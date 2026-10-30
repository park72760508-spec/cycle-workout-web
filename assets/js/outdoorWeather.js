/**
 * 루트맵 오늘의 날씨 카드 (2026-10-28)
 *  - 지역: 현재 위치 → 시도·구군(루트맵 reverseRegion: 카카오 → OSM)
 *  - 날씨: 라이딩 모임과 같은 getOpenRidingDepartureWeather(기상청 단기예보, 2시간 간격)
 *    2026-10-31: hours=all 로 오늘·내일 0~22시를 받아, 지금 시간대부터 24시간(12칸)을 좌우 스크롤로 표시
 *  - 미세먼지(PM10)·초미세먼지(PM2.5)·자외선: Open-Meteo Air Quality(현재값) → 환경부·기상청 등급
 *  - 첫 줄: 구·군 + 오늘의 대표 날씨(비·눈이면 최고 강수확률) + 미세·초미세·자외선, 바탕은 반투명 남색
 * 조회는 지역이 바뀌거나(3km 이상 이동) 30분이 지났을 때만 다시 한다.
 */
(function () {
  'use strict';
  var WX_URL = 'https://asia-northeast3-stelvio-ai.cloudfunctions.net/getOpenRidingDepartureWeather';
  var AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
  var HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
  var REFRESH_MS = 30 * 60 * 1000;
  var MOVE_M = 3000;
  var NOW_URL = 'https://api.open-meteo.com/v1/forecast'; // 현재 기온(2026-10-28)

  var S = {
    region: '', label: '', regionLL: null, regionAt: 0, regionBusy: false,
    wx: null, wx2: null, wxDate: '', wxAt: 0, wxBusy: false, wxErr: false,
    aq: null, aqLL: null, aqAt: 0, aqBusy: false,
    tempNow: null,
    collapsed: true // 기본은 접힌 상태(루트맵을 열 때마다 접힘으로 시작)
  };

  function el() { return document.getElementById('outdWeather'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function kstNow() { var d = new Date(); return new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60000); }
  function kstYmd() { var k = kstNow(); return k.getFullYear() + '-' + String(k.getMonth() + 1).padStart(2, '0') + '-' + String(k.getDate()).padStart(2, '0'); }
  function dist(a, b) {
    if (!a || !b) return Infinity;
    var R = 6371000, t = Math.PI / 180, dLa = (b[0] - a[0]) * t, dLo = (b[1] - a[1]) * t;
    var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  /** 기상청 지역 키('서울특별시 송파구', '경기도 수원시', '세종특별자치시')로 맞춤 */
  function regionKey(sido, sigungu) {
    sido = String(sido || '').trim(); sigungu = String(sigungu || '').trim();
    if (/세종/.test(sido)) return { key: '세종특별자치시', label: '세종' };
    var fix = { '강원도': '강원특별자치도', '전라북도': '전북특별자치도', '제주도': '제주특별자치도' };
    if (fix[sido]) sido = fix[sido];
    var sg = sigungu.split(/\s+/)[0] || '';
    if (!sido || !sg) return null;
    return { key: sido + ' ' + sg, label: sg };
  }

  // ---- 등급(환경부 미세먼지 · 기상청 자외선) ----
  function pm10Grade(v) { return v == null ? null : v <= 30 ? ['좋음', 'g1'] : v <= 80 ? ['보통', 'g2'] : v <= 150 ? ['나쁨', 'g3'] : ['매우나쁨', 'g4']; }
  function pm25Grade(v) { return v == null ? null : v <= 15 ? ['좋음', 'g1'] : v <= 35 ? ['보통', 'g2'] : v <= 75 ? ['나쁨', 'g3'] : ['매우나쁨', 'g4']; }
  function uvGrade(v) { return v == null ? null : v < 3 ? ['낮음', 'u1'] : v < 6 ? ['보통', 'u2'] : v < 8 ? ['높음', 'u3'] : v < 11 ? ['매우높음', 'u4'] : ['위험', 'u5']; }

  /**
   * 지금 시각이 들어 있는 예보 칸(2026-10-30): 칸 h 는 h시 ~ 다음 칸 전까지(예: 10시 칸 = 10:00~11:59).
   * 5시대는 첫 칸(6시), 18~19시대는 마지막 칸(18시). 현재 기온도 이 칸 온도로 표시해 시간대별 온도와 맞춘다.
   */
  function kstYmdOffset(days) {
    var k = kstNow(); k.setDate(k.getDate() + days);
    return k.getFullYear() + '-' + String(k.getMonth() + 1).padStart(2, '0') + '-' + String(k.getDate()).padStart(2, '0');
  }
  function curSlotHour() { return Math.floor(kstNow().getHours() / 2) * 2; }
  function findHour(list, h) {
    var it = null;
    (list || []).forEach(function (x) { if (x && x.hour === h) it = x; });
    return it;
  }
  /** 지금 시간대부터 24시간: 오늘 지금~22시, 이어서 내일 0시~지금 직전 */
  function slots() {
    var cur = curSlotHour(), out = [];
    HOURS.forEach(function (h) { if (h >= cur) out.push({ hour: h, it: findHour(S.wx, h), tomorrow: false }); });
    HOURS.forEach(function (h) { if (h < cur) out.push({ hour: h, it: findHour(S.wx2, h), tomorrow: true }); });
    return out;
  }
  /** 지금 시각이 들어 있는 2시간 칸(현재 기온도 이 칸 온도로 표시해 시간대별 온도와 맞춘다) */
  function nowSlot() {
    var it = findHour(S.wx, curSlotHour());
    return it && it.tempC != null ? it : null;
  }
  /**
   * 대표 날씨(2026-10-31: 지금부터 24시간 예보 기준, 예전엔 오늘 낮 6~18시):
   *  비·눈 예보가 한 번이라도 있으면 🌧️/🌨️ + 그날 최고 강수확률, 아니면 가장 많은 하늘 상태(같으면 더 흐린 쪽).
   *  비가 없어도 강수확률 30% 이상이면 % 표시.
   */
  function representative() {
    if (!S.wx || !S.wx.length) return null;
    var cnt = [0, 0, 0], rain = 0, maxPop = null;
    slots().map(function (c) { return c.it; }).forEach(function (x) {
      if (!x || (x.tempC == null && !x.icon)) return;
      if (x.pop != null && isFinite(x.pop)) maxPop = maxPop == null ? x.pop : Math.max(maxPop, x.pop);
      var pty = Number(x.pty || 0), sky = Number(x.sky || 0), ic = String(x.icon || '');
      if (pty === 3 || /❄|🌨/.test(ic)) { rain = Math.max(rain, 2); return; }
      if (pty > 0 || /🌧|🌦|⛈|☔/.test(ic)) { rain = Math.max(rain, 1); return; }
      if (sky === 4 || /☁/.test(ic) && !/⛅|🌤|🌥/.test(ic)) cnt[2]++;
      else if (sky === 3 || /⛅|🌤|🌥/.test(ic)) cnt[1]++;
      else cnt[0]++;
    });
    var icon, label;
    if (rain === 2) { icon = '🌨️'; label = '눈'; }
    else if (rain === 1) { icon = '🌧️'; label = '비'; }
    else {
      var k = 0; for (var i = 1; i < 3; i++) if (cnt[i] >= cnt[k]) k = i;
      icon = ['☀️', '⛅', '☁️'][k]; label = ['맑음', '구름많음', '흐림'][k];
    }
    var showPop = maxPop != null && (rain > 0 || maxPop >= 30);
    return { icon: icon, label: label, pop: showPop ? Math.round(maxPop) : null };
  }

  /** 2026-10-30: 등급 글자 없이 이름 + 색 점만(등급은 길게 누르기·읽어주기용 title/aria 에) */
  function pill(name, g, valTxt) {
    if (!g) return '<span class="outd-wx__pill" title="' + name + ' 정보 없음" aria-label="' + name + ' 정보 없음"><b>' + name + '</b><i class="outd-wx__dot"></i></span>';
    var t = esc(name + ' ' + g[0] + (valTxt ? ' (' + valTxt + ')' : ''));
    return '<span class="outd-wx__pill outd-wx__pill--' + g[1] + '" title="' + t + '" aria-label="' + t + '"><b>' + name + '</b><i class="outd-wx__dot"></i></span>';
  }

  function render() {
    var box = el();
    if (!box) return;
    box.className = 'outd-wx' + (S.collapsed ? ' is-collapsed' : '');
    var s = nowSlot();
    var rep = representative();
    var now = rep ? '<span class="outd-wx__now" title="오늘의 대표 날씨: ' + rep.label + '">' + rep.icon +
      (rep.pop != null ? '<span class="outd-wx__pop">' + rep.pop + '%</span>' : '') + '</span>' : '';
    // 현재 기온 = 지금 시각이 들어 있는 시간대 칸의 온도(시간대별 온도와 같게). 밤 등 칸이 없을 때만 Open-Meteo 현재값
    var tNow = s && s.tempC != null ? s.tempC : S.tempNow;
    if (tNow != null) now += '<span class="outd-wx__tnow">' + Math.round(tNow) + '°</span>';
    var place = S.label ? esc(S.label) : '위치 확인 중';
    var aq = S.aq || {};
    var pills = pill('미세', pm10Grade(aq.pm10), aq.pm10 != null ? Math.round(aq.pm10) + '㎍/㎥' : '') +
      pill('초미세', pm25Grade(aq.pm25), aq.pm25 != null ? Math.round(aq.pm25) + '㎍/㎥' : '') +
      pill('자외선', uvGrade(aq.uv), aq.uv != null ? String(Math.round(aq.uv)) : '');
    var head = '<div class="outd-wx__head"><span class="outd-wx__place"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.6-6-10.5A6 6 0 0 1 18 10.5C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2"/></svg>' + place + '</span>' + now +
      '<span class="outd-wx__pills">' + pills + '</span>' +
      '<span class="outd-wx__chev" aria-hidden="true"></span></div>';
    var body = '';
    if (!S.collapsed) {
      if (S.wx && S.wx.length) {
        var firstTomorrow = true;
        body = '<div class="outd-wx__hours">' + slots().map(function (c, idx) {
          var it = c.it, h = c.hour;
          var lbl = idx === 0 ? '지금' : h + '시';
          if (c.tomorrow && firstTomorrow) { firstTomorrow = false; lbl = '<b class="outd-wx__day">내일</b> ' + lbl; }
          return '<div class="outd-wx__cell' + (idx === 0 ? ' is-now' : '') + (c.tomorrow ? ' is-tmr' : '') + '">' +
            '<span class="outd-wx__h">' + lbl + '</span>' +
            // 2026-10-28: 시간 아래에 날씨 아이콘과 온도를 한 줄로 붙여서
            '<span class="outd-wx__wt"><span class="outd-wx__i">' + (it && it.icon ? it.icon : '–') + '</span>' +
            '<span class="outd-wx__t">' + (it && it.tempC != null ? Math.round(it.tempC) + '°' : '-') + '</span></span></div>';
        }).join('') + '</div>';
      } else {
        body = '<div class="outd-wx__msg">' + (S.wxErr ? '날씨 정보를 불러올 수 없습니다' : S.region ? '날씨 불러오는 중…' : '현재 위치를 확인하고 있습니다') + '</div>';
      }
    }
    var oldH = box.querySelector('.outd-wx__hours');
    var keepX = oldH && box.getAttribute('data-slot') === String(curSlotHour()) ? oldH.scrollLeft : 0;
    box.innerHTML = head + body;
    box.setAttribute('data-slot', String(curSlotHour()));
    var newH = box.querySelector('.outd-wx__hours');
    if (newH && keepX) newH.scrollLeft = keepX;
    box.setAttribute('aria-label', '오늘의 날씨 ' + place);
    fitHead(box);
  }

  /*
   * 2026-10-29: 화면 폭이 좁은 기종(갤럭시 S 기본형·플립 등 360px)에서도 미세·초미세·자외선 항목명을 항상 표시.
   *  예전엔 360px 이하에서 항목명을 숨겨 상태(좋음·보통)만 보였다. 이제 한 줄에 다 안 들어가면
   *  세 항목을 둘째 줄로 내린다(위치·날씨·접기 버튼은 첫 줄 그대로).
   */
  function fitHead(box) {
    box = box || el();
    if (!box) return;
    box.classList.remove('outd-wx--wrap');
    var head = box.querySelector('.outd-wx__head');
    if (head && head.clientWidth > 0 && head.scrollWidth > head.clientWidth + 1) box.classList.add('outd-wx--wrap');
  }
  var fitT = null;
  window.addEventListener('resize', function () {
    clearTimeout(fitT);
    fitT = setTimeout(function () { fitHead(); }, 120);
  });

  function fetchDay(ymd) {
    var q = new URLSearchParams({ region: S.region, date: ymd, hours: 'all' });
    return fetch(WX_URL + '?' + q.toString(), { method: 'GET', mode: 'cors' })
      .then(function (r) { return r.json(); })
      .then(function (d) { return d && d.success && Array.isArray(d.hours) ? d.hours : null; }, function () { return null; });
  }
  function fetchWx() {
    if (!S.region || S.wxBusy) return;
    S.wxBusy = true;
    var today = kstYmd();
    Promise.all([fetchDay(today), fetchDay(kstYmdOffset(1))]).then(function (r) {
      S.wxBusy = false; S.wxAt = Date.now();
      if (r[0] && r[0].length) { S.wx = r[0]; S.wx2 = r[1] || null; S.wxDate = today; S.wxErr = false; }
      else { S.wxErr = !S.wx; }
      render();
    });
  }

  function fetchAq(lat, lng) {
    if (S.aqBusy) return;
    S.aqBusy = true;
    var url = AQ_URL + '?latitude=' + lat.toFixed(4) + '&longitude=' + lng.toFixed(4) + '&current=pm10,pm2_5,uv_index&timezone=Asia%2FSeoul';
    fetch(url, { method: 'GET', mode: 'cors' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        S.aqBusy = false; S.aqAt = Date.now(); S.aqLL = [lat, lng];
        var c = d && d.current;
        if (c) S.aq = { pm10: c.pm10 != null ? Number(c.pm10) : null, pm25: c.pm2_5 != null ? Number(c.pm2_5) : null, uv: c.uv_index != null ? Number(c.uv_index) : null };
        render();
      }, function () { S.aqBusy = false; S.aqAt = Date.now(); });
    // 현재 기온 — 같은 주기로 함께 갱신
    fetch(NOW_URL + '?latitude=' + lat.toFixed(4) + '&longitude=' + lng.toFixed(4) + '&current=temperature_2m&timezone=Asia%2FSeoul', { method: 'GET', mode: 'cors' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var t = d && d.current && d.current.temperature_2m;
        if (t != null && isFinite(Number(t))) { S.tempNow = Number(t); render(); }
      }, function () {});
  }

  /**
   * 위치가 들어올 때마다 호출(내부에서 자주 조회하지 않게 거름).
   * @param {number} lat @param {number} lng
   * @param {function(number,number):Promise<{sido:string,sigungu:string}>} reverse 루트맵 reverseRegion
   */
  function update(lat, lng, reverse) {
    if (!isFinite(lat) || !isFinite(lng)) return;
    var now = Date.now(), ll = [lat, lng];
    if (!S.regionBusy && reverse && (!S.region || dist(S.regionLL, ll) > MOVE_M || now - S.regionAt > REFRESH_MS)) {
      S.regionBusy = true;
      reverse(lat, lng).then(function (rg) {
        S.regionBusy = false; S.regionAt = Date.now(); S.regionLL = ll;
        var k = rg && regionKey(rg.sido, rg.sigungu);
        if (!k) { render(); return; }
        var changed = k.key !== S.region;
        S.region = k.key; S.label = k.label;
        if (changed) { S.wx = null; S.wxErr = false; S.wxAt = 0; }
        if (changed || Date.now() - S.wxAt > REFRESH_MS) fetchWx();
        render();
      }, function () { S.regionBusy = false; S.regionAt = Date.now(); });
    } else if (S.region && (now - S.wxAt > REFRESH_MS || (S.wxDate && S.wxDate !== kstYmd()))) {
      fetchWx();
    }
    if (!S.aq || dist(S.aqLL, ll) > MOVE_M || now - S.aqAt > REFRESH_MS) fetchAq(lat, lng);
    // 2시간 칸이 바뀌면(예: 19:59 → 20:00) 첫 칸을 새 시간대로
    var b = el();
    if (b && S.wx && b.getAttribute('data-slot') !== String(curSlotHour())) render();
  }

  function toggle(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    S.collapsed = !S.collapsed;
    render();
  }
  /** 루트맵을 열 때 — 기본(접힌 상태)으로 시작 */
  function resetView() { S.collapsed = true; render(); }

  window.OutdoorWeather = { update: update, render: render, toggle: toggle, resetView: resetView, fit: fitHead };
})();

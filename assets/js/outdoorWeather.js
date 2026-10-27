/**
 * 루트맵 오늘의 날씨 카드 (2026-10-28)
 *  - 지역: 현재 위치 → 시도·구군(루트맵 reverseRegion: 카카오 → OSM)
 *  - 날씨: 라이딩 모임과 같은 getOpenRidingDepartureWeather(기상청 단기예보, 6~18시 2시간 간격)
 *  - 미세먼지(PM10)·초미세먼지(PM2.5)·자외선: Open-Meteo Air Quality(현재값) → 환경부·기상청 등급
 *  - 첫 줄: 구·군 + 오늘의 대표 날씨(비·눈이면 최고 강수확률) + 미세·초미세·자외선, 바탕은 반투명 남색
 * 조회는 지역이 바뀌거나(3km 이상 이동) 30분이 지났을 때만 다시 한다.
 */
(function () {
  'use strict';
  var WX_URL = 'https://asia-northeast3-stelvio-ai.cloudfunctions.net/getOpenRidingDepartureWeather';
  var AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
  var HOURS = [6, 8, 10, 12, 14, 16, 18];
  var REFRESH_MS = 30 * 60 * 1000;
  var MOVE_M = 3000;
  var LS_COLLAPSED = 'stelvio_outd_wx_collapsed';

  var S = {
    region: '', label: '', regionLL: null, regionAt: 0, regionBusy: false,
    wx: null, wxAt: 0, wxBusy: false, wxErr: false,
    aq: null, aqLL: null, aqAt: 0, aqBusy: false,
    collapsed: false
  };
  try { S.collapsed = localStorage.getItem(LS_COLLAPSED) === '1'; } catch (e) {}

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

  /** 지금 시각에 가장 가까운 예보 칸 */
  function nowSlot() {
    if (!S.wx || !S.wx.length) return null;
    var h = kstNow().getHours() + kstNow().getMinutes() / 60, best = null, bd = 99;
    if (h < 5 || h >= 20) return null; // 밤에는 예보 칸(6~18시)을 '지금 날씨'로 보이지 않게
    S.wx.forEach(function (x) { if (x && x.tempC != null && Math.abs(x.hour - h) < bd) { bd = Math.abs(x.hour - h); best = x; } });
    return best;
  }
  /**
   * 오늘의 대표 날씨(낮 6~18시 예보 기준, 2026-10-28):
   *  비·눈 예보가 한 번이라도 있으면 🌧️/🌨️ + 그날 최고 강수확률, 아니면 가장 많은 하늘 상태(같으면 더 흐린 쪽).
   *  비가 없어도 강수확률 30% 이상이면 % 표시.
   */
  function representative() {
    if (!S.wx || !S.wx.length) return null;
    var cnt = [0, 0, 0], rain = 0, maxPop = null;
    S.wx.forEach(function (x) {
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

  function pill(name, g, valTxt) {
    if (!g) return '<span class="outd-wx__pill"><b>' + name + '</b><i class="outd-wx__dot"></i>-</span>';
    return '<span class="outd-wx__pill outd-wx__pill--' + g[1] + '" title="' + esc(name + ' ' + valTxt) + '"><b>' + name + '</b><i class="outd-wx__dot"></i>' + g[0] + '</span>';
  }

  function render() {
    var box = el();
    if (!box) return;
    box.className = 'outd-wx' + (S.collapsed ? ' is-collapsed' : '');
    var s = nowSlot();
    var rep = representative();
    var now = rep ? '<span class="outd-wx__now" title="오늘의 대표 날씨: ' + rep.label + '">' + rep.icon +
      (rep.pop != null ? '<span class="outd-wx__pop">' + rep.pop + '%</span>' : '') + '</span>' : '';
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
        var curH = s ? s.hour : -1;
        body = '<div class="outd-wx__hours">' + HOURS.map(function (h) {
          var it = null; S.wx.forEach(function (x) { if (x && x.hour === h) it = x; });
          return '<div class="outd-wx__cell' + (h === curH ? ' is-now' : '') + '"><span class="outd-wx__h">' + h + '시</span>' +
            // 2026-10-28: 시간 아래에 날씨 아이콘과 온도를 한 줄로 붙여서
            '<span class="outd-wx__wt"><span class="outd-wx__i">' + (it && it.icon ? it.icon : '–') + '</span>' +
            '<span class="outd-wx__t">' + (it && it.tempC != null ? Math.round(it.tempC) + '°' : '-') + '</span></span></div>';
        }).join('') + '</div>';
      } else {
        body = '<div class="outd-wx__msg">' + (S.wxErr ? '날씨 정보를 불러올 수 없습니다' : S.region ? '날씨 불러오는 중…' : '현재 위치를 확인하고 있습니다') + '</div>';
      }
    }
    box.innerHTML = head + body;
    box.setAttribute('aria-label', '오늘의 날씨 ' + place);
  }

  function fetchWx() {
    if (!S.region || S.wxBusy) return;
    S.wxBusy = true;
    var q = new URLSearchParams({ region: S.region, date: kstYmd() });
    fetch(WX_URL + '?' + q.toString(), { method: 'GET', mode: 'cors' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        S.wxBusy = false; S.wxAt = Date.now();
        if (d && d.success && Array.isArray(d.hours) && d.hours.length) { S.wx = d.hours; S.wxErr = false; }
        else { S.wxErr = !S.wx; }
        render();
      }, function () { S.wxBusy = false; S.wxAt = Date.now(); S.wxErr = !S.wx; render(); });
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
    } else if (S.region && now - S.wxAt > REFRESH_MS) {
      fetchWx();
    }
    if (!S.aq || dist(S.aqLL, ll) > MOVE_M || now - S.aqAt > REFRESH_MS) fetchAq(lat, lng);
  }

  function toggle(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    S.collapsed = !S.collapsed;
    try { localStorage.setItem(LS_COLLAPSED, S.collapsed ? '1' : '0'); } catch (err) {}
    render();
  }

  window.OutdoorWeather = { update: update, render: render, toggle: toggle };
})();

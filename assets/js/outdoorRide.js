/**
 * 아웃도어 라이딩 (2026-10-19) — #outdoorRideScreen
 *
 * - 휴대폰 GPS(navigator.geolocation.watchPosition)로 현재 속도·이동 거리·평균 속도·경과 시간·누적 고도 계산
 * - GPX 코스맵(라이딩 모임 코스 또는 내 코스 라이브러리)을 지도에 그리고 실시간 안내(가민 코스 안내와 비슷하게):
 *   진행 방향 회전 안내(○○m 후 좌/우회전), 코스 이탈 경고, 남은 거리
 * - 라이딩 시작/일시정지, 종료 시 훈련 일지 저장(saveStravaActivityToFirebase, source 'stelvio_outdoor' → Supabase rides
 *   'stelvio', 경로는 summary_polyline) + GPX 파일 받기
 * 진입: 라이딩 모임 상세 "이 코스로 아웃도어 라이딩" → window.openOutdoorRide({ gpxUrl, title, rideId })
 */
(function () {
  'use strict';

  var SCREEN_ID = 'outdoorRideScreen';
  var GAUGE_MAX_KMH = 60;
  var OFF_COURSE_M = 45; // 코스에서 이만큼 벗어나면 이탈 경고
  var TURN_MIN_DEG = 35; // 이 각도 이상 꺾이면 회전 안내
  var TURN_ANNOUNCE_M = 400; // 이 거리 안의 다음 회전만 안내
  var TURN_BIG_M = 150; // 이 거리 안이면 큰 회전 화살표 카드 + 지도 확대 + 회전 구간 강조
  var TURN_ZOOM = 18;

  var st = {
    status: 'idle', // idle | running | paused
    elapsedMs: 0,
    runSince: 0,
    startedAt: 0,
    distanceM: 0,
    elevGainM: 0,
    altBase: null,
    altEma: null,
    speedKmh: 0,
    displaySpeed: 0,
    lastFix: null, // { lat, lng, t, acc }
    lastFixAt: 0,
    lastTrackPt: null,
    track: [], // [lat, lng, ele|null, timeMs]
    watchId: null,
    map: null,
    meMarker: null,
    trail: null,
    course: null, // { title, latlngs, cum[], turns[], totalM }
    courseLayer: null,
    courseIdx: 0,
    follow: true,
    timer: null,
    rafId: null,
    prevScreen: '',
    gpsQuality: 0,
    lastNavText: '',
    turnBigIdx: null,
    turnBuzz: {},
    turnLayer: null,
    turnLayerIdx: null,
    turnZoomed: false,
    zoomBeforeTurn: 16
  };

  function $(id) { return document.getElementById(id); }
  function setText(id, v) {
    var el = $(id);
    if (el && el.textContent !== String(v)) el.textContent = String(v);
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type);
  }
  function isActive() {
    var el = $(SCREEN_ID);
    return !!(el && el.classList.contains('active'));
  }

  /* ---------- 지리 계산 ---------- */
  function hav(lat1, lon1, lat2, lon2) {
    var R = 6371000;
    var toR = Math.PI / 180;
    var dLat = (lat2 - lat1) * toR;
    var dLon = (lon2 - lon1) * toR;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function bearing(lat1, lon1, lat2, lon2) {
    var toR = Math.PI / 180;
    var y = Math.sin((lon2 - lon1) * toR) * Math.cos(lat2 * toR);
    var x = Math.cos(lat1 * toR) * Math.sin(lat2 * toR) - Math.sin(lat1 * toR) * Math.cos(lat2 * toR) * Math.cos((lon2 - lon1) * toR);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function angleDiff(a, b) {
    var d = (b - a + 540) % 360 - 180;
    return d; // -180~180, + = 오른쪽
  }

  /* ---------- 표시 ---------- */
  function fmtHms(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }
  function elapsedNow() {
    return st.elapsedMs + (st.status === 'running' && st.runSince ? Date.now() - st.runSince : 0);
  }

  function buildGaugeScale() {
    var ticks = $('outd-gauge-ticks');
    var labels = $('outd-gauge-labels');
    if (!ticks || !labels || ticks.childNodes.length) return;
    var ns = 'http://www.w3.org/2000/svg';
    var cx = 100, cy = 140, r = 80;
    // 눈금: 모바일 개인훈련 속도계와 같은 디자인 — 총 25개(주눈금 7 + 보조 18), 흰색,
    // 주눈금(10 km/h마다) 길이 14·두께 2.5, 보조(2.5 km/h마다) 길이 7·두께 1.5, 안쪽 시작 반지름 70
    var innerR = r - 10;
    for (var i0 = 0; i0 <= 24; i0++) {
      var major = i0 % 4 === 0;
      var rad = Math.PI + (i0 / 24) * Math.PI;
      var len = major ? 14 : 7;
      var ln = document.createElementNS(ns, 'line');
      ln.setAttribute('x1', cx + innerR * Math.cos(rad));
      ln.setAttribute('y1', cy + innerR * Math.sin(rad));
      ln.setAttribute('x2', cx + (innerR + len) * Math.cos(rad));
      ln.setAttribute('y2', cy + (innerR + len) * Math.sin(rad));
      ln.setAttribute('stroke', '#ffffff');
      ln.setAttribute('stroke-width', major ? '2.5' : '1.5');
      ticks.appendChild(ln);
    }
    // 숫자: 0km/h, 10, 20, 30, 40, 50, 60 (원 바깥, 다른 계기판과 같은 반지름 98)
    for (var i = 0; i <= 6; i++) {
      var val = i * 10;
      var ang = Math.PI + (i / 6) * Math.PI;
      var t = document.createElementNS(ns, 'text');
      t.setAttribute('x', cx + 98 * Math.cos(ang));
      t.setAttribute('y', cy + 98 * Math.sin(ang));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'middle');
      t.setAttribute('fill', val === 30 ? '#ef4444' : '#ffffff'); // 30 km/h 는 빨간색
      t.setAttribute('font-size', '10');
      t.setAttribute('font-weight', '600');
      t.textContent = val === 0 ? '0km/h' : String(val);
      labels.appendChild(t);
    }
  }

  /** 정수 부분은 가운데(text-anchor middle), 소수점 이하는 정수 오른쪽 끝에 작게 붙인다 */
  function setSplitNumber(intId, decId, value, decimals) {
    var intEl = $(intId);
    var decEl = $(decId);
    if (!intEl || !decEl) return;
    var v = Math.max(0, Number(value) || 0);
    var str = v.toFixed(decimals);
    var dot = str.indexOf('.');
    var ip = dot >= 0 ? str.slice(0, dot) : str;
    var dp = dot >= 0 ? str.slice(dot) : '';
    var changed = false;
    if (intEl.textContent !== ip) { intEl.textContent = ip; changed = true; }
    if (decEl.textContent !== dp) { decEl.textContent = dp; changed = true; }
    if (changed || !decEl.__placed) {
      var w = 0;
      try { w = intEl.getComputedTextLength(); } catch (e) {}
      if (w > 0) {
        decEl.setAttribute('x', (Number(intEl.getAttribute('x')) + w / 2 + 1).toFixed(1));
        decEl.__placed = true;
      }
    }
  }

  function renderStats() {
    var el = elapsedNow();
    setText('outd-main-timer', fmtHms(el));
    setSplitNumber('outd-ui-distance', 'outd-ui-distance-dec', st.distanceM / 1000, 2);
    var avg = el > 0 ? (st.distanceM / 1000) / (el / 3600000) : 0;
    setText('outd-ui-avg', (isFinite(avg) ? avg : 0).toFixed(1));
    setText('outd-ui-elev', Math.round(st.elevGainM));
    var now = new Date();
    setText('outd-ui-clock', String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'));
    // GPS 신호가 5초 넘게 끊기면 속도 0 으로
    if (Date.now() - st.lastFixAt > 5000) st.speedKmh = 0;
  }

  function loop() {
    if (!isActive()) { st.rafId = null; return; }
    var diff = st.speedKmh - st.displaySpeed;
    st.displaySpeed = Math.abs(diff) > 0.05 ? st.displaySpeed + diff * 0.15 : st.speedKmh;
    var ratio = Math.min(Math.max(st.displaySpeed / GAUGE_MAX_KMH, 0), 1);
    var needle = $('outd-gauge-needle');
    if (needle) needle.setAttribute('transform', 'translate(100, 140) rotate(' + (-90 + ratio * 180).toFixed(2) + ')');
    // 현재 속도까지 원호가 하늘색으로 차오름(벤츠 디지털 계기판 스윕)
    var sweep = $('outd-gauge-sweep');
    if (sweep) {
      if (ratio < 0.005) {
        if (sweep.style.display !== 'none') sweep.style.display = 'none';
      } else {
        var end = Math.PI + ratio * Math.PI;
        var ex = (100 + 80 * Math.cos(end)).toFixed(2);
        var ey = (140 + 80 * Math.sin(end)).toFixed(2);
        sweep.setAttribute('d', 'M 20 140 A 80 80 0 0 1 ' + ex + ' ' + ey);
        if (sweep.style.display === 'none') sweep.style.display = '';
      }
    }
    setSplitNumber('outd-ui-speed', 'outd-ui-speed-dec', st.speedKmh, 1);
    st.rafId = requestAnimationFrame(loop);
  }

  function renderToggle() {
    var img = $('outdToggleImg');
    if (img) img.setAttribute('href', st.status === 'running' ? 'assets/img/pause0.png' : 'assets/img/play0.png');
    var pulse = $('outdStartPulseWrap');
    if (pulse) {
      pulse.classList.toggle('pulse-active', st.status !== 'running');
      pulse.classList.toggle('pulse-hidden', st.status === 'running');
    }
  }

  function renderGps(acc) {
    var q = 0;
    if (acc != null && isFinite(acc)) q = acc <= 10 ? 4 : acc <= 20 ? 3 : acc <= 35 ? 2 : 1;
    st.gpsQuality = q;
    var dot = $('outdGpsDot');
    if (dot) {
      dot.classList.toggle('is-good', q >= 3);
      dot.classList.toggle('is-weak', q > 0 && q < 3);
    }
    var bars = $('outdGpsBars');
    if (bars) Array.prototype.forEach.call(bars.children, function (b, i) { b.classList.toggle('on', i < q); });
    setText('outdGpsText', q === 0 ? 'GPS 신호 없음' : 'GPS 연결됨 · 정확도 ±' + Math.round(acc) + 'm');
  }

  /* ---------- GPS ---------- */
  function onPosition(pos) {
    var c = pos && pos.coords;
    if (!c) return;
    var lat = c.latitude, lng = c.longitude, acc = c.accuracy;
    var t = pos.timestamp || Date.now();
    renderGps(acc);
    st.lastFixAt = Date.now();
    updateMeOnMap(lat, lng);

    var prev = st.lastFix;
    st.lastFix = { lat: lat, lng: lng, t: t, acc: acc };

    // 현재 속도: 기기가 주는 speed(m/s) 우선, 없으면 직전 위치와의 거리/시간
    var spd = null;
    if (c.speed != null && isFinite(c.speed) && c.speed >= 0) spd = c.speed * 3.6;
    var d = prev ? hav(prev.lat, prev.lng, lat, lng) : 0;
    var dt = prev ? (t - prev.t) / 1000 : 0;
    if (spd == null && prev && dt > 0) spd = (d / dt) * 3.6;
    if (spd != null && isFinite(spd)) st.speedKmh = spd < 1.5 ? 0 : Math.min(spd, 120);

    if (st.status === 'running') {
      // 거리 누적: 정확도가 괜찮고(≤35m), 순간 이동(>30m/s)이 아니며, 실제로 움직였을 때만
      if (prev && acc <= 35 && dt > 0 && d / dt < 30 && (st.speedKmh >= 1.5 || d > Math.max(3, acc * 0.5))) {
        st.distanceM += d;
      }
      // 누적 고도: 고도값을 부드럽게(EMA) 한 뒤 기준점보다 3m 이상 오르면 더한다(GPS 고도 흔들림 제거)
      if (c.altitude != null && isFinite(c.altitude) && acc <= 35) {
        st.altEma = st.altEma == null ? c.altitude : st.altEma + (c.altitude - st.altEma) * 0.25;
        if (st.altBase == null) st.altBase = st.altEma;
        if (st.altEma - st.altBase >= 3) {
          st.elevGainM += st.altEma - st.altBase;
          st.altBase = st.altEma;
        } else if (st.altEma < st.altBase) {
          st.altBase = st.altEma;
        }
      }
      var lp = st.lastTrackPt;
      if (!lp || hav(lp[0], lp[1], lat, lng) >= 5) {
        var pt = [lat, lng, c.altitude != null && isFinite(c.altitude) ? Math.round(c.altitude * 10) / 10 : null, t];
        st.track.push(pt);
        st.lastTrackPt = pt;
        if (st.trail) st.trail.addLatLng([lat, lng]);
      }
    }
    updateNavigation(lat, lng);
  }

  function onPositionError(err) {
    renderGps(null);
    if (err && err.code === 1) setText('outdGpsText', '위치 권한이 필요합니다');
  }

  function startGps() {
    if (st.watchId != null) return;
    if (!navigator.geolocation) {
      setText('outdGpsText', '이 기기는 GPS를 지원하지 않습니다');
      return;
    }
    st.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000
    });
  }
  function stopGps() {
    if (st.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(st.watchId);
    st.watchId = null;
  }

  /* ---------- 지도 ---------- */
  function ensureMap() {
    if (st.map || typeof window.L === 'undefined') return st.map;
    var L = window.L;
    st.map = L.map('outdMap', { zoomControl: false, attributionControl: true, fadeAnimation: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      updateWhenIdle: true,
      attribution: '&copy; OpenStreetMap'
    }).addTo(st.map);
    st.map.setView([37.5665, 126.978], 13);
    st.trail = L.polyline([], { color: '#00d4aa', weight: 4, opacity: 0.95 }).addTo(st.map);
    // 사용자가 지도를 직접 움직이면 따라가기 해제(◎ 버튼으로 복귀)
    st.map.on('dragstart', function () { st.follow = false; });
    return st.map;
  }

  function updateMeOnMap(lat, lng) {
    var map = ensureMap();
    if (!map) return;
    var L = window.L;
    if (!st.meMarker) {
      st.meMarker = L.marker([lat, lng], {
        icon: L.divIcon({ className: '', html: '<div class="outd-me-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        interactive: false,
        zIndexOffset: 1000
      }).addTo(map);
      map.setView([lat, lng], Math.max(map.getZoom(), 16));
    } else {
      st.meMarker.setLatLng([lat, lng]);
      if (st.follow) map.panTo([lat, lng], { animate: true, duration: 0.5 });
    }
  }

  window.recenterOutdoorMap = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    st.follow = true;
    if (st.map && st.lastFix) st.map.setView([st.lastFix.lat, st.lastFix.lng], Math.max(st.map.getZoom(), 16));
  };

  /* ---------- 코스 & 내비게이션 ---------- */
  function prepareCourse(title, latlngs) {
    var cum = [0];
    for (var i = 1; i < latlngs.length; i++) {
      cum.push(cum[i - 1] + hav(latlngs[i - 1][0], latlngs[i - 1][1], latlngs[i][0], latlngs[i][1]));
    }
    // 회전 지점: 앞뒤 약 25m 구간의 진행 방향이 TURN_MIN_DEG 이상 바뀌는 곳(40m 안의 연속 후보는 가장 크게 꺾이는 곳 하나)
    var turns = [];
    var j0 = 0, j1 = 0;
    for (var k = 1; k < latlngs.length - 1; k++) {
      while (j0 < k && cum[k] - cum[j0 + 1] >= 25) j0++;
      if (j1 < k) j1 = k;
      while (j1 < latlngs.length - 1 && cum[j1] - cum[k] < 25) j1++;
      if (cum[k] - cum[j0] < 15 || cum[j1] - cum[k] < 15) continue;
      var bin = bearing(latlngs[j0][0], latlngs[j0][1], latlngs[k][0], latlngs[k][1]);
      var bout = bearing(latlngs[k][0], latlngs[k][1], latlngs[j1][0], latlngs[j1][1]);
      var delta = angleDiff(bin, bout);
      if (Math.abs(delta) < TURN_MIN_DEG) continue;
      var last = turns[turns.length - 1];
      if (last && cum[k] - last.at < 40) {
        if (Math.abs(delta) > Math.abs(last.delta)) { last.at = cum[k]; last.delta = delta; last.idx = k; }
      } else {
        turns.push({ at: cum[k], delta: delta, idx: k });
      }
    }
    return { title: title, latlngs: latlngs, cum: cum, turns: turns, totalM: cum[cum.length - 1] };
  }

  function drawCourse() {
    var map = ensureMap();
    if (!map || !st.course) return;
    var L = window.L;
    if (st.courseLayer) map.removeLayer(st.courseLayer);
    st.courseLayer = L.layerGroup().addTo(map);
    L.polyline(st.course.latlngs, { color: '#7c3aed', weight: 5, opacity: 0.85 }).addTo(st.courseLayer);
    var first = st.course.latlngs[0], lastP = st.course.latlngs[st.course.latlngs.length - 1];
    L.circleMarker(first, { radius: 6, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1 }).addTo(st.courseLayer);
    L.circleMarker(lastP, { radius: 6, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1 }).addTo(st.courseLayer);
    if (st.trail) st.trail.bringToFront();
    if (!st.lastFix) map.fitBounds(L.latLngBounds(st.course.latlngs), { padding: [16, 16] });
    var empty = $('outdMapEmpty');
    if (empty) empty.style.display = 'none';
    var nav = $('outdNav');
    if (nav) nav.style.display = 'flex';
    setText('outdNavText', st.course.title ? st.course.title : '코스를 따라 이동하세요');
    setText('outdNavRemain', (st.course.totalM / 1000).toFixed(1) + ' km');
  }

  /** 현재 위치에서 코스상 가장 가까운 지점(직전 위치 주변을 먼저 찾고, 멀면 전체 검색) */
  function nearestCourseIdx(lat, lng) {
    var c = st.course;
    var n = c.latlngs.length;
    var best = -1, bestD = Infinity;
    function scan(a, b) {
      for (var i = Math.max(0, a); i < Math.min(n, b); i++) {
        var d = hav(lat, lng, c.latlngs[i][0], c.latlngs[i][1]);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    scan(st.courseIdx - 30, st.courseIdx + 200);
    if (bestD > OFF_COURSE_M * 2) scan(0, n);
    return { idx: best, dist: bestD };
  }

  function turnWord(delta) {
    var a = Math.abs(delta);
    var side = delta > 0 ? '우' : '좌';
    if (a >= 135) return side + '측 유턴';
    if (a >= 60) return side + '회전';
    return side + '측 방향';
  }

  /* ---------- 회전 지점 확대 안내(2026-10-19) ----------
   * 다음 회전이 150m 안에 들어오면: 지도 위 큰 회전 화살표 카드(꺾이는 각도대로) + 남은 거리,
   * 지도에 회전 구간(앞뒤 40m) 노란 강조선·화살촉, 지도 확대(따라가기 중일 때), 150m·40m 진동 */
  function pointAtDist(D) {
    var c = st.course;
    var lo = 0, hi = c.cum.length - 1;
    D = Math.max(0, Math.min(c.totalM, D));
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (c.cum[mid] < D) lo = mid + 1; else hi = mid;
    }
    var i = Math.max(1, lo);
    var a = c.latlngs[i - 1], b = c.latlngs[i];
    var seg = c.cum[i] - c.cum[i - 1];
    var t = seg > 0 ? (D - c.cum[i - 1]) / seg : 0;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  /** 꺾이는 각도대로 그린 회전 화살표 SVG(위로 들어와서 delta 만큼 꺾여 나감) */
  function turnArrowSvg(delta) {
    if (Math.abs(delta) >= 135) {
      // 유턴: 위로 올라가 반원을 그리며 옆으로 내려오는 U 화살표(좌유턴은 좌우 대칭)
      var right = delta > 0;
      var fx = function (x) { return right ? x : 100 - x; };
      return '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">' +
        '<path d="M ' + fx(34) + ' 94 L ' + fx(34) + ' 42 A 20 20 0 0 ' + (right ? 1 : 0) + ' ' + fx(74) + ' 42 L ' + fx(74) + ' 62" ' +
        'fill="none" stroke="#ffffff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<polygon points="' + fx(74) + ',84 ' + fx(61) + ',62 ' + fx(87) + ',62" fill="#ffffff"/>' +
        '</svg>';
    }
    var d = Math.max(-170, Math.min(170, delta)) * Math.PI / 180;
    var cx = 50, cy = 56, L = 34;
    var ex = cx + L * Math.sin(d), ey = cy - L * Math.cos(d);
    // 화살촉
    var hx = Math.sin(d), hy = -Math.cos(d);
    var px = -hy, py = hx;
    var tipX = ex + hx * 12, tipY = ey + hy * 12;
    var l1x = ex + px * 11, l1y = ey + py * 11, l2x = ex - px * 11, l2y = ey - py * 11;
    return '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">' +
      '<path d="M 50 96 L 50 ' + cy + ' Q 50 ' + (cy - 6) + ' ' + (cx + 6 * Math.sin(d)).toFixed(1) + ' ' + (cy - 6 * Math.cos(d)).toFixed(1) + ' L ' + ex.toFixed(1) + ' ' + ey.toFixed(1) + '" ' +
      'fill="none" stroke="#ffffff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<polygon points="' + tipX.toFixed(1) + ',' + tipY.toFixed(1) + ' ' + l1x.toFixed(1) + ',' + l1y.toFixed(1) + ' ' + l2x.toFixed(1) + ',' + l2y.toFixed(1) + '" fill="#ffffff"/>' +
      '</svg>';
  }

  function turnBigEl() {
    var el = $('outdTurnBig');
    if (el) return el;
    var wrap = document.querySelector('#' + SCREEN_ID + ' .outd-map-wrap');
    if (!wrap) return null;
    el = document.createElement('div');
    el.id = 'outdTurnBig';
    el.className = 'outd-turn-big';
    el.innerHTML = '<div class="outd-turn-big__arrow"></div><div class="outd-turn-big__info"><b class="outd-turn-big__dist"></b><span class="outd-turn-big__word"></span></div>';
    wrap.appendChild(el);
    return el;
  }

  function showTurnBig(turn, dm) {
    var el = turnBigEl();
    if (!el) return;
    if (st.turnBigIdx !== turn.idx) {
      st.turnBigIdx = turn.idx;
      el.querySelector('.outd-turn-big__arrow').innerHTML = turnArrowSvg(turn.delta);
      el.querySelector('.outd-turn-big__word').textContent = turnWord(turn.delta);
      st.turnBuzz = {};
    }
    var dist = dm >= 100 ? Math.round(dm / 10) * 10 + 'm' : Math.max(0, Math.round(dm / 5) * 5) + 'm';
    var distEl = el.querySelector('.outd-turn-big__dist');
    if (distEl.textContent !== dist) distEl.textContent = dist;
    el.classList.toggle('is-near', dm <= 40);
    el.style.display = 'flex';
    // 진동: 150m 진입 1회, 40m 진입 1회
    try {
      if (navigator.vibrate) {
        if (!st.turnBuzz.far) { st.turnBuzz.far = true; navigator.vibrate(150); }
        if (dm <= 40 && !st.turnBuzz.near) { st.turnBuzz.near = true; navigator.vibrate([120, 80, 120]); }
      }
    } catch (e) {}
    drawTurnOnMap(turn);
    if (st.follow && st.map && st.lastFix && st.map.getZoom() < TURN_ZOOM && !st.turnZoomed) {
      st.turnZoomed = true;
      st.zoomBeforeTurn = st.map.getZoom();
      st.map.setView([st.lastFix.lat, st.lastFix.lng], TURN_ZOOM, { animate: true });
    }
  }

  function hideTurnBig() {
    var el = $('outdTurnBig');
    if (el && el.style.display !== 'none') el.style.display = 'none';
    st.turnBigIdx = null;
    clearTurnOnMap();
    if (st.turnZoomed && st.map && st.follow) {
      st.map.setZoom(st.zoomBeforeTurn || 16, { animate: true });
    }
    st.turnZoomed = false;
  }

  function drawTurnOnMap(turn) {
    if (!st.map || st.turnLayerIdx === turn.idx) return;
    clearTurnOnMap();
    var L = window.L;
    var pts = [];
    for (var dd = -40; dd <= 40; dd += 5) pts.push(pointAtDist(turn.at + dd));
    st.turnLayer = L.layerGroup().addTo(st.map);
    L.polyline(pts, { color: '#111827', weight: 11, opacity: 0.55, lineCap: 'round', lineJoin: 'round' }).addTo(st.turnLayer);
    L.polyline(pts, { color: '#fbbf24', weight: 7, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(st.turnLayer);
    // 화살촉: 끝점에서 진행 방향으로 삼각형
    var e1 = pts[pts.length - 2], e2 = pts[pts.length - 1];
    var map = st.map;
    var p1 = map.latLngToLayerPoint(e1), p2 = map.latLngToLayerPoint(e2);
    var vx = p2.x - p1.x, vy = p2.y - p1.y;
    var len = Math.sqrt(vx * vx + vy * vy) || 1;
    vx /= len; vy /= len;
    var size = 14;
    var tip = L.point(p2.x + vx * size, p2.y + vy * size);
    var left = L.point(p2.x - vy * size * 0.7, p2.y + vx * size * 0.7);
    var right = L.point(p2.x + vy * size * 0.7, p2.y - vx * size * 0.7);
    L.polygon([map.layerPointToLatLng(tip), map.layerPointToLatLng(left), map.layerPointToLatLng(right)], {
      color: '#111827', weight: 2, fillColor: '#fbbf24', fillOpacity: 1
    }).addTo(st.turnLayer);
    st.turnLayerIdx = turn.idx;
    if (st.meMarker && st.meMarker.bringToFront) st.meMarker.setZIndexOffset(1000);
  }

  function clearTurnOnMap() {
    if (st.turnLayer && st.map) st.map.removeLayer(st.turnLayer);
    st.turnLayer = null;
    st.turnLayerIdx = null;
  }

  function updateNavigation(lat, lng) {
    if (!st.course || !st.course.latlngs.length) return;
    var r = nearestCourseIdx(lat, lng);
    if (r.idx < 0) return;
    st.courseIdx = r.idx;
    var c = st.course;
    var nav = $('outdNav');
    var arrow = $('outdNavArrow');
    var remainM = Math.max(0, c.totalM - c.cum[r.idx]);
    setText('outdNavRemain', '남은 ' + (remainM / 1000).toFixed(1) + ' km');
    var offCourse = r.dist > OFF_COURSE_M + Math.min(30, (st.lastFix && st.lastFix.acc) || 0);
    if (nav) nav.classList.toggle('is-off', offCourse);
    if (offCourse) {
      // 코스로 돌아가는 방향
      var p = c.latlngs[r.idx];
      var toCourse = bearing(lat, lng, p[0], p[1]);
      hideTurnBig();
      setText('outdNavText', '코스를 벗어났습니다 · ' + Math.round(r.dist) + 'm');
      if (arrow) arrow.style.transform = 'rotate(' + Math.round(toCourse) + 'deg)';
      return;
    }
    if (remainM < 30) {
      hideTurnBig();
      setText('outdNavText', '도착 지점입니다');
      if (arrow) { arrow.textContent = '🏁'; arrow.style.transform = 'none'; }
      return;
    }
    if (arrow && arrow.textContent !== '↑') arrow.textContent = '↑';
    var here = c.cum[r.idx];
    var next = null;
    for (var i = 0; i < c.turns.length; i++) {
      if (c.turns[i].at > here + 8) { next = c.turns[i]; break; }
    }
    if (next && next.at - here <= TURN_ANNOUNCE_M) {
      var dm = next.at - here;
      var dist = dm >= 100 ? Math.round(dm / 10) * 10 + 'm' : Math.max(10, Math.round(dm / 5) * 5) + 'm';
      setText('outdNavText', dist + ' 후 ' + turnWord(next.delta));
      if (arrow) arrow.style.transform = 'rotate(' + Math.round(Math.max(-150, Math.min(150, next.delta))) + 'deg)';
      if (dm <= TURN_BIG_M) showTurnBig(next, dm);
      else hideTurnBig();
    } else {
      hideTurnBig();
      setText('outdNavText', next ? '코스를 따라 직진 · ' + ((next.at - here) / 1000).toFixed(1) + ' km 후 회전' : '코스를 따라 직진');
      if (arrow) arrow.style.transform = 'none';
    }
  }

  /** GPX → [[lat,lng],...] — 내비게이션 정밀도를 위해 줄이지 않고(5m 이내 연속 점만 정리) 최대 30000점 */
  function parseCourseGpx(text) {
    var doc = new DOMParser().parseFromString(String(text || ''), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('GPX 형식이 올바르지 않습니다.');
    var nodes = doc.querySelectorAll('trkpt, rtept');
    var out = [];
    for (var i = 0; i < nodes.length && out.length < 30000; i++) {
      var lat = parseFloat(nodes[i].getAttribute('lat'));
      var lon = parseFloat(nodes[i].getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      var lp = out[out.length - 1];
      if (lp && hav(lp[0], lp[1], lat, lon) < 5) continue;
      out.push([lat, lon]);
    }
    return out;
  }

  function loadCourseFromUrl(url, title) {
    if (!url) return Promise.resolve();
    setText('outdNavText', '코스맵 불러오는 중...');
    return fetch(url, { cache: 'force-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (txt) {
        var latlngs = parseCourseGpx(txt);
        if (latlngs.length < 2) throw new Error('코스 포인트가 없습니다.');
        hideTurnBig();
        st.course = prepareCourse(title || '', latlngs);
        st.courseIdx = 0;
        drawCourse();
        if (st.lastFix) updateNavigation(st.lastFix.lat, st.lastFix.lng);
      })
      .catch(function (e) {
        toast('코스맵을 불러오지 못했습니다: ' + ((e && e.message) || e), 'error');
      });
  }

  /* ---------- 메뉴 · 코스 선택 ---------- */
  window.toggleOutdoorRideMenu = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    var m = $('outdMenu');
    if (m) m.classList.toggle('show');
  };
  function closeMenu() {
    var m = $('outdMenu');
    if (m) m.classList.remove('show');
  }
  document.addEventListener('click', function (e) {
    var m = $('outdMenu');
    if (m && m.classList.contains('show') && !e.target.closest('#outdMenu') && !e.target.closest('#outdMenuBtn')) closeMenu();
  });

  function currentUid() {
    try {
      if (window.authV9 && window.authV9.currentUser) return window.authV9.currentUser.uid;
    } catch (e) {}
    return (window.currentUser && window.currentUser.id) || '';
  }

  window.openOutdoorCoursePicker = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    closeMenu();
    var picker = $('outdCoursePicker');
    var list = $('outdCoursePickerList');
    if (!picker || !list) return;
    picker.style.display = 'flex';
    list.innerHTML = '<div class="coachm-picker__empty">코스맵을 불러오는 중...</div>';
    var client = window.openRidingReadClient;
    var uid = currentUid();
    if (!client || typeof client.fetchMyGpxCoursesRouted !== 'function' || !uid) {
      list.innerHTML = '<div class="coachm-picker__empty">코스맵 목록을 불러올 수 없습니다.</div>';
      return;
    }
    client.fetchMyGpxCoursesRouted(uid, 'CYCLE').then(function (courses) {
      courses = Array.isArray(courses) ? courses.filter(function (c) { return c && c.gpxUrl; }) : [];
      if (!courses.length) {
        list.innerHTML = '<div class="coachm-picker__empty">저장된 코스맵이 없습니다.<br>라이딩 모임에서 GPX 코스를 등록하면 여기에 표시됩니다.</div>';
        return;
      }
      list.innerHTML = '';
      courses.forEach(function (c) {
        var item = document.createElement('div');
        item.className = 'coachm-picker__item';
        var km = Number(c.distanceKm || c.distance_km || 0);
        item.innerHTML = '<span class="coachm-picker__item-title"></span><span class="coachm-picker__item-min"></span>';
        item.firstChild.textContent = c.title || c.name || '코스';
        item.lastChild.textContent = km > 0 ? km.toFixed(1) + ' km' : '';
        item.addEventListener('click', function () {
          window.closeOutdoorCoursePicker();
          loadCourseFromUrl(c.gpxUrl, c.title || c.name || '');
        });
        list.appendChild(item);
      });
    }).catch(function () {
      list.innerHTML = '<div class="coachm-picker__empty">코스맵 목록을 불러오지 못했습니다.</div>';
    });
  };
  window.closeOutdoorCoursePicker = function () {
    var picker = $('outdCoursePicker');
    if (picker) picker.style.display = 'none';
  };

  /* ---------- 시작 · 일시정지 · 종료 ---------- */
  function startTimer() {
    if (st.timer) return;
    st.timer = setInterval(renderStats, 500);
  }

  window.toggleOutdoorRide = function () {
    if (st.status === 'running') {
      st.elapsedMs += Date.now() - st.runSince;
      st.runSince = 0;
      st.status = 'paused';
      toast('라이딩 일시정지', 'info');
    } else {
      if (!st.lastFix) toast('GPS 신호를 찾는 중입니다. 신호가 잡히면 거리가 기록됩니다.', 'info');
      if (!st.startedAt) st.startedAt = Date.now();
      st.runSince = Date.now();
      st.status = 'running';
      // 일시정지 동안 이동한 거리는 넣지 않도록 기준 위치를 지금으로
      st.lastTrackPt = st.lastFix ? [st.lastFix.lat, st.lastFix.lng, null, Date.now()] : st.lastTrackPt;
    }
    renderToggle();
    renderStats();
  };

  function hasRideData() {
    return st.distanceM >= 50 || elapsedNow() >= 60000;
  }

  /** Google encoded polyline (훈련 일지 지도용 summary_polyline) */
  function encodePolyline(points) {
    var out = '';
    var pLat = 0, pLng = 0;
    function enc(v) {
      v = v < 0 ? ~(v << 1) : v << 1;
      var s = '';
      while (v >= 0x20) {
        s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
      }
      return s + String.fromCharCode(v + 63);
    }
    points.forEach(function (p) {
      var lat = Math.round(p[0] * 1e5), lng = Math.round(p[1] * 1e5);
      out += enc(lat - pLat) + enc(lng - pLng);
      pLat = lat; pLng = lng;
    });
    return out;
  }
  function thin(points, maxN) {
    if (points.length <= maxN) return points;
    var step = (points.length - 1) / (maxN - 1);
    var out = [];
    for (var i = 0; i < maxN; i++) out.push(points[Math.round(i * step)]);
    return out;
  }

  function buildGpx() {
    var title = '아웃도어 라이딩' + (st.course && st.course.title ? ' · ' + st.course.title : '');
    var esc = function (s) { return String(s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); };
    var pts = st.track.map(function (p) {
      return '      <trkpt lat="' + p[0].toFixed(6) + '" lon="' + p[1].toFixed(6) + '">' +
        (p[2] != null ? '<ele>' + p[2] + '</ele>' : '') +
        '<time>' + new Date(p[3]).toISOString() + '</time></trkpt>';
    }).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="STELVIO" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      '  <metadata><name>' + esc(title) + '</name><time>' + new Date(st.startedAt || Date.now()).toISOString() + '</time></metadata>\n' +
      '  <trk><name>' + esc(title) + '</name><type>cycling</type><trkseg>\n' + pts + '\n  </trkseg></trk>\n</gpx>\n';
  }

  function downloadGpx() {
    if (st.track.length < 2) {
      toast('GPX로 저장할 경로가 없습니다.', 'error');
      return;
    }
    var d = new Date(st.startedAt || Date.now());
    var name = 'STELVIO_ride_' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
      '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '.gpx';
    var blob = new Blob([buildGpx()], { type: 'application/gpx+xml' });
    // 휴대폰(앱 포함)에서는 공유 시트로 파일 저장·전송, 안 되면 다운로드 링크
    try {
      var file = new File([blob], name, { type: 'application/gpx+xml' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        navigator.share({ files: [file], title: name }).catch(function () {});
        return;
      }
    } catch (e) {}
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function saveRide() {
    var uid = currentUid();
    if (!uid) return Promise.reject(new Error('로그인 후 저장할 수 있습니다.'));
    if (typeof window.saveStravaActivityToFirebase !== 'function') return Promise.reject(new Error('저장 모듈을 불러오지 못했습니다.'));
    var el = elapsedNow();
    var d = new Date(st.startedAt || Date.now());
    var dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var km = Math.round(st.distanceM / 10) / 100;
    var avg = el > 0 ? Math.round(((st.distanceM / 1000) / (el / 3600000)) * 10) / 10 : 0;
    var weight = Number((window.currentUser && (window.currentUser.weight || window.currentUser.weightKg)) || 0);
    return window.saveStravaActivityToFirebase({
      activity_id: 'outdoor_' + uid.slice(0, 8) + '_' + (st.startedAt || Date.now()),
      user_id: uid,
      source: 'stelvio_outdoor',
      activity_type: 'Ride',
      date: dateStr,
      title: '아웃도어 라이딩' + (st.course && st.course.title ? ' · ' + st.course.title : ''),
      distance_km: km,
      duration_sec: Math.round(el / 1000),
      time: Math.round(el / 1000),
      elevation_gain: Math.round(st.elevGainM),
      avg_speed_kmh: avg,
      tss: 0,
      weight: weight > 0 ? weight : null,
      summary_polyline: st.track.length >= 2 ? encodePolyline(thin(st.track, 1500)) : null
    });
  }

  function resetRide() {
    st.status = 'idle';
    st.elapsedMs = 0;
    st.runSince = 0;
    st.startedAt = 0;
    st.distanceM = 0;
    st.elevGainM = 0;
    st.altBase = null;
    st.altEma = null;
    st.track = [];
    st.lastTrackPt = null;
    if (st.trail) st.trail.setLatLngs([]);
    renderToggle();
    renderStats();
  }

  /** 종료: 요약 + [저장하고 종료] [GPX 받기] [계속 라이딩] */
  window.finishOutdoorRide = function () {
    if (st.status === 'idle' && !hasRideData()) {
      toast('라이딩을 시작하지 않았습니다.', 'info');
      return;
    }
    if (st.status === 'running') {
      st.elapsedMs += Date.now() - st.runSince;
      st.runSince = 0;
      st.status = 'paused';
      renderToggle();
    }
    var el = elapsedNow();
    var avg = el > 0 ? (st.distanceM / 1000) / (el / 3600000) : 0;
    var old = $('outdFinishModal');
    if (old) old.remove();
    var m = document.createElement('div');
    m.id = 'outdFinishModal';
    m.className = 'outd-finish';
    m.innerHTML =
      '<div class="outd-finish__card" role="dialog" aria-modal="true">' +
      '<h3>라이딩 종료</h3>' +
      '<dl class="outd-finish__stats">' +
      '<div><dt>거리</dt><dd>' + (st.distanceM / 1000).toFixed(2) + ' km</dd></div>' +
      '<div><dt>시간</dt><dd>' + fmtHms(el) + '</dd></div>' +
      '<div><dt>평균 속도</dt><dd>' + (isFinite(avg) ? avg : 0).toFixed(1) + ' km/h</dd></div>' +
      '<div><dt>누적 고도</dt><dd>' + Math.round(st.elevGainM) + ' m</dd></div>' +
      '</dl>' +
      '<div class="outd-finish__btns">' +
      '<button type="button" class="outd-finish__btn outd-finish__btn--primary" data-act="save">훈련 일지에 저장하고 종료</button>' +
      '<button type="button" class="outd-finish__btn" data-act="gpx">GPX 파일 받기</button>' +
      '<button type="button" class="outd-finish__btn" data-act="discard">저장하지 않고 종료</button>' +
      '<button type="button" class="outd-finish__btn outd-finish__btn--ghost" data-act="resume">계속 라이딩</button>' +
      '</div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'resume') {
        m.remove();
        window.toggleOutdoorRide();
      } else if (act === 'gpx') {
        downloadGpx();
      } else if (act === 'discard') {
        if (!window.confirm('이번 라이딩 기록을 저장하지 않고 종료할까요?')) return;
        m.remove();
        resetRide();
        toast('라이딩을 종료했습니다.', 'info');
      } else if (act === 'save') {
        btn.disabled = true;
        btn.textContent = '저장 중...';
        saveRide().then(function () {
          m.remove();
          resetRide();
          toast('훈련 일지에 저장했습니다.', 'success');
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = '훈련 일지에 저장하고 종료';
          toast('저장에 실패했습니다: ' + ((err && err.message) || err), 'error');
        });
      }
    });
  };

  /* 지도는 화면이 실제로 보인 뒤 크기를 다시 계산해야 타일이 전체에 그려진다 — 화면 활성화·회전·크기 변경 때 재계산 */
  function fixMapSize() {
    if (st.map && isActive()) st.map.invalidateSize();
  }
  (function watchScreen() {
    var el = $(SCREEN_ID);
    if (!el || typeof MutationObserver !== 'function') return;
    new MutationObserver(function () {
      if (isActive()) {
        setTimeout(fixMapSize, 50);
        setTimeout(fixMapSize, 400);
      }
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', function () { setTimeout(fixMapSize, 100); });
  })();

  /* ---------- 진입 · 나가기 ---------- */
  function activeScreenId() {
    var el = document.querySelector('.screen.active');
    return el && el.id !== SCREEN_ID ? el.id : '';
  }

  /**
   * @param {{ gpxUrl?: string, title?: string, rideId?: string }} [opts]
   */
  window.openOutdoorRide = function (opts) {
    opts = opts || {};
    st.prevScreen = activeScreenId() || st.prevScreen;
    if (typeof window.showScreen === 'function') window.showScreen(SCREEN_ID);
    var me = window.currentUser || {};
    setText('outd-user-name', me.name || '라이더');
    buildGaugeScale();
    renderToggle();
    renderStats();
    startTimer();
    // 지도는 화면이 보인 뒤 크기를 다시 계산해야 타일이 제대로 그려진다
    setTimeout(function () {
      ensureMap();
      fixMapSize();
      if (opts.gpxUrl) loadCourseFromUrl(opts.gpxUrl, opts.title || '');
    }, 80);
    setTimeout(fixMapSize, 600);
    startGps();
    if (st.rafId == null) st.rafId = requestAnimationFrame(loop);
  };

  window.exitOutdoorRide = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    closeMenu();
    if (st.status !== 'idle' && hasRideData()) {
      window.finishOutdoorRide();
      return;
    }
    resetRide();
    stopGps();
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    var back = st.prevScreen || 'basecampScreen';
    if (typeof window.showScreen === 'function') window.showScreen(back);
  };
})();

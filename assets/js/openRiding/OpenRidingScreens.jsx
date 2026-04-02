/**
 * 오픈 라이딩방 UI (메인 달력·설정 / 생성 폼 / 상세)
 * @requires React, window.openRidingBoot(모듈)로 useOpenRiding·openRidingService 로드 후 type="text/babel" 로 본 파일 로드
 */
/* global React */
var useState = React.useState;
var useEffect = React.useEffect;
var useMemo = React.useMemo;
var useCallback = React.useCallback;
var useRef = React.useRef;

function getOpenRidingHooks() {
  return {
    useOpenRiding: window.useOpenRiding,
    useOpenRideDetail: window.useOpenRideDetail
  };
}

function getOpenRidingServiceFns() {
  var svc = window.openRidingService || {};
  return {
    createRide: svc.createRide,
    uploadRideGpx: svc.uploadRideGpx,
    fetchRideById: svc.fetchRideById,
    updateRideByHost: svc.updateRideByHost,
    normalizePhoneDigits: svc.normalizePhoneDigits,
    isUserPhoneInvitedToRide: svc.isUserPhoneInvitedToRide
  };
}

function getKoreaRegionOptions() {
  return {
    KOREA_SIGUNGU_OPTIONS: window.KOREA_SIGUNGU_OPTIONS || [],
    RIDING_LEVEL_OPTIONS: window.RIDING_LEVEL_OPTIONS || []
  };
}

/** 로그인·프로필 기준 방장명·연락처 (라이딩 생성·참가 시 표시 이름) */
function getOpenRidingProfileDefaults() {
  try {
    var u = typeof window !== 'undefined' && window.currentUser ? window.currentUser : null;
    if (!u) {
      try { u = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e1) { u = null; }
    }
    if (!u) {
      try { u = JSON.parse(localStorage.getItem('authUser') || 'null'); } catch (e2) { u = null; }
    }
    var name = (u && u.name) ? String(u.name).trim() : '';
    var contact = '';
    if (u) {
      contact =
        (u.contact && String(u.contact).trim()) ||
        (u.phone && String(u.phone).trim()) ||
        '';
    }
    if (typeof window !== 'undefined' && window.authV9 && window.authV9.currentUser) {
      var cu = window.authV9.currentUser;
      if (!name && cu.displayName) name = String(cu.displayName).trim();
      if (!contact && cu.phoneNumber) contact = String(cu.phoneNumber).trim();
      if (!contact && cu.email) contact = String(cu.email).trim();
    }
    if (typeof window !== 'undefined' && window.auth && window.auth.currentUser && (!name || !contact)) {
      var c2 = window.auth.currentUser;
      if (!name && c2.displayName) name = String(c2.displayName).trim();
      if (!contact && c2.phoneNumber) contact = String(c2.phoneNumber).trim();
      if (!contact && c2.email) contact = String(c2.email).trim();
    }
    return { hostName: name, contactInfo: contact };
  } catch (e) {
    return { hostName: '', contactInfo: '' };
  }
}

if (typeof window !== 'undefined') {
  window.getOpenRidingProfileDefaults = getOpenRidingProfileDefaults;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dateKey(y, m, d) {
  return y + '-' + pad2(m + 1) + '-' + pad2(d);
}

/** 한국(서울) 기준 오늘 YYYY-MM-DD */
function getTodaySeoulYmd() {
  try {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    var y = '';
    var m = '';
    var d = '';
    parts.forEach(function (p) {
      if (p.type === 'year') y = p.value;
      if (p.type === 'month') m = p.value;
      if (p.type === 'day') d = p.value;
    });
    if (y && m && d) return y + '-' + m + '-' + d;
  } catch (e1) {}
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** 라이딩 문서 date → 서울 기준 YYYY-MM-DD */
function getRideDateSeoulYmd(ride) {
  var ts = ride && ride.date && typeof ride.date.toDate === 'function' ? ride.date.toDate() : null;
  if (!ts) return null;
  try {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ts);
    var y = '';
    var m = '';
    var d = '';
    parts.forEach(function (p) {
      if (p.type === 'year') y = p.value;
      if (p.type === 'month') m = p.value;
      if (p.type === 'day') d = p.value;
    });
    if (y && m && d) return y + '-' + m + '-' + d;
  } catch (e0) {}
  return null;
}

/** 서울 달력상 라이딩일이 지난 경우(다음날부터) 상세 연락처 마스킹 */
function shouldMaskOpenRidingContacts(ride) {
  var rideYmd = getRideDateSeoulYmd(ride);
  if (!rideYmd) return false;
  return getTodaySeoulYmd() > rideYmd;
}

/** 전화 등 연락처 표시용 마스킹 (숫자 위주, 이메일은 일부 가림) */
/** 참가자 명단: 끝 4자리 마스킹 (010-1234-****) */
function maskPhoneLastFourDisplay(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (d.length >= 10) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-****';
  if (d.length >= 7) return d.slice(0, 3) + '-****-' + d.slice(-4);
  return '****';
}

function maskContactForDisplay(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  var digits = s.replace(/\D/g, '');
  if (digits.length >= 11) {
    return digits.slice(0, 3) + '-****-' + digits.slice(-4);
  }
  if (digits.length >= 10) {
    return digits.slice(0, 3) + '-****-' + digits.slice(-4);
  }
  if (digits.length >= 7) {
    return '***-' + digits.slice(-4);
  }
  if (digits.length >= 4) {
    return '****';
  }
  if (s.indexOf('@') >= 0) {
    var at = s.indexOf('@');
    var local = s.slice(0, at);
    var dom = s.slice(at + 1);
    var domParts = dom.split('.');
    var tld = domParts.length ? domParts[domParts.length - 1] : '';
    return (local.length ? local[0] : '*') + '***@***.' + (tld || '*');
  }
  return '***';
}

/** 네이티브 주소록에서 전달하는 data → { name, phone }[] */
function parseNativeAddressBookData(data) {
  var raw = Array.isArray(data) ? data : data && (data.contacts || data.items || data.selected);
  if (!Array.isArray(raw)) raw = [];
  var out = [];
  raw.forEach(function (row) {
    if (!row || typeof row !== 'object') return;
    var phone = row.phone != null ? row.phone : row.tel != null ? row.tel : row.mobile != null ? row.mobile : row.number;
    var name = row.name != null ? row.name : row.displayName != null ? row.displayName : '';
    if (phone == null || String(phone).replace(/\D/g, '').length < 8) return;
    out.push({
      name: String(name).trim() || '이름 없음',
      phone: String(phone).trim()
    });
  });
  return out;
}

/**
 * Firebase Storage 다운로드 URL → 객체 경로 (예: open_riding_gpx/ride/file.gpx)
 * @param {string} url
 */
function firebaseStorageDownloadUrlToObjectPath(url) {
  var u = String(url || '').trim();
  var m = u.match(/\/v0\/b\/[^/]+\/o\/([^?#]+)/);
  if (!m || !m[1]) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' '));
  } catch (e1) {
    return null;
  }
}

/**
 * GPX 원격 URL → 텍스트 (Firebase Storage URL은 fetch CORS 회피를 위해 SDK ref + getBytes 사용)
 * 참고: firebase-storage.js v9.23 공개 export에 refFromURL 없음 → URL에서 경로 파싱 후 ref(storage, path).
 * @param {string} url
 * @param {import('firebase/storage').FirebaseStorage | null | undefined} storage
 * @param {() => boolean} isCancelled
 */
function loadGpxTextFromUrl(url, storage, isCancelled) {
  var u = String(url || '').trim();
  if (!u) return Promise.reject(new Error('URL 없음'));
  var looksFirebase =
    u.indexOf('firebasestorage.googleapis.com') !== -1 ||
    (u.indexOf('googleapis.com') !== -1 && u.indexOf('/v0/b/') !== -1);
  var st =
    storage ||
    (typeof window !== 'undefined' && window.firebaseStorageV9 ? window.firebaseStorageV9 : null);

  if (st && looksFirebase) {
    var objectPath = firebaseStorageDownloadUrlToObjectPath(u);
    if (!objectPath) {
      return Promise.reject(new Error('Storage 다운로드 URL 형식을 읽을 수 없습니다.'));
    }
    var ready =
      typeof window !== 'undefined' && window._firebaseStorageModReady
        ? window._firebaseStorageModReady
        : Promise.reject(new Error('Storage 모듈 선로드 대기열 없음'));

    return ready
      .then(function (mod) {
        if (isCancelled()) return '';
        var api = mod || (typeof window !== 'undefined' ? window.firebaseStorageModV9API : null);
        if (!api || typeof api.ref !== 'function' || typeof api.getBytes !== 'function') {
          throw new Error('Storage 모듈 API 없음 (ref/getBytes, index.html 선로드 확인)');
        }
        // Firestore에 저장된 전체 다운로드 URL(토큰 포함)이 있으면 ref(storage, url) 우선 — SDK가 권한 처리에 유리
        var r =
          u.indexOf('https://firebasestorage.googleapis.com') === 0
            ? api.ref(st, u)
            : api.ref(st, objectPath);
        return api.getBytes(r);
      })
      .then(function (bytes) {
        if (isCancelled()) return '';
        if (!bytes || !bytes.byteLength) return '';
        return new TextDecoder('utf-8').decode(bytes);
      })
      .catch(function (err) {
        var msg = (err && err.message) ? String(err.message) : 'GPX 다운로드 실패';
        var code = err && err.code ? String(err.code) : '';
        if (code) msg = code + ': ' + msg;
        msg +=
          ' · 브라우저에서 getBytes/fetch로 Storage를 읽으려면 GCS 버킷 CORS가 필요합니다. ' +
          '예: gsutil cors set docs/storage.cors.json gs://<Firebase Console Storage에 표시된 버킷명>';
        return Promise.reject(new Error(msg));
      });
  }

  return fetch(u, { mode: 'cors', credentials: 'omit', cache: 'no-store' }).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  });
}

/**
 * GPX URL 또는 로컬 File → Leaflet 지도 + Chart.js 고도표 (코스 설명 블록 하단용)
 * @param {{ gpxUrl?: string|null, file?: File|null, showEmptyMessage?: boolean, storage?: import('firebase/storage').FirebaseStorage | null }} props
 */
function OpenRidingGpxCoursePanel(props) {
  var gpxUrl = props.gpxUrl != null ? String(props.gpxUrl) : '';
  var file = props.file || null;
  var storage = props.storage || null;
  var showEmpty =
    props.showEmptyMessage === undefined || props.showEmptyMessage === null ? true : !!props.showEmptyMessage;

  var mapRef = useRef(null);
  var chartRef = useRef(null);
  var mapInstRef = useRef(null);
  var chartInstRef = useRef(null);

  var _st = useState({ status: 'idle', track: null, err: '' });
  var loadState = _st[0];
  var setLoadState = _st[1];

  useEffect(
    function () {
      var cancelled = false;
      var hasFile = !!(file && file.name);
      var hasUrl = !!(gpxUrl && String(gpxUrl).trim());

      if (!hasFile && !hasUrl) {
        setLoadState({ status: 'empty', track: null, err: '' });
        return;
      }

      setLoadState({ status: 'loading', track: null, err: '' });

      function applyTrack(text) {
        var mod = typeof window !== 'undefined' ? window.openRidingGpx : null;
        var parse = mod && typeof mod.parseGpxToTrack === 'function' ? mod.parseGpxToTrack : null;
        if (!parse) throw new Error('GPX 모듈(openRidingGpx)이 로드되지 않았습니다.');
        return parse(String(text || ''));
      }

      if (hasFile) {
        var reader = new FileReader();
        reader.onload = function () {
          if (cancelled) return;
          try {
            var track = applyTrack(reader.result);
            setLoadState({ status: 'ok', track: track, err: '' });
          } catch (e) {
            setLoadState({ status: 'err', track: null, err: (e && e.message) ? String(e.message) : '파싱 실패' });
          }
        };
        reader.onerror = function () {
          if (!cancelled) setLoadState({ status: 'err', track: null, err: '파일을 읽을 수 없습니다.' });
        };
        reader.readAsText(file, 'UTF-8');
        return function () {
          cancelled = true;
        };
      }

      loadGpxTextFromUrl(String(gpxUrl).trim(), storage, function () {
        return cancelled;
      })
        .then(function (text) {
          if (cancelled) return;
          try {
            var track = applyTrack(text);
            setLoadState({ status: 'ok', track: track, err: '' });
          } catch (e2) {
            setLoadState({ status: 'err', track: null, err: (e2 && e2.message) ? String(e2.message) : '파싱 실패' });
          }
        })
        .catch(function (e3) {
          if (!cancelled) {
            setLoadState({
              status: 'err',
              track: null,
              err: (e3 && e3.message) ? String(e3.message) : 'GPX를 가져올 수 없습니다.'
            });
          }
        });
      return function () {
        cancelled = true;
      };
    },
    [gpxUrl, file, storage]
  );

  useEffect(
    function () {
      if (loadState.status !== 'ok' || !loadState.track || !loadState.track.latlngs || loadState.track.latlngs.length < 2) {
        if (mapInstRef.current) {
          try {
            mapInstRef.current.remove();
          } catch (e0) {}
          mapInstRef.current = null;
        }
        return;
      }
      var L = typeof window !== 'undefined' ? window.L : null;
      if (!L || !mapRef.current) return;

      try {
        if (mapInstRef.current) {
          try {
            mapInstRef.current.remove();
          } catch (e1) {}
          mapInstRef.current = null;
        }
        var map = L.map(mapRef.current, { zoomControl: true, attributionControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(map);
        var poly = L.polyline(loadState.track.latlngs, { color: '#7c3aed', weight: 4, opacity: 0.92 }).addTo(map);
        map.fitBounds(poly.getBounds(), { padding: [18, 18] });
        mapInstRef.current = map;
        var t0 = setTimeout(function () {
          try {
            map.invalidateSize();
          } catch (e2) {}
        }, 240);
        return function () {
          clearTimeout(t0);
          try {
            if (mapInstRef.current) {
              mapInstRef.current.remove();
              mapInstRef.current = null;
            }
          } catch (e3) {}
        };
      } catch (e4) {
        if (typeof console !== 'undefined' && console.warn) console.warn('[OpenRiding GPX] map', e4);
      }
    },
    [loadState.status, loadState.track]
  );

  useEffect(
    function () {
      var Chart = typeof window !== 'undefined' ? window.Chart : null;
      if (chartInstRef.current) {
        try {
          chartInstRef.current.destroy();
        } catch (e0) {}
        chartInstRef.current = null;
      }
      if (loadState.status !== 'ok' || !loadState.track || !Chart || !chartRef.current) return;
      var tr = loadState.track;
      if (!tr.distancesKm || !tr.elevs || tr.distancesKm.length < 2) return;

      try {
        var ctx = chartRef.current.getContext('2d');
        chartInstRef.current = new Chart(ctx, {
          type: 'line',
          data: {
            labels: tr.distancesKm.map(function (d) {
              return String(Math.round(Number(d)));
            }),
            datasets: [
              {
                label: '고도',
                data: tr.elevs,
                borderColor: '#7c3aed',
                backgroundColor: 'rgba(124, 58, 237, 0.22)',
                fill: true,
                tension: 0.25,
                pointRadius: 0,
                borderWidth: 2
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
              x: {
                display: true,
                title: { display: true, text: '누적 거리 (km)', font: { size: 11 } },
                grid: { display: false },
                ticks: { maxTicksLimit: 6, font: { size: 10 } }
              },
              y: {
                display: true,
                title: { display: false },
                grid: { color: 'rgba(0,0,0,0.06)' },
                ticks: {
                  font: { size: 10 },
                  callback: function (val) {
                    var n = Math.round(Number(val));
                    return n + 'm';
                  }
                }
              }
            },
            plugins: { legend: { display: false } }
          }
        });
      } catch (e1) {
        if (typeof console !== 'undefined' && console.warn) console.warn('[OpenRiding GPX] chart', e1);
      }
      return function () {
        if (chartInstRef.current) {
          try {
            chartInstRef.current.destroy();
          } catch (e2) {}
          chartInstRef.current = null;
        }
      };
    },
    [loadState.status, loadState.track]
  );

  if (loadState.status === 'empty' || loadState.status === 'idle') {
    if (!showEmpty) return null;
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/90 px-3 py-6 text-center text-sm text-slate-500 leading-snug">
        등록된 코스가 없습니다. GPX 파일을 선택하면 지도와 고도표가 표시됩니다.
      </div>
    );
  }
  if (loadState.status === 'loading') {
    return <div className="text-sm text-slate-500 py-4 text-center">코스 불러오는 중…</div>;
  }
  if (loadState.status === 'err') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-3 text-sm text-amber-900 leading-snug">
        코스를 표시할 수 없습니다. {loadState.err}
      </div>
    );
  }
  return (
    <div className="open-riding-gpx-panel w-full max-w-full space-y-3">
      <div
        className="w-full rounded-xl overflow-hidden border border-violet-200/80 bg-slate-100 shadow-sm open-riding-gpx-map-wrap"
        style={{ height: 'clamp(220px, 42vh, 300px)', width: '100%' }}
      >
        <div ref={mapRef} className="open-riding-gpx-map-inner w-full h-full" style={{ height: '100%', minHeight: '220px' }} />
      </div>
      <div
        className="w-full rounded-xl border border-violet-200/80 bg-white p-2 shadow-sm open-riding-gpx-chart-wrap"
        style={{ height: 'clamp(150px, 28vh, 200px)', width: '100%' }}
      >
        <canvas ref={chartRef} className="block w-full h-full max-w-full" />
      </div>
    </div>
  );
}

function openRidingBridgeOpenAddressBook() {
  try {
    if (typeof window !== 'undefined' && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.openAddressBook) {
      window.webkit.messageHandlers.openAddressBook.postMessage({});
      return;
    }
    if (typeof window !== 'undefined' && window.AndroidBridge && typeof window.AndroidBridge.openAddressBook === 'function') {
      window.AndroidBridge.openAddressBook();
      return;
    }
  } catch (e1) {}
  if (typeof window !== 'undefined' && window.console) window.console.warn('[오픈라이딩] openAddressBook 브릿지를 찾을 수 없습니다.');
}

function daysInGregorianMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

function seoulFirstDayOfWeekSun0(year, month1) {
  var iso = year + '-' + pad2(month1) + '-01T12:00:00+09:00';
  var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).formatToParts(new Date(iso));
  var w = '';
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].type === 'weekday') w = parts[i].value;
  }
  var map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[w] !== undefined ? map[w] : 0;
}

function formatKoreanDateLabelFromYmd(ymd) {
  if (!ymd || String(ymd).length < 8) return '';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short'
    }).format(new Date(String(ymd).trim() + 'T12:00:00+09:00'));
  } catch (e) {
    return ymd;
  }
}

function parseHmFromDeparture(s) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return { h: 7, mi: 0 };
  var h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  var mi = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  mi = Math.round(mi / 5) * 5;
  if (mi === 60) {
    mi = 0;
    h = Math.min(23, h + 1);
  }
  return { h: h, mi: mi };
}

/** 달력 그리드 + 녹색 마커(맞춤 필터 일치 일자) */
function OpenRidingCalendarMain(props) {
  var firestore = props.firestore;
  var storage = props.storage;
  var userId = props.userId || '';
  var userLabel = props.userLabel || '라이더';
  var onOpenCreate = props.onOpenCreate || function () {};
  var onSelectRide = props.onSelectRide || function () {};
  var compact = !!props.compact;

  var _m = useState(function () { return new Date(); });
  var viewMonth = _m[0];
  var setViewMonth = _m[1];

  var _hooks = getOpenRidingHooks();
  var useOpenRidingFn = _hooks.useOpenRiding;
  if (typeof useOpenRidingFn !== 'function') {
    return (
      <div className="p-4 text-center text-sm text-amber-800">
        오픈 라이딩 모듈이 로드되지 않았습니다. 페이지를 새로고침해 주세요.
      </div>
    );
  }

  var hook = useOpenRidingFn(firestore, userId || null, viewMonth);
  var prefs = hook.prefs;
  var savePrefs = hook.savePrefs;
  var matchingDateKeys = hook.matchingDateKeys;
  var hostDateKeys = hook.hostDateKeys || new Set();
  var ridesMonth = hook.ridesMonth;
  var loadingRides = hook.loadingRides;

  var _sel = useState(null);
  var selectedKey = _sel[0];
  var setSelectedKey = _sel[1];

  var year = viewMonth.getFullYear();
  var month = viewMonth.getMonth();
  var firstDow = new Date(year, month, 1).getDay();
  var lastDate = new Date(year, month + 1, 0).getDate();

  var days = useMemo(function () {
    var cells = [];
    var i;
    for (i = 0; i < firstDow; i++) cells.push(null);
    for (i = 1; i <= lastDate; i++) cells.push(i);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [firstDow, lastDate]);

  var ridesForDay = useMemo(function () {
    if (!selectedKey) return [];
    return ridesMonth.filter(function (r) {
      var ts = r.date;
      var d = ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
      if (!d) return false;
      var k = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
      return k === selectedKey;
    });
  }, [ridesMonth, selectedKey]);

  /** 해당 월에 라이딩이 하나라도 있는 모든 날짜(필터 무관) */
  var allRideDateKeys = useMemo(function () {
    var s = new Set();
    ridesMonth.forEach(function (r) {
      var ts = r.date;
      var d = ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
      if (!d) return;
      s.add(dateKey(d.getFullYear(), d.getMonth(), d.getDate()));
    });
    return s;
  }, [ridesMonth]);

  var _koOpts = getKoreaRegionOptions();
  var RIDING_LEVEL_OPTIONS = _koOpts.RIDING_LEVEL_OPTIONS;
  var KOREA_SIGUNGU_OPTIONS_FILTER = _koOpts.KOREA_SIGUNGU_OPTIONS;

  var _regionPick = useState('');
  var regionPick = _regionPick[0];
  var setRegionPick = _regionPick[1];

  var _filterOpen = useState(false);
  var filterModalOpen = _filterOpen[0];
  var setFilterModalOpen = _filterOpen[1];

  var cellH = compact ? 'h-8' : 'h-10';
  var emptyH = compact ? 'h-8' : 'h-10';

  function addRegionFromSelect() {
    var t = String(regionPick || '').trim();
    if (!t) return;
    if (prefs.activeRegions.indexOf(t) >= 0) {
      setRegionPick('');
      return;
    }
    savePrefs({
      activeRegions: prefs.activeRegions.concat([t]),
      preferredLevels: prefs.preferredLevels
    });
    setRegionPick('');
  }

  function removeRegion(r) {
    savePrefs({
      activeRegions: prefs.activeRegions.filter(function (x) { return x !== r; }),
      preferredLevels: prefs.preferredLevels
    });
  }

  function toggleLevel(lvl) {
    var next = prefs.preferredLevels.slice();
    var i = next.indexOf(lvl);
    if (i >= 0) next.splice(i, 1);
    else next.push(lvl);
    savePrefs({ activeRegions: prefs.activeRegions, preferredLevels: next });
  }

  function renderFilterSettingsBody() {
    return (
      <div className="space-y-4 text-left">
        <div>
          <label className="text-xs text-slate-500 block mb-1">활동 지역 추가</label>
          <div className="flex gap-1 flex-wrap">
            <select
              className="flex-1 min-w-[140px] rounded-lg border border-slate-200 px-2 py-1 text-sm bg-white"
              value={regionPick}
              onChange={function (e) { setRegionPick(e.target.value); }}
            >
              <option value="">시·군·구 선택</option>
              {KOREA_SIGUNGU_OPTIONS_FILTER.map(function (o) {
                return <option key={o} value={o}>{o}</option>;
              })}
            </select>
            <button type="button" className="rounded-lg bg-slate-800 text-white px-3 py-1 text-sm shrink-0" onClick={addRegionFromSelect}>추가</button>
          </div>
          <ul className="mt-2 flex flex-wrap gap-1">
            {prefs.activeRegions.map(function (r) {
              return (
                <li key={r}>
                  <button type="button" className="text-xs bg-white border border-slate-200 rounded-full px-2 py-0.5" onClick={function () { removeRegion(r); }}>
                    {r} ×
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <span className="text-xs text-slate-500 block mb-1">관심 레벨</span>
          {RIDING_LEVEL_OPTIONS.map(function (opt) {
            var on = prefs.preferredLevels.indexOf(opt.value) >= 0;
            return (
              <label key={opt.value} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                <input type="checkbox" checked={on} onChange={function () { toggleLevel(opt.value); }} />
                {opt.value} <span className="text-xs text-slate-400">({opt.hint})</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  function rideParticipantRatio(r) {
    var p = Array.isArray(r.participants) ? r.participants.length : 0;
    var max = Math.max(1, Number(r.maxParticipants) || 10);
    return p + '/' + max;
  }

  function rideDistanceKm(r) {
    var n = Number(r.distance);
    if (isNaN(n) || n <= 0) return '-';
    return n + 'km';
  }

  function rideListMetaSep() {
    return (
      <span
        className="open-riding-list-meta-sep inline-flex shrink-0 items-center justify-center text-slate-400 px-1.5 text-[11px] leading-none select-none"
        aria-hidden
      >
        ·
      </span>
    );
  }

  function renderListSection() {
    return (
      <section className={(compact ? 'rounded-xl p-3 ' : 'rounded-2xl p-4 ') + 'border border-slate-200 bg-white shadow-sm'}>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">
          {selectedKey ? selectedKey + ' 라이딩' : '날짜를 선택하세요'}
        </h2>
        {!selectedKey ? (
          <p className="text-sm text-slate-400">달력에서 날짜를 탭하면 목록이 표시됩니다.</p>
        ) : ridesForDay.length === 0 ? (
          <p className="text-sm text-slate-400">이 날 등록된 라이딩이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
            {ridesForDay.map(function (r) {
              var isCancelled = String(r.rideStatus || 'active') === 'cancelled';
              var titleRowClass = 'font-medium text-sm flex items-center gap-1.5 min-w-0 ';
              if (isCancelled) {
                titleRowClass += 'open-riding-list-title-cancelled';
              } else if (r.isPrivate) {
                titleRowClass += 'open-riding-list-title-private';
              } else {
                titleRowClass += 'text-slate-800';
              }
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className="w-full text-left py-2.5 hover:bg-slate-50 px-2 rounded-lg"
                    onClick={function () { onSelectRide(r.id); }}
                  >
                    <div className={titleRowClass}>
                      {isCancelled ? (
                        <img src="assets/img/rcancel.png" alt="" className="w-4 h-4 shrink-0 object-contain" width={16} height={16} decoding="async" />
                      ) : null}
                      <span className="truncate">{r.title}</span>
                    </div>
                    <div className={'text-xs mt-1 flex flex-wrap items-center gap-y-0.5 ' + (isCancelled ? 'text-slate-400' : 'text-slate-600')}>
                      <span className="shrink-0">{r.region != null && String(r.region).trim() ? r.region : '-'}</span>
                      {rideListMetaSep()}
                      <span className="shrink-0">{r.level != null && String(r.level).trim() ? r.level : '-'}</span>
                      {rideListMetaSep()}
                      <span className="shrink-0">{r.departureTime != null && String(r.departureTime).trim() ? r.departureTime : '-'}</span>
                      {rideListMetaSep()}
                      <span className="shrink-0">{rideDistanceKm(r)}</span>
                      {rideListMetaSep()}
                      <span className={'font-semibold tabular-nums shrink-0 ' + (isCancelled ? 'text-slate-400' : 'text-violet-700')}>{rideParticipantRatio(r)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className={compact ? 'open-riding-compact w-full max-w-full space-y-3 text-left' : 'open-riding-main max-w-4xl mx-auto p-4 space-y-6'}>
      {compact ? (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-medium text-slate-800 min-w-0 flex-1 truncate">{userLabel}</span>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap justify-end">
            <button
              type="button"
              className="open-riding-filter-launch-btn inline-flex items-center justify-center rounded-lg border-2 border-violet-600 bg-white px-2 py-1.5 text-[10px] sm:text-[11px] font-semibold text-violet-700 shadow-sm hover:bg-violet-50 whitespace-nowrap"
              onClick={function () { setFilterModalOpen(true); }}
              aria-label="맞춤 필터 설정"
            >
              맞춤 필터 (+)
            </button>
            <button
              type="button"
              className="open-riding-create-btn inline-flex items-center justify-center rounded-lg bg-violet-600 text-white px-2 py-1.5 text-[10px] sm:text-[11px] font-semibold shadow hover:bg-violet-700 whitespace-nowrap"
              onClick={onOpenCreate}
              aria-label="라이딩 생성"
            >
              라이딩 생성 (+)
            </button>
          </div>
        </div>
      ) : (
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800">오픈 라이딩방</h1>
          <p className="text-sm text-slate-500">지역·레벨 맞춤 모임 — {userLabel}</p>
        </div>
        <button
          type="button"
          className="rounded-xl bg-violet-600 text-white px-4 py-2 text-sm font-medium shadow hover:bg-violet-700"
          onClick={onOpenCreate}
        >
          라이딩 생성 (+)
        </button>
      </header>
      )}

      <div className={compact ? 'flex flex-col gap-3' : 'grid grid-cols-1 md:grid-cols-3 gap-4'}>
        <section className={(compact ? 'rounded-xl p-3 ' : 'md:col-span-2 rounded-2xl p-4 ') + 'border border-slate-200 bg-white shadow-sm'}>
          <div className="flex items-center justify-center mb-3 gap-2">
            <button type="button" className="text-slate-600 shrink-0" onClick={function () { setViewMonth(new Date(year, month - 1, 1)); }}>{'‹'}</button>
            <span className="font-semibold text-sm sm:text-base">{year}년 {month + 1}월</span>
            <button type="button" className="text-slate-600 shrink-0" onClick={function () { setViewMonth(new Date(year, month + 1, 1)); }}>{'›'}</button>
          </div>
          {loadingRides ? <p className="text-sm text-slate-400">불러오는 중…</p> : null}
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500 mb-1">
            {['일', '월', '화', '수', '목', '금', '토'].map(function (w) { return <div key={w}>{w}</div>; })}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map(function (day, idx) {
              if (day == null) return <div key={'e' + idx} className={emptyH} />;
              var key = dateKey(year, month, day);
              var isHostDay = hostDateKeys.has(key);
              var hasMatch = matchingDateKeys.has(key);
              var hasAnyRide = allRideDateKeys.has(key);
              var showOtherOnly = !isHostDay && !hasMatch && hasAnyRide;
              var isSel = selectedKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={function () { setSelectedKey(key); }}
                  className={
                    'relative ' + cellH + ' rounded-lg text-sm flex items-center justify-center transition ' +
                    (isSel ? 'ring-2 ring-violet-500 font-semibold ' : '') +
                    ' hover:bg-slate-50'
                  }
                >
                  {isHostDay ? (
                    <span
                      className="absolute inset-1 rounded-md bg-violet-300/50 border border-violet-400/40 pointer-events-none"
                      aria-hidden
                    />
                  ) : hasMatch ? (
                    <span
                      className="absolute inset-1 rounded-md bg-emerald-400/35 pointer-events-none"
                      aria-hidden
                    />
                  ) : showOtherOnly ? (
                    <span
                      className="absolute inset-1 rounded-md bg-slate-300/45 border border-slate-400/35 pointer-events-none"
                      aria-hidden
                    />
                  ) : null}
                  <span className="relative z-10">{day}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-col gap-1.5 text-[11px] text-slate-600">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-block w-3 h-3 rounded-sm bg-emerald-400/90 shrink-0 border border-emerald-600/25" aria-hidden />
              <span className="text-slate-500">맞춤 필터 라이딩</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-block w-3 h-3 rounded-sm bg-violet-300/90 shrink-0 border border-violet-500/35" aria-hidden />
              <span className="text-slate-500">내가 올린 라이딩</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-block w-3 h-3 rounded-sm bg-slate-300/90 shrink-0 border border-slate-500/30" aria-hidden />
              <span className="text-slate-500">맞춤 필터 외 라이딩</span>
            </div>
          </div>
        </section>

        {compact ? renderListSection() : null}

        {!compact ? (
        <aside className="rounded-2xl p-4 border border-slate-200 bg-slate-50/80 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">맞춤 필터 설정</h2>
          {renderFilterSettingsBody()}
        </aside>
        ) : null}
      </div>

      {!compact ? renderListSection() : null}

      {compact && filterModalOpen ? (
        <div
          className="open-riding-filter-modal fixed inset-0 z-[10050] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-riding-filter-modal-title"
          onClick={function () { setFilterModalOpen(false); }}
        >
          <div
            className="open-riding-filter-modal-panel w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-violet-200 bg-white p-4 shadow-xl"
            onClick={function (e) { e.stopPropagation(); }}
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 id="open-riding-filter-modal-title" className="text-sm font-semibold text-slate-800">맞춤 필터 설정</h2>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                onClick={function () { setFilterModalOpen(false); }}
              >
                닫기
              </button>
            </div>
            {renderFilterSettingsBody()}
            <button
              type="button"
              className="mt-4 w-full rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white shadow hover:bg-violet-700"
              onClick={function () { setFilterModalOpen(false); }}
            >
              확인
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 생성·수정 폼 — editRideId 있으면 수정 모드 */
function OpenRidingCreateForm(props) {
  var _svcForm = getOpenRidingServiceFns();
  var createRide = _svcForm.createRide;
  var uploadRideGpx = _svcForm.uploadRideGpx;
  var fetchRideById = _svcForm.fetchRideById;
  var updateRideByHost = _svcForm.updateRideByHost;
  var _koForm = getKoreaRegionOptions();
  var KOREA_SIGUNGU_OPTIONS = _koForm.KOREA_SIGUNGU_OPTIONS;
  var RIDING_LEVEL_OPTIONS = _koForm.RIDING_LEVEL_OPTIONS;

  var firestore = props.firestore;
  var storage = props.storage;
  var hostUserId = props.hostUserId;
  var editRideId = props.editRideId || null;
  var onCreated = props.onCreated || function () {};
  var onEditSaved = props.onEditSaved || function () {};

  var st = useState(function () {
    var prof = getOpenRidingProfileDefaults();
    return {
      title: '',
      date: getTodaySeoulYmd(),
      departureTime: '07:00',
      departureLocation: '',
      distance: 40,
      course: '',
      level: '중급',
      maxParticipants: 10,
      hostName: prof.hostName || '',
      contactInfo: prof.contactInfo || '',
      region: '',
      gpxFile: null,
      gpxUrlExisting: null,
      isPrivate: false,
      invitePending: [],
      inviteSelected: [],
      rideJoinPassword: ''
    };
  });
  var form = st[0];
  var setForm = st[1];
  var _busy = useState(false);
  var isBusy = _busy[0];
  var setBusy = _busy[1];

  useEffect(function () {
    var prev = typeof window !== 'undefined' ? window.onAddressBookSelected : undefined;
    window.onAddressBookSelected = function (data) {
      if (typeof prev === 'function') {
        try {
          prev(data);
        } catch (e0) {}
      }
      var rows = parseNativeAddressBookData(data);
      if (rows.length === 0) return;
      setForm(function (f) {
        var _svc = getOpenRidingServiceFns();
        var norm =
          typeof _svc.normalizePhoneDigits === 'function'
            ? _svc.normalizePhoneDigits
            : function (s) {
                return String(s || '').replace(/\D/g, '');
              };
        var pending = (f.invitePending || []).slice();
        var keysSel = {};
        (f.inviteSelected || []).forEach(function (x) {
          keysSel[x.key] = true;
        });
        rows.forEach(function (row) {
          var key = norm(row.phone);
          if (!key || key.length < 9) return;
          if (keysSel[key]) return;
          if (pending.some(function (p) { return p.key === key; })) return;
          pending.push({ name: row.name, phone: row.phone, key: key });
        });
        var n = {};
        for (var k in f) n[k] = f[k];
        n.invitePending = pending;
        return n;
      });
    };
    return function () {
      if (typeof window !== 'undefined') window.onAddressBookSelected = prev;
    };
  }, []);

  var _hyd = useState(!editRideId);
  var editHydrated = _hyd[0];
  var setEditHydrated = _hyd[1];

  useEffect(
    function () {
      if (!editRideId || !firestore || typeof fetchRideById !== 'function') {
        setEditHydrated(true);
        return;
      }
      var cancelled = false;
      setEditHydrated(false);
      fetchRideById(firestore, editRideId)
        .then(function (ride) {
          if (cancelled) return;
          if (!ride) {
            setEditHydrated(true);
            return;
          }
          var ts = ride.date && typeof ride.date.toDate === 'function' ? ride.date.toDate() : null;
          var ymd = ts ? dateKey(ts.getFullYear(), ts.getMonth(), ts.getDate()) : getTodaySeoulYmd();
          var prof = getOpenRidingProfileDefaults();
          var _svcN = getOpenRidingServiceFns();
          var normFn =
            typeof _svcN.normalizePhoneDigits === 'function'
              ? _svcN.normalizePhoneDigits
              : function (s) {
                  return String(s || '').replace(/\D/g, '');
                };
          var il = Array.isArray(ride.invitedList) ? ride.invitedList : [];
          var inviteSelected = il.map(function (phone) {
            var p = String(phone != null ? phone : '');
            return { name: '초대', phone: p, key: normFn(p) };
          });
          setForm({
            title: String(ride.title || ''),
            date: ymd,
            departureTime: String(ride.departureTime || '07:00'),
            departureLocation: String(ride.departureLocation || ''),
            distance: Number(ride.distance) || 40,
            course: String(ride.course || ''),
            level: String(ride.level || '중급'),
            maxParticipants: Math.max(1, Number(ride.maxParticipants) || 10),
            hostName: String(ride.hostName || prof.hostName || ''),
            contactInfo: String(ride.contactInfo || prof.contactInfo || ''),
            region: String(ride.region || ''),
            gpxFile: null,
            gpxUrlExisting: ride.gpxUrl != null ? String(ride.gpxUrl) : null,
            isPrivate: !!ride.isPrivate,
            invitePending: [],
            inviteSelected: inviteSelected,
            rideJoinPassword: String(ride.rideJoinPassword != null ? ride.rideJoinPassword : '')
              .replace(/\D/g, '')
              .slice(0, 4)
          });
          setEditHydrated(true);
        })
        .catch(function () {
          if (!cancelled) setEditHydrated(true);
        });
      return function () {
        cancelled = true;
      };
    },
    [editRideId, firestore]
  );

  var _dm = useState(false);
  var dateModalOpen = _dm[0];
  var setDateModalOpen = _dm[1];
  var _py = useState(new Date().getFullYear());
  var pickerY = _py[0];
  var setPickerY = _py[1];
  var _pm = useState(1);
  var pickerM = _pm[0];
  var setPickerM = _pm[1];

  function set(k, v) {
    setForm(function (prev) {
      var n = {};
      for (var key in prev) n[key] = prev[key];
      n[k] = v;
      return n;
    });
  }

  function openKoreanDateModal() {
    var p = String(form.date || '').split('-');
    var y = parseInt(p[0], 10);
    var mo = parseInt(p[1], 10);
    if (!isNaN(y) && !isNaN(mo)) {
      setPickerY(y);
      setPickerM(mo);
    } else {
      var t = getTodaySeoulYmd().split('-');
      setPickerY(parseInt(t[0], 10));
      setPickerM(parseInt(t[1], 10));
    }
    setDateModalOpen(true);
  }

  function shiftPickerMonth(delta) {
    var y = pickerY;
    var m = pickerM + delta;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    setPickerY(y);
    setPickerM(m);
  }

  var hmPick = parseHmFromDeparture(form.departureTime);
  var minuteOptions = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
  var hourOptions = [];
  for (var hi = 0; hi < 24; hi++) hourOptions.push(hi);

  var seoulTodayYmd = getTodaySeoulYmd();
  var firstDow = seoulFirstDayOfWeekSun0(pickerY, pickerM);
  var dim = daysInGregorianMonth(pickerY, pickerM);
  var pickerCells = [];
  var ci;
  for (ci = 0; ci < firstDow; ci++) pickerCells.push(null);
  for (ci = 1; ci <= dim; ci++) pickerCells.push(ci);
  while (pickerCells.length % 7 !== 0) pickerCells.push(null);

  async function submit(e) {
    e.preventDefault();
    if (!firestore || !hostUserId) return;
    setBusy(true);
    try {
      var gpxUrl = form.gpxUrlExisting != null ? form.gpxUrlExisting : null;
      if (storage && form.gpxFile && typeof uploadRideGpx === 'function') {
        var draftPrefix = editRideId ? String(editRideId) : 'draft/' + hostUserId;
        var draftId = draftPrefix + '/' + Date.now();
        gpxUrl = await uploadRideGpx(storage, form.gpxFile, draftId);
      }
      var d = new Date(form.date + 'T12:00:00+09:00');
      if (editRideId && typeof updateRideByHost === 'function') {
        await updateRideByHost(firestore, editRideId, hostUserId, {
          title: form.title,
          date: d,
          departureTime: form.departureTime,
          departureLocation: form.departureLocation,
          distance: form.distance,
          course: form.course,
          level: form.level,
          maxParticipants: form.maxParticipants,
          hostName: form.hostName,
          contactInfo: form.contactInfo,
          isContactPublic: false,
          region: form.region,
          gpxUrl: gpxUrl,
          isPrivate: !!form.isPrivate,
          invitedList: form.isPrivate ? (form.inviteSelected || []).map(function (x) { return x.phone; }) : [],
          rideJoinPassword: form.isPrivate ? String(form.rideJoinPassword || '').replace(/\D/g, '').slice(0, 4) : ''
        });
        onEditSaved();
        return;
      }
      if (typeof createRide !== 'function') return;
      var rideId = await createRide(firestore, hostUserId, {
        title: form.title,
        date: d,
        departureTime: form.departureTime,
        departureLocation: form.departureLocation,
        distance: form.distance,
        course: form.course,
        level: form.level,
        maxParticipants: form.maxParticipants,
        hostName: form.hostName,
        contactInfo: form.contactInfo,
        isContactPublic: false,
        region: form.region,
        gpxUrl: gpxUrl,
        isPrivate: !!form.isPrivate,
        invitedList: form.isPrivate ? (form.inviteSelected || []).map(function (x) { return x.phone; }) : [],
        rideJoinPassword: form.isPrivate ? String(form.rideJoinPassword || '').replace(/\D/g, '').slice(0, 4) : ''
      });
      onCreated(rideId);
    } finally {
      setBusy(false);
    }
  }

  if (editRideId && !editHydrated) {
    return <div className="py-12 text-center text-sm text-slate-500">불러오는 중…</div>;
  }

  return (
    <form className="w-full max-w-lg mx-auto space-y-3 pb-1 text-sm text-slate-700" onSubmit={submit}>
      {!storage ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50/95 text-amber-900 text-xs px-3 py-2 leading-snug m-0">
          Firebase Storage에 연결되지 않았습니다. GPX 파일은 업로드·저장되지 않습니다. 페이지를 새로고침한 뒤에도 동일하면 Firebase Console에서 Storage 사용 여부와 보안 규칙(쓰기 허용)을 확인해 주세요.
        </p>
      ) : null}
      <label className="block font-medium text-slate-700">제목<input className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={form.title} onChange={function (e) { set('title', e.target.value); }} required /></label>

      <label className="block font-medium text-slate-700">지역
        <select className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={form.region} onChange={function (e) { set('region', e.target.value); }} required>
          <option value="">선택</option>
          {KOREA_SIGUNGU_OPTIONS.map(function (o) { return <option key={o} value={o}>{o}</option>; })}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <span className="block font-medium text-slate-700 mb-1">날짜</span>
          <button
            type="button"
            className="w-full text-left border border-slate-300 rounded-lg px-2 py-1.5 bg-white hover:bg-slate-50 text-sm text-slate-800 inline-flex items-center"
            onClick={openKoreanDateModal}
          >
            {formatKoreanDateLabelFromYmd(form.date)}
          </button>
        </div>
        <div className="min-w-0">
          <span className="block font-medium text-slate-700 mb-1">출발 시간</span>
          <div className="flex gap-2 items-stretch">
            <select
              className="open-riding-time-dial flex-1 min-w-0 text-sm"
              value={hmPick.h}
              aria-label="시"
              onChange={function (e) {
                var nh = Number(e.target.value);
                set('departureTime', pad2(nh) + ':' + pad2(hmPick.mi));
              }}
            >
              {hourOptions.map(function (h) {
                return (
                  <option key={h} value={h}>{pad2(h)}시</option>
                );
              })}
            </select>
            <select
              className="open-riding-time-dial flex-1 min-w-0 text-sm"
              value={hmPick.mi}
              aria-label="분"
              onChange={function (e) {
                var nm = Number(e.target.value);
                set('departureTime', pad2(hmPick.h) + ':' + pad2(nm));
              }}
            >
              {minuteOptions.map(function (m) {
                return (
                  <option key={m} value={m}>{pad2(m)}분</option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      <label className="block font-medium text-slate-700">출발 장소<input className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={form.departureLocation} onChange={function (e) { set('departureLocation', e.target.value); }} required /></label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block font-medium text-slate-700">거리(km)<input type="number" className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={form.distance} onChange={function (e) { set('distance', Number(e.target.value)); }} min={1} /></label>
        <label className="block font-medium text-slate-700">최대 인원<input type="number" className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={form.maxParticipants} onChange={function (e) { set('maxParticipants', Number(e.target.value)); }} min={1} /></label>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
        <span className="block font-medium text-slate-700">공개 / 비공개</span>
        <div className="device-connection-switch-container flex flex-col items-stretch sm:items-center">
          <div
            role="switch"
            aria-checked={!form.isPrivate}
            aria-label={form.isPrivate ? '비공개 모임' : '공개 모임'}
            className={'device-connection-switch open-riding-visibility-switch open-riding-visibility-switch-v2 mx-auto ' + (form.isPrivate ? 'active-ant' : 'active-bluetooth')}
            onClick={function () {
              var next = !form.isPrivate;
              setForm(function (f) {
                var n = {};
                for (var k in f) n[k] = f[k];
                n.isPrivate = next;
                if (!next) {
                  n.invitePending = [];
                  n.inviteSelected = [];
                  n.rideJoinPassword = '';
                }
                return n;
              });
            }}
          >
            <div className="switch-option switch-option-left">
              <span>공개</span>
            </div>
            <div className="switch-option switch-option-right">
              <span>비공개</span>
            </div>
            <div className="switch-slider" />
          </div>
          <div className="switch-label-container open-riding-visibility-switch-labels mx-auto !w-[200px] max-w-full">
            <span className={!form.isPrivate ? 'font-semibold open-riding-vlabel-on' : 'open-riding-vlabel-off'}>공개</span>
            <span className={form.isPrivate ? 'font-semibold open-riding-vlabel-on' : 'open-riding-vlabel-off'}>비공개</span>
          </div>
        </div>
      </div>

      {form.isPrivate ? (
        <div className="rounded-xl border border-violet-200/80 bg-violet-50/40 p-3 space-y-3">
          <h3 className="text-sm font-semibold text-violet-900">친구 초대 목록</h3>
          <button
            type="button"
            className="w-full rounded-lg border-2 border-violet-600 bg-white py-2 text-sm font-semibold text-violet-700 shadow-sm hover:bg-violet-50"
            onClick={openRidingBridgeOpenAddressBook}
          >
            주소록에서 초대하기
          </button>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-2">
              <p className="text-xs font-semibold text-slate-600 mb-2">초대 목록</p>
              {(form.invitePending || []).length === 0 ? (
                <p className="text-xs text-slate-400 py-2">주소록에서 추가하거나, 행을 눌러 오른쪽으로 옮기세요.</p>
              ) : (
                <ul className="space-y-1 max-h-36 overflow-y-auto">
                  {(form.invitePending || []).map(function (row) {
                    return (
                      <li key={row.key}>
                        <button
                          type="button"
                          className="w-full text-left rounded-md px-2 py-1.5 text-sm bg-slate-50 hover:bg-violet-100 border border-transparent hover:border-violet-200"
                          onClick={function () {
                            setForm(function (f) {
                              var pend = (f.invitePending || []).filter(function (p) { return p.key !== row.key; });
                              var picked = (f.invitePending || []).filter(function (p) { return p.key === row.key; })[0];
                              var sel = (f.inviteSelected || []).slice();
                              if (picked && !sel.some(function (s) { return s.key === row.key; })) sel.push(picked);
                              var n = {};
                              for (var k in f) n[k] = f[k];
                              n.invitePending = pend;
                              n.inviteSelected = sel;
                              return n;
                            });
                          }}
                        >
                          <span className="font-medium text-slate-800">{row.name}</span>
                          <span className="block text-xs text-slate-500">{row.phone}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="min-w-0 rounded-lg border border-violet-200 bg-white p-2">
              <p className="text-xs font-semibold text-violet-800 mb-2">선택된 목록 ({(form.inviteSelected || []).length}명)</p>
              {(form.inviteSelected || []).length === 0 ? (
                <p className="text-xs text-slate-400 py-2">비공개 모임에 초대할 사람을 왼쪽에서 탭해 추가하세요.</p>
              ) : (
                <ul className="space-y-1 max-h-36 overflow-y-auto">
                  {(form.inviteSelected || []).map(function (row) {
                    return (
                      <li key={row.key} className="flex items-start gap-2 rounded-md bg-violet-50/80 px-2 py-1.5 text-sm">
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-slate-800">{row.name}</span>
                          <span className="block text-xs text-slate-600">{row.phone}</span>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 text-xs text-red-600 font-medium px-1"
                          onClick={function () {
                            setForm(function (f) {
                              var sel = (f.inviteSelected || []).filter(function (s) { return s.key !== row.key; });
                              var removed = (f.inviteSelected || []).filter(function (s) { return s.key === row.key; })[0];
                              var pend = (f.invitePending || []).slice();
                              if (removed && !pend.some(function (p) { return p.key === row.key; })) pend.push(removed);
                              var n = {};
                              for (var k in f) n[k] = f[k];
                              n.inviteSelected = sel;
                              n.invitePending = pend;
                              return n;
                            });
                          }}
                        >
                          빼기
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
          {(form.inviteSelected || []).length === 0 ? (
            <p className="text-xs text-amber-700">초대 목록이 비어 있으면, 아래 비밀번호(4자리)를 설정해야 비초대자도 입장할 수 있습니다.</p>
          ) : null}
          <label className="block font-medium text-slate-700 mt-2">
            비공개 입장 비밀번호 (숫자 4자리, 선택)
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoComplete="off"
              className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm tracking-widest"
              placeholder="예: 1234"
              value={form.rideJoinPassword}
              onChange={function (e) {
                var v = String(e.target.value || '').replace(/\D/g, '').slice(0, 4);
                set('rideJoinPassword', v);
              }}
            />
          </label>
          <p className="text-xs text-slate-500">초대된 전화번호 또는 올바른 비밀번호를 입력한 사용자만 참석 신청할 수 있습니다.</p>
        </div>
      ) : null}

      <label className="block font-medium text-slate-700">코스 설명<textarea className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" rows={3} value={form.course} onChange={function (e) { set('course', e.target.value); }} /></label>

      <div className="rounded-xl border border-violet-100/90 bg-violet-50/25 p-3 space-y-3">
        <p className="text-xs font-semibold text-violet-900 m-0">코스 지도 · 고도표 (GPX)</p>
        <OpenRidingGpxCoursePanel
          gpxUrl={form.gpxUrlExisting}
          file={form.gpxFile}
          storage={storage}
          showEmptyMessage={!!(form.gpxUrlExisting || form.gpxFile)}
        />
        <label className="block text-sm font-medium text-slate-700">
          GPX 파일 (선택)
          <input
            type="file"
            accept=".gpx,application/gpx+xml"
            className="mt-1 block w-full text-sm"
            onChange={function (e) {
              set('gpxFile', e.target.files && e.target.files[0]);
            }}
          />
        </label>
        <p className="text-xs text-slate-600 m-0 leading-snug">파일을 고르면 위에서 미리 볼 수 있습니다. 최종 업로드는 저장(생성) 시 Firebase Storage에 반영됩니다.</p>
        {form.gpxUrlExisting && !form.gpxFile ? (
          <p className="text-xs text-slate-600 m-0">이미 등록된 GPX가 있습니다. 새 파일을 선택하면 저장 시 교체됩니다.</p>
        ) : null}
      </div>

      <fieldset className="border border-slate-200 rounded-xl p-3 space-y-2">
        <legend className="text-sm font-semibold text-slate-800 px-1">레벨</legend>
        {RIDING_LEVEL_OPTIONS.map(function (opt) {
          return (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer py-1 rounded-lg hover:bg-slate-50 text-sm">
              <input type="radio" name="lvl" className="shrink-0" value={opt.value} checked={form.level === opt.value} onChange={function () { set('level', opt.value); }} />
              <span className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0 leading-snug">
                <span className="font-medium text-slate-800">{opt.value}</span>
                <span className="text-xs text-slate-500">({opt.hint})</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <label className="block font-medium text-slate-700">
        방장명
        <input
          className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50 text-slate-700 text-sm"
          value={form.hostName}
          readOnly
          required
          title="로그인 프로필 이름이 자동 입력됩니다. 변경은 프로필(사용자 정보)에서 하세요."
        />
      </label>
      <label className="block font-medium text-slate-700">
        연락처
        <input
          className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50 text-slate-700 text-sm"
          value={form.contactInfo}
          readOnly
          title="로그인 프로필 연락처가 자동 입력됩니다. 참석 확정자에게만 공개됩니다."
        />
      </label>
      <p className="text-xs text-slate-500 -mt-1">방장명·연락처는 프로필에서 가져옵니다. 연락처는 참석 신청 후 확정된 참가자에게만 표시됩니다.</p>

      <button type="submit" className="open-riding-create-submit open-riding-action-btn h-11 inline-flex items-center justify-center w-full flex-1 px-4 bg-violet-600 text-white rounded-xl font-medium leading-none disabled:opacity-50" disabled={isBusy}>
        {isBusy ? '저장 중…' : editRideId ? '저장' : '생성'}
      </button>

      {dateModalOpen ? (
        <div
          className="fixed inset-0 z-[10060] flex items-end sm:items-center justify-center bg-black/45 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="날짜 선택"
          onClick={function () { setDateModalOpen(false); }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl border border-slate-200 overflow-hidden" onClick={function (e) { e.stopPropagation(); }}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50">
              <button type="button" className="p-2 text-slate-600 text-base" onClick={function () { shiftPickerMonth(-1); }} aria-label="이전 달">‹</button>
              <span className="font-semibold text-slate-800 text-sm">{pickerY}년 {pickerM}월</span>
              <button type="button" className="p-2 text-slate-600 text-base" onClick={function () { shiftPickerMonth(1); }} aria-label="다음 달">›</button>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-500 mb-1">
                {['일', '월', '화', '수', '목', '금', '토'].map(function (w) { return <div key={w}>{w}</div>; })}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {pickerCells.map(function (cell, idx) {
                  if (cell == null) return <div key={'e' + idx} className="h-9" />;
                  var cellKey = dateKey(pickerY, pickerM - 1, cell);
                  var isToday = cellKey === seoulTodayYmd;
                  var isSel = form.date === cellKey;
                  return (
                    <button
                      key={cellKey}
                      type="button"
                      onClick={function () {
                        set('date', cellKey);
                        setDateModalOpen(false);
                      }}
                      className={
                        'h-9 rounded-lg text-sm ' +
                        (isSel ? 'bg-violet-600 text-white font-semibold ' : 'hover:bg-violet-50 text-slate-800 ') +
                        (isToday && !isSel ? ' ring-2 ring-violet-400 ring-inset ' : '')
                      }
                    >
                      {cell}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="mt-3 w-full py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 mb-3"
                onClick={function () { setDateModalOpen(false); }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}

/** 대시보드 상단 우측 수정 아이콘과 동일 SVG */
function OpenRidingDashboardEditIcon() {
  return (
    <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

/** 상세 + 참석/취소 (Transaction) */
function OpenRidingDetail(props) {
  var firestore = props.firestore;
  var storage = props.storage || null;
  var rideId = props.rideId;
  var userId = props.userId;
  var onBack = props.onBack || function () {};
  var onOpenEdit = props.onOpenEdit || function () {};
  var registerDetailHeaderEdit = props.registerDetailHeaderEdit;

  var _hooksD = getOpenRidingHooks();
  var useOpenRideDetailFn = _hooksD.useOpenRideDetail;
  if (typeof useOpenRideDetailFn !== 'function') {
    return <div className="p-4 text-center text-sm text-amber-800">모듈 로드 오류</div>;
  }
  var h = useOpenRideDetailFn(firestore, rideId, userId);
  var ride = h.ride;
  var loading = h.loading;
  var join = h.join;
  var leave = h.leave;
  var reload = h.reload;
  var role = h.role;
  var actionErr = h.actionError;

  var _actBusy = useState(false);
  var isActionBusy = _actBusy[0];
  var setBusy = _actBusy[1];
  var _bomb = useState(false);
  var bombOpen = _bomb[0];
  var setBombOpen = _bomb[1];
  var _cancelBusy = useState(false);
  var cancelBusy = _cancelBusy[0];
  var setCancelBusy = _cancelBusy[1];
  var _jpw = useState('');
  var joinPasswordInput = _jpw[0];
  var setJoinPasswordInput = _jpw[1];
  var _jsm = useState(false);
  var joinShareModalOpen = _jsm[0];
  var setJoinShareModalOpen = _jsm[1];

  useEffect(
    function () {
      setJoinPasswordInput('');
      setJoinShareModalOpen(false);
    },
    [rideId]
  );

  async function confirmJoinWithContactShare(contactPublic) {
    setBusy(true);
    try {
      await join({
        contactPublicToParticipants: !!contactPublic,
        joinPasswordAttempt: joinPasswordInput
      });
      setJoinShareModalOpen(false);
    } finally {
      setBusy(false);
    }
  }
  async function onLeave() {
    setBusy(true);
    try {
      await leave();
    } finally {
      setBusy(false);
    }
  }

  async function confirmBombRide() {
    var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
    if (!firestore || !userId || typeof svc.cancelRideByHost !== 'function') return;
    setCancelBusy(true);
    try {
      await svc.cancelRideByHost(firestore, rideId, userId);
      setBombOpen(false);
      if (typeof reload === 'function') await reload();
    } finally {
      setCancelBusy(false);
    }
  }

  useEffect(
    function () {
      if (typeof registerDetailHeaderEdit !== 'function') return;
      if (loading || !ride) {
        registerDetailHeaderEdit(false, null);
        return;
      }
      var host = !!(userId && String(ride.hostUserId || '') === String(userId));
      var cancelled = String(ride.rideStatus || 'active') === 'cancelled';
      if (host && !cancelled) registerDetailHeaderEdit(true, onOpenEdit);
      else registerDetailHeaderEdit(false, null);
      return function () {
        registerDetailHeaderEdit(false, null);
      };
    },
    [registerDetailHeaderEdit, loading, ride, userId, onOpenEdit]
  );

  if (loading || !ride) {
    return <div className="p-6 text-center text-slate-500">불러오는 중…</div>;
  }

  var ts = ride.date && typeof ride.date.toDate === 'function' ? ride.date.toDate() : null;
  var dateStr = ts ? ts.toLocaleDateString('ko-KR') : '';

  var isHost = !!(userId && String(ride.hostUserId || '') === String(userId));
  var isCancelled = String(ride.rideStatus || 'active') === 'cancelled';
  var hasApplied = role === 'participant' || (role && typeof role === 'object' && role.type === 'waitlist');
  var showHostContactRow = !!(isHost || hasApplied);

  var isPrivateRide = !!ride.isPrivate;
  var invitedListArr = Array.isArray(ride.invitedList) ? ride.invitedList : [];
  var myPhoneForInvite = String(getOpenRidingProfileDefaults().contactInfo || '').trim();
  var _svcInv = typeof window !== 'undefined' ? window.openRidingService || {} : {};
  var phoneInvited = !!(
    typeof _svcInv.isUserPhoneInvitedToRide === 'function' && _svcInv.isUserPhoneInvitedToRide(myPhoneForInvite, invitedListArr)
  );
  var pwdStored = String(ride.rideJoinPassword != null ? ride.rideJoinPassword : '')
    .replace(/\D/g, '')
    .slice(0, 4);
  var joinPwdNorm = String(joinPasswordInput || '')
    .replace(/\D/g, '')
    .slice(0, 4);
  var passwordGateOk = pwdStored.length === 4 && joinPwdNorm === pwdStored;
  var joinInviteOk = !isPrivateRide || isHost || phoneInvited || passwordGateOk;
  var showJoinPasswordField = isPrivateRide && !isHost && !phoneInvited && !role;

  var roleLabel = !role ? '미신청' : role === 'participant' ? '참석 확정' : '대기 ' + role.position + '번';

  var pd =
    ride.participantDisplay && typeof ride.participantDisplay === 'object' && !Array.isArray(ride.participantDisplay)
      ? ride.participantDisplay
      : {};
  var pc =
    ride.participantContact && typeof ride.participantContact === 'object' && !Array.isArray(ride.participantContact)
      ? ride.participantContact
      : {};
  var pcp =
    ride.participantContactPublic && typeof ride.participantContactPublic === 'object' && !Array.isArray(ride.participantContactPublic)
      ? ride.participantContactPublic
      : {};
  var parts = Array.isArray(ride.participants) ? ride.participants : [];
  var waits = Array.isArray(ride.waitlist) ? ride.waitlist : [];
  var maskContacts = shouldMaskOpenRidingContacts(ride);

  function participantRowName(uid, fallbackLabel) {
    var n = pd[String(uid)];
    if (n && String(n).trim()) return String(n).trim();
    return fallbackLabel;
  }

  function participantListPhoneSuffix(uid) {
    var ph = pc[String(uid)];
    if (!ph || !String(ph).trim()) return null;
    var rawStr = String(ph).trim();
    var uk = String(uid);
    var shareToPeers = !Object.prototype.hasOwnProperty.call(pcp, uk) || pcp[uk] === true;
    var attendeeViewer = isHost || hasApplied;
    if (maskContacts) return ' (' + maskContactForDisplay(rawStr) + ')';
    if (!attendeeViewer) return ' (' + maskPhoneLastFourDisplay(rawStr) + ')';
    if (shareToPeers) return ' (' + rawStr + ')';
    return ' (' + maskPhoneLastFourDisplay(rawStr) + ')';
  }

  var detailMuted = isCancelled ? ' open-riding-detail-muted' : '';

  function statRow(label, valueNode) {
    return (
      <div className="open-riding-detail-stat-row">
        <span className="open-riding-detail-stat-label">{label}</span>
        <div className="open-riding-detail-stat-value min-w-0">{valueNode}</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-2 space-y-4 w-full">
      {isCancelled ? (
        <p className="text-sm font-medium text-red-500 px-1 rounded-lg bg-red-50 border border-red-100 py-2 px-2">
          이 라이딩은 방장에 의해 폭파(취소)되었습니다. 참가자 개별 안내(알림톡 등)는 추후 연동 예정입니다.
        </p>
      ) : null}

      <div className={'open-riding-detail-stat-panel rounded-xl overflow-hidden' + detailMuted}>
        <div className="open-riding-detail-stat-row">
          <span className="open-riding-detail-stat-label">제목</span>
          <div className="open-riding-detail-stat-value flex min-w-0 flex-1 items-center justify-end gap-2 text-left">
            <span className={'font-semibold text-slate-900 flex-1 min-w-0 break-words text-[13px] leading-[1.45] ' + (isCancelled ? 'open-riding-detail-title-cancelled' : '')}>
              {ride.title}
            </span>
            {isHost && !isCancelled ? (
              <button
                type="button"
                className="open-riding-filter-launch-btn inline-flex items-center justify-center rounded-lg border-2 border-violet-600 bg-white px-2 py-1.5 text-[10px] sm:text-[11px] font-semibold text-violet-700 shadow-sm hover:bg-violet-50 whitespace-nowrap shrink-0 self-center"
                onClick={function () {
                  setBombOpen(true);
                }}
              >
                라이딩 폭파
              </button>
            ) : null}
          </div>
        </div>
        {statRow('일시', (
          <span>
            {dateStr} {ride.departureTime != null ? ride.departureTime : ''}
          </span>
        ))}
        {statRow('출발', ride.departureLocation != null ? ride.departureLocation : '-')}
        {statRow('지역', ride.region != null ? ride.region : '-')}
        {statRow('레벨', ride.level != null ? ride.level : '-')}
        {statRow(
          '거리',
          ride.distance != null && String(ride.distance).trim() !== ''
            ? (function () {
                var n = Number(ride.distance);
                return isNaN(n) ? '-' : String(Math.round(n)) + 'km';
              })()
            : '-'
        )}
        {statRow('정원', ((ride.participants && ride.participants.length) || 0) + ' / ' + (ride.maxParticipants != null ? ride.maxParticipants : '-'))}
        {statRow('방장', ride.hostName != null ? ride.hostName : '-')}
        {statRow('공개 여부', isPrivateRide ? '비공개 · 초대 또는 입장 비밀번호로 신청' : '공개')}
        {statRow(
          '연락처',
          showHostContactRow && ride.contactInfo ? (
            maskContacts ? maskContactForDisplay(ride.contactInfo) : ride.contactInfo
          ) : !showHostContactRow && ride.contactInfo ? (
            <span className="text-amber-600">참석 신청 후 방장 연락처가 표시됩니다.</span>
          ) : (
            '-'
          )
        )}
        {statRow('내 상태', roleLabel)}
      </div>
      {maskContacts ? (
        <p className="text-xs text-slate-500 px-1 leading-snug">라이딩 일정일이 지나 방장·참가자 연락처는 개인정보 보호를 위해 마스킹되었습니다.</p>
      ) : null}

      <div className={'open-riding-course-detail-card rounded-xl border border-violet-100/80 bg-violet-50/30 p-3 space-y-3' + detailMuted}>
        {ride.course ? <p className="text-sm text-slate-800 whitespace-pre-wrap m-0">{ride.course}</p> : null}
        <OpenRidingGpxCoursePanel gpxUrl={ride.gpxUrl != null ? String(ride.gpxUrl) : ''} file={null} storage={storage} showEmptyMessage={true} />
        {ride.gpxUrl ? (
          <a
            className={'inline-flex items-center gap-1 text-violet-600 text-sm font-semibold hover:underline' + (isCancelled ? ' opacity-50 pointer-events-none' : '')}
            href={ride.gpxUrl}
            target="_blank"
            rel="noreferrer"
            download
          >
            GPX 파일 다운로드
          </a>
        ) : null}
      </div>

      <div className={'rounded-xl border border-violet-200/60 bg-white p-3 space-y-3 shadow-sm' + detailMuted}>
        <h2 className="text-sm font-semibold text-violet-900">참가자 명단</h2>
        <div>
          <p className="text-xs font-medium text-slate-600 mb-1">참석 확정 ({parts.length}명)</p>
          {parts.length === 0 ? (
            <p className="text-xs text-slate-400">아직 없습니다.</p>
          ) : (
            <ol className="list-none text-sm text-slate-700 space-y-1.5 pl-0">
              {parts.map(function (uid, idx) {
                var suf = participantListPhoneSuffix(uid);
                return (
                  <li key={String(uid) + '-p'}>
                    <span className="font-semibold text-violet-700">{idx + 1}번</span>{' '}
                    <span>{participantRowName(uid, '참가자')}</span>
                    {suf ? <span className="text-slate-600">{suf}</span> : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-slate-600 mb-1">대기 ({waits.length}명)</p>
          {waits.length === 0 ? (
            <p className="text-xs text-slate-400">없습니다.</p>
          ) : (
            <ol className="list-none text-sm text-slate-700 space-y-1.5 pl-0">
              {waits.map(function (uid, idx) {
                var suf = participantListPhoneSuffix(uid);
                return (
                  <li key={String(uid) + '-w'}>
                    <span className="font-semibold text-amber-700">{idx + 1}번</span>{' '}
                    <span>{participantRowName(uid, '대기')}</span>
                    {suf ? <span className="text-slate-600">{suf}</span> : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      {actionErr ? <p className="text-sm text-red-600">{actionErr}</p> : null}

      {!isCancelled ? (
        <div className="space-y-2">
          {showJoinPasswordField ? (
            <label className="block text-sm font-medium text-slate-700">
              비공개 입장 비밀번호 (숫자 4자리)
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                className="mt-1 w-full border border-violet-200 rounded-xl px-3 py-2 text-sm tracking-[0.4em] text-center"
                placeholder="••••"
                value={joinPasswordInput}
                onChange={function (e) {
                  setJoinPasswordInput(String(e.target.value || '').replace(/\D/g, '').slice(0, 4));
                }}
              />
            </label>
          ) : null}
          <div className="flex gap-2">
            {role ? (
              <button type="button" className="open-riding-action-btn h-11 inline-flex items-center justify-center flex-1 px-4 border border-red-200 text-red-700 rounded-xl font-medium leading-none" disabled={isActionBusy} onClick={onLeave}>
                참석 취소
              </button>
            ) : (
              <button
                type="button"
                className="open-riding-action-btn h-11 inline-flex items-center justify-center flex-1 px-4 bg-violet-600 text-white rounded-xl font-medium leading-none disabled:opacity-50"
                disabled={isActionBusy || !userId || !joinInviteOk}
                title={!joinInviteOk ? '초대된 연락처 또는 입장 비밀번호가 필요합니다' : undefined}
                onClick={function () {
                  if (!joinInviteOk) return;
                  setJoinShareModalOpen(true);
                }}
              >
                {joinInviteOk ? '참석 신청' : '참석 신청 (입장 조건)'}
              </button>
            )}
          </div>
          {isPrivateRide && !isHost && !role && !joinInviteOk ? (
            <p className="text-xs text-amber-800 text-center leading-snug px-1">
              초대된 전화번호와 프로필 연락처가 일치하거나, 방장이 설정한 4자리 비밀번호를 입력해야 참석 신청할 수 있습니다.
            </p>
          ) : null}
        </div>
      ) : null}

      {joinShareModalOpen ? (
        <div
          className="fixed inset-0 z-[10075] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-riding-share-contact-title"
          onClick={function () {
            if (!isActionBusy) setJoinShareModalOpen(false);
          }}
        >
          <div
            className="open-riding-share-contact-panel w-full max-w-sm rounded-2xl border border-violet-200 bg-white shadow-xl overflow-hidden"
            onClick={function (e) { e.stopPropagation(); }}
          >
            <div className="open-riding-share-contact-header px-4 py-3 border-b border-violet-100">
              <h2 id="open-riding-share-contact-title" className="text-base font-bold text-violet-900 m-0">
                참석자에게 연락처 표시
              </h2>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-slate-800 font-medium m-0">연락처를 공개하시겠습니까?</p>
              <p className="text-xs text-slate-500 m-0 leading-relaxed">(라이딩에 참석자에게만 공개됩니다.)</p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  className="open-riding-action-btn h-11 flex-1 inline-flex items-center justify-center rounded-xl border-2 border-violet-300 bg-white text-violet-800 font-semibold text-sm disabled:opacity-50"
                  disabled={isActionBusy}
                  onClick={function () {
                    confirmJoinWithContactShare(false);
                  }}
                >
                  비공개
                </button>
                <button
                  type="button"
                  className="open-riding-action-btn h-11 flex-1 inline-flex items-center justify-center rounded-xl bg-violet-600 text-white font-semibold text-sm shadow-md disabled:opacity-50"
                  disabled={isActionBusy}
                  onClick={function () {
                    confirmJoinWithContactShare(true);
                  }}
                >
                  공개
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {bombOpen ? (
        <div
          className="fixed inset-0 z-[10070] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-riding-bomb-title"
          onClick={function () {
            if (!cancelBusy) setBombOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-xl p-4" onClick={function (e) { e.stopPropagation(); }}>
            <h2 id="open-riding-bomb-title" className="text-base font-semibold text-slate-900 mb-2">
              라이딩 폭파
            </h2>
            <p className="text-sm text-slate-600 mb-4">정말 라이딩을 폭파하시겠습니까?</p>
            <p className="text-xs text-slate-500 mb-4">참가자 문자·알림톡 일괄 발송은 추후 연동됩니다.</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="open-riding-action-btn h-11 flex-1 inline-flex items-center justify-center rounded-xl border border-slate-200 text-slate-700 font-medium"
                disabled={cancelBusy}
                onClick={function () {
                  setBombOpen(false);
                }}
              >
                아니오
              </button>
              <button
                type="button"
                className="open-riding-action-btn h-11 flex-1 inline-flex items-center justify-center rounded-xl bg-red-600 text-white font-medium disabled:opacity-50"
                disabled={cancelBusy}
                onClick={confirmBombRide}
              >
                {cancelBusy ? '처리 중…' : '예'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 오픈 라이딩방 단일 앱: 컴팩트 달력·목록 ↔ 생성 ↔ 상세 */
function OpenRidingRoomApp(props) {
  var firestore = props.firestore;
  var storage = props.storage;
  var userId = props.userId || '';
  var userLabel = props.userLabel || '라이더';

  var _v = useState('main');
  var view = _v[0];
  var setView = _v[1];
  var _rid = useState(null);
  var detailRideId = _rid[0];
  var setDetailRideId = _rid[1];
  var _dhe = useState({ show: false, onEdit: null });
  var detailHeaderEdit = _dhe[0];
  var setDetailHeaderEdit = _dhe[1];

  var registerDetailHeaderEdit = useCallback(function (show, onEdit) {
    setDetailHeaderEdit({ show: !!show, onEdit: onEdit || null });
  }, []);

  useEffect(
    function () {
      if (view !== 'detail') setDetailHeaderEdit({ show: false, onEdit: null });
    },
    [view]
  );

  function handleTopBack() {
    if (view === 'main') {
      if (typeof showScreen === 'function') showScreen('basecampScreen');
    } else if (view === 'edit') {
      setView('detail');
    } else if (view === 'create') {
      setView('main');
    } else {
      setDetailRideId(null);
      setView('main');
    }
  }

  var headerTitle =
    view === 'create' ? '라이딩 생성' : view === 'edit' ? '라이딩 수정' : view === 'detail' ? '라이딩 상세' : '오픈 라이딩방';

  var inner = null;
  if (!firestore) {
    inner = (
      <div className="p-4 text-center text-sm text-amber-900 rounded-xl border border-amber-200 bg-amber-50">
        Firestore에 연결되지 않았습니다. 네트워크 또는 로그인 상태를 확인한 뒤 다시 시도해 주세요.
      </div>
    );
  } else if (view === 'create') {
    inner = (
      <OpenRidingCreateForm
        firestore={firestore}
        storage={storage}
        hostUserId={userId}
        onCreated={function () { setView('main'); }}
      />
    );
  } else if (view === 'edit' && detailRideId) {
    inner = (
      <OpenRidingCreateForm
        firestore={firestore}
        storage={storage}
        hostUserId={userId}
        editRideId={detailRideId}
        onCreated={function () { setView('main'); }}
        onEditSaved={function () { setView('detail'); }}
      />
    );
  } else if (view === 'detail' && detailRideId) {
    inner = (
      <OpenRidingDetail
        firestore={firestore}
        storage={storage}
        rideId={detailRideId}
        userId={userId}
        onBack={function () { setView('main'); }}
        onOpenEdit={function () { setView('edit'); }}
        registerDetailHeaderEdit={registerDetailHeaderEdit}
      />
    );
  } else {
    inner = (
      <OpenRidingCalendarMain
        firestore={firestore}
        storage={storage}
        userId={userId}
        userLabel={userLabel}
        compact={true}
        onOpenCreate={function () { setView('create'); }}
        onSelectRide={function (id) { setDetailRideId(id); setView('detail'); }}
      />
    );
  }

  return (
    <div className="open-riding-app-root">
      <div className="open-riding-inner-header">
        <button
          type="button"
          className="p-2 rounded-lg hover:bg-gray-100 active:opacity-80 transition-all shrink-0"
          style={{ width: '2.5em', padding: 8, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={handleTopBack}
          aria-label={view === 'main' ? '경로 선택' : '미니 달력 화면으로'}
        >
          <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: 24, height: 24, color: '#4b5563' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="flex-1 text-center font-bold text-base text-gray-900 m-0" style={{ fontSize: '1.05rem' }}>
          {headerTitle}
        </h1>
        {view === 'detail' && detailHeaderEdit.show && detailHeaderEdit.onEdit ? (
          <button
            type="button"
            className="p-2 rounded-lg hover:bg-gray-100 active:opacity-80 transition-all shrink-0"
            style={{ width: '2.5em', padding: 8, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={detailHeaderEdit.onEdit}
            aria-label="라이딩 수정"
          >
            <OpenRidingDashboardEditIcon />
          </button>
        ) : (
          <span className="shrink-0" style={{ width: '2.5em' }} aria-hidden="true" />
        )}
      </div>
      <div className="open-riding-app-body flex-1 min-h-0 overflow-y-auto px-3 pt-2 w-full box-border pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">{inner}</div>
    </div>
  );
}

if (typeof window !== 'undefined') {
  window.OpenRidingCalendarMain = OpenRidingCalendarMain;
  window.OpenRidingCreateForm = OpenRidingCreateForm;
  window.OpenRidingDetail = OpenRidingDetail;
  window.OpenRidingRoomApp = OpenRidingRoomApp;
}

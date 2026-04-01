/**
 * 오픈 라이딩방 UI (메인 달력·설정 / 생성 폼 / 상세)
 * @requires React, window.openRidingBoot(모듈)로 useOpenRiding·openRidingService 로드 후 type="text/babel" 로 본 파일 로드
 */
/* global React */
var useState = React.useState;
var useMemo = React.useMemo;
var useCallback = React.useCallback;

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
    uploadRideGpx: svc.uploadRideGpx
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
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className="w-full text-left py-2.5 hover:bg-slate-50 px-2 rounded-lg"
                    onClick={function () { onSelectRide(r.id); }}
                  >
                    <div className="font-medium text-slate-800 text-sm">{r.title}</div>
                    <div className="text-xs text-slate-600 mt-1 flex flex-wrap items-center gap-y-0.5">
                      <span className="shrink-0">{r.region != null && String(r.region).trim() ? r.region : '-'}</span>
                      {rideListMetaSep()}
                      <span className="shrink-0">{r.level != null && String(r.level).trim() ? r.level : '-'}</span>
                      {rideListMetaSep()}
                      <span className="shrink-0">{r.departureTime != null && String(r.departureTime).trim() ? r.departureTime : '-'}</span>
                      {rideListMetaSep()}
                      <span className="shrink-0">{rideDistanceKm(r)}</span>
                      {rideListMetaSep()}
                      <span className="text-violet-700 font-semibold tabular-nums shrink-0">{rideParticipantRatio(r)}</span>
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

/** 생성 폼 — storage, firestore, hostUserId, onCreated(rideId) */
function OpenRidingCreateForm(props) {
  var _svcForm = getOpenRidingServiceFns();
  var createRide = _svcForm.createRide;
  var uploadRideGpx = _svcForm.uploadRideGpx;
  var _koForm = getKoreaRegionOptions();
  var KOREA_SIGUNGU_OPTIONS = _koForm.KOREA_SIGUNGU_OPTIONS;
  var RIDING_LEVEL_OPTIONS = _koForm.RIDING_LEVEL_OPTIONS;

  var firestore = props.firestore;
  var storage = props.storage;
  var hostUserId = props.hostUserId;
  var onCreated = props.onCreated || function () {};

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
      gpxFile: null
    };
  });
  var form = st[0];
  var setForm = st[1];
  var _busy = useState(false);
  var isBusy = _busy[0];
  var setBusy = _busy[1];

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
    if (!firestore || !hostUserId || typeof createRide !== 'function') return;
    setBusy(true);
    try {
      var gpxUrl = null;
      if (storage && form.gpxFile && typeof uploadRideGpx === 'function') {
        var draftId = 'draft/' + hostUserId + '/' + Date.now();
        gpxUrl = await uploadRideGpx(storage, form.gpxFile, draftId);
      }
      var d = new Date(form.date + 'T12:00:00+09:00');
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
        gpxUrl: gpxUrl
      });
      onCreated(rideId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="w-full max-w-lg mx-auto space-y-3 pb-1 text-sm text-slate-700" onSubmit={submit}>
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
          <div className="flex gap-2 items-end">
            <div className="flex-1 min-w-0">
              <span className="block text-xs text-slate-500 mb-0.5">시</span>
              <select
                className="open-riding-time-dial w-full text-sm"
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
            </div>
            <div className="flex-1 min-w-0">
              <span className="block text-xs text-slate-500 mb-0.5">분</span>
              <select
                className="open-riding-time-dial w-full text-sm"
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
      </div>

      <label className="block font-medium text-slate-700">출발 장소<input className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={form.departureLocation} onChange={function (e) { set('departureLocation', e.target.value); }} required /></label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block font-medium text-slate-700">거리(km)<input type="number" className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={form.distance} onChange={function (e) { set('distance', Number(e.target.value)); }} min={1} /></label>
        <label className="block font-medium text-slate-700">최대 인원<input type="number" className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={form.maxParticipants} onChange={function (e) { set('maxParticipants', Number(e.target.value)); }} min={1} /></label>
      </div>

      <label className="block font-medium text-slate-700">코스 설명<textarea className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" rows={3} value={form.course} onChange={function (e) { set('course', e.target.value); }} /></label>

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

      <label className="block font-medium text-slate-700">GPX 파일 (선택)<input type="file" accept=".gpx,application/gpx+xml" className="mt-1 block w-full text-sm" onChange={function (e) { set('gpxFile', e.target.files && e.target.files[0]); }} /></label>

      <button type="submit" className="open-riding-create-submit open-riding-action-btn h-11 inline-flex items-center justify-center w-full flex-1 px-4 bg-violet-600 text-white rounded-xl font-medium leading-none disabled:opacity-50" disabled={isBusy}>
        {isBusy ? '저장 중…' : '생성'}
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

/** 상세 + 참석/취소 (Transaction) */
function OpenRidingDetail(props) {
  var firestore = props.firestore;
  var rideId = props.rideId;
  var userId = props.userId;
  var onBack = props.onBack || function () {};

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
  var role = h.role;
  var actionErr = h.actionError;

  var _actBusy = useState(false);
  var isActionBusy = _actBusy[0];
  var setBusy = _actBusy[1];

  async function onJoin() {
    setBusy(true);
    try { await join(); } finally { setBusy(false); }
  }
  async function onLeave() {
    setBusy(true);
    try { await leave(); } finally { setBusy(false); }
  }

  if (loading || !ride) {
    return <div className="p-6 text-center text-slate-500">불러오는 중…</div>;
  }

  var ts = ride.date && typeof ride.date.toDate === 'function' ? ride.date.toDate() : null;
  var dateStr = ts ? ts.toLocaleDateString('ko-KR') : '';

  var isHost = userId && String(ride.hostUserId || '') === String(userId);
  var showContact = !!(isHost || role === 'participant');

  var roleLabel = !role ? '미신청' : role === 'participant' ? '참석 확정' : '대기 ' + role.position + '번';

  var pd =
    ride.participantDisplay && typeof ride.participantDisplay === 'object' && !Array.isArray(ride.participantDisplay)
      ? ride.participantDisplay
      : {};
  var parts = Array.isArray(ride.participants) ? ride.participants : [];
  var waits = Array.isArray(ride.waitlist) ? ride.waitlist : [];
  function participantRowName(uid, fallbackLabel) {
    var n = pd[String(uid)];
    if (n && String(n).trim()) return String(n).trim();
    return fallbackLabel;
  }

  return (
    <div className="max-w-lg mx-auto py-2 space-y-4 w-full">
      <h1 className="text-xl font-bold px-1">{ride.title}</h1>
      <ul className="text-sm text-slate-600 space-y-1 px-1">
        <li>일시: {dateStr} {ride.departureTime}</li>
        <li>출발: {ride.departureLocation}</li>
        <li>지역: {ride.region} / 레벨: {ride.level}</li>
        <li>거리: {ride.distance}km</li>
        <li>정원: {(ride.participants && ride.participants.length) || 0} / {ride.maxParticipants}</li>
        <li>방장: {ride.hostName}</li>
        {showContact && ride.contactInfo ? <li>연락처: {ride.contactInfo}</li> : null}
        {!showContact && ride.contactInfo ? <li className="text-amber-600">연락처는 참석 확정 후에 표시됩니다.</li> : null}
      </ul>
      {ride.course ? <p className="text-sm bg-slate-50 rounded-lg p-3">{ride.course}</p> : null}
      {ride.gpxUrl ? <a className="text-violet-600 text-sm" href={ride.gpxUrl} target="_blank" rel="noreferrer">GPX 다운로드</a> : null}

      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">참가자 명단</h2>
        <div>
          <p className="text-xs font-medium text-slate-600 mb-1">참석 확정 ({parts.length}명)</p>
          {parts.length === 0 ? (
            <p className="text-xs text-slate-400">아직 없습니다.</p>
          ) : (
            <ol className="list-decimal list-inside text-sm text-slate-700 space-y-1.5 pl-0.5">
              {parts.map(function (uid, idx) {
                return (
                  <li key={String(uid) + '-p'} className="marker:font-semibold">
                    <span className="font-semibold text-violet-700">{idx + 1}번</span>{' '}
                    <span>{participantRowName(uid, '참가자')}</span>
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
            <ol className="list-decimal list-inside text-sm text-slate-700 space-y-1.5 pl-0.5">
              {waits.map(function (uid, idx) {
                return (
                  <li key={String(uid) + '-w'} className="marker:font-semibold">
                    <span className="font-semibold text-amber-700">대기 {idx + 1}번</span>{' '}
                    <span>{participantRowName(uid, '대기')}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      <p className="text-sm font-medium">내 상태: {roleLabel}</p>
      {actionErr ? <p className="text-sm text-red-600">{actionErr}</p> : null}

      <div className="flex gap-2">
        {role ? (
          <button type="button" className="open-riding-action-btn h-11 inline-flex items-center justify-center flex-1 px-4 border border-red-200 text-red-700 rounded-xl font-medium leading-none" disabled={isActionBusy} onClick={onLeave}>참석 취소</button>
        ) : (
          <button type="button" className="open-riding-action-btn h-11 inline-flex items-center justify-center flex-1 px-4 bg-violet-600 text-white rounded-xl font-medium leading-none disabled:opacity-50" disabled={isActionBusy || !userId} onClick={onJoin}>참석 신청</button>
        )}
      </div>
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

  function handleTopBack() {
    if (view === 'main') {
      if (typeof showScreen === 'function') showScreen('basecampScreen');
    } else {
      setDetailRideId(null);
      setView('main');
    }
  }

  var headerTitle = view === 'create' ? '라이딩 생성' : view === 'detail' ? '라이딩 상세' : '오픈 라이딩방';

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
  } else if (view === 'detail' && detailRideId) {
    inner = (
      <OpenRidingDetail
        firestore={firestore}
        rideId={detailRideId}
        userId={userId}
        onBack={function () { setView('main'); }}
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
        <span className="shrink-0" style={{ width: '2.5em' }} aria-hidden="true" />
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

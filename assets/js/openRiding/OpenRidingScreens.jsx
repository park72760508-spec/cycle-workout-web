/**
 * 오픈 라이딩방 UI (메인 달력·설정 / 생성 폼 / 상세)
 * @requires React, Tailwind 또는 프로젝트 CSS에 맞게 클래스 조정
 */
/* global React */
var useState = React.useState;
var useMemo = React.useMemo;
var useCallback = React.useCallback;
import { useOpenRiding, useOpenRideDetail } from './useOpenRiding.js';
import { createRide, uploadRideGpx } from './openRidingService.js';
import { Timestamp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { KOREA_SIGUNGU_OPTIONS, RIDING_LEVEL_OPTIONS } from './koreaRegions.js';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dateKey(y, m, d) {
  return y + '-' + pad2(m + 1) + '-' + pad2(d);
}

/** 달력 그리드 + 녹색 마커(맞춤 필터 일치 일자) */
export function OpenRidingCalendarMain(props) {
  var firestore = props.firestore;
  var storage = props.storage;
  var userId = props.userId || '';
  var userLabel = props.userLabel || '라이더';
  var onOpenCreate = props.onOpenCreate || function () {};
  var onSelectRide = props.onSelectRide || function () {};

  var _m = useState(function () { return new Date(); });
  var viewMonth = _m[0];
  var setViewMonth = _m[1];

  var hook = useOpenRiding(firestore, userId || null, viewMonth);
  var prefs = hook.prefs;
  var savePrefs = hook.savePrefs;
  var matchingDateKeys = hook.matchingDateKeys;
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

  var _regionDraft = useState('');
  var regionDraft = _regionDraft[0];
  var setRegionDraft = _regionDraft[1];

  function addRegion() {
    var t = regionDraft.trim();
    if (!t) return;
    if (prefs.activeRegions.indexOf(t) >= 0) return;
    savePrefs({
      activeRegions: prefs.activeRegions.concat([t]),
      preferredLevels: prefs.preferredLevels
    });
    setRegionDraft('');
  }

  function removeRegion(r) {
    savePrefs({
      activeRegions: prefs.activeRegions.filter(function (x) { return x !== r; });
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

  return (
    <div className="open-riding-main max-w-4xl mx-auto p-4 space-y-6">
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <section className="md:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <button type="button" className="text-slate-600" onClick={function () { setViewMonth(new Date(year, month - 1, 1)); }}>{'‹'}</button>
            <span className="font-semibold">{year}년 {month + 1}월</span>
            <button type="button" className="text-slate-600" onClick={function () { setViewMonth(new Date(year, month + 1, 1)); }}>{'›'}</button>
          </div>
          {loadingRides ? <p className="text-sm text-slate-400">불러오는 중…</p> : null}
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500 mb-1">
            {['일', '월', '화', '수', '목', '금', '토'].map(function (w) { return <div key={w}>{w}</div>; })}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map(function (day, idx) {
              if (day == null) return <div key={'e' + idx} className="h-10" />;
              var key = dateKey(year, month, day);
              var hasMatch = matchingDateKeys.has(key);
              var isSel = selectedKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={function () { setSelectedKey(key); }}
                  className={
                    'relative h-10 rounded-lg text-sm flex items-center justify-center transition ' +
                    (isSel ? 'ring-2 ring-violet-500 font-semibold ' : '') +
                    ' hover:bg-slate-50'
                  }
                >
                  {hasMatch ? (
                    <span
                      className="absolute inset-1 rounded-md bg-emerald-400/35 pointer-events-none"
                      aria-hidden
                    />
                  ) : null}
                  <span className="relative z-10">{day}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">녹색 표시: 내 지역·레벨 설정과 맞는 라이딩이 있는 날</p>
        </section>

        <aside className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">맞춤 필터 설정</h2>
          <div>
            <label className="text-xs text-slate-500 block mb-1">활동 지역 추가</label>
            <div className="flex gap-1">
              <input
                className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                value={regionDraft}
                onChange={function (e) { setRegionDraft(e.target.value); }}
                placeholder="예: 서울특별시 강남구"
              />
              <button type="button" className="rounded-lg bg-slate-800 text-white px-2 text-sm" onClick={addRegion}>추가</button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1">
              {prefs.activeRegions.map(function (r) {
                return (
                  <li key={r}>
                    <button type="button" className="text-xs bg-white border rounded-full px-2 py-0.5" onClick={function () { removeRegion(r); }}>
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
        </aside>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">
          {selectedKey ? selectedKey + ' 라이딩' : '날짜를 선택하세요'}
        </h2>
        {!selectedKey ? (
          <p className="text-sm text-slate-400">달력에서 날짜를 탭하면 목록이 표시됩니다.</p>
        ) : ridesForDay.length === 0 ? (
          <p className="text-sm text-slate-400">이 날 등록된 라이딩이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {ridesForDay.map(function (r) {
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className="w-full text-left py-3 hover:bg-slate-50 px-2 rounded-lg"
                    onClick={function () { onSelectRide(r.id); }}
                  >
                    <div className="font-medium text-slate-800">{r.title}</div>
                    <div className="text-xs text-slate-500">{r.region} · {r.level} · {r.departureTime}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** 생성 폼 — storage, firestore, hostUserId, onCreated(rideId) */
export function OpenRidingCreateForm(props) {
  var firestore = props.firestore;
  var storage = props.storage;
  var hostUserId = props.hostUserId;
  var onCreated = props.onCreated || function () {};
  var onCancel = props.onCancel || function () {};

  var st = useState(function () {
    return {
      title: '',
      date: new Date().toISOString().slice(0, 10),
      departureTime: '07:00',
      departureLocation: '',
      distance: 40,
      course: '',
      level: '중급',
      maxParticipants: 10,
      hostName: '',
      contactInfo: '',
      isContactPublic: true,
      region: '',
      gpxFile: null
    };
  });
  var form = st[0];
  var setForm = st[1];
  var _busy = useState(false);
  var isBusy = _busy[0];
  var setBusy = _busy[1];

  function set(k, v) {
    setForm(function (prev) {
      var n = {};
      for (var key in prev) n[key] = prev[key];
      n[k] = v;
      return n;
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (!firestore || !hostUserId) return;
    setBusy(true);
    try {
      var gpxUrl = null;
      if (storage && form.gpxFile) {
        var draftId = 'draft/' + hostUserId + '/' + Date.now();
        gpxUrl = await uploadRideGpx(storage, form.gpxFile, draftId);
      }
      var d = new Date(form.date + 'T12:00:00');
      var rideId = await createRide(firestore, hostUserId, {
        title: form.title,
        date: Timestamp.fromDate(d),
        departureTime: form.departureTime,
        departureLocation: form.departureLocation,
        distance: form.distance,
        course: form.course,
        level: form.level,
        maxParticipants: form.maxParticipants,
        hostName: form.hostName,
        contactInfo: form.contactInfo,
        isContactPublic: form.isContactPublic,
        region: form.region,
        gpxUrl: gpxUrl
      });
      onCreated(rideId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="max-w-lg mx-auto p-4 space-y-3 bg-white rounded-2xl border border-slate-200 shadow-sm" onSubmit={submit}>
      <h2 className="text-lg font-bold">라이딩 생성</h2>

      <label className="block text-sm">제목<input className="mt-1 w-full border rounded-lg px-2 py-1" value={form.title} onChange={function (e) { set('title', e.target.value); }} required /></label>

      <label className="block text-sm">지역
        <select className="mt-1 w-full border rounded-lg px-2 py-1" value={form.region} onChange={function (e) { set('region', e.target.value); }} required>
          <option value="">선택</option>
          {KOREA_SIGUNGU_OPTIONS.map(function (o) { return <option key={o} value={o}>{o}</option>; })}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">날짜<input type="date" className="mt-1 w-full border rounded-lg px-2 py-1" value={form.date} onChange={function (e) { set('date', e.target.value); }} required /></label>
        <label className="block text-sm">출발시간<input className="mt-1 w-full border rounded-lg px-2 py-1" value={form.departureTime} onChange={function (e) { set('departureTime', e.target.value); }} required /></label>
      </div>

      <label className="block text-sm">출발 장소<input className="mt-1 w-full border rounded-lg px-2 py-1" value={form.departureLocation} onChange={function (e) { set('departureLocation', e.target.value); }} required /></label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">거리(km)<input type="number" className="mt-1 w-full border rounded-lg px-2 py-1" value={form.distance} onChange={function (e) { set('distance', Number(e.target.value)); }} min={1} /></label>
        <label className="block text-sm">최대 인원<input type="number" className="mt-1 w-full border rounded-lg px-2 py-1" value={form.maxParticipants} onChange={function (e) { set('maxParticipants', Number(e.target.value)); }} min={1} /></label>
      </div>

      <label className="block text-sm">코스 설명<textarea className="mt-1 w-full border rounded-lg px-2 py-1" rows={3} value={form.course} onChange={function (e) { set('course', e.target.value); }} /></label>

      <fieldset className="text-sm">
        <legend className="font-medium">레벨</legend>
        {RIDING_LEVEL_OPTIONS.map(function (opt) {
          return (
            <label key={opt.value} className="mr-4">
              <input type="radio" name="lvl" value={opt.value} checked={form.level === opt.value} onChange={function () { set('level', opt.value); }} />
              {opt.value}
            </label>
          );
        })}
      </fieldset>

      <label className="block text-sm">방장명<input className="mt-1 w-full border rounded-lg px-2 py-1" value={form.hostName} onChange={function (e) { set('hostName', e.target.value); }} required /></label>
      <label className="block text-sm">연락처<input className="mt-1 w-full border rounded-lg px-2 py-1" value={form.contactInfo} onChange={function (e) { set('contactInfo', e.target.value); }} /></label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.isContactPublic} onChange={function (e) { set('isContactPublic', e.target.checked); }} />
        연락처 공개
      </label>

      <label className="block text-sm">GPX 파일 (선택)<input type="file" accept=".gpx,application/gpx+xml" className="mt-1" onChange={function (e) { set('gpxFile', e.target.files && e.target.files[0]); }} /></label>

      <div className="flex gap-2 pt-2">
        <button type="button" className="flex-1 border rounded-xl py-2" onClick={onCancel}>취소</button>
        <button type="submit" className="flex-1 bg-violet-600 text-white rounded-xl py-2 disabled:opacity-50" disabled={isBusy}>{isBusy ? '저장 중…' : '생성'}</button>
      </div>
    </form>
  );
}

/** 상세 + 참석/취소 (Transaction) */
export function OpenRidingDetail(props) {
  var firestore = props.firestore;
  var rideId = props.rideId;
  var userId = props.userId;
  var onBack = props.onBack || function () {};

  var h = useOpenRideDetail(firestore, rideId, userId);
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

  var showContact = ride.isContactPublic || (role === 'participant');

  var roleLabel = !role ? '미신청' : role === 'participant' ? '참석 확정' : '대기 ' + role.position + '번';

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <button type="button" className="text-sm text-violet-600" onClick={onBack}>← 목록</button>
      <h1 className="text-xl font-bold">{ride.title}</h1>
      <ul className="text-sm text-slate-600 space-y-1">
        <li>일시: {dateStr} {ride.departureTime}</li>
        <li>출발: {ride.departureLocation}</li>
        <li>지역: {ride.region} / 레벨: {ride.level}</li>
        <li>거리: {ride.distance}km</li>
        <li>정원: {(ride.participants && ride.participants.length) || 0} / {ride.maxParticipants}</li>
        <li>방장: {ride.hostName}</li>
        {showContact && ride.contactInfo ? <li>연락처: {ride.contactInfo}</li> : null}
        {!ride.isContactPublic && role !== 'participant' ? <li className="text-amber-600">연락처는 참석 확정 후 공개됩니다.</li> : null}
      </ul>
      {ride.course ? <p className="text-sm bg-slate-50 rounded-lg p-3">{ride.course}</p> : null}
      {ride.gpxUrl ? <a className="text-violet-600 text-sm" href={ride.gpxUrl} target="_blank" rel="noreferrer">GPX 다운로드</a> : null}

      <p className="text-sm font-medium">내 상태: {roleLabel}</p>
      {actionErr ? <p className="text-sm text-red-600">{actionErr}</p> : null}

      <div className="flex gap-2">
        {role ? (
          <button type="button" className="flex-1 border border-red-200 text-red-700 rounded-xl py-3" disabled={isActionBusy} onClick={onLeave}>참석 취소</button>
        ) : (
          <button type="button" className="flex-1 bg-violet-600 text-white rounded-xl py-3" disabled={isActionBusy || !userId} onClick={onJoin}>참석 신청</button>
        )}
      </div>
    </div>
  );
}

if (typeof window !== 'undefined') {
  window.OpenRidingCalendarMain = OpenRidingCalendarMain;
  window.OpenRidingCreateForm = OpenRidingCreateForm;
  window.OpenRidingDetail = OpenRidingDetail;
}

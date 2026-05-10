/* ============================================================
   AffiliateScreens.jsx
   제휴사 관리 화면 – 라이딩 모임 그룹 화면 디자인 준용
   뷰: list → detail | create | edit
   ============================================================ */

// ── 전역 React 훅 참조 ──────────────────────────────────────────
var useState   = React.useState;
var useEffect  = React.useEffect;
var useMemo    = React.useMemo;
var useRef     = React.useRef;

// ── 헬퍼 함수 ────────────────────────────────────────────────────
function affiliateCurrentUser() {
  try {
    var c = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    return c || null;
  } catch (e) { return null; }
}

function affiliateIsAdminGrade() {
  try {
    var u = affiliateCurrentUser();
    return u && (String(u.grade) === '1' || String(u.grade) === '0');
  } catch (e) { return false; }
}

function affiliateCurrentUserId() {
  try {
    if (window.authV9 && window.authV9.currentUser) return window.authV9.currentUser.uid;
    var u = affiliateCurrentUser();
    return u ? String(u.id || u.uid || '') : '';
  } catch (e) { return ''; }
}

function affiliateInitials(name) {
  if (!name) return '?';
  var s = String(name).trim();
  return s.length > 0 ? s.charAt(0).toUpperCase() : '?';
}

function affiliateDateLabel(dateStr) {
  if (!dateStr) return '';
  return String(dateStr).replace(/-/g, '.');
}

function affiliateFormatPeriod(start, end) {
  var s = affiliateDateLabel(start);
  var e = affiliateDateLabel(end);
  if (s && e) return s + ' ~ ' + e;
  if (s) return s + ' ~';
  if (e) return '~ ' + e;
  return '';
}

function affiliateShowToast(msg) {
  if (typeof window.showToast === 'function') { window.showToast(msg); return; }
  if (typeof window.showAlert === 'function') { window.showAlert(msg); return; }
  alert(msg);
}

// ── Firestore 서비스 (Firebase v9 모듈러 – window.firestoreV9 기준) ──────────
var affiliateService = {
  _col: function(db) {
    var fns = window._firebaseFirestoreFns || {};
    if (typeof fns.collection === 'function') return fns.collection(db, 'affiliates');
    if (typeof firebase !== 'undefined' && firebase.firestore) return db.collection('affiliates');
    return null;
  },
  _doc: function(db, id) {
    var fns = window._firebaseFirestoreFns || {};
    if (typeof fns.doc === 'function') return fns.doc(db, 'affiliates', id);
    if (typeof firebase !== 'undefined' && firebase.firestore) return db.collection('affiliates').doc(id);
    return null;
  },

  subscribe: function(db, cb) {
    try {
      var fns = window._firebaseFirestoreFns || {};
      var col = this._col(db);
      if (!col) { cb([]); return function(){}; }
      var orderByFn = fns.orderBy || null;
      var queryFn   = fns.query   || null;
      var onSnap    = fns.onSnapshot || null;
      var q = (queryFn && orderByFn) ? queryFn(col, orderByFn('createdAt', 'desc')) : col;
      if (typeof onSnap === 'function') {
        return onSnap(q, function(snap) {
          var list = [];
          snap.forEach(function(d) { list.push(Object.assign({ id: d.id }, d.data())); });
          cb(list);
        }, function() { cb([]); });
      }
      // compat
      var unsub = q.onSnapshot(function(snap) {
        var list = [];
        snap.forEach(function(d) { list.push(Object.assign({ id: d.id }, d.data())); });
        cb(list);
      }, function() { cb([]); });
      return unsub;
    } catch(e) { cb([]); return function(){}; }
  },

  fetchById: function(db, id) {
    try {
      var fns = window._firebaseFirestoreFns || {};
      var ref = this._doc(db, id);
      if (!ref) return Promise.reject(new Error('no ref'));
      if (typeof fns.getDoc === 'function') {
        return fns.getDoc(ref).then(function(d) {
          return d.exists() ? Object.assign({ id: d.id }, d.data()) : null;
        });
      }
      // compat
      return ref.get().then(function(d) {
        return d.exists ? Object.assign({ id: d.id }, d.data()) : null;
      });
    } catch(e) { return Promise.reject(e); }
  },

  create: function(db, userId, data) {
    try {
      var fns = window._firebaseFirestoreFns || {};
      var col = this._col(db);
      if (!col) return Promise.reject(new Error('no col'));
      var ts = (fns.serverTimestamp || (typeof firebase !== 'undefined' ? firebase.firestore.FieldValue.serverTimestamp : null));
      var payload = Object.assign({}, data, {
        createdBy: userId,
        createdAt: ts ? ts() : new Date().toISOString(),
        updatedAt: ts ? ts() : new Date().toISOString()
      });
      if (typeof fns.addDoc === 'function') {
        return fns.addDoc(col, payload).then(function(ref) { return ref.id; });
      }
      return col.add(payload).then(function(ref) { return ref.id; });
    } catch(e) { return Promise.reject(e); }
  },

  update: function(db, id, data) {
    try {
      var fns = window._firebaseFirestoreFns || {};
      var ref = this._doc(db, id);
      if (!ref) return Promise.reject(new Error('no ref'));
      var ts = (fns.serverTimestamp || null);
      var payload = Object.assign({}, data, {
        updatedAt: ts ? ts() : new Date().toISOString()
      });
      if (typeof fns.updateDoc === 'function') {
        return fns.updateDoc(ref, payload);
      }
      return ref.update(payload);
    } catch(e) { return Promise.reject(e); }
  },

  remove: function(db, id) {
    try {
      var fns = window._firebaseFirestoreFns || {};
      var ref = this._doc(db, id);
      if (!ref) return Promise.reject(new Error('no ref'));
      if (typeof fns.deleteDoc === 'function') return fns.deleteDoc(ref);
      return ref.delete();
    } catch(e) { return Promise.reject(e); }
  },

  uploadPhoto: function(storage, affiliateId, file) {
    try {
      var fns = window._firebaseStorageFns || {};
      if (typeof fns.ref === 'function' && typeof fns.uploadBytes === 'function' && typeof fns.getDownloadURL === 'function') {
        var storageRef = fns.ref(storage, 'affiliates/' + affiliateId + '/cover.' + (file.name.split('.').pop() || 'jpg'));
        return fns.uploadBytes(storageRef, file).then(function(snap) {
          return fns.getDownloadURL(snap.ref);
        });
      }
      // compat
      if (typeof firebase !== 'undefined' && firebase.storage) {
        var r = firebase.storage().ref('affiliates/' + affiliateId + '/cover.' + (file.name.split('.').pop() || 'jpg'));
        return r.put(file).then(function() { return r.getDownloadURL(); });
      }
      return Promise.resolve('');
    } catch(e) { return Promise.reject(e); }
  }
};

// ── 한국 행정구역 (OpenRidingScreens.jsx 동일 함수 재사용) ──────
function affiliateGetKoreaRegions() {
  if (typeof getKoreaRegionGroupsResolved === 'function') return getKoreaRegionGroupsResolved();
  return [];
}

// ══════════════════════════════════════════════════════════════
// 제휴사 목록 화면
// ══════════════════════════════════════════════════════════════
function AffiliateList(props) {
  var firestore   = props.firestore;
  var isAdmin     = props.isAdmin || false;
  var onOpenDetail = props.onOpenDetail || function(){};
  var onCreate    = props.onCreate || function(){};

  var _rows = useState([]);
  var rows = _rows[0]; var setRows = _rows[1];
  var _filter = useState('');
  var filterText = _filter[0]; var setFilter = _filter[1];
  var _loading = useState(true);
  var loading = _loading[0]; var setLoading = _loading[1];

  var listRef = useRef(null);
  var _showScrollTop = useState(false);
  var showScrollTop = _showScrollTop[0]; var setShowScrollTop = _showScrollTop[1];

  // Firestore 구독
  useEffect(function() {
    if (!firestore) { setLoading(false); return; }
    setLoading(true);
    var unsub = affiliateService.subscribe(firestore, function(list) {
      setRows(list);
      setLoading(false);
    });
    return function() { if (typeof unsub === 'function') unsub(); };
  }, [firestore]);

  // 스크롤 감지 (위로 가기 버튼)
  useEffect(function() {
    var el = listRef.current;
    if (!el) return;
    function onScroll() { setShowScrollTop(el.scrollTop > 200); }
    el.addEventListener('scroll', onScroll, { passive: true });
    return function() { el.removeEventListener('scroll', onScroll); };
  }, []);

  var filtered = useMemo(function() {
    var q = String(filterText || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(function(a) {
      if (String(a.name || '').toLowerCase().indexOf(q) >= 0) return true;
      if ((a.regions || []).join(' ').toLowerCase().indexOf(q) >= 0) return true;
      return false;
    });
  }, [rows, filterText]);

  return (
    <div className="relative w-full max-w-lg mx-auto" style={{ paddingBottom: '90px' }}>
      {/* 검색 */}
      <div className="mb-3 px-1">
        <div className="relative">
          <span className="absolute inset-y-0 left-3 flex items-center text-slate-400 pointer-events-none">🔍</span>
          <input
            type="search"
            className="open-riding-group-search-input w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-sm bg-white shadow-sm"
            placeholder="상호명으로 검색"
            value={filterText}
            onChange={function(e){ setFilter(e.target.value); }}
          />
        </div>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex justify-center py-16">
          <span className="inline-block h-10 w-10 rounded-full border-[3px] border-violet-200 border-t-violet-600 animate-spin" style={{ animationDuration: '0.85s' }} />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-slate-400 text-sm py-16">
          {filterText ? '검색 결과가 없습니다.' : '등록된 제휴사가 없습니다.'}
        </p>
      ) : (
        <ul className="space-y-2 px-1">
          {filtered.map(function(aff) {
            var initial = affiliateInitials(aff.name);
            var regionLabel = (aff.regions || []).slice(0, 2).join(' · ') + ((aff.regions || []).length > 2 ? ' 외' : '');
            var periodLabel = affiliateFormatPeriod(aff.periodStart, aff.periodEnd);
            return (
              <li key={aff.id}>
                <button
                  type="button"
                  className="open-riding-group-list-row-btn w-full flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:shadow-md hover:border-violet-200 transition-all"
                  onClick={function(){ onOpenDetail(aff.id); }}
                >
                  {/* 아바타 */}
                  <span className="affiliate-avatar-circle shrink-0">
                    {aff.photoUrl
                      ? <img src={aff.photoUrl} alt="" className="h-full w-full object-cover rounded-full" decoding="async" loading="lazy" />
                      : <span className="text-white font-bold text-lg">{initial}</span>
                    }
                  </span>
                  {/* 텍스트 */}
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold text-slate-800 text-sm truncate">{aff.name || '(이름 없음)'}</span>
                    {regionLabel ? <span className="block text-xs text-slate-400 truncate mt-0.5">{regionLabel}</span> : null}
                    {periodLabel ? <span className="block text-xs text-slate-400 truncate">{periodLabel}</span> : null}
                  </span>
                  <span className="text-slate-300 shrink-0">›</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* 등록 FAB (grade=1 only) */}
      {isAdmin && (
        <button
          type="button"
          className="open-riding-group-fab affiliate-fab-create fixed z-[100100] flex items-center justify-center rounded-full shadow-lg text-white text-2xl font-bold"
          aria-label="제휴사 등록"
          onClick={onCreate}
        >
          +
        </button>
      )}

      {/* 스크롤 위로 버튼 */}
      {showScrollTop && (
        <button
          type="button"
          className="affiliate-scroll-top-btn fixed z-[100099] flex items-center justify-center rounded-full shadow-lg bg-white border border-slate-200 text-slate-600"
          aria-label="위로"
          onClick={function(){
            var el = document.getElementById('affiliate-react-root');
            if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        >
          ↑
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 제휴사 등록 / 수정 폼
// ══════════════════════════════════════════════════════════════
function AffiliateForm(props) {
  var firestore  = props.firestore;
  var storage    = props.storage;
  var userId     = props.userId || '';
  var editId     = props.editId || '';
  var onCancel   = props.onCancel || function(){};
  var onSaved    = props.onSaved  || function(){};
  var isEdit     = !!editId;

  var koreaList = affiliateGetKoreaRegions();

  var _name = useState('');       var name = _name[0]; var setName = _name[1];
  var _regions = useState([]);    var regions = _regions[0]; var setRegions = _regions[1];
  var _sido = useState('');       var sidoPick = _sido[0]; var setSido = _sido[1];
  var _dist = useState('');       var distPick = _dist[0]; var setDist = _dist[1];
  var _intro = useState('');      var intro = _intro[0]; var setIntro = _intro[1];
  var _pStart = useState('');     var periodStart = _pStart[0]; var setPStart = _pStart[1];
  var _pEnd = useState('');       var periodEnd = _pEnd[0]; var setPEnd = _pEnd[1];
  var _address = useState('');    var address = _address[0]; var setAddress = _address[1];
  var _phone = useState('');      var phone = _phone[0]; var setPhone = _phone[1];
  var _photoUrl = useState('');   var photoUrl = _photoUrl[0]; var setPhotoUrl = _photoUrl[1];
  var _photoFile = useState(null);var photoFile = _photoFile[0]; var setPhotoFile = _photoFile[1];
  var _photoPreview = useState('');var photoPreview = _photoPreview[0]; var setPhotoPreview = _photoPreview[1];
  var _busy = useState(false);    var busy = _busy[0]; var setBusy = _busy[1];
  var _loaded = useState(!isEdit);var loaded = _loaded[0]; var setLoaded = _loaded[1];

  var districtsForSido = useMemo(function() {
    for (var i = 0; i < koreaList.length; i++) {
      if (koreaList[i].sido === sidoPick) return koreaList[i].districts || [];
    }
    return [];
  }, [koreaList, sidoPick]);

  // 사진 미리보기
  useEffect(function() {
    if (!photoFile) { setPhotoPreview(''); return; }
    var u = URL.createObjectURL(photoFile);
    setPhotoPreview(u);
    return function() { URL.revokeObjectURL(u); };
  }, [photoFile]);

  // 수정 모드: 기존 데이터 로드
  useEffect(function() {
    if (!isEdit || !firestore || !editId) { setLoaded(true); return; }
    setLoaded(false);
    var cancelled = false;
    affiliateService.fetchById(firestore, editId)
      .then(function(doc) {
        if (cancelled || !doc) return;
        setName(doc.name || '');
        setRegions(Array.isArray(doc.regions) ? doc.regions : []);
        setIntro(doc.intro || '');
        setPStart(doc.periodStart || '');
        setPEnd(doc.periodEnd || '');
        setAddress(doc.address || '');
        setPhone(doc.phone || '');
        setPhotoUrl(doc.photoUrl || '');
      })
      .catch(function(){})
      .finally(function(){ if (!cancelled) setLoaded(true); });
    return function(){ cancelled = true; };
  }, [firestore, editId, isEdit]);

  function addRegion() {
    if (!sidoPick) return;
    var label = distPick ? (sidoPick + ' ' + distPick) : sidoPick;
    if (regions.indexOf(label) >= 0) { setSido(''); setDist(''); return; }
    setRegions(regions.concat([label]));
    setSido(''); setDist('');
  }
  function removeRegion(r) { setRegions(regions.filter(function(x){ return x !== r; })); }

  function buildPayload(urlOverride) {
    var url = urlOverride != null ? urlOverride : photoUrl;
    return {
      name: name.trim(),
      regions: regions,
      intro: intro.trim(),
      periodStart: periodStart,
      periodEnd: periodEnd,
      address: address.trim(),
      phone: phone.trim(),
      photoUrl: url || ''
    };
  }

  function validate() {
    if (!name.trim()) { affiliateShowToast('제휴사명을 입력해주세요.'); return false; }
    if (name.trim().length > 24) { affiliateShowToast('제휴사명은 24자 이내여야 합니다.'); return false; }
    return true;
  }

  function doSave(isEditMode) {
    if (!validate()) return;
    setBusy(true);
    var savePromise;
    if (isEditMode) {
      var id = editId;
      var chain = Promise.resolve().then(function(){
        if (photoFile && storage) {
          return affiliateService.uploadPhoto(storage, id, photoFile).then(function(url){
            return affiliateService.update(firestore, id, buildPayload(url));
          });
        }
        return affiliateService.update(firestore, id, buildPayload());
      });
      savePromise = chain.then(function(){ onSaved(id); });
    } else {
      savePromise = affiliateService.create(firestore, userId, buildPayload(null))
        .then(function(newId){
          if (photoFile && storage && newId) {
            return affiliateService.uploadPhoto(storage, newId, photoFile)
              .then(function(url){ return affiliateService.update(firestore, newId, buildPayload(url)); })
              .then(function(){ onSaved(newId); });
          }
          onSaved(newId);
        });
    }
    savePromise.catch(function(e){
      affiliateShowToast(e && e.message ? e.message : '저장에 실패했습니다.');
    }).finally(function(){ setBusy(false); });
  }

  if (!loaded) {
    return (
      <div className="flex justify-center py-16">
        <span className="inline-block h-10 w-10 rounded-full border-[3px] border-violet-200 border-t-violet-600 animate-spin" style={{ animationDuration: '0.85s' }} role="status" aria-label="불러오는 중" />
      </div>
    );
  }

  return (
    <div className="open-riding-create-form-root w-full max-w-lg mx-auto space-y-4 pb-28 text-sm text-slate-700 px-1">

      {/* 제휴사명 */}
      <div>
        <label className="text-xs text-slate-500 block mb-1">제휴사명 (최대 24자)</label>
        <input type="text" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          maxLength={24} value={name}
          onChange={function(e){ setName(e.target.value); }}
          placeholder="상호명을 입력하세요" />
      </div>

      {/* 활동 지역 */}
      <div>
        <label className="text-xs text-slate-500 block mb-1">활동 지역</label>
        <div className="flex gap-1 flex-wrap items-center">
          <select className="flex-1 min-w-[110px] rounded-lg border border-slate-200 px-2 py-1 text-sm bg-white"
            aria-label="시·도" value={sidoPick}
            onChange={function(e){ setSido(e.target.value); setDist(''); }}>
            <option value="">시·도</option>
            {koreaList.map(function(g){ return <option key={g.sido} value={g.sido}>{g.sido}</option>; })}
          </select>
          <select className="flex-1 min-w-[110px] rounded-lg border border-slate-200 px-2 py-1 text-sm bg-white"
            aria-label="구·군" value={distPick}
            disabled={!sidoPick || !districtsForSido.length}
            onChange={function(e){ setDist(e.target.value); }}>
            <option value="">{!sidoPick ? '시·도 먼저' : !districtsForSido.length ? '해당 없음' : '구·군'}</option>
            {districtsForSido.map(function(d){ return <option key={d} value={d}>{d}</option>; })}
          </select>
          <button type="button"
            className="rounded-lg bg-violet-600 text-white px-3 py-1 text-sm shrink-0 hover:bg-violet-700"
            onClick={addRegion}>추가</button>
        </div>
        <ul className="mt-2 flex flex-wrap gap-1">
          {regions.map(function(r){
            return (
              <li key={r}>
                <button type="button"
                  className="text-xs bg-white border border-slate-200 rounded-full px-2 py-0.5 hover:border-red-300"
                  onClick={function(){ removeRegion(r); }}>
                  {r} ×
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 제휴사 사진 */}
      <div>
        <label className="text-xs text-slate-500 block mb-1">제휴사 사진</label>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex h-20 w-20 rounded-full ring-2 ring-violet-200 overflow-hidden bg-slate-100 items-center justify-center shrink-0">
            {photoFile && photoPreview
              ? <img src={photoPreview} alt="" className="h-full w-full object-cover" />
              : photoUrl
                ? <img src={photoUrl} alt="" className="h-full w-full object-cover" decoding="async" />
                : <span className="text-xs text-slate-400">없음</span>
            }
          </span>
          <input type="file" accept="image/*" className="text-xs max-w-[12rem]"
            onChange={function(e){ var f = e.target.files && e.target.files[0]; setPhotoFile(f || null); }} />
        </div>
      </div>

      {/* 제휴 소개 */}
      <div>
        <label className="text-xs text-slate-500 block mb-1">제휴 소개 (최대 500자)</label>
        <textarea className="w-full min-h-[120px] rounded-xl border border-slate-200 px-3 py-2 text-sm resize-y"
          maxLength={500} value={intro}
          onChange={function(e){ setIntro(e.target.value); }}
          placeholder="제휴 혜택 및 소개를 입력하세요" />
        <span className="text-xs text-slate-400">{intro.length}/500</span>
      </div>

      {/* 제휴 기간 */}
      <div>
        <label className="text-xs text-slate-500 block mb-1">제휴 기간</label>
        <div className="flex gap-2 items-center flex-wrap">
          <input type="date" className="rounded-xl border border-slate-200 px-3 py-2 text-sm flex-1 min-w-[140px]"
            value={periodStart} onChange={function(e){ setPStart(e.target.value); }} />
          <span className="text-slate-400 text-sm">~</span>
          <input type="date" className="rounded-xl border border-slate-200 px-3 py-2 text-sm flex-1 min-w-[140px]"
            value={periodEnd} onChange={function(e){ setPEnd(e.target.value); }} />
        </div>
      </div>

      {/* 주소 */}
      <div>
        <label className="text-xs text-slate-500 block mb-1">주소</label>
        <input type="text" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          value={address} onChange={function(e){ setAddress(e.target.value); }}
          placeholder="주소를 입력하세요" />
      </div>

      {/* 전화번호 */}
      <div>
        <label className="text-xs text-slate-500 block mb-1">전화번호</label>
        <input type="tel" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          value={phone} onChange={function(e){ setPhone(e.target.value); }}
          placeholder="전화번호를 입력하세요" />
      </div>

      {/* 하단 고정 버튼 */}
      <div className="open-riding-bottom-actions open-riding-group-form-footer fixed left-0 right-0 pt-2 bg-[rgba(255,255,255,0.97)] border-t border-slate-200/90 backdrop-blur-[6px]">
        <div className="w-[94%] mx-auto flex gap-2">
          <button type="button"
            className="open-riding-action-btn flex-1 min-w-0 h-11 rounded-xl border border-slate-300 bg-white text-slate-800 font-medium"
            disabled={busy} onClick={onCancel}>취소</button>
          <button type="button"
            className="open-riding-action-btn flex-1 min-w-0 h-11 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700"
            disabled={busy} onClick={function(){ doSave(isEdit); }}>
            {busy ? '처리 중…' : isEdit ? '수정' : '제휴사 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 제휴 상세 화면
// ══════════════════════════════════════════════════════════════
function AffiliateDetail(props) {
  var firestore   = props.firestore;
  var affiliateId = props.affiliateId || '';
  var isAdmin     = props.isAdmin || false;
  var userId      = props.userId || '';
  var onBack      = props.onBack  || function(){};
  var onEdit      = props.onEdit  || function(){};

  var _aff = useState(null);   var aff = _aff[0]; var setAff = _aff[1];
  var _loading = useState(true);var loading = _loading[0]; var setLoading = _loading[1];
  var _busy = useState(false);  var busy = _busy[0]; var setBusy = _busy[1];

  useEffect(function(){
    if (!firestore || !affiliateId) { setLoading(false); return; }
    setLoading(true);
    affiliateService.fetchById(firestore, affiliateId)
      .then(function(doc){ setAff(doc); })
      .catch(function(){ setAff(null); })
      .finally(function(){ setLoading(false); });
  }, [firestore, affiliateId]);

  function handleDelete() {
    if (!window.confirm('이 제휴사를 삭제하시겠습니까?')) return;
    setBusy(true);
    affiliateService.remove(firestore, affiliateId)
      .then(function(){ affiliateShowToast('삭제되었습니다.'); onBack(); })
      .catch(function(e){ affiliateShowToast(e && e.message ? e.message : '삭제 실패'); })
      .finally(function(){ setBusy(false); });
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <span className="inline-block h-10 w-10 rounded-full border-[3px] border-violet-200 border-t-violet-600 animate-spin" style={{ animationDuration: '0.85s' }} />
      </div>
    );
  }

  if (!aff) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">
        <p>제휴사를 찾을 수 없습니다.</p>
        <button type="button" className="mt-4 text-violet-600 underline" onClick={onBack}>목록으로</button>
      </div>
    );
  }

  var regionLabel = (aff.regions || []).join(' · ');
  var periodLabel = affiliateFormatPeriod(aff.periodStart, aff.periodEnd);
  var initial = affiliateInitials(aff.name);
  var isOwner = isAdmin || (userId && String(aff.createdBy) === String(userId));

  return (
    <div className="open-riding-detail-content-root w-full max-w-lg mx-auto pb-32 text-sm space-y-4 px-1">

      {/* 상단 카드: 아바타 + 기본 정보 */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* 배경 블러 (사진 있을 때) */}
        {aff.photoUrl && (
          <div className="h-24 w-full overflow-hidden relative">
            <img src={aff.photoUrl} alt="" className="w-full h-full object-cover" style={{ filter: 'blur(8px)', transform: 'scale(1.1)' }} />
            <div className="absolute inset-0 bg-black/30" />
          </div>
        )}
        <div className={`flex gap-4 items-start px-5 ${aff.photoUrl ? '-mt-10' : 'pt-5'} pb-5`}>
          {/* 아바타 원형 */}
          <span className="affiliate-avatar-circle affiliate-avatar-lg shrink-0 shadow-md">
            {aff.photoUrl
              ? <img src={aff.photoUrl} alt="" className="h-full w-full object-cover rounded-full" decoding="async" />
              : <span className="text-white font-bold text-2xl">{initial}</span>
            }
          </span>
          <div className="flex-1 min-w-0 pt-1">
            <p className="font-bold text-slate-800 text-base leading-snug">{aff.name}</p>
            {regionLabel ? <p className="text-xs text-slate-400 mt-0.5">📍 {regionLabel}</p> : null}
            {periodLabel ? <p className="text-xs text-slate-400">🗓 {periodLabel}</p> : null}
          </div>
          {/* 관리자 버튼 */}
          {isOwner && (
            <div className="flex flex-col gap-1 shrink-0">
              <button type="button"
                className="text-xs px-3 py-1 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100"
                onClick={function(){ onEdit(affiliateId); }}>수정</button>
              <button type="button"
                className="text-xs px-3 py-1 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
                disabled={busy} onClick={handleDelete}>삭제</button>
            </div>
          )}
        </div>
      </div>

      {/* 제휴 소개 */}
      {aff.intro ? (
        <div className="stelvio-category-card rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 mb-2">제휴 소개</p>
          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{aff.intro}</p>
        </div>
      ) : null}

      {/* 주소 / 전화번호 */}
      {(aff.address || aff.phone) ? (
        <div className="stelvio-category-card rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm space-y-2">
          {aff.address ? (
            <div className="flex gap-2 text-sm text-slate-700 items-start">
              <span className="shrink-0">📍</span>
              <span>{aff.address}</span>
            </div>
          ) : null}
          {aff.phone ? (
            <div className="flex gap-2 text-sm items-center">
              <span className="shrink-0">📞</span>
              <a href={'tel:' + aff.phone} className="text-violet-600 hover:underline">{aff.phone}</a>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 하단 CTA */}
      <div className="open-riding-group-member-cta-slot open-riding-bottom-actions fixed left-0 right-0">
        <div className="w-[94%] mx-auto py-2">
          {aff.phone ? (
            <a href={'tel:' + aff.phone}
              className="open-riding-action-btn block w-full h-11 rounded-xl bg-violet-600 text-white font-medium text-sm text-center leading-[44px] hover:bg-violet-700">
              📞 문의하기
            </a>
          ) : (
            <button type="button"
              className="open-riding-action-btn w-full h-11 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700">
              할인 혜택 확인
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 메인 앱 (라우터)
// ══════════════════════════════════════════════════════════════
function AffiliateApp(props) {
  var firestore = props.firestore;
  var storage   = props.storage;
  var userId    = props.userId || '';

  var isAdmin = affiliateIsAdminGrade();

  var _view = useState('list');
  var view = _view[0]; var setView = _view[1];
  var _detailId = useState(null);
  var detailId = _detailId[0]; var setDetailId = _detailId[1];
  var _editId = useState(null);
  var editId = _editId[0]; var setEditId = _editId[1];

  var headerTitle = view === 'create' ? '제휴사 등록'
    : view === 'edit' ? '제휴사 수정'
    : view === 'detail' ? '제휴사 할인 내용'
    : '제휴사';

  function goBack() {
    if (view === 'detail') { setDetailId(null); setView('list'); }
    else if (view === 'create' || view === 'edit') { setEditId(null); setView(detailId ? 'detail' : 'list'); }
    else {
      // 목록에서 뒤로: 프로필 화면으로 복귀
      if (typeof window.showScreen === 'function') window.showScreen('profileScreen');
    }
  }

  return (
    <div className="open-riding-app-root flex flex-col" style={{ minHeight: '100vh' }}>

      {/* 헤더 */}
      <header className="open-riding-inner-header flex items-center gap-2 px-4 py-3 bg-white border-b border-slate-200 sticky top-0 z-50">
        <button type="button"
          className="p-1 rounded-lg text-slate-600 hover:bg-slate-100 shrink-0"
          aria-label="뒤로가기"
          onClick={goBack}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="open-riding-screen-title font-bold text-slate-800 text-base flex-1">{headerTitle}</h1>
        {/* 폼에서 X 닫기 */}
        {(view === 'create' || view === 'edit') && (
          <button type="button"
            className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 shrink-0"
            aria-label="닫기"
            onClick={goBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </header>

      {/* 본문 */}
      <div className="open-riding-app-body flex-1 overflow-y-auto px-3 py-3">
        {view === 'list' && (
          <AffiliateList
            firestore={firestore}
            isAdmin={isAdmin}
            onOpenDetail={function(id){ setDetailId(id); setView('detail'); }}
            onCreate={function(){ setEditId(null); setView('create'); }}
          />
        )}
        {view === 'detail' && detailId && (
          <AffiliateDetail
            firestore={firestore}
            affiliateId={detailId}
            isAdmin={isAdmin}
            userId={userId}
            onBack={function(){ setDetailId(null); setView('list'); }}
            onEdit={function(id){ setEditId(id); setView('edit'); }}
          />
        )}
        {(view === 'create' || view === 'edit') && (
          <AffiliateForm
            firestore={firestore}
            storage={storage}
            userId={userId}
            editId={view === 'edit' ? editId : ''}
            onCancel={goBack}
            onSaved={function(id){
              affiliateShowToast(view === 'edit' ? '수정되었습니다.' : '등록되었습니다.');
              setDetailId(id);
              setEditId(null);
              setView('detail');
            }}
          />
        )}
      </div>
    </div>
  );
}

window.AffiliateApp = AffiliateApp;

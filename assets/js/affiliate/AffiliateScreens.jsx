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
  },

  uploadPromoImage: function(storage, affiliateId, file) {
    try {
      var fns = window._firebaseStorageFns || {};
      var ext = (file.name.split('.').pop() || 'jpg');
      var path = 'affiliates/' + affiliateId + '/promo.' + ext;
      if (typeof fns.ref === 'function' && typeof fns.uploadBytes === 'function' && typeof fns.getDownloadURL === 'function') {
        var storageRef = fns.ref(storage, path);
        return fns.uploadBytes(storageRef, file).then(function(snap) {
          return fns.getDownloadURL(snap.ref);
        });
      }
      // compat
      if (typeof firebase !== 'undefined' && firebase.storage) {
        var r = firebase.storage().ref(path);
        return r.put(file).then(function() { return r.getDownloadURL(); });
      }
      return Promise.resolve('');
    } catch(e) { return Promise.reject(e); }
  }
};

// ── 한국 행정구역 (koreaRegions.js 데이터를 직접 내장 – 외부 모듈 의존 없음) ──
var AFFILIATE_KOREA_REGIONS = [
  { sido: '서울특별시', districts: ['강남구','강동구','강북구','강서구','관악구','광진구','구로구','금천구','노원구','도봉구','동대문구','동작구','마포구','서대문구','서초구','성동구','성북구','송파구','양천구','영등포구','용산구','은평구','종로구','중구','중랑구'] },
  { sido: '부산광역시', districts: ['강서구','금정구','기장군','남구','동구','동래구','부산진구','북구','사상구','사하구','서구','수영구','연제구','영도구','중구','해운대구'] },
  { sido: '대구광역시', districts: ['남구','달서구','달성군','동구','북구','서구','수성구','중구','군위군'] },
  { sido: '인천광역시', districts: ['강화군','계양구','남동구','동구','미추홀구','부평구','서구','연수구','옹진군','중구'] },
  { sido: '광주광역시', districts: ['광산구','남구','동구','북구','서구'] },
  { sido: '대전광역시', districts: ['대덕구','동구','서구','유성구','중구'] },
  { sido: '울산광역시', districts: ['남구','동구','북구','울주군','중구'] },
  { sido: '세종특별자치시', districts: [] },
  { sido: '경기도', districts: ['가평군','고양시','과천시','광명시','광주시','구리시','군포시','김포시','남양주시','동두천시','부천시','성남시','수원시','시흥시','안산시','안성시','안양시','양주시','양평군','여주시','연천군','오산시','용인시','의왕시','의정부시','이천시','파주시','평택시','포천시','하남시','화성시'] },
  { sido: '강원특별자치도', districts: ['강릉시','고성군','동해시','삼척시','속초시','양구군','양양군','영월군','원주시','인제군','정선군','철원군','춘천시','태백시','평창군','홍천군','화천군','횡성군'] },
  { sido: '충청북도', districts: ['괴산군','단양군','보은군','영동군','옥천군','음성군','제천시','증평군','진천군','청주시','충주시'] },
  { sido: '충청남도', districts: ['계룡시','공주시','금산군','논산시','당진시','보령시','부여군','서산시','서천군','아산시','예산군','천안시','청양군','태안군','홍성군'] },
  { sido: '전북특별자치도', districts: ['고창군','군산시','김제시','남원시','무주군','부안군','순창군','완주군','익산시','임실군','장수군','전주시','정읍시','진안군'] },
  { sido: '전라남도', districts: ['강진군','고흥군','곡성군','광양시','구례군','나주시','담양군','목포시','무안군','보성군','순천시','신안군','여수시','영광군','영암군','완도군','장성군','장흥군','진도군','함평군','해남군','화순군'] },
  { sido: '경상북도', districts: ['경산시','경주시','고령군','구미시','김천시','문경시','봉화군','상주시','성주군','안동시','영덕군','영양군','영주시','영천시','예천군','울릉군','울진군','의성군','청도군','청송군','칠곡군','포항시'] },
  { sido: '경상남도', districts: ['거제시','거창군','고성군','김해시','남해군','밀양시','사천시','산청군','양산시','의령군','진주시','창녕군','창원시','통영시','하동군','함안군','함양군','합천군'] },
  { sido: '제주특별자치도', districts: ['서귀포시','제주시'] }
];

function affiliateGetKoreaRegions() {
  // window에 데이터가 이미 있으면 우선 사용 (openRidingBoot가 먼저 로드된 경우)
  var fn = typeof window !== 'undefined' ? window.getKoreaRegionGroupsForUi : null;
  if (typeof fn === 'function') {
    try { var r = fn(); if (r && r.length) return r; } catch(e) {}
  }
  var g = typeof window !== 'undefined' ? window.KOREA_REGION_GROUPS : null;
  if (g && g.length) return g;
  return AFFILIATE_KOREA_REGIONS;
}

function affiliateGetDistricts(sido) {
  var fn = typeof window !== 'undefined' ? window.getDistrictsForSido : null;
  if (typeof fn === 'function') try { return fn(sido); } catch(e) {}
  var list = affiliateGetKoreaRegions();
  for (var i = 0; i < list.length; i++) {
    if (list[i].sido === sido) return list[i].districts || [];
  }
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
    <div
      className="relative w-full max-w-lg mx-auto text-left box-border"
      style={{
        paddingBottom: 'calc(4.5rem + (2 * var(--open-riding-glass-nav-inner-fixed-height, 58px)) + env(safe-area-inset-bottom, 0px))'
      }}
    >
      {/* 검색 */}
      <div className="w-full mb-3 box-border">
        <input
          type="search"
          enterKeyHint="search"
          className="open-riding-group-search-input w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm box-border"
          placeholder="상호명으로 검색"
          value={filterText}
          onChange={function(e){ setFilter(e.target.value); }}
        />
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
        <ul className="space-y-2">
          {filtered.map(function(aff) {
            var initial = affiliateInitials(aff.name);
            var regionLabel = (aff.regions || []).slice(0, 2).join(' · ') + ((aff.regions || []).length > 2 ? ' 외' : '');
            var periodLabel = affiliateFormatPeriod(aff.periodStart, aff.periodEnd);
            return (
              <li key={aff.id}>
                <button
                  type="button"
                  className="open-riding-action-btn open-riding-group-list-row-btn w-full flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm hover:bg-slate-50/90 transition box-border"
                  onClick={function(){ onOpenDetail(aff.id); }}
                >
                  {/* 아바타 – 그룹 목록과 동일: h-14 w-14 · ring-2 ring-violet-200 · gradient bg */}
                  <span className="relative shrink-0">
                    <span className="inline-flex h-14 w-14 items-center justify-center rounded-full ring-2 ring-violet-200 overflow-hidden bg-gradient-to-br from-violet-50 to-slate-100">
                      {aff.photoUrl
                        ? <img src={aff.photoUrl} alt="" className="h-full w-full object-cover" decoding="async" loading="lazy" />
                        : <span className="text-lg font-bold text-violet-700">{initial}</span>
                      }
                    </span>
                  </span>
                  {/* 텍스트 */}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-900 truncate text-[15px]">{aff.name || '(이름 없음)'}</span>
                    <span className="block text-xs text-slate-500 mt-0.5 truncate">
                      {regionLabel || '지역 미설정'}
                      {periodLabel ? <span className="text-slate-300 mx-1">·</span> : null}
                      {periodLabel || ''}
                    </span>
                  </span>
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
  var _promoUrl = useState('');   var promoUrl = _promoUrl[0]; var setPromoUrl = _promoUrl[1];
  var _promoFile = useState(null);var promoFile = _promoFile[0]; var setPromoFile = _promoFile[1];
  var _promoPreview = useState('');var promoPreview = _promoPreview[0]; var setPromoPreview = _promoPreview[1];
  var _busy = useState(false);    var busy = _busy[0]; var setBusy = _busy[1];
  var _loaded = useState(!isEdit);var loaded = _loaded[0]; var setLoaded = _loaded[1];

  var koreaList = affiliateGetKoreaRegions();

  var districtsForSido = useMemo(function() {
    return affiliateGetDistricts(sidoPick);
  }, [sidoPick]);

  // 사진 미리보기
  useEffect(function() {
    if (!photoFile) { setPhotoPreview(''); return; }
    var u = URL.createObjectURL(photoFile);
    setPhotoPreview(u);
    return function() { URL.revokeObjectURL(u); };
  }, [photoFile]);

  // 홍보 이미지 미리보기
  useEffect(function() {
    if (!promoFile) { setPromoPreview(''); return; }
    var u = URL.createObjectURL(promoFile);
    setPromoPreview(u);
    return function() { URL.revokeObjectURL(u); };
  }, [promoFile]);

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
        setPromoUrl(doc.promoImageUrl || '');
      })
      .catch(function(){})
      .finally(function(){ if (!cancelled) setLoaded(true); });
    return function(){ cancelled = true; };
  }, [firestore, editId, isEdit]);

  function addRegion() {
    if (!sidoPick) { affiliateShowToast('시·도를 먼저 선택해주세요.'); return; }
    var districts = affiliateGetDistricts(sidoPick);
    var label;
    if (districts.length === 0) {
      // 세종특별자치시 등 구·군 없는 시·도
      label = sidoPick;
    } else {
      if (!distPick) { affiliateShowToast('구·군을 선택해주세요.'); return; }
      label = sidoPick + ' ' + distPick;
    }
    if (regions.indexOf(label) >= 0) { setSido(''); setDist(''); return; }
    setRegions(regions.concat([label]));
    setSido(''); setDist('');
  }
  function removeRegion(r) { setRegions(regions.filter(function(x){ return x !== r; })); }

  function buildPayload(urlOverride, promoUrlOverride) {
    var url = urlOverride != null ? urlOverride : photoUrl;
    var pUrl = promoUrlOverride != null ? promoUrlOverride : promoUrl;
    return {
      name: name.trim(),
      regions: regions,
      intro: intro.trim(),
      periodStart: periodStart,
      periodEnd: periodEnd,
      address: address.trim(),
      phone: phone.trim(),
      photoUrl: url || '',
      promoImageUrl: pUrl || ''
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
      var chain = Promise.resolve()
        .then(function(){
          // 대표 사진 업로드 (변경된 경우)
          if (photoFile && storage) {
            return affiliateService.uploadPhoto(storage, id, photoFile);
          }
          return photoUrl;
        })
        .then(function(resolvedPhotoUrl){
          // 홍보 이미지 업로드 (변경된 경우)
          if (promoFile && storage) {
            return affiliateService.uploadPromoImage(storage, id, promoFile)
              .then(function(resolvedPromoUrl){
                return affiliateService.update(firestore, id, buildPayload(resolvedPhotoUrl, resolvedPromoUrl));
              });
          }
          return affiliateService.update(firestore, id, buildPayload(resolvedPhotoUrl, null));
        });
      savePromise = chain.then(function(){ onSaved(id); });
    } else {
      savePromise = affiliateService.create(firestore, userId, buildPayload(null, null))
        .then(function(newId){
          if (!newId) { onSaved(newId); return; }
          // 대표 사진 업로드
          var p1 = (photoFile && storage)
            ? affiliateService.uploadPhoto(storage, newId, photoFile)
            : Promise.resolve(photoUrl);
          // 홍보 이미지 업로드
          return p1.then(function(resolvedPhotoUrl){
            var p2 = (promoFile && storage)
              ? affiliateService.uploadPromoImage(storage, newId, promoFile)
              : Promise.resolve(promoUrl);
            return p2.then(function(resolvedPromoUrl){
              if (resolvedPhotoUrl || resolvedPromoUrl) {
                return affiliateService.update(firestore, newId, buildPayload(resolvedPhotoUrl, resolvedPromoUrl))
                  .then(function(){ onSaved(newId); });
              }
              onSaved(newId);
            });
          });
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

      {/* 홍보 이미지 */}
      <div>
        <label className="text-xs text-slate-500 block mb-1">
          홍보 이미지
          <span className="ml-2 text-slate-400 font-normal">권장: 750 × 422px (16:9) · 1MB 이하</span>
        </label>
        <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
          {/* 이미지 미리보기 영역 */}
          {(promoFile && promoPreview) ? (
            <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
              <img src={promoPreview} alt="홍보 이미지 미리보기"
                className="w-full h-full object-cover" />
              <button
                type="button"
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white text-sm flex items-center justify-center hover:bg-black/70"
                aria-label="이미지 제거"
                onClick={function(){ setPromoFile(null); setPromoPreview(''); }}>
                ×
              </button>
            </div>
          ) : promoUrl ? (
            <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
              <img src={promoUrl} alt="홍보 이미지"
                className="w-full h-full object-cover" decoding="async" />
              <button
                type="button"
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white text-sm flex items-center justify-center hover:bg-black/70"
                aria-label="이미지 제거"
                onClick={function(){ setPromoUrl(''); }}>
                ×
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-2 py-8 cursor-pointer hover:bg-slate-100 transition-colors">
              <span className="text-3xl text-slate-300">🖼️</span>
              <span className="text-xs text-slate-400">클릭하여 홍보 이미지 선택</span>
              <span className="text-xs text-slate-300">JPG · PNG · WEBP</span>
              <input type="file" accept="image/*" className="hidden"
                onChange={function(e){ var f = e.target.files && e.target.files[0]; if(f) setPromoFile(f); e.target.value=''; }} />
            </label>
          )}
        </div>
        {/* 이미지가 있을 때 교체 버튼 */}
        {(promoFile || promoUrl) && (
          <label className="mt-2 inline-flex items-center gap-1 text-xs text-violet-600 cursor-pointer hover:text-violet-800">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            이미지 교체
            <input type="file" accept="image/*" className="hidden"
              onChange={function(e){ var f = e.target.files && e.target.files[0]; if(f) setPromoFile(f); e.target.value=''; }} />
          </label>
        )}
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
    <div className="w-full max-w-lg mx-auto space-y-4 pb-6 text-left">

      {/* ── 상단 히어로 카드: 그룹 상세와 동일 구조 ── */}
      <div className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative isolate bg-white">
        {/* 배경 이미지 + 그라데이션 오버레이 (사진 있을 때) */}
        {aff.photoUrl ? (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-50"
              style={{ backgroundImage: 'url(' + JSON.stringify(String(aff.photoUrl)) + ')' }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-white/75 via-white/86 to-white/95"
            />
          </>
        ) : null}

        <div className="relative z-[1] p-4">
          <div className="flex items-start gap-3">
            {/* 아바타 – 그룹 상세와 동일: h-16 w-16 · ring-2 · gradient bg */}
            <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full ring-2 ring-violet-200 overflow-hidden bg-gradient-to-br from-violet-50 to-slate-100">
              {aff.photoUrl
                ? <img src={String(aff.photoUrl)} alt="" className="h-full w-full object-cover" decoding="async" />
                : <span className="text-xl font-bold text-violet-700">{initial}</span>
              }
            </span>

            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-slate-900 m-0 truncate">{aff.name || ''}</h2>
              <p className="text-xs text-slate-500 m-0 mt-1">
                {regionLabel || '지역 미설정'}
                {periodLabel ? <span className="text-slate-300 mx-1">·</span> : null}
                {periodLabel || ''}
              </p>
            </div>

            {/* 관리자 수정/삭제 버튼 */}
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

          {/* 제휴 소개 – 그룹 상세처럼 히어로 카드 내부에 배치 */}
          {aff.intro ? (
            <p className="text-sm text-slate-700 mt-3 whitespace-pre-wrap m-0 leading-relaxed">{aff.intro}</p>
          ) : (
            <p className="text-sm text-slate-400 mt-3 m-0">등록된 소개가 없습니다.</p>
          )}
        </div>
      </div>

      {/* 홍보 이미지 */}
      {aff.promoImageUrl ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <img
            src={aff.promoImageUrl}
            alt="홍보 이미지"
            className="w-full object-cover"
            style={{ aspectRatio: '16/9' }}
            decoding="async"
            loading="lazy"
          />
        </div>
      ) : null}

      {/* 주소 / 전화번호 */}
      {(aff.address || aff.phone) ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm space-y-2">
          {aff.address ? (
            <div className="flex gap-2 text-sm text-slate-700 items-start">
              <span className="shrink-0 text-slate-400">📍</span>
              <span>{aff.address}</span>
            </div>
          ) : null}
          {aff.phone ? (
            <div className="flex gap-2 text-sm items-center">
              <span className="shrink-0 text-slate-400">📞</span>
              <a href={'tel:' + aff.phone} className="text-violet-600 hover:underline">{aff.phone}</a>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 하단 CTA – 그룹 상세와 동일: open-riding-bottom-actions border-t */}
      <div className="open-riding-group-member-cta-slot open-riding-bottom-actions border-t border-slate-200/90 bg-[rgba(255,255,255,0.98)] px-3 pt-2 pb-3 box-border">
        {aff.phone ? (
          <a href={'tel:' + aff.phone}
            className="open-riding-action-btn block w-full min-h-[clamp(2.75rem,10vw,3.5rem)] rounded-xl bg-violet-600 text-white font-medium text-[clamp(0.8125rem,3.8vw,0.9375rem)] text-center flex items-center justify-center hover:bg-violet-700">
            📞 문의하기
          </a>
        ) : (
          <button type="button"
            className="open-riding-action-btn w-full min-h-[clamp(2.75rem,10vw,3.5rem)] rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 text-[clamp(0.8125rem,3.8vw,0.9375rem)]">
            할인 혜택 확인
          </button>
        )}
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

      {/* 헤더 – 그룹 화면과 동일한 grid 중앙 정렬 패턴 */}
      <header className="open-riding-inner-header">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center w-full min-w-0 flex-1 gap-x-1">
          {/* 좌: 뒤로가기 */}
          <button type="button"
            className="shrink-0 inline-flex items-center justify-center w-[2.5em] h-[2.5em] rounded-lg text-slate-600 hover:bg-slate-100"
            aria-label="뒤로가기"
            onClick={goBack}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          {/* 중앙: 타이틀 */}
          <h1 className="open-riding-screen-title m-0 min-w-0 px-0.5 text-center truncate">{headerTitle}</h1>
          {/* 우: 폼에서 X 닫기, 그 외 빈 대칭 공간 */}
          {(view === 'create' || view === 'edit') ? (
            <button type="button"
              className="shrink-0 inline-flex items-center justify-center w-[2.5em] h-[2.5em] rounded-lg text-slate-400 hover:bg-slate-100"
              aria-label="닫기"
              onClick={goBack}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          ) : (
            <span className="shrink-0 inline-block w-[2.5em]" aria-hidden="true" />
          )}
        </div>
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

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

/**
 * Canvas API를 이용한 이미지 압축 및 리사이즈
 * @param {File}   file    - 원본 이미지 파일
 * @param {number} maxPx   - 긴 변 최대 픽셀 (초과 시 비율 유지하며 축소)
 * @param {number} quality - JPEG 출력 품질 0~1
 * @returns {Promise<File>} 압축된 File (실패 시 원본 반환)
 */
function compressImageFile(file, maxPx, quality) {
  maxPx   = maxPx   || 1200;
  quality = quality || 0.85;
  return new Promise(function(resolve) {
    if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) {
      resolve(file);
      return;
    }
    var reader = new FileReader();
    reader.onerror = function() { resolve(file); };
    reader.onload  = function(e) {
      var img = new Image();
      img.onerror = function() { resolve(file); };
      img.onload  = function() {
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        /* 긴 변이 maxPx를 초과하면 비율 유지하며 축소 */
        if (w > maxPx || h > maxPx) {
          if (w >= h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else        { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        /* 원본보다 크게 되지 않도록 */
        if (w === img.naturalWidth && h === img.naturalHeight && file.type === 'image/jpeg') {
          resolve(file);
          return;
        }
        var canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(function(blob) {
          if (!blob) { resolve(file); return; }
          var safeName = (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg';
          resolve(new File([blob], safeName, { type: 'image/jpeg', lastModified: Date.now() }));
        }, 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 제휴사 활성 기간 판정
 * - periodStart/periodEnd 모두 없으면 → 항상 활성
 * - periodEnd가 오늘보다 이전이면 → 기간 만료 (비활성)
 * - periodStart가 오늘보다 이후이면 → 기간 미도래 (비활성)
 * returns: 'active' | 'expired' | 'upcoming' | 'always'
 */
function affiliateActiveStatus(aff) {
  if (!aff) return 'expired';
  var hasStart = aff.periodStart && String(aff.periodStart).trim();
  var hasEnd   = aff.periodEnd   && String(aff.periodEnd).trim();
  if (!hasStart && !hasEnd) return 'always';
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  if (hasStart) {
    var start = new Date(aff.periodStart);
    start.setHours(0, 0, 0, 0);
    if (today < start) return 'upcoming';
  }
  if (hasEnd) {
    var end = new Date(aff.periodEnd);
    end.setHours(23, 59, 59, 999);
    if (today > end) return 'expired';
  }
  return 'active';
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
      /* getDocFromServer: 캐시를 건너뛰고 서버에서 직접 읽어 최신 데이터 보장
         (이미지 수정 후 즉시 최신 photoUrl 반영을 위해 서버 우선) */
      var readFn = typeof fns.getDocFromServer === 'function'
        ? fns.getDocFromServer
        : (typeof fns.getDoc === 'function' ? fns.getDoc : null);
      if (readFn) {
        return readFn(ref).then(function(d) {
          return d.exists() ? Object.assign({ id: d.id }, d.data()) : null;
        }).catch(function() {
          /* 서버 읽기 실패 시 캐시에서 재시도 */
          if (typeof fns.getDoc === 'function') {
            return fns.getDoc(ref).then(function(d) {
              return d.exists() ? Object.assign({ id: d.id }, d.data()) : null;
            });
          }
          return null;
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
      if (!col) return Promise.reject(new Error('Firestore 컬렉션에 접근할 수 없습니다.'));
      /* serverTimestamp: v9 모듈러 또는 compat 방식 모두 대응 */
      var tsFn = typeof fns.serverTimestamp === 'function' ? fns.serverTimestamp
        : (typeof firebase !== 'undefined' && firebase.firestore && typeof firebase.firestore.FieldValue !== 'undefined')
          ? firebase.firestore.FieldValue.serverTimestamp
          : null;
      var now = new Date().toISOString();
      var payload = Object.assign({}, data, {
        createdBy: userId || '',
        createdAt: tsFn ? tsFn() : now,
        updatedAt: tsFn ? tsFn() : now
      });
      if (typeof fns.addDoc === 'function') {
        return fns.addDoc(col, payload).then(function(ref) { return ref.id; });
      }
      if (typeof col.add === 'function') {
        return col.add(payload).then(function(ref) { return ref.id; });
      }
      return Promise.reject(new Error('addDoc 함수를 찾을 수 없습니다.'));
    } catch(e) { return Promise.reject(e); }
  },

  update: function(db, id, data) {
    try {
      var fns = window._firebaseFirestoreFns || {};
      var ref = this._doc(db, id);
      if (!ref) return Promise.reject(new Error('문서 참조를 찾을 수 없습니다.'));
      var tsFn = typeof fns.serverTimestamp === 'function' ? fns.serverTimestamp : null;
      var payload = Object.assign({}, data, {
        updatedAt: tsFn ? tsFn() : new Date().toISOString()
      });
      if (typeof fns.updateDoc === 'function') {
        return fns.updateDoc(ref, payload);
      }
      if (typeof ref.update === 'function') {
        return ref.update(payload);
      }
      return Promise.reject(new Error('updateDoc 함수를 찾을 수 없습니다.'));
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
      /* 타임스탬프를 파일명에 포함해 매 업로드마다 고유 URL 생성
         → CDN/브라우저 캐시 문제 없이 항상 새 이미지 반영 */
      var ts   = Date.now();
      var path = 'affiliates/' + affiliateId + '/cover_' + ts + '.jpg';
      var meta = { contentType: 'image/jpeg' };
      if (typeof fns.ref === 'function' && typeof fns.uploadBytes === 'function' && typeof fns.getDownloadURL === 'function') {
        var storageRef = fns.ref(storage, path);
        return fns.uploadBytes(storageRef, file, meta).then(function(snap) {
          return fns.getDownloadURL(snap.ref);
        });
      }
      // compat
      if (typeof firebase !== 'undefined' && firebase.storage) {
        var r = firebase.storage().ref(path);
        return r.put(file, meta).then(function() { return r.getDownloadURL(); });
      }
      return Promise.resolve('');
    } catch(e) { return Promise.reject(e); }
  },

  uploadPromoImage: function(storage, affiliateId, file) {
    try {
      var fns = window._firebaseStorageFns || {};
      /* 타임스탬프로 고유 파일명 생성 */
      var ts   = Date.now();
      var path = 'affiliates/' + affiliateId + '/promo_' + ts + '.jpg';
      var meta = { contentType: 'image/jpeg' };
      if (typeof fns.ref === 'function' && typeof fns.uploadBytes === 'function' && typeof fns.getDownloadURL === 'function') {
        var storageRef = fns.ref(storage, path);
        return fns.uploadBytes(storageRef, file, meta).then(function(snap) {
          return fns.getDownloadURL(snap.ref);
        });
      }
      // compat
      if (typeof firebase !== 'undefined' && firebase.storage) {
        var r = firebase.storage().ref(path);
        return r.put(file, meta).then(function() { return r.getDownloadURL(); });
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

// ── 스타버스트 배지 SVG 경로 생성 ─────────────────────────────
function affiliateStarburstPath(cx, cy, outerR, innerR, points) {
  var pts = [];
  for (var i = 0; i < points * 2; i++) {
    var angle = (i * Math.PI) / points - Math.PI / 2;
    var r = (i % 2 === 0) ? outerR : innerR;
    pts.push((cx + r * Math.cos(angle)).toFixed(2) + ',' + (cy + r * Math.sin(angle)).toFixed(2));
  }
  return 'M' + pts.join('L') + 'Z';
}

/**
 * 빨간 스타버스트(톱니 인장) 모양의 할인율 배지
 * 첨부 이미지와 동일한 디자인 — 흰색 "N%" / "OFF"
 */
function AffiliateDiscountBadge(props) {
  var discount = props.discount;
  var size     = props.size || 54;
  if (!discount && discount !== 0) return null;
  var d = parseInt(discount, 10);
  if (isNaN(d) || d <= 0) return null;

  /* 12-포인트 스타버스트 (outerR=49, innerR=39) */
  var path = affiliateStarburstPath(50, 50, 49, 39, 12);

  /* 폰트 크기를 배지 size에 맞춰 조정 */
  var fsPct  = Math.round(size * 0.27);  /* "N%"  */
  var fsOff  = Math.round(size * 0.19);  /* "OFF" */

  return (
    React.createElement('div', {
      style: {
        position: 'relative',
        width:    size + 'px',
        height:   size + 'px',
        flexShrink: 0,
        filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.25))'
      },
      'aria-label': d + '% 할인'
    },
      React.createElement('svg', {
        viewBox: '0 0 100 100',
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%' }
      },
        React.createElement('path', { d: path, fill: '#dc2626' })
      ),
      React.createElement('div', {
        style: {
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          color: '#ffffff',
          fontWeight: '900',
          lineHeight: '1',
          letterSpacing: '-0.01em',
          textShadow: '0 1px 2px rgba(0,0,0,0.2)',
          userSelect: 'none',
          pointerEvents: 'none'
        }
      },
        React.createElement('span', { style: { fontSize: fsPct + 'px' } }, d + '%'),
        React.createElement('span', { style: { fontSize: fsOff + 'px', marginTop: '1px', letterSpacing: '0.06em' } }, 'OFF')
      )
    )
  );
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
            var status = affiliateActiveStatus(aff);
            var isClickable = (status === 'active' || status === 'always');
            /* 비활성 상태 레이블 */
            var statusBadge = null;
            if (status === 'expired') {
              statusBadge = (
                <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 border border-slate-200">
                  기간 만료
                </span>
              );
            } else if (status === 'upcoming') {
              statusBadge = (
                <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-500 border border-amber-200">
                  준비 중
                </span>
              );
            }
            return (
              <li key={aff.id} className="relative">
                <button
                  type="button"
                  disabled={!isClickable && !isAdmin}
                  className={[
                    'open-riding-action-btn open-riding-group-list-row-btn w-full flex items-center gap-3 rounded-2xl border px-3 py-3 text-left shadow-sm transition box-border',
                    isClickable || isAdmin
                      ? 'bg-white border-slate-200 hover:bg-slate-50/90'
                      : 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
                  ].join(' ')}
                  onClick={function(){
                    if (!isClickable && !isAdmin) return;
                    onOpenDetail(aff.id);
                  }}
                  aria-disabled={!isClickable && !isAdmin}
                >
                  {/* 아바타 – 상세화면과 동일: object-contain으로 이미지 전체 표시 */}
                  <span className="relative shrink-0">
                    <span className={[
                      'relative inline-block h-14 w-14 rounded-full ring-2 overflow-hidden',
                      isClickable || isAdmin
                        ? 'ring-violet-200 bg-gradient-to-br from-violet-50 to-slate-100'
                        : 'ring-slate-200 bg-slate-100'
                    ].join(' ')}>
                      {aff.photoUrl
                        ? <img src={aff.photoUrl} alt=""
                            decoding="async" loading="lazy"
                            style={{
                              display: 'block',
                              width: '100%',
                              height: '100%',
                              objectFit: 'contain',
                              objectPosition: 'center',
                              filter: (!isClickable && !isAdmin) ? 'grayscale(1)' : 'none'
                            }} />
                        : <span className={[
                            'absolute inset-0 flex items-center justify-center text-lg font-bold',
                            isClickable || isAdmin ? 'text-violet-700' : 'text-slate-400'
                          ].join(' ')}>{initial}</span>
                      }
                    </span>
                  </span>
                  {/* 텍스트 */}
                  <span className="min-w-0 flex-1">
                    <span className={['block font-semibold truncate text-[15px]', isClickable || isAdmin ? 'text-slate-900' : 'text-slate-400'].join(' ')}>
                      {aff.name || '(이름 없음)'}
                    </span>
                    <span className="block text-xs text-slate-500 mt-0.5 truncate">
                      {regionLabel || '지역 미설정'}
                    </span>
                  </span>
                  {/* 상태 배지 (만료/준비중) */}
                  {statusBadge}
                </button>

                {/* 할인율 배지 – 카드 우측 상단에 절대 위치 */}
                {aff.discount && parseInt(aff.discount, 10) > 0 ? (
                  <div style={{
                    position: 'absolute',
                    top: '-6px',
                    right: '6px',
                    zIndex: 10,
                    pointerEvents: 'none'
                  }}>
                    <AffiliateDiscountBadge discount={aff.discount} size={52} />
                  </div>
                ) : null}
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
  var _discount = useState('');   var discount = _discount[0]; var setDiscount = _discount[1];
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
        setDiscount(doc.discount != null ? String(doc.discount) : '');
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
    var discountNum = parseInt(discount, 10);
    return {
      name: name.trim(),
      regions: regions,
      intro: intro.trim(),
      periodStart: periodStart,
      periodEnd: periodEnd,
      discount: (!isNaN(discountNum) && discountNum > 0) ? discountNum : null,
      address: address.trim(),
      phone: phone.trim(),
      photoUrl: url || '',
      promoImageUrl: pUrl || ''
    };
  }

  function validate() {
    if (!name.trim()) { affiliateShowToast('제휴사명을 입력해주세요.'); return false; }
    if (name.trim().length > 24) { affiliateShowToast('제휴사명은 24자 이내여야 합니다.'); return false; }
    if (!firestore) { affiliateShowToast('데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.'); return false; }
    return true;
  }

  function doSave(isEditMode) {
    if (!validate()) return;
    setBusy(true);

    /* 이미지 업로드 실패 시 URL을 빈 문자열로 처리하여 텍스트 데이터는 저장되도록 */
    function safeUploadPhoto(st, id, file) {
      if (!st || !file) return Promise.resolve(photoUrl || '');
      return affiliateService.uploadPhoto(st, id, file).catch(function(e){
        console.warn('[Affiliate] 대표 사진 업로드 실패:', e);
        return photoUrl || '';
      });
    }
    function safeUploadPromo(st, id, file) {
      if (!st || !file) return Promise.resolve(promoUrl || '');
      return affiliateService.uploadPromoImage(st, id, file).catch(function(e){
        console.warn('[Affiliate] 홍보 이미지 업로드 실패:', e);
        return promoUrl || '';
      });
    }

    var savePromise;
    if (isEditMode) {
      var id = editId;
      savePromise = safeUploadPhoto(storage, id, photoFile)
        .then(function(resolvedPhotoUrl){
          return safeUploadPromo(storage, id, promoFile)
            .then(function(resolvedPromoUrl){
              return affiliateService.update(firestore, id, buildPayload(resolvedPhotoUrl, resolvedPromoUrl));
            });
        })
        .then(function(){ onSaved(id); });
    } else {
      /* 1) 텍스트 데이터 먼저 저장 → 2) 이미지 업로드 후 URL 업데이트 */
      savePromise = affiliateService.create(firestore, userId, buildPayload('', ''))
        .then(function(newId){
          if (!newId) { onSaved(''); return; }
          return safeUploadPhoto(storage, newId, photoFile)
            .then(function(resolvedPhotoUrl){
              return safeUploadPromo(storage, newId, promoFile)
                .then(function(resolvedPromoUrl){
                  /* 이미지 URL이 하나라도 있으면 업데이트 */
                  if (resolvedPhotoUrl || resolvedPromoUrl) {
                    return affiliateService.update(firestore, newId, buildPayload(resolvedPhotoUrl, resolvedPromoUrl))
                      .catch(function(e){ console.warn('[Affiliate] URL 업데이트 실패:', e); });
                  }
                })
                .then(function(){ onSaved(newId); });
            });
        });
    }
    savePromise.catch(function(e){
      console.error('[Affiliate] 저장 오류:', e);
      affiliateShowToast(e && e.message ? e.message : '저장에 실패했습니다. 다시 시도해주세요.');
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
    <div
      className="open-riding-create-form-root w-full max-w-lg mx-auto space-y-4 text-sm text-slate-700 px-1"
      style={{
        /* 하단 고정 버튼 바(~70px) + 네비바 위치(16+safe+navH+10) + 여유 20px */
        paddingBottom: 'calc(70px + 16px + var(--open-riding-glass-nav-inner-fixed-height, 58px) + 10px + env(safe-area-inset-bottom, 0px) + 20px)'
      }}
    >

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
        <label className="text-xs text-slate-500 block mb-1">
          제휴사 사진
          <span className="ml-2 text-slate-400 font-normal">권장: 400 × 400px · 자동 압축 적용</span>
        </label>
        <div className="flex items-center gap-3 flex-wrap">
          {/* 원형 아바타 미리보기 – overflow-hidden + block img로 꽉 채움 */}
          <span className="relative inline-block h-20 w-20 rounded-full ring-2 ring-violet-200 overflow-hidden bg-slate-100 shrink-0">
            {photoFile && photoPreview
              ? <img src={photoPreview} alt=""
                  style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} />
              : photoUrl
                ? <img src={photoUrl} alt="" decoding="async"
                    style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} />
                : <span className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">없음</span>
            }
          </span>
          <input type="file" accept="image/*" className="text-xs max-w-[12rem]"
            onChange={function(e){
              var f = e.target.files && e.target.files[0];
              if (!f) { setPhotoFile(null); return; }
              /* 아바타: 긴 변 800px / JPEG 0.85 압축 */
              compressImageFile(f, 800, 0.85).then(function(compressed) {
                setPhotoFile(compressed);
              });
            }} />
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
                onChange={function(e){
                  var f = e.target.files && e.target.files[0];
                  e.target.value = '';
                  if (!f) return;
                  /* 홍보 이미지: 긴 변 1200px / JPEG 0.85 압축 */
                  compressImageFile(f, 1200, 0.85).then(function(compressed) {
                    setPromoFile(compressed);
                  });
                }} />
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

      {/* 할인율 */}
      <div>
        <label className="text-xs text-slate-500 block mb-1">할인율 적용</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0" max="100" step="1"
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm w-28 text-center"
            placeholder="숫자 입력"
            value={discount}
            onChange={function(e){
              var v = e.target.value.replace(/[^0-9]/g, '');
              if (v === '' || (parseInt(v, 10) >= 0 && parseInt(v, 10) <= 100)) setDiscount(v);
            }}
          />
          <span className="text-sm text-slate-600 font-semibold">%</span>
          {/* 미리보기 배지 */}
          {discount && parseInt(discount, 10) > 0 ? (
            <div className="ml-2">
              <AffiliateDiscountBadge discount={discount} size={48} />
            </div>
          ) : null}
        </div>
        <p className="text-xs text-slate-400 mt-1">0 ~ 100 사이의 숫자를 입력하세요. 비워두면 배지가 표시되지 않습니다.</p>
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

      {/* 하단 고정 버튼 – CSS로 네비바 위에 위치 고정 */}
      <div className="open-riding-bottom-actions open-riding-group-form-footer">
        <div className="w-[94%] mx-auto flex gap-2">
          <button type="button"
            className="open-riding-action-btn flex-1 min-w-0 h-11 rounded-xl border border-slate-300 bg-white text-slate-800 font-medium disabled:opacity-50"
            disabled={busy} onClick={onCancel}>취소</button>
          <button type="button"
            className="open-riding-action-btn flex-1 min-w-0 h-11 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50"
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
    <div
      className="w-full max-w-lg mx-auto space-y-4 text-left"
      style={{
        paddingBottom: 'calc(var(--open-riding-glass-nav-inner-fixed-height, 58px) + env(safe-area-inset-bottom, 0px) + 32px)'
      }}
    >

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
            {/* 아바타 – object-contain으로 이미지 전체 표시 */}
            <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full ring-2 ring-violet-200 overflow-hidden bg-gradient-to-br from-violet-50 to-slate-100">
              {aff.photoUrl
                ? <img src={String(aff.photoUrl)} alt="" decoding="async"
                    style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }} />
                : <span className="text-xl font-bold text-violet-700">{initial}</span>
              }
            </span>

            <div className="min-w-0 flex-1">
              <h2 className="m-0 truncate font-extrabold text-slate-900"
                style={{ fontSize: 'clamp(1.1rem, 4.5vw, 1.35rem)', lineHeight: '1.25' }}>
                {aff.name || ''}
              </h2>
              <p className="text-xs text-slate-500 m-0 mt-1">{regionLabel || '지역 미설정'}</p>
              {/* 기간 – 관리자만 표시 */}
              {isOwner && periodLabel ? (
                <p className="text-xs text-amber-600 m-0 mt-0.5">📅 {periodLabel}</p>
              ) : null}
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
          {/* 좌: 목록에서는 뒤로가기 숨김, 상세/폼에서는 표시 */}
          {view !== 'list' ? (
            <button type="button"
              className="shrink-0 inline-flex items-center justify-center w-[2.5em] h-[2.5em] rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="뒤로가기"
              onClick={goBack}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          ) : (
            <span className="shrink-0 inline-block w-[2.5em]" aria-hidden="true" />
          )}
          {/* 중앙: 타이틀 */}
          <h1 className="open-riding-screen-title m-0 min-w-0 px-0.5 text-center truncate font-bold"
            style={{ fontSize: view === 'detail' ? 'clamp(1.05rem, 4.5vw, 1.25rem)' : undefined }}>
            {headerTitle}
          </h1>
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

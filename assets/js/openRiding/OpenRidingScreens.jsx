/**
 * 오픈 라이딩방 UI (메인 달력·설정 / 생성 폼 / 상세)
 * @requires React, window.openRidingBoot(모듈)로 useOpenRiding·openRidingService 로드 후 type="text/babel" 로 본 파일 로드
 */
/* global React */
var useState = React.useState;
var useEffect = React.useEffect;
var useMemo = React.useMemo;
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

/**
 * 전국 시·도→구·군 목록: koreaRegions.js 의 KOREA_REGION_GROUPS 단일 소스
 * — window.getKoreaRegionGroupsForUi() 우선(koreaRegions 부트), 없으면 window 백업
 */
function getKoreaRegionGroupsResolved() {
  var fn = typeof window !== 'undefined' ? window.getKoreaRegionGroupsForUi : null;
  if (typeof fn === 'function') {
    try {
      var fromMod = fn();
      if (fromMod && fromMod.length) return fromMod;
    } catch (e0) {}
  }
  var groups = typeof window !== 'undefined' ? window.KOREA_REGION_GROUPS : null;
  if (groups && groups.length) return groups;
  return [];
}

function getKoreaRegionOptions() {
  return {
    KOREA_SIGUNGU_OPTIONS: window.KOREA_SIGUNGU_OPTIONS || [],
    KOREA_REGION_GROUPS: getKoreaRegionGroupsResolved(),
    RIDING_LEVEL_OPTIONS: window.RIDING_LEVEL_OPTIONS || []
  };
}

/** 랭킹 API byCategory → 분포 차트용 합집합( userId 기준 중복 제거 ) */
function mergePeakRankingEntriesFromByCategory(bc) {
  if (!bc) return [];
  var m = {};
  ['Supremo', 'Assoluto', 'Bianco', 'Rosa', 'Infinito', 'Leggenda'].forEach(function (c) {
    (bc[c] || []).forEach(function (e) {
      if (e && e.userId) m[e.userId] = e;
    });
  });
  return Object.keys(m).map(function (k) {
    return m[k];
  });
}

function readOpenRidingProfileFtpWeight() {
  var u = typeof window !== 'undefined' ? window.currentUser : null;
  if (!u) {
    try {
      u = JSON.parse(localStorage.getItem('currentUser') || 'null');
    } catch (e0) {
      u = null;
    }
  }
  var ftp = u && Number(u.ftp) > 0 ? Number(u.ftp) : 0;
  var w = u && Number(u.weight) > 0 ? Number(u.weight) : 0;
  return { ftp: ftp, weight: w, ok: ftp > 0 && w > 0 };
}

/** 맞춤 필터·라이딩 생성 폼 공통: 시·도·구군 선택값 → 저장용 전체 문자열 */
function resolveOpenRidingFullRegionLabel(sido, districtPick, districtsForSido) {
  var sd = String(sido || '').trim();
  if (!sd) return '';
  var dList = districtsForSido != null && Array.isArray(districtsForSido) ? districtsForSido : [];
  if (!dList.length) return sd;
  var di = String(districtPick || '').trim();
  if (!di) return '';
  var build = typeof window !== 'undefined' ? window.buildFullRegionLabel : null;
  return typeof build === 'function' ? build(sd, di) : sd + ' ' + di;
}

/** 목록 카드용: "서울특별시 강남구" → "강남구". 구·군 없음(세종 등)이면 시·도만 */
function formatOpenRidingRegionShort(regionRaw) {
  var s = String(regionRaw || '').trim();
  if (!s) return '-';
  var groups = getKoreaRegionGroupsResolved();
  var i;
  for (i = 0; i < groups.length; i++) {
    var sido = groups[i].sido;
    if (s === sido) return sido;
    var prefix = sido + ' ';
    if (s.indexOf(prefix) === 0) {
      var rest = s.slice(prefix.length).trim();
      return rest || sido;
    }
  }
  return s;
}

/** 상세 패널: 레벨명 뒤 항속(hint) 괄호 표기 — 값 열은 다른 statRow와 동일 폰트·크기 상속 */
function formatOpenRidingLevelDetailValue(levelStr) {
  if (levelStr == null || String(levelStr).trim() === '') return '-';
  var s = String(levelStr).trim();
  var opts = typeof window !== 'undefined' ? window.RIDING_LEVEL_OPTIONS || [] : [];
  var hint = '';
  var i;
  for (i = 0; i < opts.length; i++) {
    if (opts[i].value === s) {
      hint = opts[i].hint != null ? String(opts[i].hint) : '';
      break;
    }
  }
  if (!hint) return s;
  return s + ' (' + hint + ')';
}

/** 상세: 지역 + 출발 장소 한 줄 (지역 우선, 공백으로 구분) */
function formatOpenRidingDepartureRegionDisplay(ride) {
  if (!ride) return '-';
  var reg = ride.region != null ? String(ride.region).trim() : '';
  var dep = ride.departureLocation != null ? String(ride.departureLocation).trim() : '';
  if (!reg && !dep) return '-';
  if (reg && dep) return reg + ' ' + dep;
  return reg || dep;
}

/** 초대 번호 ↔ 저장 연락처 매칭 (openRidingService.normalizePhoneDigits + 뒤 8자리 규칙) */
function openRidingInvitePhoneDigitsMatch(a, b) {
  var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
  var norm =
    typeof svc.normalizePhoneDigits === 'function'
      ? svc.normalizePhoneDigits
      : function (x) {
          return String(x || '').replace(/\D/g, '');
        };
  var u = norm(a);
  var v = norm(b);
  if (!u || !v || u.length < 8 || v.length < 8) return false;
  if (u === v) return true;
  return u.slice(-8) === v.slice(-8);
}

function findOpenRidingUidForInvitePhone(phone, participantIds, waitlistIds, participantContact) {
  var pc = participantContact && typeof participantContact === 'object' ? participantContact : {};
  function scan(ids) {
    if (!Array.isArray(ids)) return null;
    var i;
    for (i = 0; i < ids.length; i++) {
      var uid = String(ids[i]);
      var ph = pc[uid];
      if (ph && openRidingInvitePhoneDigitsMatch(phone, ph)) return uid;
    }
    return null;
  }
  var found = scan(participantIds);
  if (found) return found;
  return scan(waitlistIds);
}

/** 초대 명단 표시용 행 (전화 정규화 키, 참석자·대기 participantContact 로 uid 매칭) */
function buildOpenRidingInviteListRows(ride) {
  var raw = ride && Array.isArray(ride.invitedList) ? ride.invitedList : [];
  var part = ride && Array.isArray(ride.participants) ? ride.participants : [];
  var wait = ride && Array.isArray(ride.waitlist) ? ride.waitlist : [];
  var pc =
    ride &&
    ride.participantContact &&
    typeof ride.participantContact === 'object' &&
    !Array.isArray(ride.participantContact)
      ? ride.participantContact
      : {};
  var normFn =
    typeof window !== 'undefined' &&
    window.openRidingService &&
    typeof window.openRidingService.normalizePhoneDigits === 'function'
      ? window.openRidingService.normalizePhoneDigits
      : function (x) {
          return String(x || '').replace(/\D/g, '');
        };
  var seen = {};
  var rows = [];
  var ii;
  for (ii = 0; ii < raw.length; ii++) {
    var inv = raw[ii];
    var phoneStr = typeof inv === 'string' ? inv : inv != null && inv.phone != null ? String(inv.phone) : '';
    phoneStr = String(phoneStr).trim();
    if (!phoneStr) continue;
    var key = normFn(phoneStr);
    if (!key || seen[key]) continue;
    seen[key] = true;
    var matchedUid = findOpenRidingUidForInvitePhone(phoneStr, part, wait, pc);
    var inPart =
      !!matchedUid &&
      part.some(function (id) {
        return String(id) === String(matchedUid);
      });
    var inWait =
      !!matchedUid &&
      wait.some(function (id) {
        return String(id) === String(matchedUid);
      });
    /** 참석 확정 | 대기 명단만 신청 | 미신청(연락처 매칭 없음) */
    var inviteStatus = inPart ? 'attended' : inWait ? 'wait' : 'none';
    rows.push({
      phoneKey: key,
      invitePhone: phoneStr,
      matchedUid: matchedUid,
      inviteStatus: inviteStatus
    });
  }
  return rows;
}

function formatOpenRidingInviteFallbackLabel(phoneRaw, maskedMode) {
  if (maskedMode) return maskPhoneLastFourDisplay(String(phoneRaw || ''));
  var d =
    typeof window !== 'undefined' &&
    window.openRidingService &&
    typeof window.openRidingService.normalizePhoneDigits === 'function'
      ? window.openRidingService.normalizePhoneDigits(phoneRaw)
      : String(phoneRaw || '').replace(/\D/g, '');
  if (d.length >= 10) return d.slice(0, 3) + '-****-' + d.slice(-4);
  return '초대 대상';
}

/** Firestore users.contact 로 초대 번호 프로필 이름 조회 (규칙·데이터 형식에 따라 실패할 수 있음) */
function lookupOpenRidingUserNameByInvitePhone(firestoreDb, invitePhone) {
  if (!firestoreDb || !invitePhone) return Promise.resolve('');
  return import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js')
    .then(function (mod) {
      var col = mod.collection(firestoreDb, 'users');
      var norm =
        typeof window !== 'undefined' &&
        window.openRidingService &&
        typeof window.openRidingService.normalizePhoneDigits === 'function'
          ? window.openRidingService.normalizePhoneDigits(invitePhone)
          : String(invitePhone).replace(/\D/g, '');
      if (!norm || norm.length < 8) return '';
      var candidates = [];
      if (typeof window.formatPhoneNumber === 'function') {
        var fo = window.formatPhoneNumber(norm);
        if (fo) candidates.push(fo);
      }
      if (candidates.indexOf(norm) < 0) candidates.push(norm);

      function tryCandidate(idx) {
        if (idx >= candidates.length) return Promise.resolve('');
        var q = mod.query(col, mod.where('contact', '==', candidates[idx]), mod.limit(1));
        return mod.getDocs(q).then(function (snap) {
          if (!snap.empty) {
            var data = snap.docs[0].data();
            var nm = String((data && data.name) || (data && data.displayName) || '').trim();
            if (nm) return nm;
          }
          return tryCandidate(idx + 1);
        });
      }
      return tryCandidate(0);
    })
    .catch(function () {
      return '';
    });
}

/** 로그인·프로필 기준 방장명·연락처 (라이딩 생성·참가 시 표시 이름) */
function getOpenRidingProfileDefaults() {
  try {
    var cu = null;
    if (typeof window !== 'undefined' && window.authV9 && window.authV9.currentUser) {
      cu = window.authV9.currentUser;
    } else if (typeof window !== 'undefined' && window.auth && window.auth.currentUser) {
      cu = window.auth.currentUser;
    }
    var authUid = cu && cu.uid ? String(cu.uid) : '';

    var u = typeof window !== 'undefined' && window.currentUser ? window.currentUser : null;
    if (!u) {
      try { u = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e1) { u = null; }
    }
    if (!u) {
      try { u = JSON.parse(localStorage.getItem('authUser') || 'null'); } catch (e2) { u = null; }
    }

    var profileId = '';
    if (u && u.id != null) profileId = String(u.id);
    else if (u && u.uid != null) profileId = String(u.uid);
    /** Firebase 세션 UID와 로컬 프로필 id가 다르면 로컬 name/contact 무시(이전 계정·방장 번호 혼입 방지) */
    var profileOk = !authUid || !profileId || profileId === authUid;

    var name = '';
    var contact = '';
    if (cu && cu.phoneNumber) {
      contact = String(cu.phoneNumber).trim();
    }
    if (profileOk && u) {
      if ((u.name && String(u.name).trim())) name = String(u.name).trim();
      if (!contact) {
        contact =
          (u.contact && String(u.contact).trim()) ||
          (u.phone && String(u.phone).trim()) ||
          '';
      }
    }
    if (cu) {
      if (!name && cu.displayName) name = String(cu.displayName).trim();
      if (!contact && cu.email) contact = String(cu.email).trim();
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

/** 서울 기준 라이딩일 → M/D (요일) 예: 4/7 (화) */
function formatRideDateMdDowSeoul(ride) {
  var ts = ride && ride.date && typeof ride.date.toDate === 'function' ? ride.date.toDate() : null;
  if (!ts) return '';
  try {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      month: 'numeric',
      day: 'numeric'
    }).formatToParts(ts);
    var mo = '';
    var da = '';
    parts.forEach(function (p) {
      if (p.type === 'month') mo = p.value;
      if (p.type === 'day') da = p.value;
    });
    var w = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'narrow' }).format(ts);
    if (!mo || !da) return '';
    return mo + '/' + da + ' (' + w + ')';
  } catch (eFmt) {
    return '';
  }
}

/** YYYY-MM-DD(서울 정오) → M/D (요일) — 달력 선택일 제목 등 */
function formatMdDowFromYmdSeoul(ymd) {
  if (!ymd || String(ymd).trim().length < 8) return '';
  try {
    var ts = new Date(String(ymd).trim() + 'T12:00:00+09:00');
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      month: 'numeric',
      day: 'numeric'
    }).formatToParts(ts);
    var mo = '';
    var da = '';
    parts.forEach(function (p) {
      if (p.type === 'month') mo = p.value;
      if (p.type === 'day') da = p.value;
    });
    var w = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'narrow' }).format(ts);
    if (!mo || !da) return '';
    return mo + '/' + da + ' (' + w + ')';
  } catch (e0) {
    return '';
  }
}

/** 월간 목록: 일시 오름차순 정렬 */
function sortOpenRidingListByDateTime(rides) {
  return rides.slice().sort(function (a, b) {
    var ta = a && a.date && typeof a.date.toDate === 'function' ? a.date.toDate().getTime() : 0;
    var tb = b && b.date && typeof b.date.toDate === 'function' ? b.date.toDate().getTime() : 0;
    if (ta !== tb) return ta - tb;
    return String(a.departureTime || '00:00').localeCompare(String(b.departureTime || '00:00'));
  });
}

/**
 * 초대 목록 표시용 전화(동기만). auth / localStorage / window.currentUser
 * (prof.contactInfo 제외 — 참가 신청과 동일하게 오탐 방지)
 */
function getOpenRidingInvitePhoneSync(userId) {
  var uid = String(userId || '').trim();
  if (!uid) return '';
  var phone = '';
  var cuJoin =
    typeof window !== 'undefined' && window.authV9 && window.authV9.currentUser
      ? window.authV9.currentUser
      : typeof window !== 'undefined' && window.auth && window.auth.currentUser
        ? window.auth.currentUser
        : null;
  if (cuJoin && String(cuJoin.uid) === uid && cuJoin.phoneNumber) {
    phone = String(cuJoin.phoneNumber).trim().slice(0, 80);
  }
  try {
    if (typeof window !== 'undefined') {
      var au2 = null;
      try {
        au2 = JSON.parse(localStorage.getItem('authUser') || 'null');
      } catch (eA2) {
        au2 = null;
      }
      if (au2 && String(au2.id != null ? au2.id : au2.uid != null ? au2.uid : '') === uid) {
        if (!phone) {
          phone = (
            String(au2.contact != null ? au2.contact : '').trim() ||
            String(au2.phone != null ? au2.phone : '').trim()
          ).slice(0, 80);
        }
      }
      if (
        !phone &&
        window.currentUser &&
        String(window.currentUser.id != null ? window.currentUser.id : window.currentUser.uid != null ? window.currentUser.uid : '') ===
          uid
      ) {
        var c2 = window.currentUser;
        phone = (
          String(c2.contact != null ? c2.contact : '').trim() || String(c2.phone != null ? c2.phone : '').trim()
        ).slice(0, 80);
      }
    }
  } catch (eLoc) {}
  return phone;
}

/** 한국(서울) 달력 기준으로 라이딩일이 오늘보다 이전인지 (당일·미래는 false) */
function isOpenRidingPastBySeoulDate(ride) {
  var rideYmd = getRideDateSeoulYmd(ride);
  if (!rideYmd) return false;
  return getTodaySeoulYmd() > rideYmd;
}

/** 서울 달력상 라이딩일이 지난 경우(다음날부터) 상세 연락처 마스킹 */
function shouldMaskOpenRidingContacts(ride) {
  return isOpenRidingPastBySeoulDate(ride);
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

/** 연락처 행에서 전화번호 필드 추출 (iOS CNContact / Android ContentResolver 등 편차 흡수) */
function openRidingExtractPhoneFromContactRow(row) {
  if (!row || typeof row !== 'object') return '';
  var p =
    row.phone != null
      ? row.phone
      : row.phoneNumber != null
        ? row.phoneNumber
        : row.phone_number != null
          ? row.phone_number
          : row.tel != null
            ? row.tel
            : row.mobile != null
              ? row.mobile
              : row.number != null
                ? row.number
                : row.mobilePhone != null
                  ? row.mobilePhone
                  : '';
  if (!p && Array.isArray(row.phoneNumbers) && row.phoneNumbers.length) {
    var pn0 = row.phoneNumbers[0];
    p = typeof pn0 === 'string' ? pn0 : pn0 && (pn0.number != null ? pn0.number : pn0.value != null ? pn0.value : pn0.stringValue);
  }
  return String(p != null ? p : '').trim();
}

/** 연락처 행에서 표시 이름 */
function openRidingExtractNameFromContactRow(row) {
  if (!row || typeof row !== 'object') return '';
  var n =
    row.name != null
      ? row.name
      : row.displayName != null
        ? row.displayName
        : row.fullName != null
          ? row.fullName
          : '';
  if (!String(n).trim() && (row.givenName != null || row.familyName != null)) {
    n = [row.familyName, row.givenName].filter(Boolean).join(' ').trim();
  }
  return String(n != null ? n : '').trim();
}

/**
 * 네이티브 주소록에서 전달하는 data → { name, phone }[]
 * - JSON 문자열(JSON.parse)
 * - 단일 객체 또는 { contacts | items | selected }
 * - phoneNumbers[] (iOS)
 */
function parseNativeAddressBookData(data) {
  if (data == null) return [];
  if (typeof data === 'string') {
    var s = String(data).trim();
    if (!s) return [];
    try {
      data = JSON.parse(s);
    } catch (e0) {
      return [];
    }
  }
  var raw;
  if (Array.isArray(data)) {
    raw = data;
  } else if (data && typeof data === 'object') {
    raw = data.contacts || data.items || data.selected || data.results || data.data;
    if (!Array.isArray(raw)) {
      if (data.phone != null || data.phoneNumber != null || data.phoneNumbers || data.tel || data.mobile) {
        raw = [data];
      } else {
        raw = [];
      }
    }
  } else {
    raw = [];
  }
  var out = [];
  raw.forEach(function (row) {
    if (!row || typeof row !== 'object') return;
    var phoneRaw = openRidingExtractPhoneFromContactRow(row);
    var digits = String(phoneRaw).replace(/\D/g, '');
    if (digits.length < 8) return;
    var name = openRidingExtractNameFromContactRow(row) || '이름 없음';
    out.push({
      name: name,
      phone: phoneRaw
    });
  });
  return out;
}

/** 초대 목록 병합(setForm은 OpenRidingCreateForm의 setter) */
function openRidingMergeAddressBookIntoInvitePending(data, setForm) {
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
      if (!key || key.length < 8) return;
      if (keysSel[key]) return;
      if (pending.some(function (p) { return p.key === key; })) return;
      var displayPhone = row.phone;
      pending.push({ name: row.name, phone: displayPhone, key: key });
    });
    var n = {};
    for (var k in f) n[k] = f[k];
    n.invitePending = pending;
    return n;
  });
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

/** 모바일·터치·절약 모드: 타일·폴리라인 부하를 줄여 발열 완화 */
function openRidingPreferLowPowerMap() {
  try {
    if (typeof window === 'undefined') return false;
    var c = navigator.connection;
    if (c && c.saveData) return true;
    if (window.matchMedia) {
      if (window.matchMedia('(max-width: 900px)').matches) return true;
      if (window.matchMedia('(pointer: coarse)').matches) return true;
    }
  } catch (e) {}
  return false;
}

/** 지도 표시용 좌표만 순 번호로 축소(고도 그래프는 원본 유지) */
function openRidingDownsampleLatLngs(latlngs, maxPts) {
  if (!latlngs || latlngs.length <= maxPts) return latlngs;
  var n = latlngs.length;
  var step = Math.ceil(n / maxPts);
  var out = [];
  var i;
  for (i = 0; i < n; i += step) out.push(latlngs[i]);
  if (out[out.length - 1] !== latlngs[n - 1]) out.push(latlngs[n - 1]);
  return out;
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
  var mapPausedByVisibilityRef = useRef(false);

  var _st = useState({ status: 'idle', track: null, err: '' });
  var loadState = _st[0];
  var setLoadState = _st[1];
  var _mk = useState(0);
  var mapRemountKey = _mk[0];
  var setMapRemountKey = _mk[1];

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
      function onVis() {
        if (typeof document === 'undefined') return;
        if (document.visibilityState === 'hidden') {
          if (mapInstRef.current) {
            mapPausedByVisibilityRef.current = true;
            try {
              mapInstRef.current.remove();
            } catch (eH) {}
            mapInstRef.current = null;
          }
        } else if (
          mapPausedByVisibilityRef.current &&
          loadState.status === 'ok' &&
          loadState.track &&
          loadState.track.latlngs &&
          loadState.track.latlngs.length >= 2
        ) {
          mapPausedByVisibilityRef.current = false;
          setMapRemountKey(function (k) {
            return k + 1;
          });
        }
      }
      document.addEventListener('visibilitychange', onVis);
      return function () {
        document.removeEventListener('visibilitychange', onVis);
      };
    },
    [loadState.status, loadState.track]
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
        var lowPower = openRidingPreferLowPowerMap();
        var tileCap = lowPower ? 16 : 19;
        var latlngsDraw = openRidingDownsampleLatLngs(loadState.track.latlngs, lowPower ? 420 : 1100);

        var map = L.map(mapRef.current, {
          zoomControl: true,
          attributionControl: true,
          fadeAnimation: false,
          zoomAnimation: false,
          trackResize: false,
          inertia: !lowPower,
          maxZoom: tileCap
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: tileCap,
          maxNativeZoom: 19,
          updateWhenIdle: true,
          updateWhenZooming: false,
          keepBuffer: lowPower ? 0 : 1,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(map);
        var poly = L.polyline(latlngsDraw, {
          color: '#7c3aed',
          weight: 4,
          opacity: 0.92,
          smoothFactor: lowPower ? 2 : 1
        }).addTo(map);
        map.fitBounds(poly.getBounds(), { padding: [18, 18], maxZoom: tileCap });
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
    [loadState.status, loadState.track, mapRemountKey]
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
        var pts = [];
        var iPt;
        var nKm = tr.distancesKm.length;
        for (iPt = 0; iPt < nKm; iPt++) {
          pts.push({ x: Number(tr.distancesKm[iPt]), y: Number(tr.elevs[iPt]) });
        }
        var xMax = pts[pts.length - 1] && pts[pts.length - 1].x != null ? Number(pts[pts.length - 1].x) : 0;

        var lowPowerCh = openRidingPreferLowPowerMap();
        var decimateChart = lowPowerCh || pts.length > 700;
        var chartPlugins = { legend: { display: false } };
        if (decimateChart) {
          chartPlugins.decimation = {
            enabled: true,
            algorithm: 'lttb',
            samples: lowPowerCh ? 320 : 480
          };
        }

        var ctx = chartRef.current.getContext('2d');
        chartInstRef.current = new Chart(ctx, {
          type: 'line',
          data: {
            datasets: [
              {
                label: '고도',
                data: pts,
                borderColor: '#7c3aed',
                backgroundColor: 'rgba(124, 58, 237, 0.22)',
                fill: true,
                tension: lowPowerCh ? 0.2 : 0.25,
                pointRadius: 0,
                borderWidth: 2
              }
            ]
          },
          options: {
            parsing: false,
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            layout: {
              padding: { right: 18, left: 2, top: 4, bottom: 2 }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
            scales: {
              x: {
                type: 'linear',
                display: true,
                min: 0,
                max: xMax,
                title: { display: true, text: '누적 거리 (km)', font: { size: 11 } },
                grid: { display: false },
                afterBuildTicks: function (scale) {
                  var ticks = scale.ticks;
                  if (!ticks || !ticks.length || xMax <= 0) return;
                  var last = ticks[ticks.length - 1];
                  var lastV = last && last.value != null ? Number(last.value) : NaN;
                  if (!Number.isFinite(lastV) || Math.abs(lastV - xMax) > Math.max(1e-6, xMax * 1e-5)) {
                    ticks.push({ value: xMax });
                  }
                },
                ticks: {
                  maxTicksLimit: 7,
                  font: { size: 10 },
                  callback: function (value) {
                    return String(Math.round(Number(value)));
                  }
                }
              },
              y: {
                display: true,
                title: { display: false },
                grid: { color: 'rgba(0,0,0,0.06)' },
                ticks: {
                  font: { size: 10 },
                  callback: function (val) {
                    var n = Math.round(Number(val));
                    return n === 0 ? '0m' : String(n);
                  }
                }
              }
            },
            plugins: chartPlugins
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
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/90 px-3 py-6 text-center open-riding-gpx-empty-hint space-y-1.5">
        <p className="m-0">등록된 코스가 없습니다.</p>
        <p className="m-0">GPX파일을 업로드하면 지도와 고도표가 표시됩니다.</p>
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
    if (typeof window !== 'undefined' && window.Android && typeof window.Android.openAddressBook === 'function') {
      window.Android.openAddressBook();
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
/** 하단 뷰포트 고정: 스텔비오 로고만 (CTA는 본문 흐름의 open-riding-bottom-actions 유지) */
function OpenRidingBottomLogoBar() {
  return (
    <div className="open-riding-bottom-fixed-shell open-riding-bottom-logo-bar">
      <div className="open-riding-bottom-brand" aria-hidden="true">
        <img
          src="assets/img/STELVIO AI.png"
          alt=""
          className="open-riding-bottom-brand-logo"
          width={420}
          height={54}
          decoding="async"
        />
      </div>
    </div>
  );
}

function OpenRidingCalendarMain(props) {
  var firestore = props.firestore;
  var storage = props.storage;
  var userId = props.userId || '';
  var userLabel = props.userLabel || '라이더';
  var onOpenCreate = props.onOpenCreate || function () {};
  var onSelectRide = props.onSelectRide || function () {};
  var compact = !!props.compact;
  var filterPageOpen = !!props.filterPageOpen;
  var onOpenFilterPage = props.onOpenFilterPage || function () {};
  var onCloseFilterPage = props.onCloseFilterPage || function () {};

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

  var _invitePh = useState('');
  var inviteCheckPhone = _invitePh[0];
  var setInviteCheckPhone = _invitePh[1];

  useEffect(
    function () {
      if (!userId) {
        setInviteCheckPhone('');
        return undefined;
      }
      var sync = getOpenRidingInvitePhoneSync(userId);
      setInviteCheckPhone(sync);
      var cancelled = false;
      if (typeof window !== 'undefined' && typeof window.getUserByUid === 'function') {
        window
          .getUserByUid(String(userId))
          .then(function (row) {
            if (cancelled || !row || typeof row !== 'object') return;
            var ph = (
              String(row.contact != null ? row.contact : '').trim() ||
              String(row.phone != null ? row.phone : '').trim()
            ).slice(0, 80);
            if (ph) setInviteCheckPhone(ph);
          })
          .catch(function () {});
      }
      return function () {
        cancelled = true;
      };
    },
    [userId]
  );

  var invitedRidesSorted = useMemo(
    function () {
      var uid = String(userId || '');
      var phone = String(inviteCheckPhone || '').trim();
      var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
      var isInv =
        typeof svc.isUserPhoneInvitedToRide === 'function'
          ? svc.isUserPhoneInvitedToRide
          : function () {
              return false;
            };
      if (!uid || !phone) return [];
      var list = ridesMonth.filter(function (r) {
        if (isOpenRidingPastBySeoulDate(r)) return false;
        if (String(r.hostUserId || '') === uid) return false;
        var il = Array.isArray(r.invitedList) ? r.invitedList : [];
        if (!il.length) return false;
        return isInv(phone, r.invitedList);
      });
      return sortOpenRidingListByDateTime(list);
    },
    [ridesMonth, userId, inviteCheckPhone]
  );

  var myHostedRidesSorted = useMemo(
    function () {
      var uid = String(userId || '');
      if (!uid) return [];
      var list = ridesMonth.filter(function (r) {
        if (isOpenRidingPastBySeoulDate(r)) return false;
        return String(r.hostUserId || '') === uid;
      });
      return sortOpenRidingListByDateTime(list);
    },
    [ridesMonth, userId]
  );

  /** 해당 월에서 내가 참석 확정(participants)인 라이딩이 있는 날짜 */
  var participantConfirmedDateKeys = useMemo(function () {
    var uid = String(userId || '');
    if (!uid) return new Set();
    var s = new Set();
    ridesMonth.forEach(function (r) {
      if (String(r.rideStatus || 'active') === 'cancelled') return;
      var parts = Array.isArray(r.participants) ? r.participants : [];
      var inPart = parts.some(function (p) {
        return String(p) === uid;
      });
      if (!inPart) return;
      var ts = r.date;
      var d = ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
      if (!d) return;
      s.add(dateKey(d.getFullYear(), d.getMonth(), d.getDate()));
    });
    return s;
  }, [ridesMonth, userId]);

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
  /** 부트·캐시 타이밍에도 최신 그룹을 읽기 위한 시그니처 */
  var openRidingRegionDataSig =
    getKoreaRegionGroupsResolved().length * 100000 + (window.KOREA_SIGUNGU_OPTIONS || []).length;

  var _filterSidoPick = useState('');
  var filterSidoPick = _filterSidoPick[0];
  var setFilterSidoPick = _filterSidoPick[1];
  var _filterDistrictPick = useState('');
  var filterDistrictPick = _filterDistrictPick[0];
  var setFilterDistrictPick = _filterDistrictPick[1];

  useEffect(
    function () {
      setFilterDistrictPick('');
    },
    [filterSidoPick]
  );

  var filterDistrictsForSido = useMemo(
    function () {
      var groups = getKoreaRegionGroupsResolved();
      var fn = typeof window !== 'undefined' ? window.getDistrictsForSido : null;
      if (typeof fn === 'function') return fn(filterSidoPick);
      var i;
      for (i = 0; i < groups.length; i++) {
        if (groups[i].sido === filterSidoPick) {
          return Array.isArray(groups[i].districts) ? groups[i].districts.slice() : [];
        }
      }
      return [];
    },
    [filterSidoPick, openRidingRegionDataSig]
  );

  var koreaRegionGroupsForFilterUi = getKoreaRegionGroupsResolved();

  var _rankFetch = useState({
    loading: false,
    error: false,
    byCategory: null,
    entries: null,
    currentUser: null,
    myRankSupremo: null,
    startStr: null,
    endStr: null
  });
  var openRidingFilterRankDist = _rankFetch[0];
  var setOpenRidingFilterRankDist = _rankFetch[1];
  var filterRankFetchStartedRef = useRef(false);

  useEffect(
    function () {
      filterRankFetchStartedRef.current = false;
    },
    [userId]
  );

  useEffect(
    function () {
      if (filterPageOpen) {
        filterRankFetchStartedRef.current = false;
      }
    },
    [filterPageOpen]
  );

  useEffect(
    function () {
      if (!filterPageOpen) return undefined;
      if (filterRankFetchStartedRef.current) return undefined;
      filterRankFetchStartedRef.current = true;
      var cancelled = false;
      setOpenRidingFilterRankDist(function (s) {
        return Object.assign({}, s, { loading: true, error: false });
      });
      var uid = String(userId || '');
      var params = new URLSearchParams({
        period: 'monthly',
        duration: '60min',
        gender: 'all'
      });
      if (uid) params.set('uid', uid);
      var url =
        'https://us-central1-stelvio-ai.cloudfunctions.net/getPeakPowerRanking?' + params.toString();
      fetch(url, { method: 'GET', mode: 'cors' })
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          if (cancelled) return;
          if (!data || !data.success || !data.byCategory) {
            setOpenRidingFilterRankDist({
              loading: false,
              error: true,
              byCategory: null,
              entries: null,
              currentUser: null,
              myRankSupremo: null,
              startStr: null,
              endStr: null
            });
            return;
          }
          var merged = mergePeakRankingEntriesFromByCategory(data.byCategory);
          setOpenRidingFilterRankDist({
            loading: false,
            error: false,
            byCategory: data.byCategory,
            entries: merged,
            currentUser: data.currentUser || null,
            myRankSupremo: data.myRankSupremo || null,
            startStr: data.startStr != null ? String(data.startStr) : null,
            endStr: data.endStr != null ? String(data.endStr) : null
          });
        })
        .catch(function () {
          if (!cancelled) {
            setOpenRidingFilterRankDist({
              loading: false,
              error: true,
              byCategory: null,
              entries: null,
              currentUser: null,
              myRankSupremo: null,
              startStr: null,
              endStr: null
            });
          }
        });
      return function () {
        cancelled = true;
      };
    },
    [filterPageOpen, userId]
  );

  var cellH = compact ? 'h-8' : 'h-10';
  var emptyH = compact ? 'h-8' : 'h-10';

  function addRegionFromSelect() {
    var t = resolveOpenRidingFullRegionLabel(filterSidoPick, filterDistrictPick, filterDistrictsForSido);
    if (!t) return;
    if (prefs.activeRegions.indexOf(t) >= 0) {
      setFilterSidoPick('');
      setFilterDistrictPick('');
      return;
    }
    savePrefs({
      activeRegions: prefs.activeRegions.concat([t]),
      preferredLevels: prefs.preferredLevels
    });
    setFilterSidoPick('');
    setFilterDistrictPick('');
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

  /** 맞춤 필터: 지역·관심 레벨(참석 판정 배지) / 능력 패널 분리 — 전체 화면에서는 확인 버튼이 중간에 옴 */
  function renderFilterSettingsBodyParts() {
    var prof = readOpenRidingProfileFtpWeight();
    var ev =
      typeof window !== 'undefined' && typeof window.evaluateGroupRideEligibility === 'function'
        ? window.evaluateGroupRideEligibility
        : null;
    var StelvioDistChart =
      typeof window !== 'undefined' ? window.StelvioRankingDistributionChart : null;
    var baseStats = prof.ok && ev ? ev(prof.ftp, prof.weight, 0) : null;

    var rankPeakEntry = null;
    if (openRidingFilterRankDist.entries && userId) {
      var uidPeak = String(userId);
      var pi;
      for (pi = 0; pi < openRidingFilterRankDist.entries.length; pi++) {
        if (openRidingFilterRankDist.entries[pi].userId === uidPeak) {
          rankPeakEntry = openRidingFilterRankDist.entries[pi];
          break;
        }
      }
    }
    var cuRank = openRidingFilterRankDist.currentUser || rankPeakEntry;
    var peak60Watts = cuRank && Number(cuRank.watts) > 0 ? Number(cuRank.watts) : 0;
    var peakWeightKg =
      cuRank && Number(cuRank.weightKg) > 0 ? Number(cuRank.weightKg) : prof.ok ? prof.weight : 0;
    var realisticStats =
      prof.ok && ev && peak60Watts > 0 && peakWeightKg > 0 ? ev(peak60Watts, peakWeightKg, 0) : null;
    var rangePeak =
      openRidingFilterRankDist.startStr && openRidingFilterRankDist.endStr
        ? openRidingFilterRankDist.startStr + ' ~ ' + openRidingFilterRankDist.endStr
        : '';
    var chartRefWkg = realisticStats ? realisticStats.wkg : baseStats ? baseStats.wkg : null;
    var chartRefBadgeTitle = realisticStats ? '나의 60분' : '나의 FTP';
    var chartRefValueNote = realisticStats ? ' (최근 30일)' : ' (프로필)';

    var wkgForBand =
      typeof window !== 'undefined' && typeof window.wkgForOpenRidingGroupTargetSpeed === 'function'
        ? window.wkgForOpenRidingGroupTargetSpeed
        : null;
    var bandWeightKg =
      peakWeightKg > 0 ? peakWeightKg : prof.ok && Number(prof.weight) > 0 ? Number(prof.weight) : 0;
    var levelBandReferenceLines = null;
    if (wkgForBand && bandWeightKg > 0) {
      var bx1 = wkgForBand(25, bandWeightKg);
      var bx2 = wkgForBand(30, bandWeightKg);
      var bx3 = wkgForBand(35, bandWeightKg);
      if (bx1 != null && bx2 != null && bx3 != null) {
        levelBandReferenceLines = [
          { x: bx1, stroke: '#facc15' },
          { x: bx2, stroke: '#22c55e' },
          { x: bx3, stroke: '#f97316' },
        ];
      }
    }

    var regionAndLevels = (
      <div className="space-y-4 text-left">
        <div>
          <label className="text-xs text-slate-500 block mb-1">활동 지역 추가</label>
          <div className="flex gap-1 flex-wrap items-center" data-open-riding-label="활동지역-시도-구군-선택">
            <select
              className="flex-1 min-w-[120px] rounded-lg border border-slate-200 px-2 py-1 text-sm bg-white"
              aria-label="활동 지역 시·도"
              value={filterSidoPick}
              onChange={function (e) { setFilterSidoPick(e.target.value); }}
            >
              <option value="">시·도</option>
              {koreaRegionGroupsForFilterUi.map(function (g) {
                return (
                  <option key={g.sido} value={g.sido}>{g.sido}</option>
                );
              })}
            </select>
            <select
              className="flex-1 min-w-[120px] rounded-lg border border-slate-200 px-2 py-1 text-sm bg-white"
              aria-label="활동 지역 구·군"
              value={filterDistrictPick}
              disabled={!filterSidoPick || !filterDistrictsForSido.length}
              onChange={function (e) { setFilterDistrictPick(e.target.value); }}
            >
              <option value="">
                {!filterSidoPick
                  ? '시·도 먼저'
                  : !filterDistrictsForSido.length
                    ? '구·군 없음'
                    : '구·군'}
              </option>
              {filterDistrictsForSido.map(function (d) {
                return <option key={d} value={d}>{d}</option>;
              })}
            </select>
            <button type="button" className="rounded-lg bg-violet-600 text-white px-3 py-1 text-sm shrink-0 hover:bg-violet-700" onClick={addRegionFromSelect}>추가</button>
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
            var powLv = peak60Watts > 0 ? peak60Watts : prof.ftp;
            var wLv = peak60Watts > 0 && peakWeightKg > 0 ? peakWeightKg : prof.weight;
            var clsFn =
              typeof window !== 'undefined' && typeof window.classifyOpenRidingParticipation === 'function'
                ? window.classifyOpenRidingParticipation
                : null;
            var part =
              clsFn && prof.ok && wLv > 0 ? clsFn(powLv, wLv, opt.value) : null;
            var badgeCls =
              part && part.tier === 'go'
                ? 'bg-emerald-100 text-emerald-900 border border-emerald-300/90'
                : part && part.tier === 'caution'
                  ? 'bg-orange-50 text-orange-900 border border-orange-200/90'
                  : part && part.tier === 'stop'
                    ? 'bg-red-50 text-red-800 border border-red-200/90'
                    : 'bg-slate-100 text-slate-500 border border-slate-200';
            var badgeTitle = part
              ? part.comment
              : !prof.ok
                ? 'FTP·체중을 입력하면 60분 피크(있으면)·없으면 FTP 기준으로 참석 판정이 표시됩니다.'
                : '';
            return (
              <div
                key={opt.value}
                className="flex items-center justify-between gap-2 text-sm py-1 pr-0.5"
              >
                <label className="flex items-center gap-2 cursor-pointer min-w-0 flex-1">
                  <input
                    type="checkbox"
                    className="open-riding-filter-level-checkbox h-4 w-4 shrink-0 rounded border-slate-300 accent-violet-600 focus:ring-2 focus:ring-violet-500/35 focus:ring-offset-0 cursor-pointer"
                    checked={on}
                    onChange={function () { toggleLevel(opt.value); }}
                  />
                  <span className="min-w-0">
                    {opt.value}{' '}
                    <span className="text-xs text-slate-400">({opt.hint})</span>
                  </span>
                </label>
                <span
                  className={
                    'shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums ' + badgeCls
                  }
                  title={badgeTitle}
                >
                  {part ? part.label : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );

    var abilityPanel = (
      <div className="rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-3 space-y-3 open-riding-filter-ability-panel">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-semibold text-violet-900">나의 항속 능력 레벨</span>
            <span className="text-[10px] text-slate-500 leading-tight text-right">
              최대 능력치: 프로필 FTP·체중 · 현실 지표: 최근 30일 60분 최고 평균 파워 · 팩 1.2×
            </span>
          </div>
          {!prof.ok ? (
            <p className="text-xs text-slate-600 m-0 leading-relaxed">
              프로필에 <strong>FTP</strong>와 <strong>체중</strong>을 입력하면, 평지 개인 평속·예상 그룹 평속과 관심 레벨별
              참가 난이도를 안내합니다. 60분 피크·분포는 훈련 로그가 반영된 뒤 랭킹과 동일하게 표시됩니다.
            </p>
          ) : (
            <>
              <p className="text-[10px] font-semibold text-violet-800 m-0">최대 능력치 (프로필 FTP·체중)</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg bg-white/90 border border-violet-100 px-2 py-1.5">
                  <div className="text-slate-500 text-[10px]">FTP</div>
                  <div className="font-semibold text-slate-800 tabular-nums">{prof.ftp} W</div>
                </div>
                <div className="rounded-lg bg-white/90 border border-violet-100 px-2 py-1.5">
                  <div className="text-slate-500 text-[10px]">체중</div>
                  <div className="font-semibold text-slate-800 tabular-nums">{prof.weight} kg</div>
                </div>
                <div className="rounded-lg bg-white/90 border border-violet-100 px-2 py-1.5 col-span-2 sm:col-span-1">
                  <div className="text-slate-500 text-[10px]">W/kg (FTP)</div>
                  <div className="font-semibold text-violet-800 tabular-nums">
                    {baseStats ? baseStats.wkg.toFixed(2) : '-'}
                  </div>
                </div>
                <div className="rounded-lg bg-white/90 border border-slate-200 px-2 py-1.5 col-span-2 sm:col-span-3 open-riding-filter-ftp-solo-highlight">
                  <div className="text-violet-900 text-[10px] font-semibold">
                    평지 개인 평속 (FTP 투입) — 최대 능력치 핵심
                  </div>
                  <div className="font-bold text-violet-950 tabular-nums text-sm">
                    {baseStats ? baseStats.soloSpeed + ' km/h' : '-'}
                  </div>
                </div>
                <div className="rounded-lg bg-white/90 border border-violet-100 px-2 py-1.5 col-span-2 sm:col-span-3">
                  <div className="text-slate-500 text-[10px]">예상 그룹 평속 (×1.2 드래프팅)</div>
                  <div className="font-semibold text-slate-800 tabular-nums">
                    {baseStats ? baseStats.estimatedGroupSpeed + ' km/h' : '-'}
                  </div>
                </div>
              </div>

              <p className="text-[10px] font-semibold text-slate-800 m-0 pt-1 border-t border-violet-100/80">
                현실 지표 (최근 30일 · 60분 최대 평균 파워·체중, 랭킹보드와 동일 산출)
                {rangePeak ? (
                  <span className="font-normal text-slate-500"> · {rangePeak}</span>
                ) : null}
              </p>
              {realisticStats ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-white/90 border border-slate-200 px-2 py-1.5">
                    <div className="text-slate-500 text-[10px]">60분 최고 평균 파워</div>
                    <div className="font-semibold text-slate-800 tabular-nums">{peak60Watts} W</div>
                  </div>
                  <div className="rounded-lg bg-white/90 border border-slate-200 px-2 py-1.5">
                    <div className="text-slate-500 text-[10px]">체중 (랭킹 산출)</div>
                    <div className="font-semibold text-slate-800 tabular-nums">{peakWeightKg} kg</div>
                  </div>
                  <div className="rounded-lg bg-white/90 border border-slate-200 px-2 py-1.5 col-span-2 sm:col-span-1">
                    <div className="text-slate-500 text-[10px]">W/kg (60분 피크)</div>
                    <div className="font-semibold text-indigo-700 tabular-nums">
                      {realisticStats.wkg.toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/90 border border-slate-200 px-2 py-1.5 col-span-2 sm:col-span-3 open-riding-filter-realistic-solo-highlight">
                    <div className="text-slate-700 text-[10px] font-semibold">평지 개인 평속 (60분 피크 투입) — 현실 지표 핵심</div>
                    <div className="font-bold text-slate-900 tabular-nums text-sm">
                      {realisticStats.soloSpeed + ' km/h'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/90 border border-slate-200 px-2 py-1.5 col-span-2 sm:col-span-3">
                    <div className="text-slate-500 text-[10px]">예상 그룹 평속 (×1.2)</div>
                    <div className="font-semibold text-slate-800 tabular-nums">
                      {realisticStats.estimatedGroupSpeed + ' km/h'}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 m-0 leading-snug">
                  이 구간에 반영된 60분 최고 평균 파워 기록이 없거나, 아직 랭킹 데이터에 포함되지 않았습니다.
                  라이딩 로그를 동기화한 뒤 맞춤 설정을 다시 여세요.
                </p>
              )}
              <p className="text-[10px] text-slate-500 m-0 leading-snug">
                관심 레벨 참고는 <strong className="text-slate-600">60분 피크가 있으면 그 값</strong>으로, 없으면 FTP로 계산합니다.
              </p>
            </>
          )}

          {openRidingFilterRankDist.loading ? (
            <p className="text-xs text-slate-500 m-0 py-2 text-center">분포 데이터 불러오는 중…</p>
          ) : openRidingFilterRankDist.error ? (
            <p className="text-xs text-amber-700 m-0 py-2 text-center">
              전체 사용자 분포를 불러오지 못했습니다. 네트워크 후 다시 열어 주세요.
            </p>
          ) : StelvioDistChart &&
            openRidingFilterRankDist.byCategory &&
            openRidingFilterRankDist.entries &&
            openRidingFilterRankDist.entries.length ? (
            <StelvioDistChart
              entries={openRidingFilterRankDist.entries}
              byCategory={openRidingFilterRankDist.byCategory}
              activeCategory="Supremo"
              duration="60min"
              currentUserId={userId || ''}
              currentUser={openRidingFilterRankDist.currentUser}
              myRankSupremo={openRidingFilterRankDist.myRankSupremo}
              overrideMyWkg={chartRefWkg != null ? chartRefWkg : null}
              overrideReferenceBadgeTitle={chartRefBadgeTitle}
              overrideReferenceValueNote={chartRefValueNote}
              levelBandReferenceLines={levelBandReferenceLines || undefined}
              titleOverride="전체 사용자 60분 W/kg 분포"
              pillLabelOverride="전체 · 60분 W/kg · 최근 30일"
              chartSubNoteOverride={
                '훈련 로그 기준 최근 30일(서울) 내 60분 최대 평균 파워로 산출한 W/kg 분포입니다. ' +
                '노란·녹·주황 세로 실선은 초급·중급·중상급 모임 기준(평지·×1.2)에 해당하는 W/kg 경계이고, ' +
                '보라 점선은 본인 동일 기준 W/kg(없으면 FTP W/kg)입니다.'
              }
            />
          ) : (
            <p className="text-xs text-slate-500 m-0 py-2 text-center">표시할 분포 데이터가 없습니다.</p>
          )}
        </div>
    );

    return { regionAndLevels: regionAndLevels, abilityPanel: abilityPanel };
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

  function isUserParticipantConfirmedForRide(r) {
    var uid = String(userId || '');
    if (!uid) return false;
    if (String(r.rideStatus || 'active') === 'cancelled') return false;
    var parts = Array.isArray(r.participants) ? r.participants : [];
    return parts.some(function (p) {
      return String(p) === uid;
    });
  }

  /** extra.showRideDate: 월간 합성 목록에서 일자 표시 */
  function renderMonthRideListRow(r, extra) {
    var ex = extra || {};
    var isCancelled = String(r.rideStatus || 'active') === 'cancelled';
    var isMine = !!(userId && String(r.hostUserId || '') === String(userId));
    var titleRowClass = 'font-medium text-sm flex items-center gap-1.5 min-w-0 ';
    var hostedCancelledMine = !!(ex.hostedListSection && isMine && isCancelled);
    if (isCancelled) {
      titleRowClass += hostedCancelledMine
        ? 'text-slate-600'
        : isMine
          ? 'open-riding-list-title-cancelled-mine'
          : 'open-riding-list-title-cancelled';
    } else if (isMine && ex.hostedListSection) {
      titleRowClass += 'text-black';
    } else if (isMine) {
      titleRowClass += 'open-riding-list-title-mine';
    } else if (r.isPrivate) {
      titleRowClass += 'open-riding-list-title-private-black';
    } else {
      titleRowClass += 'text-slate-800';
    }
    var rideYmd = getRideDateSeoulYmd(r);
    var useInviteHostedRow = !!ex.compactInviteOrHostedList;
    var dateLabel = '';
    if (ex.showRideDate) {
      dateLabel = useInviteHostedRow ? formatRideDateMdDowSeoul(r) : rideYmd && formatKoreanDateLabelFromYmd(rideYmd);
    }
    var regionFull = r.region != null && String(r.region).trim() ? String(r.region).trim() : '';
    var regionShort = formatOpenRidingRegionShort(regionFull);
    var placeLabel = regionShort;
    var regionTitleAttr = regionFull ? regionFull : undefined;
    var showParticipantConfirmedIcon =
      isUserParticipantConfirmedForRide(r) && !(ex.compactInviteOrHostedList && ex.hostedListSection);
    return (
      <li key={r.id}>
        <button
          type="button"
          className="w-full text-left py-2.5 hover:bg-slate-50 px-2 rounded-lg"
          onClick={function () { onSelectRide(r.id); }}
        >
          <div className={titleRowClass}>
            {isCancelled ? (
              <img src="assets/img/rcancel.svg" alt="" className="w-4 h-4 shrink-0 object-contain" width={16} height={16} decoding="async" />
            ) : r.isPrivate ? (
              <img src="assets/img/lock.png" alt="" className="w-4 h-4 shrink-0 object-contain" width={16} height={16} decoding="async" />
            ) : null}
            {showParticipantConfirmedIcon ? (
              <img
                src="assets/img/check.svg"
                alt="참석 확정"
                className="w-4 h-4 shrink-0 object-contain"
                width={16}
                height={16}
                decoding="async"
              />
            ) : null}
            <span className="truncate">{r.title}</span>
          </div>
          <div
            className={
              'text-xs mt-1 flex flex-wrap items-center gap-y-0.5 ' +
              (hostedCancelledMine ? 'text-slate-600' : isCancelled ? 'text-slate-400' : 'text-slate-600')
            }
          >
            {ex.showRideDate && dateLabel ? (
              <>
                <span className={'shrink-0 ' + (useInviteHostedRow ? 'text-slate-600' : 'text-slate-500')}>{dateLabel}</span>
                {rideListMetaSep()}
              </>
            ) : null}
            <span className={'shrink-0 min-w-0 ' + (useInviteHostedRow ? 'truncate max-w-[min(100%,12rem)]' : '')} title={regionTitleAttr}>
              {placeLabel}
            </span>
            {rideListMetaSep()}
            <span className="shrink-0">{r.level != null && String(r.level).trim() ? r.level : '-'}</span>
            {rideListMetaSep()}
            <span className="shrink-0">{r.departureTime != null && String(r.departureTime).trim() ? r.departureTime : '-'}</span>
            {rideListMetaSep()}
            <span className="shrink-0">{rideDistanceKm(r)}</span>
            {rideListMetaSep()}
            <span
              className={
                'font-semibold tabular-nums shrink-0 ' +
                (hostedCancelledMine ? 'text-slate-600' : isCancelled ? 'text-slate-400' : 'text-violet-700')
              }
            >
              {rideParticipantRatio(r)}
            </span>
          </div>
        </button>
      </li>
    );
  }

  function renderListSection() {
    return (
      <section className={(compact ? 'rounded-xl p-3 ' : 'rounded-2xl p-4 ') + 'border border-slate-200 bg-white shadow-sm'}>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">
          {selectedKey ? formatMdDowFromYmdSeoul(selectedKey) || selectedKey : '날짜를 선택하세요'}
        </h2>
        {!selectedKey ? (
          <p className="text-sm text-slate-400">달력에서 날짜를 탭하면 목록이 표시됩니다.</p>
        ) : ridesForDay.length === 0 ? (
          <p className="text-sm text-slate-400">이 날 등록된 라이딩이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
            {ridesForDay.map(function (r) {
              return renderMonthRideListRow(r, {});
            })}
          </ul>
        )}
      </section>
    );
  }

  function renderInvitedRidesCompactSection() {
    var invitedTitlePillStyle = {
      borderColor: 'rgba(22, 101, 52, 0.38)',
      color: '#166534',
      background: 'rgba(34, 197, 94, 0.12)'
    };
    return (
      <section className="rounded-xl p-3 border border-slate-200 bg-white shadow-sm open-riding-invited-rides-panel" aria-labelledby="open-riding-invited-heading">
        <div className="flex items-center justify-start gap-2 mb-2 flex-wrap">
          <span
            id="open-riding-invited-heading"
            role="heading"
            aria-level={2}
            className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border shadow-sm shrink-0 tracking-tight open-riding-invited-title-pill"
            style={invitedTitlePillStyle}
          >
            초대받은 라이딩
          </span>
        </div>
        {!userId ? (
          <p className="text-sm text-slate-400">로그인 후 비공개 라이딩 초대 목록을 확인할 수 있습니다.</p>
        ) : !String(inviteCheckPhone || '').trim() ? (
          <p className="text-sm text-slate-400">
            프로필·계정에 등록된 전화번호로 초대 여부를 확인합니다. 연락처를 등록한 뒤 새로고침해 주세요.
          </p>
        ) : invitedRidesSorted.length === 0 ? (
          <p className="text-sm text-slate-400">이번 달 초대받은 라이딩이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
            {invitedRidesSorted.map(function (r) {
              return renderMonthRideListRow(r, { showRideDate: true, compactInviteOrHostedList: true });
            })}
          </ul>
        )}
      </section>
    );
  }

  function renderMyHostedRidesCompactSection() {
    if (!myHostedRidesSorted.length) return null;
    var hostedTitlePillStyle = {
      borderColor: 'rgba(109, 40, 217, 0.4)',
      color: '#5b21b6',
      background: 'rgba(139, 92, 246, 0.12)'
    };
    return (
      <section className="rounded-xl p-3 border border-slate-200 bg-white shadow-sm open-riding-my-hosted-panel" aria-labelledby="open-riding-my-hosted-heading">
        <div className="flex items-center justify-start gap-2 mb-2 flex-wrap">
          <span
            id="open-riding-my-hosted-heading"
            role="heading"
            aria-level={2}
            className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border shadow-sm shrink-0 tracking-tight open-riding-hosted-title-pill"
            style={hostedTitlePillStyle}
          >
            내가 주최한 라이딩
          </span>
        </div>
        <ul className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
          {myHostedRidesSorted.map(function (r) {
            return renderMonthRideListRow(r, { showRideDate: true, compactInviteOrHostedList: true, hostedListSection: true });
          })}
        </ul>
      </section>
    );
  }

  if (compact && filterPageOpen) {
    var _filterParts = renderFilterSettingsBodyParts();
    return (
      <div className="open-riding-filter-full-page w-full max-w-lg mx-auto text-left relative z-0">
        <div className="open-riding-create-form-root w-full max-w-lg mx-auto space-y-3 pb-1 text-sm text-slate-700 relative z-0">
          {_filterParts.regionAndLevels}
          <div className="open-riding-bottom-actions">
            <button
              type="button"
              className="open-riding-create-submit open-riding-action-btn h-11 inline-flex items-center justify-center w-full flex-1 px-4 bg-violet-600 text-white rounded-xl font-medium leading-none hover:bg-violet-700"
              onClick={onCloseFilterPage}
            >
              확인
            </button>
          </div>
          {_filterParts.abilityPanel}
          <OpenRidingBottomLogoBar />
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? 'open-riding-compact w-full max-w-full space-y-3 text-left' : 'open-riding-main max-w-4xl mx-auto p-4 space-y-6'}>
      {compact ? (
        <div className="grid grid-cols-3 items-center gap-x-1 sm:gap-x-2 w-full min-w-0">
          <div className="flex justify-start items-center min-w-0">
            <button
              type="button"
              className="open-riding-filter-launch-btn inline-flex items-center justify-center rounded-lg border-2 border-violet-600 bg-white px-1.5 sm:px-2 py-1.5 text-[10px] sm:text-[11px] font-semibold text-violet-700 shadow-sm hover:bg-violet-50 whitespace-nowrap max-w-full"
              onClick={onOpenFilterPage}
              aria-label="맞춤 설정"
            >
              맞춤 설정 (+)
            </button>
          </div>
          <div className="flex justify-center items-center min-w-0 px-0.5">
            <span className="text-xs font-medium text-slate-800 truncate text-center block w-full" title={userLabel}>
              {userLabel}
            </span>
          </div>
          <div className="flex justify-end items-center min-w-0">
            <button
              type="button"
              className="open-riding-create-btn inline-flex items-center justify-center rounded-lg bg-violet-600 text-white px-1.5 sm:px-2 py-1.5 text-[10px] sm:text-[11px] font-semibold shadow hover:bg-violet-700 whitespace-nowrap max-w-full"
              onClick={onOpenCreate}
              aria-label="라이딩 주최"
            >
              라이딩 주최 (+)
            </button>
          </div>
        </div>
      ) : (
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="open-riding-main-screen-title">라이딩 모임</h1>
          <p className="text-sm text-slate-500">지역·레벨 맞춤 모임 — {userLabel}</p>
        </div>
        <button
          type="button"
          className="rounded-xl bg-violet-600 text-white px-4 py-2 text-sm font-medium shadow hover:bg-violet-700"
          onClick={onOpenCreate}
        >
          라이딩 주최 (+)
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
              var isConfirmedDay = participantConfirmedDateKeys.has(key);
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
                      className="absolute inset-1 z-[1] rounded-md bg-violet-300/50 border border-violet-400/40 pointer-events-none"
                      aria-hidden
                    />
                  ) : hasMatch ? (
                    <span
                      className="absolute inset-1 z-[1] rounded-md bg-emerald-400/35 pointer-events-none"
                      aria-hidden
                    />
                  ) : showOtherOnly ? (
                    <span
                      className="absolute inset-1 z-[1] rounded-md bg-slate-300/45 border border-slate-400/35 pointer-events-none"
                      aria-hidden
                    />
                  ) : null}
                  {isConfirmedDay ? (
                    <span
                      className="absolute inset-0 z-[8] rounded-lg border-2 border-red-600 pointer-events-none box-border"
                      aria-hidden
                    />
                  ) : null}
                  <span className="relative z-10">{day}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-slate-600 items-center">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="inline-block w-3 h-3 rounded-sm bg-emerald-400/90 shrink-0 border border-emerald-600/25" aria-hidden />
              <span className="text-slate-500 min-w-0 leading-tight">참석 가능 라이딩</span>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="inline-block w-3 h-3 rounded-sm shrink-0 border-2 border-red-600 bg-white box-border"
                aria-hidden
              />
              <span className="text-slate-500 min-w-0 leading-tight">참석 확정 라이딩</span>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="inline-block w-3 h-3 rounded-sm bg-violet-300/90 shrink-0 border border-violet-500/35" aria-hidden />
              <span className="text-slate-500 min-w-0 leading-tight">내가 주최한 라이딩</span>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="inline-block w-3 h-3 rounded-sm bg-slate-300/90 shrink-0 border border-slate-500/30" aria-hidden />
              <span className="text-slate-500 min-w-0 leading-tight">구경해 볼 라이딩</span>
            </div>
          </div>
        </section>

        {compact ? renderListSection() : null}
        {compact ? renderInvitedRidesCompactSection() : null}
        {compact ? renderMyHostedRidesCompactSection() : null}

        {!compact ? (
        <aside className="rounded-2xl p-4 border border-slate-200 bg-slate-50/80 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">맞춤 필터 설정</h2>
          {function () {
            var fp = renderFilterSettingsBodyParts();
            return (
              <>
                {fp.regionAndLevels}
                {fp.abilityPanel}
              </>
            );
          }()}
        </aside>
        ) : null}
      </div>

      {!compact ? renderListSection() : null}
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

  var _valDlg = useState({ open: false, text: '' });
  var validationDlg = _valDlg[0];
  var setValidationDlg = _valDlg[1];

  var _rideSido = useState('');
  var rideFormSidoPick = _rideSido[0];
  var setRideFormSidoPick = _rideSido[1];
  var _rideGu = useState('');
  var rideFormDistrictPick = _rideGu[0];
  var setRideFormDistrictPick = _rideGu[1];

  useEffect(
    function () {
      setRideFormDistrictPick('');
    },
    [rideFormSidoPick]
  );

  var openRidingRideFormRegionSig =
    getKoreaRegionGroupsResolved().length * 100000 + (window.KOREA_SIGUNGU_OPTIONS || []).length;

  var rideFormDistrictsForSido = useMemo(
    function () {
      var groups = getKoreaRegionGroupsResolved();
      var fn = typeof window !== 'undefined' ? window.getDistrictsForSido : null;
      if (typeof fn === 'function') return fn(rideFormSidoPick);
      var ri;
      for (ri = 0; ri < groups.length; ri++) {
        if (groups[ri].sido === rideFormSidoPick) {
          return Array.isArray(groups[ri].districts) ? groups[ri].districts.slice() : [];
        }
      }
      return [];
    },
    [rideFormSidoPick, openRidingRideFormRegionSig]
  );

  var rideFormRegionGroupsUi = getKoreaRegionGroupsResolved();

  function applyRideFormRegionFromPicker() {
    var t = resolveOpenRidingFullRegionLabel(rideFormSidoPick, rideFormDistrictPick, rideFormDistrictsForSido);
    if (!t) return;
    set('region', t);
    setRideFormSidoPick('');
    setRideFormDistrictPick('');
  }

  function clearRideFormRegion() {
    set('region', '');
  }

  useEffect(function () {
    if (typeof window === 'undefined') return undefined;

    function onAddressBookPayload(data) {
      openRidingMergeAddressBookIntoInvitePending(data, setForm);
    }

    var prevMain = window.onAddressBookSelected;
    var prevAlt = window.onOpenRidingAddressBookSelected;
    var prevPick = window.stelvioAddressBookPicked;

    window.onAddressBookSelected = function (data) {
      if (typeof prevMain === 'function') {
        try {
          prevMain(data);
        } catch (e0) {}
      }
      onAddressBookPayload(data);
    };
    window.onOpenRidingAddressBookSelected = onAddressBookPayload;
    window.stelvioAddressBookPicked = onAddressBookPayload;

    function onMessage(ev) {
      var d = ev && ev.data;
      if (d == null || typeof d !== 'object') return;
      var t = d.type != null ? String(d.type) : '';
      if (
        t === 'OPEN_RIDING_ADDRESS_BOOK' ||
        t === 'addressBookSelected' ||
        t === 'ADDRESS_BOOK_SELECTED' ||
        t === 'stelvio.addressBook'
      ) {
        onAddressBookPayload(d.payload != null ? d.payload : d.data != null ? d.data : d);
      }
    }
    window.addEventListener('message', onMessage);

    return function () {
      window.removeEventListener('message', onMessage);
      window.onAddressBookSelected = prevMain;
      window.onOpenRidingAddressBookSelected = prevAlt;
      window.stelvioAddressBookPicked = prevPick;
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

  var _cph = useState(null);
  var createFormPeakHint = _cph[0];
  var setCreateFormPeakHint = _cph[1];

  useEffect(
    function () {
      if (!hostUserId) {
        setCreateFormPeakHint(null);
        return undefined;
      }
      setCreateFormPeakHint({ loading: true });
      var cancelled = false;
      var prof = readOpenRidingProfileFtpWeight();
      var uid = String(hostUserId);
      var levelVals = RIDING_LEVEL_OPTIONS.map(function (o) {
        return o.value;
      });

      function applyHint(peakW, wKg, usedPeak) {
        var pw = Number(peakW) > 0 ? Number(peakW) : prof.ok ? prof.ftp : 0;
        var ww =
          Number(peakW) > 0 && Number(wKg) > 0 ? Number(wKg) : prof.ok ? prof.weight : 0;
        var calcFn = typeof window !== 'undefined' ? window.calculateSpeedOnFlat : null;
        var spd =
          calcFn && pw > 0 && ww > 0 ? Math.round(calcFn(pw, ww) * 10) / 10 : 0;
        var summ =
          typeof window !== 'undefined' &&
          typeof window.getMaxRidingLevelsForPeakParticipation === 'function'
            ? window.getMaxRidingLevelsForPeakParticipation(pw, ww, levelVals)
            : { maxGoLevel: null, maxCautionLevel: null };
        if (!cancelled) {
          setCreateFormPeakHint({
            loading: false,
            soloSpeedKmh: spd,
            usedPeak: !!(usedPeak && Number(peakW) > 0),
            maxGoLevel: summ.maxGoLevel,
            maxCautionLevel: summ.maxCautionLevel,
            profileOk: prof.ok
          });
        }
      }

      var params = new URLSearchParams({
        period: 'monthly',
        duration: '60min',
        gender: 'all'
      });
      params.set('uid', uid);
      fetch(
        'https://us-central1-stelvio-ai.cloudfunctions.net/getPeakPowerRanking?' + params.toString(),
        { mode: 'cors' }
      )
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (cancelled) return;
          if (!data || !data.success || !data.byCategory) {
            applyHint(0, 0, false);
            return;
          }
          var merged = mergePeakRankingEntriesFromByCategory(data.byCategory);
          var entry =
            merged.filter(function (e) {
              return e.userId === uid;
            })[0] || data.currentUser;
          var peakW = entry && Number(entry.watts) > 0 ? Number(entry.watts) : 0;
          var wKg = entry && Number(entry.weightKg) > 0 ? Number(entry.weightKg) : 0;
          applyHint(peakW, wKg, peakW > 0);
        })
        .catch(function () {
          if (!cancelled) applyHint(0, 0, false);
        });

      return function () {
        cancelled = true;
      };
    },
    [hostUserId, RIDING_LEVEL_OPTIONS.length]
  );

  var createFormPeakHintLoading =
    !!hostUserId && (!createFormPeakHint || createFormPeakHint.loading === true);

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

  function closeFormValidationDialog() {
    setValidationDlg({ open: false, text: '' });
  }

  function openFormValidationDialog(text) {
    setValidationDlg({ open: true, text: text });
  }

  /** 스텔비오 종료 확인 팝업과 유사한 단일 확인 알림 (모바일 WebView에서 native validation 무반응 대비) */
  function showFormValidationMessages(errors) {
    var list = Array.isArray(errors) ? errors.filter(function (s) { return s && String(s).trim(); }) : [];
    if (!list.length) return;
    var body =
      list.length === 1
        ? list[0]
        : '다음 내용을 확인해 주세요.\n\n' + list.map(function (line) { return '· ' + line; }).join('\n');
    openFormValidationDialog(body);
  }

  async function submit(e) {
    e.preventDefault();
    var distParsed = form.distance === '' || form.distance === null || form.distance === undefined ? NaN : Number(form.distance);
    var maxParsed =
      form.maxParticipants === '' || form.maxParticipants === null || form.maxParticipants === undefined
        ? NaN
        : Number(form.maxParticipants);

    var checkList = [];
    if (!firestore || !hostUserId) {
      checkList.push('라이딩을 저장할 수 없습니다. 로그인 상태와 네트워크를 확인해 주세요.');
    }
    if (!String(form.title || '').trim()) {
      checkList.push('제목을 입력해 주세요.');
    }
    if (!String(form.region || '').trim()) {
      checkList.push('지역이 선택되지 않았습니다. 시·도·구·군을 선택한 뒤 「추가」를 눌러 주세요.');
    }
    if (!String(form.departureLocation || '').trim()) {
      checkList.push('출발 장소를 입력해 주세요.');
    }
    if (!Number.isFinite(distParsed) || distParsed < 1) {
      checkList.push('거리(km)를 1 이상 입력해 주세요.');
    }
    if (!Number.isFinite(maxParsed) || maxParsed < 1) {
      checkList.push('최대 인원을 1 이상 입력해 주세요.');
    }
    if (!String(form.hostName || '').trim()) {
      checkList.push('방장명이 없습니다. 프로필(사용자 정보)에서 이름을 등록해 주세요.');
    }
    if (!String(form.contactInfo || '').trim()) {
      checkList.push('연락처가 없습니다. 프로필에서 휴대폰 번호를 등록해 주세요.');
    }
    if (checkList.length) {
      showFormValidationMessages(checkList);
      return;
    }

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
          distance: distParsed,
          course: form.course,
          level: form.level,
          maxParticipants: Math.max(1, Math.floor(maxParsed)),
          hostName: form.hostName,
          contactInfo: form.contactInfo,
          isContactPublic: false,
          region: form.region,
          gpxUrl: gpxUrl,
          isPrivate: !!form.isPrivate,
          invitedList: (form.inviteSelected || []).map(function (x) { return x.phone; }),
          rideJoinPassword: form.isPrivate ? String(form.rideJoinPassword || '').replace(/\D/g, '').slice(0, 4) : ''
        });
        onEditSaved();
        return;
      }
      if (typeof createRide !== 'function') {
        showFormValidationMessages(['라이딩 저장 기능을 불러오지 못했습니다. 페이지를 새로고침해 주세요.']);
        return;
      }
      var rideId = await createRide(firestore, hostUserId, {
        title: form.title,
        date: d,
        departureTime: form.departureTime,
        departureLocation: form.departureLocation,
        distance: distParsed,
        course: form.course,
        level: form.level,
        maxParticipants: Math.max(1, Math.floor(maxParsed)),
        hostName: form.hostName,
        contactInfo: form.contactInfo,
        isContactPublic: false,
        region: form.region,
        gpxUrl: gpxUrl,
        isPrivate: !!form.isPrivate,
        invitedList: (form.inviteSelected || []).map(function (x) { return x.phone; }),
        rideJoinPassword: form.isPrivate ? String(form.rideJoinPassword || '').replace(/\D/g, '').slice(0, 4) : '',
        /** createRide 내부와 동일하게 명시(캐시·구버전 서비스 대비) */
        participants: hostUserId ? [String(hostUserId).trim()] : []
      });
      /** 생성 직후 방장을 참석 확정으로 한 번 더 보장(Transaction, 비공개 방도 hostUid 예외) */
      if (rideId && hostUserId) {
        var svcJoin = typeof window !== 'undefined' ? window.openRidingService || {} : {};
        if (typeof svcJoin.joinRideTransaction === 'function') {
          try {
            await svcJoin.joinRideTransaction(
              firestore,
              rideId,
              String(hostUserId).trim(),
              String(form.hostName || '').trim().slice(0, 80) || '라이더',
              String(form.contactInfo || '').trim().slice(0, 80),
              { contactPublicToParticipants: true, joinPasswordAttempt: '' }
            );
          } catch (eJoin) {
            console.warn('[OpenRiding] 생성 직후 방장 참석 명단 보정 실패:', eJoin && eJoin.message ? eJoin.message : eJoin);
          }
        }
      }
      onCreated(rideId);
    } finally {
      setBusy(false);
    }
  }

  if (editRideId && !editHydrated) {
    return <div className="py-12 text-center text-sm text-slate-500">불러오는 중…</div>;
  }

  /* 폼 루트 z-0, 하단 CTA는 style.css에서 z-5(고정 로고바 10000 미만)로 본문보다만 위 — 스크롤 시 고정바 뒤로 가려짐 */
  return (
    <form className="open-riding-create-form-root w-full max-w-lg mx-auto space-y-3 pb-1 text-sm text-slate-700 relative z-0" onSubmit={submit} noValidate>
      {!storage ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50/95 text-amber-900 text-xs px-3 py-2 leading-snug m-0">
          Firebase Storage에 연결되지 않았습니다. GPX 파일은 업로드·저장되지 않습니다. 페이지를 새로고침한 뒤에도 동일하면 Firebase Console에서 Storage 사용 여부와 보안 규칙(쓰기 허용)을 확인해 주세요.
        </p>
      ) : null}
      <label className="block font-medium text-slate-700">제목<input className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={form.title} onChange={function (e) { set('title', e.target.value); }} /></label>

      <div className="block font-medium text-slate-700">
        <span className="block mb-1">지역</span>
        <span className="text-xs font-normal text-slate-500 block mb-1">
          시·도를 고른 뒤 구·군을 고르고 「추가」를 누르면 아래에 반영됩니다.
        </span>
        <div className="flex gap-1 flex-wrap items-center mt-1" data-open-riding-label="라이딩폼-지역-시도-구군">
          <select
            className="flex-1 min-w-[120px] border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
            aria-label="라이딩 지역 시·도"
            value={rideFormSidoPick}
            onChange={function (e) { setRideFormSidoPick(e.target.value); }}
          >
            <option value="">시·도</option>
            {rideFormRegionGroupsUi.map(function (g) {
              return <option key={g.sido} value={g.sido}>{g.sido}</option>;
            })}
          </select>
          <select
            className="flex-1 min-w-[120px] border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
            aria-label="라이딩 지역 구·군"
            value={rideFormDistrictPick}
            disabled={!rideFormSidoPick || !rideFormDistrictsForSido.length}
            onChange={function (e) { setRideFormDistrictPick(e.target.value); }}
          >
            <option value="">
              {!rideFormSidoPick
                ? '시·도 먼저'
                : !rideFormDistrictsForSido.length
                  ? '구·군 없음'
                  : '구·군'}
            </option>
            {rideFormDistrictsForSido.map(function (d) {
              return <option key={d} value={d}>{d}</option>;
            })}
          </select>
          <button
            type="button"
            className="rounded-lg bg-violet-600 text-white px-3 py-1.5 text-sm shrink-0 hover:bg-violet-700"
            onClick={applyRideFormRegionFromPicker}
          >
            추가
          </button>
        </div>
        {String(form.region || '').trim() ? (
          <div className="mt-2 flex flex-wrap gap-1">
            <button
              type="button"
              className="text-xs bg-white border border-slate-200 rounded-full px-2 py-0.5 font-normal"
              onClick={clearRideFormRegion}
            >
              {String(form.region).trim()} ×
            </button>
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-amber-700/90">선택된 지역 없음 — 제출하려면 위에서 추가해 주세요.</p>
        )}
      </div>

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

      <label className="block font-medium text-slate-700">출발 장소<input className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={form.departureLocation} onChange={function (e) { set('departureLocation', e.target.value); }} /></label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block font-medium text-slate-700">
          거리(km)
          <input
            type="number"
            inputMode="numeric"
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            value={form.distance === '' || form.distance === null || form.distance === undefined ? '' : form.distance}
            onChange={function (e) {
              var v = e.target.value;
              if (v === '') {
                set('distance', '');
                return;
              }
              var n = Number(v);
              if (!Number.isNaN(n)) set('distance', n);
            }}
          />
        </label>
        <label className="block font-medium text-slate-700">
          최대 인원
          <input
            type="number"
            inputMode="numeric"
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            value={
              form.maxParticipants === '' || form.maxParticipants === null || form.maxParticipants === undefined
                ? ''
                : form.maxParticipants
            }
            onChange={function (e) {
              var v = e.target.value;
              if (v === '') {
                set('maxParticipants', '');
                return;
              }
              var n = Number(v);
              if (!Number.isNaN(n)) set('maxParticipants', n);
            }}
          />
        </label>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
        <span className="block font-medium text-slate-700">라이딩 모임 공개/비공개 설정</span>
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
              <p className="text-xs text-slate-400 py-2">주소록에서 추가하거나, 친구목록에서 추가하세요.</p>
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
              <p className="text-xs text-slate-400 py-2">모임에 초대할 사람을 초대 목록에서 추가하세요</p>
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
        {form.isPrivate ? (
          <>
            {(form.inviteSelected || []).length === 0 ? (
              <p className="text-xs text-amber-700">
                초대 목록이 비어 있으면, 아래 비밀번호(4자리)를 설정해야 비초대자도 입장할 수 있습니다.
              </p>
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
          </>
        ) : (
          <>
            {(form.inviteSelected || []).length === 0 ? (
              <p className="text-xs text-amber-700">
                초대 목록이 비어 있어도 공개 모임이므로, 입장 비밀번호(4자리) 없이 누구나 참석 신청할 수 있습니다.
              </p>
            ) : (
              <p className="text-xs text-slate-600">
                지정한 전화번호(뒤 8자리 일치)로 로그인한 친구는 「초대받은 라이딩」에서 이 모임을 바로 볼 수 있습니다.
              </p>
            )}
          </>
        )}
      </div>

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
        {createFormPeakHintLoading ? (
          <div
            className="open-riding-create-level-peak-loading mt-2 flex min-h-[4.5rem] items-center justify-center rounded-lg border border-emerald-200/65 bg-emerald-50/45 px-2.5 py-3"
            role="status"
            aria-live="polite"
            aria-label="레벨 참고 지표 불러오는 중"
          >
            <span
              className="inline-block h-7 w-7 shrink-0 rounded-full border-2 border-emerald-200 border-t-emerald-600 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          </div>
        ) : createFormPeakHint && createFormPeakHint.soloSpeedKmh > 0 ? (
          <div className="open-riding-create-level-peak-hint mt-2 rounded-lg border border-emerald-200/70 bg-emerald-50/55 px-2.5 py-2 space-y-1.5 text-[11px] sm:text-xs text-emerald-900 leading-snug">
            <p className="m-0 font-semibold">
              평지 개인 평속 (60분 피크 투입)
              {!createFormPeakHint.usedPeak ? (
                <span className="font-normal text-emerald-800/95"> — 프로필 FTP 반영</span>
              ) : null}
              :{' '}
              <span className="tabular-nums font-bold text-emerald-950">{createFormPeakHint.soloSpeedKmh} km/h</span>
            </p>
            <p className="m-0 text-emerald-900">
              {createFormPeakHint.maxGoLevel ? (
                <>
                  최대 참석 가능 레벨: <strong className="text-emerald-950">{createFormPeakHint.maxGoLevel}</strong>
                </>
              ) : createFormPeakHint.maxCautionLevel ? (
                <>
                  참석 가능(안정) 구간 없음 · 주의 수준 최고:{' '}
                  <strong className="text-emerald-950">{createFormPeakHint.maxCautionLevel}</strong>
                </>
              ) : (
                <span className="text-emerald-800/95">
                  여유가 큰 참석 가능 레벨이 없습니다. 초급·하위 모임을 권장합니다.
                </span>
              )}
            </p>
          </div>
        ) : hostUserId && createFormPeakHint && createFormPeakHint.profileOk === false ? (
          <p className="m-0 mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 leading-snug">
            프로필에 FTP·체중을 저장하면 평지 개인 평속과 권장 레벨이 표시됩니다.
          </p>
        ) : null}
      </fieldset>

      <label className="block font-medium text-slate-700">
        방장명
        <input
          className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50 text-slate-700 text-sm"
          value={form.hostName}
          readOnly
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

      {/* Safe Area + 터치 타깃: 하단 CTA — style.css (고정바보다 낮은 z-index) */}
      <div className="open-riding-bottom-actions">
        <button type="submit" className="open-riding-create-submit open-riding-action-btn h-11 inline-flex items-center justify-center w-full flex-1 px-4 bg-violet-600 text-white rounded-xl font-medium leading-none disabled:opacity-50" disabled={isBusy}>
          {isBusy ? '저장 중…' : editRideId ? '저장' : '생성'}
        </button>
      </div>
      <OpenRidingBottomLogoBar />

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

      {validationDlg.open ? (
        <div
          className="fixed inset-0 z-[10070] flex items-center justify-center p-4"
          style={{ fontFamily: 'inherit' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-riding-form-val-title"
        >
          <button
            type="button"
            className="absolute inset-0 w-full h-full border-0 p-0 cursor-default bg-black/45 backdrop-blur-[4px]"
            style={{ WebkitBackdropFilter: 'blur(4px)' }}
            aria-label="닫기"
            onClick={closeFormValidationDialog}
          />
          <div
            className="relative z-[1] w-full max-w-[min(90vw,360px)] rounded-2xl border border-violet-300/40 bg-[rgba(255,255,255,0.98)] shadow-[0_16px_48px_rgba(102,126,234,0.2),0_0_0_1px_rgba(118,75,162,0.1)] text-center px-6 sm:px-8 py-7 box-border"
            onClick={function (e) { e.stopPropagation(); }}
          >
            <h2 id="open-riding-form-val-title" className="sr-only">
              입력 확인
            </h2>
            <p className="m-0 text-base font-semibold text-slate-700 leading-snug whitespace-pre-line text-left">
              {validationDlg.text}
            </p>
            <button
              type="button"
              className="open-riding-action-btn mt-6 w-full rounded-[10px] py-3 text-[15px] font-semibold text-white border-0 shadow-[0_2px_8px_rgba(102,126,234,0.35)] cursor-pointer active:translate-y-0 hover:-translate-y-px transition-transform"
              style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
              }}
              onClick={closeFormValidationDialog}
            >
              확인
            </button>
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
  var _lvlPart = useState(null);
  var levelParticipation = _lvlPart[0];
  var setLevelParticipation = _lvlPart[1];
  var _dlph = useState(null);
  var detailLevelPeakHint = _dlph[0];
  var setDetailLevelPeakHint = _dlph[1];
  var _lvlLd = useState(false);
  var levelAnalysisLoading = _lvlLd[0];
  var setLevelAnalysisLoading = _lvlLd[1];

  useEffect(
    function () {
      setJoinPasswordInput('');
      setJoinShareModalOpen(false);
    },
    [rideId]
  );

  useEffect(
    function () {
      if (!ride || !userId) {
        setLevelParticipation(null);
        setDetailLevelPeakHint(null);
        setLevelAnalysisLoading(false);
        return undefined;
      }
      setLevelAnalysisLoading(true);
      var cancelled = false;
      var prof = readOpenRidingProfileFtpWeight();
      var uid = String(userId);
      var levelStr = ride.level != null ? String(ride.level) : '';

      function applyLvClassify(pow, w) {
        var fn = typeof window !== 'undefined' ? window.classifyOpenRidingParticipation : null;
        if (!fn || !(Number(pow) > 0) || !(Number(w) > 0) || !levelStr) return null;
        return fn(Number(pow), Number(w), levelStr);
      }

      function finishWithPeak(peakW, wKg) {
        var pw = Number(peakW) > 0 ? Number(peakW) : prof.ok ? prof.ftp : 0;
        var ww =
          Number(peakW) > 0 && Number(wKg) > 0 ? Number(wKg) : prof.ok ? prof.weight : 0;
        var usedPeak = Number(peakW) > 0;
        var opts = typeof window !== 'undefined' ? window.RIDING_LEVEL_OPTIONS || [] : [];
        var levelVals = opts.map(function (o) {
          return o.value;
        });
        var calcFn = typeof window !== 'undefined' ? window.calculateSpeedOnFlat : null;
        var spd =
          calcFn && pw > 0 && ww > 0 ? Math.round(calcFn(pw, ww) * 10) / 10 : 0;
        var summ =
          typeof window !== 'undefined' &&
          typeof window.getMaxRidingLevelsForPeakParticipation === 'function'
            ? window.getMaxRidingLevelsForPeakParticipation(pw, ww, levelVals)
            : { maxGoLevel: null, maxCautionLevel: null };
        if (!cancelled) {
          setLevelParticipation(applyLvClassify(pw, ww));
          setDetailLevelPeakHint({
            soloSpeedKmh: spd,
            usedPeak: !!usedPeak,
            maxGoLevel: summ.maxGoLevel,
            maxCautionLevel: summ.maxCautionLevel,
            profileOk: prof.ok
          });
          setLevelAnalysisLoading(false);
        }
      }

      var params = new URLSearchParams({
        period: 'monthly',
        duration: '60min',
        gender: 'all'
      });
      params.set('uid', uid);
      fetch(
        'https://us-central1-stelvio-ai.cloudfunctions.net/getPeakPowerRanking?' + params.toString(),
        { mode: 'cors' }
      )
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (cancelled) return;
          if (!data || !data.success || !data.byCategory) {
            finishWithPeak(0, 0);
            return;
          }
          var merged = mergePeakRankingEntriesFromByCategory(data.byCategory);
          var entry =
            merged.filter(function (e) {
              return e.userId === uid;
            })[0] || data.currentUser;
          var peakW = entry && Number(entry.watts) > 0 ? Number(entry.watts) : 0;
          var wKg = entry && Number(entry.weightKg) > 0 ? Number(entry.weightKg) : 0;
          finishWithPeak(peakW, wKg);
        })
        .catch(function () {
          if (!cancelled) finishWithPeak(0, 0);
        });

      return function () {
        cancelled = true;
      };
    },
    [rideId, userId, ride && ride.level]
  );

  var inviteRows = useMemo(
    function () {
      return ride ? buildOpenRidingInviteListRows(ride) : [];
    },
    [rideId, ride]
  );

  var _invLab = useState({});
  var inviteResolvedLabels = _invLab[0];
  var setInviteResolvedLabels = _invLab[1];

  useEffect(
    function () {
      if (!ride || !inviteRows.length) {
        setInviteResolvedLabels({});
        return undefined;
      }
      var cancelled = false;
      var pdLocal =
        ride.participantDisplay &&
        typeof ride.participantDisplay === 'object' &&
        !Array.isArray(ride.participantDisplay)
          ? ride.participantDisplay
          : {};
      var seed = {};
      inviteRows.forEach(function (r) {
        if (r.matchedUid) {
          var nm0 = pdLocal[String(r.matchedUid)];
          if (nm0 && String(nm0).trim()) seed[r.phoneKey] = String(nm0).trim();
        }
      });
      setInviteResolvedLabels(seed);

      inviteRows.forEach(function (r) {
        if (cancelled) return;
        if (r.matchedUid && (!seed[r.phoneKey] || !String(seed[r.phoneKey]).trim())) {
          if (typeof window !== 'undefined' && typeof window.getUserByUid === 'function') {
            window
              .getUserByUid(String(r.matchedUid))
              .then(function (row) {
                if (cancelled || !row) return;
                var nm = String(row.name != null ? row.name : row.displayName != null ? row.displayName : '').trim();
                if (nm) {
                  setInviteResolvedLabels(function (prev) {
                    var o = {};
                    for (var ks in prev) o[ks] = prev[ks];
                    o[r.phoneKey] = nm;
                    return o;
                  });
                }
              })
              .catch(function () {});
          }
        } else if (!r.matchedUid && firestore) {
          lookupOpenRidingUserNameByInvitePhone(firestore, r.invitePhone).then(function (nm) {
            if (cancelled || !nm) return;
            setInviteResolvedLabels(function (prev) {
              if (prev[r.phoneKey]) return prev;
              var o = {};
              for (var ks in prev) o[ks] = prev[ks];
              o[r.phoneKey] = nm;
              return o;
            });
          });
        }
      });

      return function () {
        cancelled = true;
      };
    },
    [rideId, ride, firestore, inviteRows]
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
      var res = await svc.cancelRideByHost(firestore, rideId, userId);
      setBombOpen(false);
      if (res && res.deleted) {
        if (typeof onBack === 'function') onBack();
      } else if (typeof reload === 'function') {
        await reload();
      }
    } finally {
      setCancelBusy(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-center text-slate-500">불러오는 중…</div>;
  }
  if (!ride) {
    return (
      <div className="max-w-lg mx-auto py-8 px-4 text-center space-y-4">
        <p className="text-sm text-slate-600 leading-relaxed m-0">
          라이딩을 찾을 수 없거나 삭제되었습니다.
        </p>
        <div className="open-riding-bottom-actions flex justify-center">
          <button
            type="button"
            className="open-riding-action-btn inline-flex items-center justify-center rounded-xl bg-violet-600 text-white font-semibold text-sm px-6 py-2.5 shadow"
            onClick={function () {
              if (typeof onBack === 'function') onBack();
            }}
          >
            목록으로
          </button>
        </div>
        <OpenRidingBottomLogoBar />
      </div>
    );
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

  /* 상세 본문 루트 z-0, 하단 CTA는 고정 로고바보다 낮은 스택(style.css). 수정/취소 행·게스트 상단 추가 여백 없음 */
  return (
    <div
      className={
        'open-riding-detail-content-root max-w-lg mx-auto w-full relative z-0 ' +
        (isHost && !isCancelled ? 'open-riding-detail-content-root--host' : 'open-riding-detail-content-root--guest')
      }
    >
      {isCancelled ? (
        <p className="text-sm font-medium text-red-500 px-1 rounded-lg bg-red-50 border border-red-100 py-2 px-2 m-0">
          이 라이딩은 방장에 의해 폭파(취소)되었습니다. 참가자 개별 안내(알림톡 등)는 추후 연동 예정입니다.
        </p>
      ) : null}

      {isHost && !isCancelled ? (
        <div className="flex justify-end items-center gap-0.5 min-w-0 open-riding-detail-host-actions">
          <button
            type="button"
            className="p-2 rounded-lg hover:bg-gray-100 active:opacity-80 transition-all shrink-0"
            style={{ width: '2.5em', padding: 8, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={onOpenEdit}
            aria-label="라이딩 수정"
          >
            <OpenRidingDashboardEditIcon />
          </button>
          <button
            type="button"
            className="open-riding-header-cancel-btn p-2 rounded-lg hover:bg-violet-100 active:opacity-80 transition-all shrink-0"
            style={{ width: '2.5em', padding: 8, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={function () {
              setBombOpen(true);
            }}
            aria-label="라이딩 취소"
          >
            <img
              src="assets/img/cancel01.png"
              alt=""
              width={22}
              height={22}
              className="block object-contain pointer-events-none"
              decoding="async"
            />
          </button>
        </div>
      ) : null}

      <div className={'open-riding-detail-stat-panel rounded-xl overflow-hidden' + detailMuted}>
        {statRow(
          '제목',
          <span className={'font-semibold text-slate-900 block min-w-0 break-words text-[13px] leading-[1.45] text-left ' + (isCancelled ? 'open-riding-detail-title-cancelled' : '')}>
            {ride.title}
          </span>
        )}
        {statRow('일시', (
          <span>
            {dateStr} {ride.departureTime != null ? ride.departureTime : ''}
          </span>
        ))}
        {statRow('출발 지역', formatOpenRidingDepartureRegionDisplay(ride))}
        {statRow(
          '레벨',
          <div className="min-w-0 w-full space-y-1.5 text-right">
            <div>{formatOpenRidingLevelDetailValue(ride.level)}</div>
            {userId && levelAnalysisLoading ? (
              <div
                className="mt-1 flex w-full max-w-[17rem] flex-col items-end gap-1.5 self-end text-left"
                role="status"
                aria-live="polite"
                aria-label="레벨 분석 중"
              >
                <span
                  className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-emerald-200 border-t-emerald-600 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
                <span className="text-[11px] font-medium text-emerald-800">레벨 분석 중 ...</span>
              </div>
            ) : levelParticipation ? (
              <div
                className={
                  'open-riding-level-participation-hint open-riding-level-participation-hint--' +
                  levelParticipation.tier
                }
              >
                <span className="open-riding-level-participation-label">{levelParticipation.label}</span>
                {detailLevelPeakHint && detailLevelPeakHint.soloSpeedKmh > 0 ? (
                  <div className="open-riding-create-level-peak-hint mt-1 w-full max-w-[17rem] ml-auto rounded-lg border border-emerald-200/70 bg-emerald-50/55 px-2.5 py-2 space-y-1.5 text-[11px] sm:text-xs text-emerald-900 leading-snug text-right">
                    <p className="m-0 font-semibold">
                      나의 평지 항속 능력 :{' '}
                      <span className="tabular-nums font-bold text-emerald-950">
                        {detailLevelPeakHint.soloSpeedKmh} km/h
                      </span>
                    </p>
                    <p className="m-0 text-emerald-900">
                      {detailLevelPeakHint.maxGoLevel ? (
                        <>
                          나의 레벨 :{' '}
                          <strong className="text-emerald-950">{detailLevelPeakHint.maxGoLevel}</strong>
                        </>
                      ) : detailLevelPeakHint.maxCautionLevel ? (
                        <>
                          참석 가능(안정) 구간 없음 · 주의 수준 최고:{' '}
                          <strong className="text-emerald-950">{detailLevelPeakHint.maxCautionLevel}</strong>
                        </>
                      ) : (
                        <span className="text-emerald-800/95">
                          여유가 큰 참석 가능 레벨이 없습니다. 초급·하위 모임을 권장합니다.
                        </span>
                      )}
                    </p>
                  </div>
                ) : userId && detailLevelPeakHint && detailLevelPeakHint.profileOk === false ? (
                  <p className="m-0 mt-1 w-full max-w-[17rem] ml-auto pt-1.5 border-t border-slate-200/80 text-[11px] text-slate-600 leading-snug text-right">
                    프로필에 FTP·체중을 저장하면 평지 개인 평속과 권장 레벨이 표시됩니다.
                  </p>
                ) : null}
              </div>
            ) : userId && detailLevelPeakHint && detailLevelPeakHint.profileOk === false ? (
              <p className="m-0 text-[11px] text-slate-500 leading-snug text-right">
                프로필에 FTP·체중을 저장하면 평지 개인 평속과 권장 레벨이 표시됩니다.
              </p>
            ) : null}
          </div>
        )}
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
        {inviteRows.length > 0
          ? statRow(
              '초대 명단',
              <ul className="open-riding-detail-invite-list m-0 w-full min-w-0 list-none space-y-2 p-0 text-right">
                {inviteRows.map(function (r) {
                  var named = inviteResolvedLabels[r.phoneKey];
                  if (!named || !String(named).trim()) {
                    named = formatOpenRidingInviteFallbackLabel(r.invitePhone, maskContacts);
                  } else {
                    named = String(named).trim();
                  }
                  var st =
                    r.inviteStatus === 'attended'
                      ? '참석'
                      : r.inviteStatus === 'wait'
                        ? '대기'
                        : '미응답';
                  var stCls =
                    r.inviteStatus === 'attended'
                      ? 'text-emerald-700'
                      : r.inviteStatus === 'wait'
                        ? 'text-amber-700'
                        : 'text-slate-500';
                  return (
                    <li key={r.phoneKey} className="break-words">
                      <span className="open-riding-detail-invite-name">{named}</span>
                      <span className={'open-riding-detail-invite-status ml-1 ' + stCls}>({st})</span>
                    </li>
                  );
                })}
              </ul>
            )
          : null}
        {statRow('방장', ride.hostName != null ? ride.hostName : '-')}
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
        {statRow('공개 여부', isPrivateRide ? '비공개 · 초대 또는 입장 비밀번호로 신청' : '공개')}
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
        <h2 className="text-sm font-semibold text-violet-900">참석자 명단</h2>
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
          {isPrivateRide && !isHost && !role && !joinInviteOk ? (
            <p className="text-xs text-amber-800 text-center leading-snug px-1">
              초대된 전화번호와 프로필 연락처가 일치하거나, 방장이 설정한 4자리 비밀번호를 입력해야 참석 신청할 수 있습니다.
            </p>
          ) : null}
          <div className="open-riding-bottom-actions">
            <div className="open-riding-bottom-actions-row flex gap-2">
              {role && !isHost ? (
                <button type="button" className="open-riding-action-btn h-11 inline-flex items-center justify-center flex-1 px-4 border border-red-200 text-red-700 rounded-xl font-medium leading-none" disabled={isActionBusy} onClick={onLeave}>
                  참석 취소
                </button>
              ) : !role && !isHost ? (
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
              ) : null}
            </div>
          </div>
          <OpenRidingBottomLogoBar />
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
          className="open-riding-bomb-modal-backdrop fixed inset-0 z-[10070] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-riding-bomb-title"
          onClick={function () {
            if (!cancelBusy) setBombOpen(false);
          }}
        >
          <div
            className="open-riding-bomb-modal-panel w-full max-w-sm py-7 px-8 text-center"
            onClick={function (e) {
              e.stopPropagation();
            }}
          >
            <div className="flex items-center justify-center gap-2.5 mb-4 pb-4 border-b border-slate-200">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 text-sm font-bold border border-indigo-100"
                aria-hidden
              >
                !
              </span>
              <h2 id="open-riding-bomb-title" className="text-base font-bold text-slate-800 m-0 leading-tight">
                라이딩 취소
              </h2>
            </div>
            <p className="stelvio-exit-confirm-message text-center">정말 라이딩을 취소하시겠습니까?</p>
            <p className="text-xs text-slate-500 mb-5 leading-snug m-0 text-center">참가자 문자·알림톡 일괄 발송은 추후 연동됩니다.</p>
            <div className="stelvio-exit-confirm-buttons">
              <button
                type="button"
                className="open-riding-action-btn stelvio-exit-confirm-btn stelvio-exit-confirm-btn-cancel inline-flex items-center justify-center disabled:opacity-50"
                disabled={cancelBusy}
                onClick={function () {
                  setBombOpen(false);
                }}
              >
                아니오
              </button>
              <button
                type="button"
                className="open-riding-action-btn stelvio-exit-confirm-btn stelvio-exit-confirm-btn-ok inline-flex items-center justify-center disabled:opacity-50"
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

  function handleTopBack() {
    if (view === 'main') {
      if (typeof showScreen === 'function') showScreen('basecampScreen');
    } else if (view === 'filter') {
      setView('main');
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
    view === 'create'
      ? '라이딩 생성'
      : view === 'edit'
        ? '라이딩 수정'
        : view === 'detail'
          ? '라이딩 일정 상세'
          : view === 'filter'
            ? '맞춤 필터 설정'
            : '라이딩 모임';

  var useBottomFixedBar = !!(
    firestore &&
    (view === 'main' ||
      view === 'create' ||
      view === 'filter' ||
      (view === 'edit' && detailRideId) ||
      (view === 'detail' && detailRideId))
  );

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
        filterPageOpen={view === 'filter'}
        onOpenFilterPage={function () { setView('filter'); }}
        onCloseFilterPage={function () { setView('main'); }}
        onOpenCreate={function () { setView('create'); }}
        onSelectRide={function (id) { setDetailRideId(id); setView('detail'); }}
      />
    );
  }

  /* 🚀 투명 레이어 클릭 가로채기 원천 차단: style.css에서 #openRidingRoomScreen.screen.active 이중 스크롤 제거. 본문(#open-riding-app-body)만 세로 스크롤·z-0 */
  return (
    <div className="open-riding-app-root relative z-0">
      <div className="open-riding-inner-header">
        {view === 'detail' ? (
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center w-full min-w-0 flex-1 gap-x-1">
            <div className="flex justify-start min-w-0 shrink-0">
              <button
                type="button"
                className="p-2 rounded-lg hover:bg-gray-100 active:opacity-80 transition-all shrink-0"
                style={{ width: '2.5em', padding: 8, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={handleTopBack}
                aria-label="미니 달력 화면으로"
              >
                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: 24, height: 24, color: '#4b5563' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>
            <h1 className="open-riding-screen-title m-0 min-w-0 px-0.5 text-center truncate" title={headerTitle}>
              {headerTitle}
            </h1>
            <span className="shrink-0 inline-block w-[2.5em]" aria-hidden="true" />
          </div>
        ) : (
          <>
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
            <h1 className="open-riding-screen-title flex-1 text-center m-0">
              {headerTitle}
            </h1>
            <span className="shrink-0 inline-block" style={{ width: '2.5em' }} aria-hidden="true" />
          </>
        )}
      </div>
      {/* 스크롤 전용 본문: pseudo는 pointer-events:none. CTA는 고정바 아래 z-스택(style.css) */}
      <div
        className={
          'open-riding-app-body flex-1 min-h-0 overflow-y-auto px-3 w-full box-border ' +
          (view === 'detail' && detailRideId ? 'open-riding-app-body--riding-detail ' : 'pt-2 ') +
          (useBottomFixedBar ? 'open-riding-app-body--bottom-fixed' : 'pb-[calc(1rem+env(safe-area-inset-bottom,0px))]')
        }
      >
        {inner}
      </div>
      {/* 라이딩 모임(메인 달력): 상세·생성·수정과 동일 스타일의 하단 STELVIO 고정바 — 해당 화면들은 폼 내부에 별도 배치 */}
      {firestore && view === 'main' ? <OpenRidingBottomLogoBar /> : null}
    </div>
  );
}

if (typeof window !== 'undefined') {
  window.OpenRidingCalendarMain = OpenRidingCalendarMain;
  window.OpenRidingCreateForm = OpenRidingCreateForm;
  window.OpenRidingDetail = OpenRidingDetail;
  window.OpenRidingRoomApp = OpenRidingRoomApp;
}

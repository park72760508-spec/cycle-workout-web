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
    isUserPhoneInvitedToRide: svc.isUserPhoneInvitedToRide,
    normalizePackRidingRules: svc.normalizePackRidingRules
  };
}

/** 팩 라이딩 룰 — 텍스트 필드 placeholder(가이드, 입력 비필수) */
var OPEN_RIDING_PACK_TEXT_PLACEHOLDERS = {
  openSection: '업힐 구간만 오픈 후 정상 대기',
  supplySection:
    '1차(출발 후 1시간 후 10분 보급), 2차(반환점, 10분), 3차(라이딩 3시간 후, 15분)',
  fee: '약 1~2만 원 (식사 및 보급 / 1/N 정산)',
  cancelCondition: '모임 2시간 전 기상청 기준 비 예보 시 자동 취소, 신청 인원 0명 미만 시 취소'
};

/** 팩 라이딩 룰 폼 기본값 (생성 폼) */
function openRidingPackRulesFormDefaults() {
  return {
    packRotation: '',
    packNodrop: '',
    packOpenSectionText: '',
    packSupplySectionText: '',
    packFeeText: '',
    packCancelConditionText: '',
    packGearHelmet: false,
    packGearLights: false,
    packGearPuncture: false,
    packGearWater: false,
    packMinorsAllowed: ''
  };
}

/** 수정 폼: ride 문서 → 폼 필드 */
function openRidingApplyPackRulesFromRide(ride) {
  var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
  var n =
    typeof svc.normalizePackRidingRules === 'function'
      ? svc.normalizePackRidingRules(ride && ride.packRidingRules)
      : {
          rotation: '',
          nodrop: '',
          gear: { helmet: false, lights: false, puncture: false, water: false },
          minorsAllowed: '',
          openSectionText: '',
          supplySectionText: '',
          feeText: '',
          cancelConditionText: ''
        };
  return {
    packRotation: n.rotation,
    packNodrop: n.nodrop,
    packOpenSectionText: n.openSectionText != null ? String(n.openSectionText) : '',
    packSupplySectionText: n.supplySectionText != null ? String(n.supplySectionText) : '',
    packFeeText: n.feeText != null ? String(n.feeText) : '',
    packCancelConditionText: n.cancelConditionText != null ? String(n.cancelConditionText) : '',
    packGearHelmet: !!n.gear.helmet,
    packGearLights: !!n.gear.lights,
    packGearPuncture: !!n.gear.puncture,
    packGearWater: !!n.gear.water,
    packMinorsAllowed: n.minorsAllowed
  };
}

/** 상세·폼 공통: packRidingRules 정규화 객체 → 표시용 문구 */
function openRidingPackRulesDisplay(prNorm) {
  var pr = prNorm || {};
  var rot =
    pr.rotation === 'maalseon'
      ? '방장 말선'
      : pr.rotation === 'rotation'
        ? '순환 로테이션(가능한 사람에 한함)'
        : '';
  var nd =
    pr.nodrop === 'together'
      ? '끝까지 챙겨서 가기'
      : pr.nodrop === 'ownpace'
        ? '각자 페이스대로 타고 목적지에 도착'
        : '';
  var g = pr.gear && typeof pr.gear === 'object' ? pr.gear : {};
  var gearLines = [];
  if (g.helmet) gearLines.push('헬멧(미착용 참석 불가)');
  if (g.lights) gearLines.push('전/후미등');
  if (g.puncture) gearLines.push('펑크 대비 용품');
  if (g.water) gearLines.push('식수/개인용');
  var minors =
    pr.minorsAllowed === 'yes' ? '예' : pr.minorsAllowed === 'no' ? '아니오' : '';
  return {
    rot: rot,
    nodrop: nd,
    gearLines: gearLines,
    minors: minors,
    openSectionText: String(pr.openSectionText != null ? pr.openSectionText : '').trim(),
    supplySectionText: String(pr.supplySectionText != null ? pr.supplySectionText : '').trim(),
    feeText: String(pr.feeText != null ? pr.feeText : '').trim(),
    cancelConditionText: String(pr.cancelConditionText != null ? pr.cancelConditionText : '').trim()
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

/** 방장 폼 자리표시어 — Firestore에 저장되면 상세에서 실명 대신 이 문자열만 보임 */
function isOpenRidingInvitePlaceholderDisplayName(name) {
  var s = String(name != null ? name : '').trim();
  if (!s) return true;
  if (s === '초대') return true;
  return false;
}

/** 프로필 DB·getUserByUid로 덮어써도 되는 임시 표기(끝자리·폴백 등) */
function isOpenRidingInviteWeakDisplayName(name) {
  if (isOpenRidingInvitePlaceholderDisplayName(name)) return true;
  var s = String(name != null ? name : '').trim();
  if (!s) return true;
  if (s === '초대 회원') return true;
  if (s === '초대 대상') return true;
  if (s.indexOf('초대 대상 ·') === 0) return true;
  if (s.indexOf('끝자리 ') === 0) return true;
  return false;
}

/** inviteDisplayByPhone: 방장·참석 병합 맵에서 행 키로 표시명 (키 표기·앞자리 차이 보정) */
function openRidingResolveInviteDisplayByPhoneKey(idp, rowKey, normFn) {
  if (!idp || typeof idp !== 'object' || !rowKey || String(rowKey).length < 8) return '';
  var rk = String(rowKey);
  var direct =
    idp[rk] != null ? String(idp[rk]).trim() : idp[String(rk)] != null ? String(idp[String(rk)]).trim() : '';
  if (direct && !isOpenRidingInvitePlaceholderDisplayName(direct)) return direct;
  var ik;
  for (ik in idp) {
    if (!Object.prototype.hasOwnProperty.call(idp, ik)) continue;
    var nik = normFn(ik);
    if (nik === rk || (nik.length >= 8 && rk.length >= 8 && nik.slice(-8) === rk.slice(-8))) {
      var lab = String(idp[ik] != null ? idp[ik] : '').trim();
      if (lab && !isOpenRidingInvitePlaceholderDisplayName(lab)) return lab;
    }
  }
  return '';
}

/** inviteDisplayByPhone 저장값 → 목록 표시명 (형식 "주소록/users이름"이면 users이름) */
function openRidingInviteDisplayLabelForUi(storedValue) {
  var s = String(storedValue != null ? storedValue : '').trim();
  if (!s) return '';
  var i = s.indexOf('/');
  if (i >= 0) {
    var after = s.slice(i + 1).trim();
    if (after) return after;
    return s.slice(0, i).trim();
  }
  return s;
}

function openRidingInviteStoredMatchesParticipant(invLabel, pdName) {
  var p = String(pdName || '').trim();
  if (!p) return false;
  var inv = String(invLabel || '').trim();
  if (!inv) return false;
  if (inv === p) return true;
  if (openRidingInviteDisplayLabelForUi(inv) === p) return true;
  var slash = inv.indexOf('/');
  var loc = slash >= 0 ? inv.slice(0, slash).trim() : inv;
  if (loc === p) return true;
  return false;
}

/** 방장 문서 병합: 프로필 조회명을 "주소록/실명" 형태로 맞춤 */
function openRidingComposeInviteDisplayStoredValue(cur, firebaseResolvedName) {
  var nm = String(firebaseResolvedName != null ? firebaseResolvedName : '').trim();
  if (!nm || isOpenRidingInviteWeakDisplayName(nm)) return null;
  var curS = String(cur != null ? cur : '').trim();
  if (!curS || isOpenRidingInvitePlaceholderDisplayName(curS)) return nm.slice(0, 40);
  var slash = curS.indexOf('/');
  if (slash >= 0) {
    var fbPart = curS.slice(slash + 1).trim();
    var locPart = curS.slice(0, slash).trim();
    if (fbPart === nm || curS === nm || locPart === nm) return null;
    return (locPart && locPart !== nm ? locPart + '/' + nm : nm).slice(0, 40);
  }
  if (curS === nm) return null;
  return (curS !== nm ? curS + '/' + nm : curS).slice(0, 40);
}

/**
 * 초대 전화 키 → UID (participantContact + inviteJoinedUidByPhone 통합, 뒤 8자리 보조)
 * 비방장도 문서에 participantContact 전체가 오면 매칭 가능하고, 없으면 inviteJoinedUidByPhone에 의존
 */
function buildOpenRidingPhoneKeyToUidMap(ride, part, wait, pc, normFn) {
  var out = {};
  var i;
  var idx;
  var candUids = [];
  for (i = 0; i < part.length; i++) candUids.push(String(part[i]));
  for (i = 0; i < wait.length; i++) candUids.push(String(wait[i]));
  for (idx = 0; idx < candUids.length; idx++) {
    var uid = candUids[idx];
    var ph = pc[uid] != null ? String(pc[uid]) : '';
    if (!ph) continue;
    var pk = normFn(ph);
    if (pk.length >= 8) out[pk] = uid;
  }
  var iju = ride && ride.inviteJoinedUidByPhone;
  if (iju && typeof iju === 'object') {
    var k2;
    for (k2 in iju) {
      if (!Object.prototype.hasOwnProperty.call(iju, k2)) continue;
      var nk = normFn(k2);
      var u = String(iju[k2] || '').trim();
      if (nk.length >= 8 && u) out[nk] = u;
    }
  }
  return out;
}

function lookupUidFromPhoneKeyMap(map, rowKey) {
  var rk = String(rowKey);
  if (!rk || rk.length < 8) return null;
  if (map[rk]) return map[rk];
  var mk;
  for (mk in map) {
    if (!Object.prototype.hasOwnProperty.call(map, mk)) continue;
    if (mk === rk) return map[mk];
    if (rk.length >= 8 && mk.length >= 8 && mk.slice(-8) === rk.slice(-8)) return map[mk];
  }
  return null;
}

/**
 * 초대 명단 표시용 행 (전화 정규화 키, participantContact + inviteJoinedUidByPhone 통합 UID 매칭)
 * 초대된 전화는 모두 포함; 참석·대기·미응답(none) 구분.
 */
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
  var phoneKeyToUid = buildOpenRidingPhoneKeyToUidMap(ride, part, wait, pc, normFn);
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
    var matchedUid = lookupUidFromPhoneKeyMap(phoneKeyToUid, key);
    /** inviteDisplayByPhone 표시명과 participantDisplay 실명 일치로 UID 보정 (맵만으로 부족할 때) */
    if (!matchedUid && ride.inviteDisplayByPhone && typeof ride.inviteDisplayByPhone === 'object') {
      var invLabel = openRidingResolveInviteDisplayByPhoneKey(ride.inviteDisplayByPhone, key, normFn);
      if (invLabel) {
        var pdMap =
          ride.participantDisplay && typeof ride.participantDisplay === 'object' && !Array.isArray(ride.participantDisplay)
            ? ride.participantDisplay
            : {};
        var cand2 = part.concat(wait);
        var cj;
        for (cj = 0; cj < cand2.length; cj++) {
          var cuid2 = String(cand2[cj]);
          var pdName2 = pdMap[cuid2] != null ? String(pdMap[cuid2]).trim() : '';
          if (pdName2 && openRidingInviteStoredMatchesParticipant(invLabel, pdName2)) {
            matchedUid = cuid2;
            break;
          }
        }
      }
    }
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

/** 초대 명단: 실명 없을 때 행 구분용(끝 4자리) — 일정 지난 뒤에는 번호 일부도 표시하지 않음 */
function formatOpenRidingInviteFallbackLabel(phoneRaw, maskedMode) {
  if (maskedMode) return '초대 대상';
  var d = String(phoneRaw != null ? phoneRaw : '').replace(/\D/g, '');
  if (d.length >= 4) return '초대 대상 · ' + d.slice(-4);
  return '초대 회원';
}

/** 방장 폼 inviteSelected → Firestore inviteDisplayByPhone 맵 */
function buildOpenRidingInviteDisplayMap(inviteSelected) {
  var out = {};
  var norm =
    typeof window !== 'undefined' &&
    window.openRidingService &&
    typeof window.openRidingService.normalizePhoneDigits === 'function'
      ? window.openRidingService.normalizePhoneDigits
      : function (s) {
          return String(s || '').replace(/\D/g, '');
        };
  (inviteSelected || []).forEach(function (x) {
    if (!x) return;
    var k = norm(x.phone);
    var nm = x.name != null ? String(x.name).trim() : '';
    if (isOpenRidingInvitePlaceholderDisplayName(nm)) nm = '';
    if (k.length >= 8 && nm) out[k] = nm.slice(0, 40);
  });
  return out;
}

/**
 * 상세 초대 명단 한 줄 표시명: inviteDisplayByPhone(주소록/users)의 users 측 → 조회 캐시 → 본인 → 폴백
 */
function getOpenRidingInviteRowDisplayName(r, ride, inviteResolvedLabels, maskContacts, myPhoneForInvite, viewerUserId) {
  var key = r.phoneKey;
  var normFnDl =
    typeof window !== 'undefined' &&
    window.openRidingService &&
    typeof window.openRidingService.normalizePhoneDigits === 'function'
      ? window.openRidingService.normalizePhoneDigits
      : function (x) {
          return String(x || '').replace(/\D/g, '');
        };
  var idpMap =
    ride && ride.inviteDisplayByPhone && typeof ride.inviteDisplayByPhone === 'object' && !Array.isArray(ride.inviteDisplayByPhone)
      ? ride.inviteDisplayByPhone
      : null;
  if (idpMap) {
    var rawIdp = openRidingResolveInviteDisplayByPhoneKey(idpMap, key, normFnDl);
    var fromIdpUi = openRidingInviteDisplayLabelForUi(rawIdp);
    if (fromIdpUi && !isOpenRidingInviteWeakDisplayName(fromIdpUi) && !isOpenRidingInvitePlaceholderDisplayName(fromIdpUi)) {
      return fromIdpUi;
    }
  }

  var fromSeed = inviteResolvedLabels[key];
  if (fromSeed && String(fromSeed).trim() && !isOpenRidingInviteWeakDisplayName(fromSeed)) return String(fromSeed).trim();

  var uidStr = viewerUserId != null ? String(viewerUserId) : '';
  if (uidStr && r.matchedUid && String(r.matchedUid) === uidStr) {
    var profUid = getOpenRidingProfileDefaults();
    var selfByUid = profUid.hostName && String(profUid.hostName).trim();
    if (selfByUid) return selfByUid;
  }

  if (myPhoneForInvite && openRidingInvitePhoneDigitsMatch(myPhoneForInvite, r.invitePhone)) {
    var prof = getOpenRidingProfileDefaults();
    var selfName = prof.hostName && String(prof.hostName).trim();
    if (selfName) return selfName;
  }

  return formatOpenRidingInviteFallbackLabel(r.invitePhone, maskContacts);
}

/**
 * 베이스캠프에 로드된 users / userProfiles 에서 UID 또는 연락처로 이름 조회
 */
function resolveOpenRidingInviteNameFromLocalUsers(matchedUid, invitePhone) {
  var uid = matchedUid != null ? String(matchedUid) : '';
  var normSvc =
    typeof window !== 'undefined' &&
    window.openRidingService &&
    typeof window.openRidingService.normalizePhoneDigits === 'function'
      ? window.openRidingService.normalizePhoneDigits
      : function (x) {
          return String(x || '').replace(/\D/g, '');
        };
  var normInvite = normSvc(invitePhone);
  var fmtDb =
    typeof window !== 'undefined' && typeof window.formatPhoneForDB === 'function'
      ? window.formatPhoneForDB(String(invitePhone || '').trim())
      : '';
  var lists = [];
  if (typeof window !== 'undefined') {
    if (Array.isArray(window.users)) lists.push(window.users);
    if (Array.isArray(window.userProfiles)) lists.push(window.userProfiles);
  }
  var li;
  var i;
  var u;
  var nm;
  for (li = 0; li < lists.length; li++) {
    for (i = 0; i < lists[li].length; i++) {
      u = lists[li][i];
      if (!u) continue;
      if (uid && String(u.id) === uid) {
        nm = String(u.name != null ? u.name : u.displayName != null ? u.displayName : '').trim();
        if (nm) return nm;
      }
    }
  }
  for (li = 0; li < lists.length; li++) {
    for (i = 0; i < lists[li].length; i++) {
      u = lists[li][i];
      if (!u) continue;
      var c = String(u.contact != null ? u.contact : '').trim();
      if (!c) continue;
      var nd = normSvc(c);
      var fmtC =
        typeof window.formatPhoneForDB === 'function' ? window.formatPhoneForDB(c) : '';
      var phoneMatch =
        (normInvite &&
          nd &&
          (nd === normInvite ||
            (nd.length >= 8 && normInvite.length >= 8 && nd.slice(-8) === normInvite.slice(-8)))) ||
        (fmtDb && fmtC && fmtDb === fmtC);
      if (phoneMatch) {
        nm = String(u.name != null ? u.name : u.displayName != null ? u.displayName : '').trim();
        if (nm) return nm;
      }
    }
  }
  return '';
}

/** 전화번호 후보(프로필 DB contact·phone 등과 동일 형식으로 맞춤) */
function buildOpenRidingPhoneLookupCandidates(invitePhone) {
  var raw = String(invitePhone != null ? invitePhone : '').trim();
  var norm =
    typeof window !== 'undefined' &&
    window.openRidingService &&
    typeof window.openRidingService.normalizePhoneDigits === 'function'
      ? window.openRidingService.normalizePhoneDigits(invitePhone)
      : String(invitePhone || '').replace(/\D/g, '');
  var candidates = [];
  function add(x) {
    var s = x != null ? String(x).trim() : '';
    if (s && candidates.indexOf(s) < 0) candidates.push(s);
  }
  /** users.contact 등에 흔한 표기(예: "010-9135-4272") — 쿼리 == 일치용 */
  function addKoreanDialVariants(digits) {
    var d = String(digits || '').replace(/\D/g, '');
    if (d.length < 10) return;
    if (d.length === 11 && d.indexOf('010') === 0) {
      add(d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7, 11));
      add(d.slice(0, 3) + ' ' + d.slice(3, 7) + ' ' + d.slice(7, 11));
      var rest11 = d.slice(3);
      add('+82-10-' + rest11.slice(0, 4) + '-' + rest11.slice(4, 8));
      add('+82 10-' + rest11.slice(0, 4) + '-' + rest11.slice(4, 8));
    }
    if (d.length === 11 && d.indexOf('011') === 0) {
      add(d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7, 11));
    }
    if (d.length === 10 && d.charAt(0) === '0') {
      add(d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6, 10));
      add(d.slice(0, 2) + '-' + d.slice(2, 6) + '-' + d.slice(6, 10));
    }
  }
  if (typeof window.formatPhoneForDB === 'function') {
    if (raw) add(window.formatPhoneForDB(raw));
    if (norm) add(window.formatPhoneForDB(norm));
  }
  if (typeof window.formatPhoneNumber === 'function' && norm) {
    add(window.formatPhoneNumber(norm));
  }
  if (norm) {
    add(norm);
    addKoreanDialVariants(norm);
  }
  if (norm && norm.length >= 10 && norm.charAt(0) === '0') {
    add('82' + norm.slice(1));
    add('+82' + norm.slice(1));
  }
  return { norm: norm, candidates: candidates };
}

/**
 * 초대 전화 → 표시 이름: 1) Firestore users (contact·phone·phoneNumber·tel) 2) 메모리 users/userProfiles
 * 규칙상 타인 문서 조회는 전화 필드 일치 문서에 한해 허용됨(docs/firestore.rules).
 */
function lookupOpenRidingUserNameByInvitePhone(firestoreDb, invitePhone) {
  if (!invitePhone) return Promise.resolve('');
  if (!firestoreDb) {
    return Promise.resolve(resolveOpenRidingInviteNameFromLocalUsers('', invitePhone) || '');
  }
  var info = buildOpenRidingPhoneLookupCandidates(invitePhone);
  if (!info.norm || info.norm.length < 8) {
    return Promise.resolve(resolveOpenRidingInviteNameFromLocalUsers('', invitePhone) || '');
  }
  var candidates = info.candidates;
  if (candidates.length === 0) {
    return Promise.resolve(resolveOpenRidingInviteNameFromLocalUsers('', invitePhone) || '');
  }
  return import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js')
    .then(function (mod) {
      var col = mod.collection(firestoreDb, 'users');
      var fields = ['contact', 'phone', 'phoneNumber', 'tel'];

      function tryField(fieldIdx, candIdx) {
        if (fieldIdx >= fields.length) return Promise.resolve('');
        if (candIdx >= candidates.length) return tryField(fieldIdx + 1, 0);
        var field = fields[fieldIdx];
        var q = mod.query(col, mod.where(field, '==', candidates[candIdx]), mod.limit(1));
        return mod
          .getDocs(q)
          .then(function (snap) {
            if (!snap.empty) {
              var data = snap.docs[0].data();
              var nm = String((data && data.name) || (data && data.displayName) || '').trim();
              if (nm) return nm;
            }
            return tryField(fieldIdx, candIdx + 1);
          })
          .catch(function () {
            return tryField(fieldIdx, candIdx + 1);
          });
      }
      return tryField(0, 0);
    })
    .then(function (fromFs) {
      if (fromFs && String(fromFs).trim()) return String(fromFs).trim();
      return resolveOpenRidingInviteNameFromLocalUsers('', invitePhone) || '';
    })
    .catch(function () {
      return resolveOpenRidingInviteNameFromLocalUsers('', invitePhone) || '';
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
            var wLv = peak60Watts > 0 && peakWeightKg > 0 ? peakWeightKg : prof.weight;
            var refSoloFn =
              typeof window !== 'undefined' && typeof window.getFilterInterestReferenceSoloSpeedKmH === 'function'
                ? window.getFilterInterestReferenceSoloSpeedKmH
                : null;
            var intClsFn =
              typeof window !== 'undefined' && typeof window.classifyOpenRidingInterestLevelFilter === 'function'
                ? window.classifyOpenRidingInterestLevelFilter
                : null;
            var refSolo =
              refSoloFn && prof.ok && wLv > 0 ? refSoloFn(peak60Watts, prof.ftp, wLv) : null;
            var part =
              intClsFn && refSolo != null && refSolo > 0 ? intClsFn(refSolo, opt.value) : null;
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
                ? 'FTP·체중을 입력하면 참조 평지 개인 평속(60분 피크, 없으면 FTP 평속×93%)으로 관심 레벨을 판별합니다.'
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
              관심 레벨 판별: 평지 개인 평속(60분 피크 우선, 없으면 FTP×93%) · 구간은 초급~상급 항속 기준
            </span>
          </div>
          {!prof.ok ? (
            <p className="text-xs text-slate-600 m-0 leading-relaxed">
              프로필에 <strong>FTP</strong>와 <strong>체중</strong>을 입력하면, 관심 레벨 배지는
              <strong> 평지 개인 평속(60분 피크·없으면 FTP 평속×93%)</strong>으로 초급~상급 항속 구간과 비교합니다.
              아래 분포·그룹 평속은 참고용입니다.
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
                관심 레벨 배지는 <strong className="text-slate-600">60분 피크 평지 평속</strong>이 없을 때만
                <strong className="text-slate-600"> FTP 평지 평속의 93%</strong>를 참조 속도로 씁니다.
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
              openRidingTierBandWeightKg={
                peakWeightKg > 0 ? peakWeightKg : prof.ok && Number(prof.weight) > 0 ? Number(prof.weight) : null
              }
              titleOverride="전체 사용자 60분 W/kg 분포"
              pillLabelOverride="전체 · 60분 W/kg · 최근 30일"
              chartSubNoteOverride={false}
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
    return Object.assign(
      {
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
      },
      openRidingPackRulesFormDefaults()
    );
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

  /** Firestore 친구 목록 → 초대 후보(invitePending)에 병합 */
  useEffect(
    function () {
      if (!firestore || !hostUserId) return undefined;
      var fr = typeof window !== 'undefined' ? window.openRidingFriendsService || {} : {};
      if (typeof fr.loadFriendsForInviteMerge !== 'function') return undefined;
      var cancelled = false;
      fr.loadFriendsForInviteMerge(firestore, String(hostUserId).trim())
        .then(function (rows) {
          if (cancelled || !rows || !rows.length) return;
          setForm(function (f) {
            var pending = (f.invitePending || []).slice();
            var keysP = {};
            pending.forEach(function (p) {
              keysP[p.key] = true;
            });
            (f.inviteSelected || []).forEach(function (s) {
              keysP[s.key] = true;
            });
            var added = false;
            rows.forEach(function (row) {
              if (!row || !row.key || keysP[row.key]) return;
              keysP[row.key] = true;
              pending.push({ name: row.name, phone: row.phone, key: row.key });
              added = true;
            });
            if (!added) return f;
            var n = {};
            for (var k in f) n[k] = f[k];
            n.invitePending = pending;
            return n;
          });
        })
        .catch(function () {});
      return function () {
        cancelled = true;
      };
    },
    [firestore, hostUserId]
  );

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
          var idp =
            ride.inviteDisplayByPhone &&
            typeof ride.inviteDisplayByPhone === 'object' &&
            !Array.isArray(ride.inviteDisplayByPhone)
              ? ride.inviteDisplayByPhone
              : {};
          var inviteSelected = il.map(function (phone) {
            var p = String(phone != null ? phone : '');
            var k = normFn(p);
            var nm = idp[k] && String(idp[k]).trim() ? String(idp[k]).trim() : '';
            if (isOpenRidingInvitePlaceholderDisplayName(nm)) nm = '';
            if (!nm && k.length >= 4) {
              nm = '끝자리 ' + k.slice(-4);
            } else if (!nm) {
              nm = '초대 대상';
            }
            return { name: nm, phone: p, key: k };
          });
          setForm(
            Object.assign(
              {
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
              },
              openRidingApplyPackRulesFromRide(ride)
            )
          );
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
      checkList.push('모임명을 입력해 주세요.');
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
      var packRidingRulesPayload = {
        rotation: form.packRotation,
        nodrop: form.packNodrop,
        gear: {
          helmet: !!form.packGearHelmet,
          lights: !!form.packGearLights,
          puncture: !!form.packGearPuncture,
          water: !!form.packGearWater
        },
        minorsAllowed: form.packMinorsAllowed,
        openSectionText: form.packOpenSectionText,
        supplySectionText: form.packSupplySectionText,
        feeText: form.packFeeText,
        cancelConditionText: form.packCancelConditionText
      };
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
          inviteDisplayByPhone: buildOpenRidingInviteDisplayMap(form.inviteSelected),
          rideJoinPassword: form.isPrivate ? String(form.rideJoinPassword || '').replace(/\D/g, '').slice(0, 4) : '',
          packRidingRules: packRidingRulesPayload
        });
        try {
          var svcEn0 = typeof window !== 'undefined' ? window.openRidingService || {} : {};
          if (
            typeof svcEn0.enrichInviteDisplayByPhoneFromUsers === 'function' &&
            ((form.inviteSelected && form.inviteSelected.length) || 0) > 0
          ) {
            await svcEn0.enrichInviteDisplayByPhoneFromUsers(firestore, editRideId, String(hostUserId).trim());
          }
        } catch (eEn0) {
          console.warn('[OpenRiding] 초대 표시 users 병합(수정) 실패:', eEn0 && eEn0.message ? eEn0.message : eEn0);
        }
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
        inviteDisplayByPhone: buildOpenRidingInviteDisplayMap(form.inviteSelected),
        rideJoinPassword: form.isPrivate ? String(form.rideJoinPassword || '').replace(/\D/g, '').slice(0, 4) : '',
        packRidingRules: packRidingRulesPayload,
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
        try {
          if (
            typeof svcJoin.enrichInviteDisplayByPhoneFromUsers === 'function' &&
            ((form.inviteSelected && form.inviteSelected.length) || 0) > 0
          ) {
            await svcJoin.enrichInviteDisplayByPhoneFromUsers(firestore, rideId, String(hostUserId).trim());
          }
        } catch (eEn1) {
          console.warn('[OpenRiding] 초대 표시 users 병합(생성) 실패:', eEn1 && eEn1.message ? eEn1.message : eEn1);
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
      <label className="block font-medium text-slate-700">모임명<input className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={form.title} onChange={function (e) { set('title', e.target.value); }} /></label>

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

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 m-0">운영 방식 (팩 라이딩 룰)</h3>
          <p className="text-xs text-slate-500 m-0 mt-1 leading-relaxed">
            아래 운영 방식은 필수 조건은 아니며 옵션 조건으로 빈 값 허용 됩니다.
          </p>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-semibold text-slate-700 block">로테이션 방식</span>
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="openRidingPackRot"
              className="mt-0.5 shrink-0"
              checked={form.packRotation === ''}
              onChange={function () { set('packRotation', ''); }}
            />
            <span>선택 안 함</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="openRidingPackRot"
              className="mt-0.5 shrink-0"
              checked={form.packRotation === 'maalseon'}
              onChange={function () { set('packRotation', 'maalseon'); }}
            />
            <span>방장 말선</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="openRidingPackRot"
              className="mt-0.5 shrink-0"
              checked={form.packRotation === 'rotation'}
              onChange={function () { set('packRotation', 'rotation'); }}
            />
            <span>순환 로테이션(가능한 사람에 한함)</span>
          </label>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-semibold text-slate-700 block">노드랍 팩라이딩</span>
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="openRidingPackNd"
              className="mt-0.5 shrink-0"
              checked={form.packNodrop === ''}
              onChange={function () { set('packNodrop', ''); }}
            />
            <span>선택 안 함</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="openRidingPackNd"
              className="mt-0.5 shrink-0"
              checked={form.packNodrop === 'together'}
              onChange={function () { set('packNodrop', 'together'); }}
            />
            <span>끝까지 챙겨서 가기</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="openRidingPackNd"
              className="mt-0.5 shrink-0"
              checked={form.packNodrop === 'ownpace'}
              onChange={function () { set('packNodrop', 'ownpace'); }}
            />
            <span>각자 페이스대로 타고 목적지에 도착</span>
          </label>
        </div>

        <label className="block text-xs font-semibold text-slate-700">
          오픈(Open) 구간
          <textarea
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 placeholder:font-normal"
            rows={2}
            placeholder={OPEN_RIDING_PACK_TEXT_PLACEHOLDERS.openSection}
            value={form.packOpenSectionText}
            onChange={function (e) { set('packOpenSectionText', e.target.value); }}
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          보급 구간
          <textarea
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 placeholder:font-normal"
            rows={2}
            placeholder={OPEN_RIDING_PACK_TEXT_PLACEHOLDERS.supplySection}
            value={form.packSupplySectionText}
            onChange={function (e) { set('packSupplySectionText', e.target.value); }}
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          회비
          <input
            type="text"
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 placeholder:font-normal"
            placeholder={OPEN_RIDING_PACK_TEXT_PLACEHOLDERS.fee}
            value={form.packFeeText}
            onChange={function (e) { set('packFeeText', e.target.value); }}
          />
        </label>

        <div className="space-y-2">
          <span className="text-xs font-semibold text-slate-700 block">필수 준비물 (체크)</span>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 accent-violet-600"
              checked={!!form.packGearHelmet}
              onChange={function (e) { set('packGearHelmet', e.target.checked); }}
            />
            <span>헬멧(미착용 참석 불가)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 accent-violet-600"
              checked={!!form.packGearLights}
              onChange={function (e) { set('packGearLights', e.target.checked); }}
            />
            <span>전/후미등</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 accent-violet-600"
              checked={!!form.packGearPuncture}
              onChange={function (e) { set('packGearPuncture', e.target.checked); }}
            />
            <span>펑크 대비 용품</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 accent-violet-600"
              checked={!!form.packGearWater}
              onChange={function (e) { set('packGearWater', e.target.checked); }}
            />
            <span>식수/개인용</span>
          </label>
        </div>

        <label className="block text-xs font-semibold text-slate-700">
          모임 취소 조건
          <textarea
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 placeholder:font-normal"
            rows={2}
            placeholder={OPEN_RIDING_PACK_TEXT_PLACEHOLDERS.cancelCondition}
            value={form.packCancelConditionText}
            onChange={function (e) { set('packCancelConditionText', e.target.value); }}
          />
        </label>

        <div className="space-y-2">
          <span className="text-xs font-semibold text-slate-700 block">미성년자 참석 가능 여부</span>
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="openRidingPackMinors"
              className="mt-0.5 shrink-0"
              checked={form.packMinorsAllowed === ''}
              onChange={function () { set('packMinorsAllowed', ''); }}
            />
            <span>선택 안 함</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="openRidingPackMinors"
              className="mt-0.5 shrink-0"
              checked={form.packMinorsAllowed === 'yes'}
              onChange={function () { set('packMinorsAllowed', 'yes'); }}
            />
            <span>예</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="openRidingPackMinors"
              className="mt-0.5 shrink-0"
              checked={form.packMinorsAllowed === 'no'}
              onChange={function () { set('packMinorsAllowed', 'no'); }}
            />
            <span>아니오</span>
          </label>
        </div>
      </div>

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
function OpenRidingDashboardEditIcon(props) {
  var p = props || {};
  var cls = typeof p.className === 'string' && p.className.trim() ? p.className.trim() : 'w-6 h-6 text-gray-600';
  return (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
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
  /** hooks·초대 명단 동기화에서 사용 (조건부 return 이전에 계산) */
  var isHost = !!(
    userId &&
    ride &&
    String(ride.hostUserId != null ? ride.hostUserId : '').trim() === String(userId != null ? userId : '').trim()
  );
  var hostIdpSyncTmRef = useRef(null);

  var _actBusy = useState(false);
  var isActionBusy = _actBusy[0];
  var setBusy = _actBusy[1];
  var _bomb = useState(false);
  var bombOpen = _bomb[0];
  var setBombOpen = _bomb[1];
  var _delM = useState(false);
  var deleteModalOpen = _delM[0];
  var setDeleteModalOpen = _delM[1];
  var _delBusy = useState(false);
  var deleteBusy = _delBusy[0];
  var setDeleteBusy = _delBusy[1];
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
  var _invListExp = useState(false);
  var inviteListExpanded = _invListExp[0];
  var setInviteListExpanded = _invListExp[1];
  var _opRulesExp = useState(false);
  var operationRulesExpanded = _opRulesExp[0];
  var setOperationRulesExpanded = _opRulesExp[1];
  var _partListExp = useState(false);
  var participantListExpanded = _partListExp[0];
  var setParticipantListExpanded = _partListExp[1];

  useEffect(
    function () {
      setJoinPasswordInput('');
      setJoinShareModalOpen(false);
      setDeleteModalOpen(false);
      setInviteListExpanded(false);
      setOperationRulesExpanded(false);
      setParticipantListExpanded(false);
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

      function finishWithPeak(peakW, wKg) {
        var ww =
          Number(peakW) > 0 && Number(wKg) > 0 ? Number(wKg) : prof.ok ? prof.weight : 0;
        var usedPeak = Number(peakW) > 0;
        var refSoloFn =
          typeof window !== 'undefined' && typeof window.getFilterInterestReferenceSoloSpeedKmH === 'function'
            ? window.getFilterInterestReferenceSoloSpeedKmH
            : null;
        var intClsFn =
          typeof window !== 'undefined' && typeof window.classifyOpenRidingInterestLevelFilter === 'function'
            ? window.classifyOpenRidingInterestLevelFilter
            : null;
        var tierLblFn =
          typeof window !== 'undefined' && typeof window.getOpenRidingSoloTierLevelLabelFromKmH === 'function'
            ? window.getOpenRidingSoloTierLevelLabelFromKmH
            : null;
        var refSolo =
          refSoloFn && prof.ok && ww > 0 ? refSoloFn(Number(peakW) > 0 ? Number(peakW) : 0, prof.ftp, ww) : null;
        var part =
          intClsFn && refSolo != null && refSolo > 0 && levelStr
            ? intClsFn(refSolo, levelStr)
            : null;
        var myTier =
          tierLblFn && refSolo != null && refSolo > 0 ? tierLblFn(refSolo) : null;
        if (!cancelled) {
          setLevelParticipation(part);
          setDetailLevelPeakHint({
            refSoloKmh: refSolo,
            usedPeak: !!usedPeak,
            usedFtpFallback: !!(prof.ok && !usedPeak && Number(prof.ftp) > 0 && refSolo != null),
            myTierLabel: myTier,
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

  var inviteAttendedCount = useMemo(
    function () {
      var n = 0;
      var i;
      for (i = 0; i < inviteRows.length; i++) {
        if (inviteRows[i].inviteStatus === 'attended') n++;
      }
      return n;
    },
    [inviteRows]
  );
  var inviteTotalCount = inviteRows.length;

  var packRulesNorm = useMemo(
    function () {
      if (!ride) return null;
      var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
      if (typeof svc.normalizePackRidingRules === 'function') {
        return svc.normalizePackRidingRules(ride.packRidingRules);
      }
      return {
        rotation: '',
        nodrop: '',
        gear: { helmet: false, lights: false, puncture: false, water: false },
        minorsAllowed: '',
        openSectionText: '',
        supplySectionText: '',
        feeText: '',
        cancelConditionText: ''
      };
    },
    [rideId, ride]
  );

  var packRulesDisp = useMemo(
    function () {
      return packRulesNorm ? openRidingPackRulesDisplay(packRulesNorm) : null;
    },
    [packRulesNorm]
  );

  var _invLab = useState({});
  var inviteResolvedLabels = _invLab[0];
  var setInviteResolvedLabels = _invLab[1];

  useEffect(
    function () {
      var hasAppliedForInvite =
        role === 'participant' || (role && typeof role === 'object' && role.type === 'waitlist');
      /** 참가 미신청·비방장은 초대 명단 미표시 — 조회·시드 생략 */
      if (!ride || !inviteRows.length || (!isHost && !hasAppliedForInvite)) {
        setInviteResolvedLabels({});
        return undefined;
      }
      var cancelled = false;
      /** 시드: 메모리 캐시만(빠른 1프레임). 본 이름은 getUserByUid·Firestore users 전화 조회로 덮어씀 */
      var seed = {};
      inviteRows.forEach(function (r) {
        var nm = resolveOpenRidingInviteNameFromLocalUsers(r.matchedUid, r.invitePhone);
        if (nm) seed[r.phoneKey] = nm;
      });
      setInviteResolvedLabels(seed);

      function mergeInviteName(phoneKey, nm) {
        if (cancelled || !nm || !String(nm).trim()) return;
        var finalNm = String(nm).trim();
        setInviteResolvedLabels(function (prev) {
          var o = {};
          for (var ks in prev) o[ks] = prev[ks];
          o[phoneKey] = finalNm;
          return o;
        });
      }

      inviteRows.forEach(function (r) {
        if (cancelled) return;

        function tryUidFallback() {
          if (!r.matchedUid || typeof window === 'undefined' || typeof window.getUserByUid !== 'function') return;
          window
            .getUserByUid(String(r.matchedUid))
            .then(function (row) {
              if (cancelled) return;
              var nm = row
                ? String(row.name != null ? row.name : row.displayName != null ? row.displayName : '').trim()
                : '';
              if (nm) mergeInviteName(r.phoneKey, nm);
            })
            .catch(function () {});
        }

        /** 1) users.contact·phone 등 형식(하이픈 포함)으로 Firestore 조회 → name 우선 */
        if (firestore) {
          lookupOpenRidingUserNameByInvitePhone(firestore, r.invitePhone).then(function (nm) {
            if (cancelled) return;
            if (nm && String(nm).trim()) mergeInviteName(r.phoneKey, nm);
            else tryUidFallback();
          });
        } else {
          tryUidFallback();
        }
      });

      return function () {
        cancelled = true;
      };
    },
    [rideId, ride, firestore, inviteRows, role, isHost]
  );

  /**
   * 방장만: 프로필 조회로 채워진 inviteResolvedLabels(실명)을 rides.inviteDisplayByPhone에 병합 저장.
   * 초대받은 사용자는 users 컬렉션 쿼리가 불가하므로 문서의 inviteDisplayByPhone으로 동일 표기.
   */
  useEffect(
    function () {
      if (!isHost || !firestore || !rideId || !userId || !ride || !inviteRows.length) return undefined;
      var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
      if (typeof svc.mergeInviteDisplayByPhoneForHost !== 'function') return undefined;

      var normFn =
        typeof window !== 'undefined' &&
        window.openRidingService &&
        typeof window.openRidingService.normalizePhoneDigits === 'function'
          ? window.openRidingService.normalizePhoneDigits
          : function (x) {
              return String(x || '').replace(/\D/g, '');
            };
      var idp =
        ride.inviteDisplayByPhone && typeof ride.inviteDisplayByPhone === 'object' && !Array.isArray(ride.inviteDisplayByPhone)
          ? ride.inviteDisplayByPhone
          : {};

      var patch = {};
      var i;
      for (i = 0; i < inviteRows.length; i++) {
        var r = inviteRows[i];
        var nm = inviteResolvedLabels[r.phoneKey];
        if (!nm || isOpenRidingInviteWeakDisplayName(nm)) continue;
        var cur = openRidingResolveInviteDisplayByPhoneKey(idp, r.phoneKey, normFn);
        var composed = openRidingComposeInviteDisplayStoredValue(cur, nm);
        if (!composed || composed === cur) continue;
        patch[r.phoneKey] = composed;
      }
      if (Object.keys(patch).length === 0) return undefined;

      if (hostIdpSyncTmRef.current) clearTimeout(hostIdpSyncTmRef.current);
      hostIdpSyncTmRef.current = setTimeout(function () {
        hostIdpSyncTmRef.current = null;
        svc
          .mergeInviteDisplayByPhoneForHost(firestore, rideId, userId, patch)
          .then(function () {
            if (typeof reload === 'function') reload();
          })
          .catch(function () {});
      }, 900);

      return function () {
        if (hostIdpSyncTmRef.current) {
          clearTimeout(hostIdpSyncTmRef.current);
          hostIdpSyncTmRef.current = null;
        }
      };
    },
    [isHost, firestore, rideId, userId, ride, inviteRows, inviteResolvedLabels, reload]
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

  async function confirmDeleteRide() {
    var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
    if (!firestore || !userId || typeof svc.deleteRideByHost !== 'function') return;
    setDeleteBusy(true);
    try {
      await svc.deleteRideByHost(firestore, rideId, userId);
      setDeleteModalOpen(false);
      if (typeof onBack === 'function') onBack();
    } catch (err) {
      console.warn('[openRiding] deleteRideByHost', err);
    } finally {
      setDeleteBusy(false);
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

  var isCancelled = String(ride.rideStatus || 'active') === 'cancelled';
  var hasApplied = role === 'participant' || (role && typeof role === 'object' && role.type === 'waitlist');
  /** 초대 명단·인원 수: 방장 또는 참석/대기 신청한 사용자만 열람 */
  var viewerCanSeeInviteFold = isHost || hasApplied;
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
    /** 일정 지난 뒤 정원·참석자 목록에서는 전화번호 자체를 표시하지 않음 */
    if (maskContacts) return null;
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
        <div className="flex justify-end items-center gap-2 flex-wrap min-w-0 open-riding-detail-host-actions px-1">
          <button
            type="button"
            className="open-riding-host-toolbar-btn inline-flex items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-800 shadow-sm hover:bg-violet-50 active:opacity-90 transition-colors shrink-0"
            onClick={onOpenEdit}
            aria-label="라이딩 수정"
          >
            <OpenRidingDashboardEditIcon className="w-5 h-5 shrink-0 text-violet-700" />
            <span>수정</span>
          </button>
          <button
            type="button"
            className="open-riding-host-toolbar-btn inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-amber-900 shadow-sm hover:bg-amber-50 active:opacity-90 transition-colors shrink-0"
            onClick={function () {
              setBombOpen(true);
            }}
            aria-label="라이딩 취소"
          >
            <img
              src="assets/img/cancel01.png"
              alt=""
              width={20}
              height={20}
              className="block object-contain shrink-0"
              decoding="async"
            />
            <span>취소</span>
          </button>
          <button
            type="button"
            className="open-riding-host-toolbar-btn inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 shadow-sm hover:bg-red-50 active:opacity-90 transition-colors shrink-0"
            onClick={function () {
              setDeleteModalOpen(true);
            }}
            aria-label="라이딩 삭제"
          >
            <img
              src="assets/img/delete2.png"
              alt=""
              width={20}
              height={20}
              className="block object-contain shrink-0"
              decoding="async"
            />
            <span>삭제</span>
          </button>
        </div>
      ) : null}

      <div className={'open-riding-detail-stat-panel rounded-xl overflow-hidden' + detailMuted}>
        {statRow(
          '모임명',
          <span className={'font-bold text-slate-900 block min-w-0 break-words text-sm leading-[1.25rem] text-left ' + (isCancelled ? 'open-riding-detail-title-cancelled' : '')}>
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
            ) : levelParticipation ||
              (detailLevelPeakHint &&
                detailLevelPeakHint.refSoloKmh != null &&
                Number(detailLevelPeakHint.refSoloKmh) > 0) ? (
              <div
                className={
                  'open-riding-level-participation-hint' +
                  (levelParticipation
                    ? ' open-riding-level-participation-hint--' + levelParticipation.tier
                    : '')
                }
              >
                {levelParticipation ? (
                  <span
                    className="open-riding-level-participation-label"
                    title={levelParticipation.comment || ''}
                  >
                    {levelParticipation.label}
                  </span>
                ) : null}
                {detailLevelPeakHint &&
                detailLevelPeakHint.refSoloKmh != null &&
                Number(detailLevelPeakHint.refSoloKmh) > 0 ? (
                  <div className="open-riding-create-level-peak-hint mt-1 w-full max-w-[17rem] ml-auto rounded-lg border border-emerald-200/70 bg-emerald-50/55 px-2.5 py-2 space-y-1.5 text-[11px] sm:text-xs text-emerald-900 leading-snug text-right">
                    <p className="m-0 font-semibold">
                      나의 평지 항속 능력 :{' '}
                      <span className="tabular-nums font-bold text-emerald-950">
                        {detailLevelPeakHint.refSoloKmh} km/h
                      </span>
                    </p>
                    {detailLevelPeakHint.myTierLabel ? (
                      <p className="m-0 text-emerald-900">
                        나의 레벨 :{' '}
                        <strong className="text-emerald-950">{detailLevelPeakHint.myTierLabel}</strong>
                      </p>
                    ) : null}
                    {detailLevelPeakHint.usedFtpFallback ? (
                      <p className="m-0 text-[10px] text-emerald-800/90">
                        참조: 60분 피크 없음 · FTP 평지 평속 × 93%
                      </p>
                    ) : detailLevelPeakHint.usedPeak ? (
                      <p className="m-0 text-[10px] text-emerald-800/90">
                        참조: 60분 최고 평균 파워·체중 (현실 지표)
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : userId && detailLevelPeakHint && detailLevelPeakHint.profileOk === false ? (
              <p className="m-0 text-[11px] text-slate-500 leading-snug text-right">
                프로필에 FTP·체중을 저장하면 평지 개인 평속·레벨 안내와 참석 가능 여부가 표시됩니다.
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
        <div
          className={
            'w-full border-t border-slate-100/90 border-b border-slate-300/90 px-3 py-3 space-y-3 bg-violet-50/25' +
            detailMuted
          }
        >
          {ride.course ? <p className="text-sm text-slate-800 whitespace-pre-wrap m-0">{ride.course}</p> : null}
          <OpenRidingGpxCoursePanel gpxUrl={ride.gpxUrl != null ? String(ride.gpxUrl) : ''} file={null} storage={storage} showEmptyMessage={true} />
          {ride.gpxUrl ? (
            <a
              className={
                'inline-flex items-center gap-1 text-violet-600 text-sm font-semibold hover:underline' +
                (isCancelled ? ' opacity-50 pointer-events-none' : '')
              }
              href={ride.gpxUrl}
              target="_blank"
              rel="noreferrer"
              download
            >
              GPX 파일 다운로드
            </a>
          ) : null}
        </div>
        <div className="open-riding-detail-participant-fold open-riding-detail-invite-fold--block w-full min-w-0">
          <div className="open-riding-detail-stat-row open-riding-detail-stat-row--invite items-start gap-2 px-3 py-2">
            <span className="open-riding-detail-stat-label shrink-0 pt-0.5">
              <button
                type="button"
                className="m-0 p-0 bg-transparent border-0 cursor-pointer text-left text-sm font-semibold leading-[1.25rem] text-[#6d28d9] hover:text-[#5b21b6] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 rounded"
                onClick={function () {
                  setParticipantListExpanded(function (v) {
                    return !v;
                  });
                }}
                aria-expanded={participantListExpanded}
                id="open-riding-participant-toggle"
              >
                정원{' '}
                <span className="tabular-nums font-semibold text-inherit" aria-hidden>
                  {participantListExpanded ? '(−)' : '(+)'}
                </span>
              </button>
            </span>
            <div className="open-riding-detail-stat-value min-w-0 flex flex-col items-end text-right gap-0.5">
              <span className="tabular-nums text-sm leading-[1.25rem]">
                {parts.length} / {ride.maxParticipants != null ? ride.maxParticipants : '-'}
              </span>
            </div>
          </div>
          {participantListExpanded ? (
            <div
              className="open-riding-detail-participant-list-expanded m-0 w-full min-w-0 border-t border-slate-100/90 px-3 py-3 space-y-3 text-left"
              role="region"
              aria-labelledby="open-riding-participant-toggle"
            >
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
          ) : null}
        </div>
        {viewerCanSeeInviteFold && (isHost || inviteRows.length > 0) ? (
          <div className="open-riding-detail-invite-fold open-riding-detail-invite-fold--block w-full min-w-0">
            <div className="open-riding-detail-stat-row open-riding-detail-stat-row--invite items-start gap-2">
              <span className="open-riding-detail-stat-label shrink-0 pt-0.5">
                <button
                  type="button"
                  className="m-0 p-0 bg-transparent border-0 cursor-pointer text-left text-sm font-semibold leading-[1.25rem] text-[#6d28d9] hover:text-[#5b21b6] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 rounded"
                  onClick={function () {
                    setInviteListExpanded(function (v) {
                      return !v;
                    });
                  }}
                  aria-expanded={inviteListExpanded}
                  id="open-riding-invite-toggle"
                >
                  초대 명단{' '}
                  <span className="tabular-nums font-semibold text-inherit" aria-hidden>
                    {inviteListExpanded ? '(−)' : '(+)'}
                  </span>
                </button>
              </span>
              <div className="open-riding-detail-stat-value min-w-0 flex flex-col items-end text-right gap-0.5">
                <span className="tabular-nums text-sm leading-[1.25rem]">{inviteAttendedCount} / {inviteTotalCount}</span>
                <span className="text-xs text-slate-500 leading-tight font-medium">참석 / 초대</span>
              </div>
            </div>
            {inviteListExpanded ? (
              <ul
                id="open-riding-detail-invite-listbox"
                role="region"
                aria-labelledby="open-riding-invite-toggle"
                className="open-riding-detail-invite-list open-riding-detail-invite-list--in-fold m-0 w-full min-w-0 list-none space-y-2 border-t border-slate-100/90"
              >
                {inviteRows.map(function (r) {
                  var named = getOpenRidingInviteRowDisplayName(
                    r,
                    ride,
                    inviteResolvedLabels,
                    maskContacts,
                    myPhoneForInvite,
                    userId
                  );
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
            ) : null}
          </div>
        ) : userId && invitedListArr.length > 0 ? (
          <div className="open-riding-detail-invite-fold open-riding-detail-invite-fold--teaser w-full min-w-0">
            <div className="open-riding-detail-stat-row open-riding-detail-stat-row--invite items-start gap-2">
              <span className="open-riding-detail-stat-label shrink-0 pt-0.5 text-sm font-semibold text-slate-700">초대 명단</span>
              <div className="open-riding-detail-stat-value min-w-0 flex flex-col items-end text-right">
                <span className="text-sm text-slate-500 leading-snug">참가 신청 후 확인 가능</span>
              </div>
            </div>
          </div>
        ) : null}
        {ride && packRulesNorm ? (
          <div className="open-riding-detail-pack-rules-fold open-riding-detail-invite-fold--block w-full min-w-0">
            <div className="open-riding-detail-stat-row open-riding-detail-stat-row--invite items-start gap-2">
              <span className="open-riding-detail-stat-label shrink-0 pt-0.5">
                <button
                  type="button"
                  className="m-0 p-0 bg-transparent border-0 cursor-pointer text-left text-sm font-semibold leading-[1.25rem] text-[#6d28d9] hover:text-[#5b21b6] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 rounded"
                  onClick={function () {
                    setOperationRulesExpanded(function (v) {
                      return !v;
                    });
                  }}
                  aria-expanded={operationRulesExpanded}
                  id="open-riding-pack-rules-toggle"
                >
                  운영방식{' '}
                  <span className="tabular-nums font-semibold text-inherit" aria-hidden>
                    {operationRulesExpanded ? '(−)' : '(+)'}
                  </span>
                </button>
              </span>
              <div className="open-riding-detail-stat-value min-w-0 flex flex-col items-end text-right gap-0.5">
                <span className="text-xs text-slate-500 leading-tight font-medium">팩 라이딩 룰</span>
              </div>
            </div>
            {operationRulesExpanded && packRulesDisp ? (
              <div
                className="open-riding-pack-rules-expanded m-0 w-full min-w-0 border-t border-slate-100/90 pt-3 text-left"
                role="region"
                aria-labelledby="open-riding-pack-rules-toggle"
              >
                <div className="rounded-2xl border border-violet-200/50 bg-gradient-to-b from-white via-violet-50/[0.35] to-slate-50/50 shadow-[0_2px_12px_-2px_rgba(109,40,217,0.08)] ring-1 ring-violet-100/30 overflow-hidden">
                  <div className="divide-y divide-slate-100/90">
                    {packRulesDisp.rot ? (
                      <div className="px-3 py-3.5 sm:px-4 sm:py-4">
                        <p className="text-sm font-semibold text-violet-900 m-0 mb-2 tracking-tight">
                          로테이션 방식
                        </p>
                        <div className="ml-1 border-l-[3px] border-violet-400/85 pl-3.5 pr-1">
                          <p className="text-sm text-slate-800 m-0 leading-relaxed font-medium">{packRulesDisp.rot}</p>
                        </div>
                      </div>
                    ) : null}
                    {packRulesDisp.nodrop ? (
                      <div className="px-3 py-3.5 sm:px-4 sm:py-4">
                        <p className="text-sm font-semibold text-violet-900 m-0 mb-2 tracking-tight">
                          노드랍 팩라이딩
                        </p>
                        <div className="ml-1 border-l-[3px] border-violet-400/85 pl-3.5 pr-1">
                          <p className="text-sm text-slate-800 m-0 leading-relaxed font-medium">{packRulesDisp.nodrop}</p>
                        </div>
                      </div>
                    ) : null}
                    <div className="px-3 py-3.5 sm:px-4 sm:py-4">
                      <p className="text-sm font-semibold text-violet-900 m-0 mb-2 tracking-tight">
                        오픈(Open) 구간
                      </p>
                      <div className="ml-1 border-l-[3px] border-slate-300/90 pl-3.5 pr-1 min-h-[1.25rem]">
                        {packRulesDisp.openSectionText ? (
                          <p className="text-sm text-slate-700 m-0 leading-relaxed whitespace-pre-wrap">{packRulesDisp.openSectionText}</p>
                        ) : (
                          <p className="text-xs text-slate-400 m-0 italic">입력 없음</p>
                        )}
                      </div>
                    </div>
                    <div className="px-3 py-3.5 sm:px-4 sm:py-4">
                      <p className="text-sm font-semibold text-violet-900 m-0 mb-2 tracking-tight">
                        보급 구간
                      </p>
                      <div className="ml-1 border-l-[3px] border-slate-300/90 pl-3.5 pr-1 min-h-[1.25rem]">
                        {packRulesDisp.supplySectionText ? (
                          <p className="text-sm text-slate-700 m-0 leading-relaxed whitespace-pre-wrap">{packRulesDisp.supplySectionText}</p>
                        ) : (
                          <p className="text-xs text-slate-400 m-0 italic">입력 없음</p>
                        )}
                      </div>
                    </div>
                    <div className="px-3 py-3.5 sm:px-4 sm:py-4">
                      <p className="text-sm font-semibold text-violet-900 m-0 mb-2 tracking-tight">
                        회비
                      </p>
                      <div className="ml-1 border-l-[3px] border-slate-300/90 pl-3.5 pr-1 min-h-[1.25rem]">
                        {packRulesDisp.feeText ? (
                          <p className="text-sm text-slate-700 m-0 leading-relaxed whitespace-pre-wrap">{packRulesDisp.feeText}</p>
                        ) : (
                          <p className="text-xs text-slate-400 m-0 italic">입력 없음</p>
                        )}
                      </div>
                    </div>
                    <div className="px-3 py-3.5 sm:px-4 sm:py-4">
                      <p className="text-sm font-semibold text-violet-900 m-0 mb-2 tracking-tight">
                        필수 준비물
                      </p>
                      <div className="ml-1 border-l-[3px] border-slate-300/90 pl-3.5 pr-1 min-h-[1.25rem]">
                        {packRulesDisp.gearLines.length ? (
                          <ul className="m-0 pl-0 list-none space-y-1.5 text-sm text-slate-700 leading-snug">
                            {packRulesDisp.gearLines.map(function (line, ix) {
                              return (
                                <li key={ix} className="flex gap-2 items-start">
                                  <span
                                    className="mt-2 h-1 w-1 shrink-0 rounded-full bg-violet-400/80"
                                    aria-hidden
                                  />
                                  <span className="min-w-0 flex-1">{line}</span>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="text-xs text-slate-400 m-0 italic">선택된 항목 없음</p>
                        )}
                      </div>
                    </div>
                    <div className="px-3 py-3.5 sm:px-4 sm:py-4">
                      <p className="text-sm font-semibold text-violet-900 m-0 mb-2 tracking-tight">
                        모임 취소 조건
                      </p>
                      <div className="ml-1 border-l-[3px] border-slate-300/90 pl-3.5 pr-1 min-h-[1.25rem]">
                        {packRulesDisp.cancelConditionText ? (
                          <p className="text-sm text-slate-700 m-0 leading-relaxed whitespace-pre-wrap">{packRulesDisp.cancelConditionText}</p>
                        ) : (
                          <p className="text-xs text-slate-400 m-0 italic">입력 없음</p>
                        )}
                      </div>
                    </div>
                    {packRulesDisp.minors ? (
                      <div className="px-3 py-3.5 sm:px-4 sm:py-4 bg-violet-50/40">
                        <p className="text-sm font-semibold text-violet-900 m-0 mb-2 tracking-tight">
                          미성년자 참석 가능 여부
                        </p>
                        <div className="ml-1 border-l-[3px] border-violet-400/85 pl-3.5 pr-1">
                          <p className="text-sm text-slate-800 m-0 leading-relaxed font-semibold">
                            {packRulesDisp.minors}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {statRow('방장', ride.hostName != null ? ride.hostName : '-')}
        {statRow(
          '연락처',
          showHostContactRow && ride.contactInfo ? (
            maskContacts ? maskPhoneLastFourDisplay(ride.contactInfo) : ride.contactInfo
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
        <p className="text-xs text-slate-500 px-1 leading-snug">
          라이딩 일정일이 지나 참가자 연락처는 표시하지 않으며, 방장 연락처는 끝 네 자리가 가려집니다.
        </p>
      ) : null}

      {actionErr ? <p className="text-sm text-red-600">{actionErr}</p> : null}

      {!isCancelled ? (
        <div className="space-y-2">
          {!maskContacts && showJoinPasswordField ? (
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
          {!maskContacts && isPrivateRide && !isHost && !role && !joinInviteOk ? (
            <p className="text-xs text-amber-800 text-center leading-snug px-1">
              초대된 전화번호와 프로필 연락처가 일치하거나, 방장이 설정한 4자리 비밀번호를 입력해야 참석 신청할 수 있습니다.
            </p>
          ) : null}
          {!maskContacts ? (
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
          ) : null}
          <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3 mt-2 space-y-2 text-left">
            <h3 className="text-xs font-bold text-slate-800 m-0 tracking-tight">[안전 및 주의사항 (필독)]</h3>
            <p className="text-xs text-slate-600 m-0 leading-relaxed">
              스텔비오 모임은 자발적인 친목 모임으로, 라이딩 중 발생하는 모든 사고 및 자전거 손상에 대한 책임은 참석자 본인에게 있습니다.
            </p>
            <p className="text-xs text-slate-600 m-0 leading-relaxed">
              참석 신청을 하시는 것은 위 면책 조항에 동의하는 것으로 간주합니다.
            </p>
            <p className="text-xs text-slate-600 m-0 leading-relaxed">
              그룹 라이딩 수신호를 반드시 숙지하시고, 선두의 지시에 잘 따라주시기 바랍니다.
            </p>
            <p className="text-xs text-slate-600 m-0 leading-relaxed">개인 자전거 보험 가입을 적극 권장합니다.</p>
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

      {deleteModalOpen ? (
        <div
          className="open-riding-bomb-modal-backdrop fixed inset-0 z-[10071] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-riding-delete-title"
          onClick={function () {
            if (!deleteBusy) setDeleteModalOpen(false);
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
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 text-sm font-bold border border-red-100"
                aria-hidden
              >
                !
              </span>
              <h2 id="open-riding-delete-title" className="text-base font-bold text-slate-800 m-0 leading-tight">
                라이딩 삭제
              </h2>
            </div>
            <p className="stelvio-exit-confirm-message text-center m-0">등록한 라이딩을 삭제하시겠습니까?</p>
            <p className="text-xs text-slate-500 mb-5 leading-snug m-0 text-center">삭제 후에는 복구할 수 없습니다.</p>
            <div className="stelvio-exit-confirm-buttons">
              <button
                type="button"
                className="open-riding-action-btn stelvio-exit-confirm-btn stelvio-exit-confirm-btn-cancel inline-flex items-center justify-center disabled:opacity-50"
                disabled={deleteBusy}
                onClick={function () {
                  setDeleteModalOpen(false);
                }}
              >
                아니오
              </button>
              <button
                type="button"
                className="open-riding-action-btn stelvio-exit-confirm-btn stelvio-exit-confirm-btn-ok inline-flex items-center justify-center disabled:opacity-50"
                disabled={deleteBusy}
                onClick={confirmDeleteRide}
              >
                {deleteBusy ? '처리 중…' : '예'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 친구 관리 (맞춤 필터 전체 화면 레이아웃과 동일) */
function OpenRidingFriendsManage(props) {
  var firestore = props.firestore;
  var userId = props.userId || '';

  var _b = useState({
    friends: [],
    outgoing: [],
    incoming: [],
    loading: true,
    err: ''
  });
  var bundle = _b[0];
  var setBundle = _b[1];
  var _s = useState('');
  var searchTerm = _s[0];
  var setSearchTerm = _s[1];
  var _c = useState([]);
  var searchCandidates = _c[0];
  var setSearchCandidates = _c[1];
  var _diag = useState({
    done: false,
    lastTerm: '',
    errors: [],
    hints: [],
    rowCount: 0
  });
  var searchDiag = _diag[0];
  var setSearchDiag = _diag[1];
  var _sBusy = useState(false);
  var searchBusy = _sBusy[0];
  var setSearchBusy = _sBusy[1];
  var _busy = useState(false);
  var actionBusy = _busy[0];
  var setActionBusy = _busy[1];

  function refresh() {
    var fr = typeof window !== 'undefined' ? window.openRidingFriendsService || {} : {};
    if (!firestore || !userId || typeof fr.fetchFriendManagementSnapshot !== 'function') {
      setBundle(function (x) {
        return Object.assign({}, x, { loading: false });
      });
      return;
    }
    setBundle(function (x) {
      return Object.assign({}, x, { loading: true, err: '' });
    });
    fr.fetchFriendManagementSnapshot(firestore, userId).then(function (data) {
      setBundle({
        friends: data.friends || [],
        outgoing: data.outgoing || [],
        incoming: data.incoming || [],
        loading: false,
        err: ''
      });
    }).catch(function (e) {
      setBundle(function (x) {
        return Object.assign({}, x, {
          loading: false,
          err: e && e.message ? String(e.message) : '불러오기 실패'
        });
      });
    });
  }

  useEffect(
    function () {
      refresh();
    },
    [firestore, userId]
  );

  function runSearch() {
    var fr = typeof window !== 'undefined' ? window.openRidingFriendsService || {} : {};
    if (!firestore || typeof fr.searchUsersForFriendRequest !== 'function') return;
    var termTrim = String(searchTerm || '').trim();
    setSearchBusy(true);
    fr.searchUsersForFriendRequest(firestore, searchTerm, userId)
      .then(function (res) {
        var rows = [];
        var errors = [];
        var hints = [];
        if (res && Array.isArray(res.rows)) {
          rows = res.rows || [];
          errors = res.errors || [];
          hints = res.hints || [];
        } else if (Array.isArray(res)) {
          rows = res;
        } else {
          errors.push('검색 응답 형식을 알 수 없습니다.');
        }
        setSearchCandidates(rows);
        setSearchDiag({
          done: true,
          lastTerm: termTrim,
          errors: errors,
          hints: hints,
          rowCount: rows.length
        });
      })
      .catch(function (e) {
        setSearchCandidates([]);
        setSearchDiag({
          done: true,
          lastTerm: termTrim,
          errors: [e && e.message ? String(e.message) : '검색 실패'],
          hints: [],
          rowCount: 0
        });
      })
      .finally(function () {
        setSearchBusy(false);
      });
  }

  function profForSend() {
    var p = getOpenRidingProfileDefaults();
    return {
      fromDisplayName: String(p.hostName || '').trim() || '라이더',
      fromContact: String(p.contactInfo || '').trim()
    };
  }

  function sendFriendRequestToCandidate(c) {
    if (!c || !c.uid) return;
    var fr = typeof window !== 'undefined' ? window.openRidingFriendsService || {} : {};
    if (typeof fr.sendFriendRequest !== 'function') return;
    var pr = profForSend();
    if (!pr.fromContact) {
      alert('프로필에 연락처를 등록한 뒤 친구 요청을 보낼 수 있습니다.');
      return;
    }
    setActionBusy(true);
    fr.sendFriendRequest(firestore, userId, c.uid, pr, {
      targetName: c.name,
      targetContact: c.contact
    }).then(function () {
      refresh();
    }).catch(function (e) {
      alert(e && e.message ? e.message : '요청 실패');
    }).finally(function () {
      setActionBusy(false);
    });
  }

  function searchRowStatus(c) {
    var fr = typeof window !== 'undefined' ? window.openRidingFriendsService || {} : {};
    if (typeof fr.getFriendSearchRowStatus !== 'function') return '—';
    return fr.getFriendSearchRowStatus(c.uid, bundle.friends, bundle.outgoing, bundle.incoming);
  }

  function privacyMask(contact) {
    var fr = typeof window !== 'undefined' ? window.openRidingFriendsService || {} : {};
    if (typeof fr.maskContactPrivacy === 'function') {
      return fr.maskContactPrivacy(contact);
    }
    return String(contact || '').trim() ? '****' : '-';
  }

  /** 검색 표시: 이미 친구면 DB friends 연락처, 아니면 마스킹 */
  function searchContactDisplay(c) {
    if (searchRowStatus(c) === '이미 친구') {
      var uid = String(c.uid || '');
      var fi;
      for (fi = 0; fi < bundle.friends.length; fi++) {
        var fd = bundle.friends[fi];
        if (String(fd.friendUid || fd.id || '') === uid) {
          var n = fd.contact != null ? String(fd.contact).trim() : '';
          if (n) return n;
          break;
        }
      }
      return c.contact != null ? String(c.contact).trim() || '-' : '-';
    }
    return privacyMask(c.contact);
  }

  /** 보낸 요청: 상대 번호는 수락 전까지 비공개 */
  function outgoingContactForDisplay(row) {
    return privacyMask(outgoingContact(row));
  }

  /** 받은 요청: 상대(보낸 사람) 번호는 수락 전까지 비공개 */
  function incomingContactForDisplay(row) {
    return privacyMask(row.fromContact != null ? row.fromContact : '');
  }

  function canClickFriendRequest(c) {
    var st = searchRowStatus(c);
    return st === '친구 요청 가능' || st === '거절됨' || st === '요청 취소됨';
  }

  function searchStatusDisplay(st) {
    var s = String(st || '');
    if (s === '이미 친구') return '친구';
    if (s === '친구 요청 가능') return '요청 가능';
    return s || '—';
  }

  function outgoingDisplayName(row) {
    var nm = row.targetPreviewName != null ? String(row.targetPreviewName).trim() : '';
    if (nm) return nm;
    return row.toDisplayName != null ? String(row.toDisplayName).trim() : '상대';
  }

  function outgoingContact(row) {
    var c = row.targetPreviewContact != null ? String(row.targetPreviewContact).trim() : '';
    if (c) return c;
    return row.toContact != null ? String(row.toContact).trim() : '-';
  }

  function statusKo(st) {
    var s = String(st || '');
    if (s === 'pending') return '대기 중';
    if (s === 'rejected') return '거절';
    if (s === 'cancelled') return '취소됨';
    if (s === 'accepted') return '수락됨';
    return s || '-';
  }

  /** 내가 보낸 요청 목록용 짧은 상태 문구 */
  function outgoingStatusShort(st) {
    var s = String(st || '');
    if (s === 'pending') return '대기';
    if (s === 'rejected') return '거절';
    if (s === 'cancelled') return '취소됨';
    return statusKo(s);
  }

  var outgoingList = bundle.outgoing.filter(function (r) {
    return String(r.status) !== 'accepted';
  });
  var incomingList = bundle.incoming.filter(function (r) {
    return String(r.status) !== 'accepted';
  });

  var acceptProfMemo = {
    toDisplayName: String(getOpenRidingProfileDefaults().hostName || '').trim() || '라이더',
    toContact: String(getOpenRidingProfileDefaults().contactInfo || '').trim()
  };

  return (
    <div className="open-riding-filter-full-page w-full max-w-lg mx-auto text-left relative z-0">
      <div className="open-riding-create-form-root w-full max-w-lg mx-auto space-y-3 pb-4 text-sm text-slate-700 relative z-0">
        {/* 1. 친구 요청 대상자 검색 */}
        <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
          <h2 className="text-sm font-semibold text-slate-800 m-0">친구 요청 대상자 검색</h2>
          <p className="text-xs text-slate-500 m-0 leading-snug">
            검색 결과·보낸/받은 요청에서는 상대 전화번호가 수락되기 전까지 마스킹(예: 010-4017-****)되어 표시됩니다.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              className="flex-1 border border-slate-300 rounded-lg px-2 py-2 text-sm"
              placeholder="이름 또는 전화 뒤 4자리"
              value={searchTerm}
              onChange={function (e) {
                setSearchTerm(e.target.value);
              }}
            />
            <button
              type="button"
              className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              disabled={actionBusy || searchBusy}
              onClick={runSearch}
            >
              검색
            </button>
          </div>
          {searchBusy || searchDiag.done ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50/90 p-2.5 space-y-1.5 text-xs">
              {searchBusy ? (
                <p className="text-slate-600 m-0 font-medium">검색 중…</p>
              ) : (
                <p className="text-slate-800 m-0">
                  <span className="font-semibold">검색어:</span>{' '}
                  <span className="text-slate-700">{searchDiag.lastTerm || '(없음)'}</span>
                  <span className="text-slate-400 mx-1.5">·</span>
                  <span className="font-semibold text-slate-700">
                    {searchDiag.rowCount > 0 ? searchDiag.rowCount + '건' : '결과 없음'}
                  </span>
                </p>
              )}
              {!searchBusy && searchDiag.errors && searchDiag.errors.length > 0
                ? searchDiag.errors.map(function (msg, i) {
                    return (
                      <p key={'se-' + i} className="text-red-600 m-0 leading-snug">
                        {msg}
                      </p>
                    );
                  })
                : null}
              {!searchBusy && searchDiag.hints && searchDiag.hints.length > 0
                ? searchDiag.hints.map(function (h, i) {
                    return (
                      <p key={'sh-' + i} className="text-slate-500 m-0 leading-snug">
                        {h}
                      </p>
                    );
                  })
                : null}
            </div>
          ) : null}
          {searchDiag.done && !searchBusy ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-600 m-0">검색 대상</p>
              {searchCandidates.length === 0 ? (
                <p className="text-xs text-slate-500 m-0">표시할 사용자가 없습니다. 조건을 바꿔 다시 검색해 주세요.</p>
              ) : (
                <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-lg border border-slate-200 -mx-0.5">
                  <table className="w-full text-xs text-left border-collapse min-w-[320px]">
                    <thead>
                      <tr className="text-slate-500 bg-slate-50 border-b border-slate-200 sticky top-0">
                        <th className="py-2 px-2 font-medium">이름</th>
                        <th className="py-2 px-2 font-medium w-[5.5rem] text-center">친구 요청</th>
                        <th className="py-2 px-2 font-medium w-[3.5rem] text-center">삭제</th>
                        <th className="py-2 px-2 font-medium">상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchCandidates.map(function (c) {
                        var rowSt = searchRowStatus(c);
                        var canReq = canClickFriendRequest(c);
                        return (
                          <tr key={c.uid} className="border-b border-slate-100 align-top">
                            <td className="py-2 px-2">
                              <span className="font-medium text-slate-800 block">{c.name}</span>
                              <span className="text-[11px] text-slate-500 break-all">{searchContactDisplay(c)}</span>
                            </td>
                            <td className="py-2 px-1 text-center">
                              <button
                                type="button"
                                className="text-[11px] font-semibold px-2 py-1.5 rounded-md bg-violet-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-violet-700"
                                disabled={actionBusy || !canReq}
                                onClick={function () {
                                  sendFriendRequestToCandidate(c);
                                }}
                              >
                                친구 요청
                              </button>
                            </td>
                            <td className="py-2 px-1 text-center">
                              <button
                                type="button"
                                className="text-[11px] font-semibold px-2 py-1.5 rounded-md border border-slate-300 text-slate-600 bg-white hover:bg-slate-50"
                                disabled={actionBusy}
                                title="이 검색 결과 목록에서만 제거합니다"
                                onClick={function () {
                                  setSearchCandidates(function (prev) {
                                    var next = prev.filter(function (x) {
                                      return x.uid !== c.uid;
                                    });
                                    setSearchDiag(function (d) {
                                      return Object.assign({}, d, { rowCount: next.length });
                                    });
                                    return next;
                                  });
                                }}
                              >
                                삭제
                              </button>
                            </td>
                            <td className="py-2 px-2 text-slate-700 leading-snug">{searchStatusDisplay(rowSt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </section>

        {/* 2. 등록된 친구 */}
        <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
          <h2 className="text-sm font-semibold text-slate-800 m-0">등록된 친구</h2>
          {bundle.loading ? (
            <p className="text-xs text-slate-500 m-0">불러오는 중…</p>
          ) : bundle.friends.length === 0 ? (
            <p className="text-xs text-slate-500 m-0">등록된 친구가 없습니다. 요청이 수락되면 여기에 표시됩니다.</p>
          ) : (
            <div className="overflow-x-auto -mx-0.5">
              <table className="w-full text-xs text-left border-collapse border border-slate-100 rounded-lg overflow-hidden">
                <thead>
                  <tr className="text-slate-500 bg-slate-50 border-b border-slate-100">
                    <th className="py-2 px-2 font-medium w-10">순번</th>
                    <th className="py-2 px-2 font-medium">이름</th>
                    <th className="py-2 px-2 font-medium">연락처</th>
                  </tr>
                </thead>
                <tbody>
                  {bundle.friends.map(function (row, idx) {
                    return (
                      <tr key={String(row.id || row.friendUid || idx)} className="border-b border-slate-50 last:border-b-0">
                        <td className="py-2 px-2 text-slate-600 tabular-nums">{idx + 1}</td>
                        <td className="py-2 px-2 font-medium text-slate-800">
                          {row.displayName != null ? String(row.displayName) : '-'}
                        </td>
                        <td className="py-2 px-2 text-slate-700 break-all">
                          {row.contact != null ? String(row.contact) : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 3. 내가 보낸 요청 */}
        <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
          <h2 className="text-sm font-semibold text-slate-800 m-0">내가 보낸 요청</h2>
          {outgoingList.length === 0 ? (
            <p className="text-xs text-slate-500 m-0">보낸 요청이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto -mx-0.5">
              <table className="w-full text-xs text-left border-collapse border border-slate-100 rounded-lg overflow-hidden min-w-[300px]">
                <thead>
                  <tr className="text-slate-500 bg-slate-50 border-b border-slate-100">
                    <th className="py-2 px-2 font-medium whitespace-nowrap">이름</th>
                    <th className="py-2 px-2 font-medium min-w-[6.5rem]">연락처</th>
                    <th className="py-2 px-2 font-medium whitespace-nowrap w-[4.5rem]">상태</th>
                    <th className="py-2 px-2 font-medium text-center w-[4.5rem]">요청</th>
                  </tr>
                </thead>
                <tbody>
                  {outgoingList.map(function (row) {
                    var st = String(row.status || '');
                    var to = String(row.toUid || '');
                    return (
                      <tr key={String(row.id || 'out-' + to)} className="border-b border-slate-50 last:border-b-0 align-top">
                        <td className="py-2 px-2 font-medium text-slate-800">{outgoingDisplayName(row)}</td>
                        <td className="py-2 px-2 text-slate-600 break-all tabular-nums">{outgoingContactForDisplay(row)}</td>
                        <td className="py-2 px-2 text-slate-600 whitespace-nowrap">{outgoingStatusShort(st)}</td>
                        <td className="py-2 px-1 text-center">
                          <div className="flex flex-col gap-1 items-stretch sm:items-end">
                            {st === 'pending' ? (
                              <button
                                type="button"
                                className="text-[11px] font-semibold px-2 py-1.5 rounded-md border border-amber-200 text-amber-800 bg-white hover:bg-amber-50 whitespace-nowrap"
                                disabled={actionBusy}
                                onClick={function () {
                                  var fr = window.openRidingFriendsService || {};
                                  if (typeof fr.cancelFriendRequest !== 'function') return;
                                  setActionBusy(true);
                                  fr.cancelFriendRequest(firestore, userId, to).then(refresh).catch(function (e) {
                                    alert(e && e.message ? e.message : '취소 실패');
                                  }).finally(function () {
                                    setActionBusy(false);
                                  });
                                }}
                              >
                                취소
                              </button>
                            ) : null}
                            {st === 'rejected' || st === 'cancelled' ? (
                              <button
                                type="button"
                                className="text-[11px] font-semibold px-2 py-1.5 rounded-md border border-violet-200 text-violet-800 bg-white hover:bg-violet-50 whitespace-nowrap"
                                disabled={actionBusy}
                                onClick={function () {
                                  var fr = window.openRidingFriendsService || {};
                                  if (typeof fr.sendFriendRequest !== 'function') return;
                                  var pr = profForSend();
                                  if (!pr.fromContact) {
                                    alert('프로필 연락처를 등록해 주세요.');
                                    return;
                                  }
                                  setActionBusy(true);
                                  fr.sendFriendRequest(firestore, userId, to, pr, {
                                    targetName: outgoingDisplayName(row),
                                    targetContact: outgoingContact(row)
                                  }).then(refresh).catch(function (e) {
                                    alert(e && e.message ? e.message : '재요청 실패');
                                  }).finally(function () {
                                    setActionBusy(false);
                                  });
                                }}
                              >
                                다시 요청
                              </button>
                            ) : null}
                            {st === 'rejected' || st === 'cancelled' ? (
                              <button
                                type="button"
                                className="text-[11px] font-semibold px-2 py-1.5 rounded-md border border-slate-300 text-slate-600 bg-white hover:bg-slate-50 whitespace-nowrap"
                                disabled={actionBusy}
                                onClick={function () {
                                  var fr = window.openRidingFriendsService || {};
                                  if (typeof fr.deleteFriendRequestForSender !== 'function') return;
                                  setActionBusy(true);
                                  fr.deleteFriendRequestForSender(firestore, userId, to).then(refresh).catch(function (e) {
                                    alert(e && e.message ? e.message : '삭제 실패');
                                  }).finally(function () {
                                    setActionBusy(false);
                                  });
                                }}
                              >
                                삭제
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 4. 나에게 온 요청 */}
        <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
          <h2 className="text-sm font-semibold text-slate-800 m-0">나에게 온 요청</h2>
          {incomingList.length === 0 ? (
            <p className="text-xs text-slate-500 m-0">새 요청이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto -mx-0.5">
              <table className="w-full text-xs text-left border-collapse border border-slate-100 rounded-lg overflow-hidden min-w-[340px]">
                <thead>
                  <tr className="text-slate-500 bg-slate-50 border-b border-slate-100">
                    <th className="py-2 px-2 font-medium w-10">순번</th>
                    <th className="py-2 px-2 font-medium whitespace-nowrap">이름</th>
                    <th className="py-2 px-2 font-medium min-w-[7rem]">연락처</th>
                    <th className="py-2 px-2 font-medium whitespace-nowrap">상태</th>
                    <th className="py-2 px-2 font-medium text-center min-w-[7rem]">처리</th>
                  </tr>
                </thead>
                <tbody>
                  {incomingList.map(function (row, idx) {
                    var st = String(row.status || '');
                    var from = String(row.fromUid || '');
                    return (
                      <tr key={String(row.id || 'in-' + from)} className="border-b border-slate-50 last:border-b-0 align-top">
                        <td className="py-2 px-2 text-slate-600 tabular-nums">{idx + 1}</td>
                        <td className="py-2 px-2 font-medium text-slate-800">
                          {row.fromDisplayName != null ? String(row.fromDisplayName) : '회원'}
                        </td>
                        <td className="py-2 px-2 text-slate-600 break-all tabular-nums">{incomingContactForDisplay(row)}</td>
                        <td className="py-2 px-2 text-slate-600 whitespace-nowrap">
                          {st === 'pending' ? '대기 중' : statusKo(st)}
                        </td>
                        <td className="py-2 px-1 text-center">
                          <div className="flex flex-col sm:flex-row gap-1 justify-end items-stretch sm:items-center">
                            {st === 'pending' || st === 'rejected' ? (
                              <button
                                type="button"
                                className="text-[11px] font-semibold px-2 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 whitespace-nowrap"
                                disabled={actionBusy}
                                onClick={function () {
                                  if (!acceptProfMemo.toContact) {
                                    alert('수락 시 상대에게 공개할 연락처가 필요합니다. 프로필에서 등록해 주세요.');
                                    return;
                                  }
                                  var fr = window.openRidingFriendsService || {};
                                  if (typeof fr.acceptFriendRequest !== 'function') return;
                                  setActionBusy(true);
                                  fr.acceptFriendRequest(firestore, from, userId, acceptProfMemo).then(refresh).catch(function (e) {
                                    alert(e && e.message ? e.message : '수락 실패');
                                  }).finally(function () {
                                    setActionBusy(false);
                                  });
                                }}
                              >
                                수락
                              </button>
                            ) : null}
                            {st === 'pending' ? (
                              <button
                                type="button"
                                className="text-[11px] font-semibold px-2 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                                disabled={actionBusy}
                                onClick={function () {
                                  var fr = window.openRidingFriendsService || {};
                                  if (typeof fr.rejectFriendRequest !== 'function') return;
                                  setActionBusy(true);
                                  fr.rejectFriendRequest(firestore, from, userId).then(refresh).catch(function (e) {
                                    alert(e && e.message ? e.message : '거절 실패');
                                  }).finally(function () {
                                    setActionBusy(false);
                                  });
                                }}
                              >
                                거절
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {bundle.err ? <p className="text-xs text-red-600 m-0 px-1">{bundle.err}</p> : null}

        <OpenRidingBottomLogoBar />
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
    } else if (view === 'friends') {
      setView('main');
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
            : view === 'friends'
              ? '친구 관리'
              : '라이딩 모임';

  var useBottomFixedBar = !!(
    firestore &&
    (view === 'main' ||
      view === 'create' ||
      view === 'filter' ||
      view === 'friends' ||
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
  } else if (view === 'friends') {
    inner = (
      <OpenRidingFriendsManage
        firestore={firestore}
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
            {view === 'main' && userId ? (
              <button
                type="button"
                className="shrink-0 p-1 rounded-lg hover:bg-gray-100 border-0 bg-transparent cursor-pointer flex items-center justify-center"
                style={{ width: '2.5em' }}
                onClick={function () {
                  setView('friends');
                }}
                aria-label="친구 관리"
              >
                <img
                  src="assets/img/friends.png"
                  alt=""
                  width={26}
                  height={26}
                  className="block object-contain"
                  decoding="async"
                  onError={function (e) {
                    e.currentTarget.src = 'assets/img/friends.svg';
                    e.currentTarget.onerror = null;
                  }}
                />
              </button>
            ) : (
              <span className="shrink-0 inline-block" style={{ width: '2.5em' }} aria-hidden="true" />
            )}
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
  window.OpenRidingFriendsManage = OpenRidingFriendsManage;
  window.OpenRidingRoomApp = OpenRidingRoomApp;
}

/**
 * 오픈 라이딩방 UI (메인 달력·설정 / 생성 폼 / 상세)
 * @requires React, window.openRidingBoot(모듈)로 useOpenRiding·openRidingService 로드 후 type="text/babel" 로 본 파일 로드
 */
/* global React, ReactDOM */
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
  if (g.water) gearLines.push('식수/개인용(파워젤 및 보급)');
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
  var display = s;
  var i;
  for (i = 0; i < opts.length; i++) {
    if (opts[i].value === s) {
      hint = opts[i].hint != null ? String(opts[i].hint) : '';
      if (opts[i].label != null && String(opts[i].label).trim()) display = String(opts[i].label).trim();
      break;
    }
  }
  if (!hint) return s;
  return display + ' (' + hint + ')';
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

/** inviteSelected 에서 등록 친구 행만 — 정규화 전화 → 친구 UID (알림톡 수신번호 users 프로필 해석용) */
function buildOpenRidingInviteFriendUidMap(inviteSelected) {
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
    if (!x || !x.friendUid) return;
    var k = norm(x.phone);
    var uid = String(x.friendUid).trim().slice(0, 128);
    if (k.length >= 8 && uid) out[k] = uid;
  });
  return out;
}

/** 라이딩 생성 폼 초대 행 { name, phone, key } — 표시명 기준 한글 가나다순 */
function sortOpenRidingInviteRowsByDisplayNameKo(rows) {
  return (rows || []).slice().sort(function (a, b) {
    var na = String(a && a.name != null ? a.name : '').trim();
    var nb = String(b && b.name != null ? b.name : '').trim();
    var cmp = na.localeCompare(nb, 'ko', { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    return String((a && a.phone) || '').localeCompare(String((b && b.phone) || ''), 'ko');
  });
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
  return import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js')
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

/** YYYY-MM-DD → 서울 기준 요일 (일=0 … 토=6) — 달력 기본 일·토 색상용 */
function seoulDowSun0FromYmd(ymd) {
  var s = String(ymd || '').trim().substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 0;
  try {
    var inst = new Date(s + 'T12:00:00+09:00');
    var w = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(inst);
    var map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[w] !== undefined ? map[w] : 0;
  } catch (e) {
    return 0;
  }
}

/** Coerce Firestore Timestamp / {seconds} / Date to Date or null */
function openRidingCoerceRideDateToDate(rideDateField) {
  if (rideDateField == null) return null;
  if (rideDateField instanceof Date && !Number.isNaN(rideDateField.getTime())) return rideDateField;
  if (typeof rideDateField.toDate === 'function') {
    try {
      var t = rideDateField.toDate();
      if (t instanceof Date && !Number.isNaN(t.getTime())) return t;
    } catch (eCoerce) {}
  }
  var sec = Number(
    rideDateField.seconds != null
      ? rideDateField.seconds
      : rideDateField._seconds != null
        ? rideDateField._seconds
        : NaN
  );
  if (Number.isFinite(sec)) return new Date(sec * 1000);
  return null;
}

/** Ride date -> Seoul calendar YYYY-MM-DD */
function getRideDateSeoulYmd(ride) {
  var ts = ride && ride.date != null ? openRidingCoerceRideDateToDate(ride.date) : null;
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

/** Normalize YYYY-M-D vs YYYY-MM-DD for compare */
function openRidingNormalizeYmdString(ymd) {
  if (ymd == null) return '';
  var s = String(ymd).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return s;
  return m[1] + '-' + pad2(parseInt(m[2], 10)) + '-' + pad2(parseInt(m[3], 10));
}

function openRidingYmdEqual(a, b) {
  return openRidingNormalizeYmdString(a) === openRidingNormalizeYmdString(b);
}

/** rides.hostPublicReviewSummary matches ride schedule date */
function rideDocHostSummaryMatchesRideDate(ride, ymd) {
  var h = ride && ride.hostPublicReviewSummary;
  if (!h || !ymd) return false;
  var s = h.summary;
  if (!s || typeof s !== 'object') return false;
  return openRidingYmdEqual(h.rideDateYmd, ymd);
}

/** Stable fingerprint of hostPublicReviewSummary (ignores updatedAt) for effect deps. */
function openRidingHostPublicSummaryStableKey(h) {
  if (!h || typeof h !== 'object') return '';
  var rd = h.rideDateYmd != null ? String(h.rideDateYmd).trim() : '';
  var s = h.summary;
  if (!s || typeof s !== 'object') return rd;
  var dist = s.distance_km != null ? String(Number(s.distance_km)) : '';
  var dur =
    s.duration_sec != null
      ? String(Number(s.duration_sec))
      : s.time != null
        ? String(Number(s.time))
        : '';
  var tss = s.tss != null ? String(Number(s.tss)) : '';
  var spd = s.avg_speed_kmh != null ? String(Number(s.avg_speed_kmh)) : '';
  return [rd, dist, dur, tss, spd].join('|');
}

/** Delegates to openRidingService (single source of truth for ±10% or longer-than-planned rules). */
function openRidingHostSummaryQualifiesAsGroupRideUi(rideData, hostBlock) {
  var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
  if (typeof svc.openRidingHostSummaryQualifiesAsGroupRide === 'function') {
    return svc.openRidingHostSummaryQualifiesAsGroupRide(rideData, hostBlock);
  }
  if (!rideData || !hostBlock || typeof hostBlock !== 'object') return false;
  var s = hostBlock.summary;
  if (!s || typeof s !== 'object') return false;
  var rideYmd = getRideDateSeoulYmd(rideData);
  if (!rideYmd || !openRidingYmdEqual(hostBlock.rideDateYmd, rideYmd)) return false;
  var logged = Number(s.distance_km != null ? s.distance_km : 0) || 0;
  if (!(logged > 0)) return false;
  var planned = Number(rideData.distance != null ? rideData.distance : 0) || 0;
  if (planned > 0) {
    var lo = planned * 0.9;
    var hi = planned * 1.1;
    return (logged >= lo && logged <= hi) || logged > planned;
  }
  return logged >= 12;
}

/** 방장 공개 후기가 해당 일정일에 기록됨(참석·취소 잠금). 서비스 미로드 시 로컬 폴백. */
function openRidingHostPublicReviewWrittenUi(rideData, hostBlock) {
  var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
  if (typeof svc.openRidingHostPublicReviewWritten === 'function') {
    return svc.openRidingHostPublicReviewWritten(rideData, hostBlock);
  }
  if (!rideData || !hostBlock || typeof hostBlock !== 'object') return false;
  var s = hostBlock.summary;
  if (!s || typeof s !== 'object') return false;
  var rideYmd = getRideDateSeoulYmd(rideData);
  if (!rideYmd || !openRidingYmdEqual(hostBlock.rideDateYmd, rideYmd)) return false;
  var logged = Number(s.distance_km != null ? s.distance_km : 0) || 0;
  return logged > 0;
}

function openRidingIsJoinClosedByScheduleUi(ride) {
  var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
  if (typeof svc.isOpenRidingScheduleEnded === 'function') {
    return svc.isOpenRidingScheduleEnded(ride);
  }
  if (typeof svc.isRideJoinClosedBySchedule === 'function') {
    return svc.isRideJoinClosedBySchedule(ride);
  }
  if (!ride) return false;
  if (String(ride.rideStatus || 'active') === 'cancelled') return true;
  var ry = getRideDateSeoulYmd(ride);
  if (!ry) return false;
  var today = getTodaySeoulYmd();
  if (ry < today) return true;
  if (ry > today) return false;
  var h = ride.hostPublicReviewSummary;
  return !!(h && typeof h === 'object' && openRidingHostPublicReviewWrittenUi(ride, h));
}

/** Training log date → Seoul YYYY-MM-DD (journal / open-riding review sync) */
function openRidingLogYmdSeoul(log) {
  if (!log || log.date == null) return '';
  var d = log.date;
  if (typeof d === 'string') return d.length >= 10 ? d.slice(0, 10) : '';
  if (d && typeof d.toDate === 'function') {
    var dt = d.toDate();
    try {
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(dt);
      var y = '';
      var m = '';
      var day = '';
      parts.forEach(function (p) {
        if (p.type === 'year') y = p.value;
        if (p.type === 'month') m = p.value;
        if (p.type === 'day') day = p.value;
      });
      if (y && m && day) return y + '-' + m + '-' + day;
    } catch (e1) {}
  }
  return '';
}

function openRidingLogIsStrava(log) {
  var s = log && log.source != null ? String(log.source).toLowerCase().trim() : '';
  return s === 'strava';
}

/**
 * Host Strava logs same day: activities within ±10% of ride.distance (km), or distance > planned.
 * Among matches, pick the one closest to planned km (avoids picking a random ultra when a ~P ride exists).
 * If ride.distance unset: use single longest activity.
 * @param {object[]} dayLogs filtered same-day Strava logs
 * @param {object} ride
 */
function openRidingPickStravaLogsForHostReview(dayLogs, ride) {
  if (!dayLogs || dayLogs.length === 0) return [];
  var p = Number(ride && ride.distance != null ? ride.distance : 0) || 0;
  var tol = 0.1;
  if (!(p > 0)) {
    if (dayLogs.length === 1) return dayLogs;
    var sortedFallback = dayLogs.slice().sort(function (a, b) {
      return (Number(b.distance_km) || 0) - (Number(a.distance_km) || 0);
    });
    return [sortedFallback[0]];
  }
  var lo = p * (1 - tol);
  var hi = p * (1 + tol);
  var candidates = dayLogs.filter(function (l) {
    var d = Number(l.distance_km != null ? l.distance_km : 0) || 0;
    return (d >= lo && d <= hi) || d > p;
  });
  if (candidates.length === 0) return [];
  candidates.sort(function (a, b) {
    var da = Math.abs((Number(a.distance_km) || 0) - p);
    var db = Math.abs((Number(b.distance_km) || 0) - p);
    return da - db;
  });
  return [candidates[0]];
}

function openRidingReviewFormatDuration(sec) {
  if (sec == null || sec === '' || Number.isNaN(Number(sec))) return '-';
  var s = Math.floor(Number(sec));
  var m = Math.floor(s / 60);
  var h = Math.floor(m / 60);
  s = s % 60;
  m = m % 60;
  if (h > 0) return h + '시간 ' + m + '분 ' + s + '초';
  return m + '분 ' + s + '초';
}

function openRidingReviewAvgSpeedKmh(distanceKm, durationSec) {
  var d = Number(distanceKm) || 0;
  var t = Number(durationSec) || 0;
  if (d <= 0 || t <= 0) return null;
  return Math.round((d / (t / 3600)) * 100) / 100;
}

function openRidingReviewFormatSpeedKmh(v) {
  if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return '-';
  return Number(v).toFixed(1) + ' km/h';
}

function openRidingReviewFormatElevationM(v) {
  if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return '-';
  return Math.round(Number(v)) + ' m';
}

function openRidingReviewFormatCadenceRpm(v) {
  if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return '-';
  return Math.round(Number(v)) + ' rpm';
}

function openRidingReviewFormatWatts(v) {
  if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return '-';
  return Math.round(Number(v)) + ' W';
}

/**
 * 일지 JournalDetailBottomSheet.mergeLogsForDetail 와 동일 규칙 — Summary 탭용 단일 로그
 * @param {object[]} logs 해당 일·STRAVA만 필터된 배열
 */
function openRidingMergeLogsForReviewSummary(logs) {
  if (!logs || logs.length === 0) return null;
  if (logs.length === 1) {
    var log = logs[0];
    var sec = Number(log.duration_sec != null ? log.duration_sec : (log.time != null ? log.time : log.duration)) || 0;
    var dist0 = log.distance_km != null ? Number(log.distance_km) : 0;
    var spdStored0 = log.avg_speed_kmh != null ? Number(log.avg_speed_kmh) : null;
    var spd0 = spdStored0 != null && spdStored0 > 0 ? spdStored0 : openRidingReviewAvgSpeedKmh(dist0, sec);
    return {
      date: log.date,
      distance_km: log.distance_km,
      duration_sec: sec,
      tss: log.tss,
      if: log.if,
      kilojoules: log.kilojoules,
      elevation_gain: log.elevation_gain != null ? Number(log.elevation_gain) : null,
      avg_speed_kmh: spd0,
      avg_cadence: log.avg_cadence,
      avg_hr: log.avg_hr,
      max_hr: log.max_hr,
      avg_watts: log.avg_watts,
      weighted_watts: log.weighted_watts,
      max_watts: log.max_watts,
      time_in_zones: log.time_in_zones,
      source: log.source
    };
  }
  var totalSec = 0;
  var totalTSS = 0;
  var totalDist = 0;
  var totalKj = 0;
  var sumElev = 0;
  var sumCadSec = 0;
  var cadDur = 0;
  var sumNpSec = 0;
  var sumApSec = 0;
  var sumHrSec = 0;
  var maxHr = 0;
  var maxW = 0;
  var aggPower = {};
  var aggHr = {};
  var i;
  for (i = 0; i < logs.length; i++) {
    var l = logs[i];
    var s = Number(l.duration_sec != null ? l.duration_sec : (l.time != null ? l.time : l.duration)) || 0;
    totalSec += s;
    totalTSS += Number(l.tss || 0);
    totalDist += Number(l.distance_km || 0);
    totalKj += Number(l.kilojoules || 0);
    sumElev += Number(l.elevation_gain || 0);
    var c0 = l.avg_cadence != null ? Number(l.avg_cadence) : 0;
    if (c0 > 0 && s > 0) {
      sumCadSec += c0 * s;
      cadDur += s;
    }
    var np = l.weighted_watts != null ? Number(l.weighted_watts) : (l.avg_watts != null ? Number(l.avg_watts) : 0);
    var ap = l.avg_watts != null ? Number(l.avg_watts) : 0;
    var hr = l.avg_hr != null ? Number(l.avg_hr) : 0;
    sumNpSec += np * s;
    sumApSec += ap * s;
    sumHrSec += hr * s;
    maxHr = Math.max(maxHr, Number(l.max_hr || 0));
    maxW = Math.max(maxW, Number(l.max_watts || 0));
    var tiz = l.time_in_zones;
    if (tiz && tiz.power) {
      ['z0', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7'].forEach(function (k) {
        aggPower[k] = (aggPower[k] || 0) + (Number(tiz.power[k]) || 0);
      });
    }
    if (tiz && tiz.hr) {
      ['z1', 'z2', 'z3', 'z4', 'z5'].forEach(function (k) {
        aggHr[k] = (aggHr[k] || 0) + (Number(tiz.hr[k]) || 0);
      });
    }
  }
  var mergedTiz = null;
  if (Object.keys(aggPower).length > 0 || Object.keys(aggHr).length > 0) {
    mergedTiz = { power: aggPower, hr: aggHr };
  } else if (logs[0].time_in_zones) {
    mergedTiz = logs[0].time_in_zones;
  }
  return {
    date: logs[0].date,
    distance_km: totalDist,
    duration_sec: totalSec,
    tss: totalTSS,
    if: null,
    kilojoules: totalKj,
    elevation_gain: sumElev > 0 ? sumElev : null,
    avg_speed_kmh: openRidingReviewAvgSpeedKmh(totalDist, totalSec),
    avg_cadence: cadDur > 0 ? sumCadSec / cadDur : null,
    avg_hr: totalSec > 0 ? sumHrSec / totalSec : null,
    max_hr: maxHr || null,
    avg_watts: totalSec > 0 ? sumApSec / totalSec : null,
    weighted_watts: totalSec > 0 ? sumNpSec / totalSec : null,
    max_watts: maxW || null,
    time_in_zones: mergedTiz,
    source: logs[0].source
  };
}

/** rides.hostPublicReviewSummary.summary → 후기 UI용 log 객체 */
function openRidingReviewLogFromStoredSummary(stored, rideDateYmd) {
  if (!stored || typeof stored !== 'object') return null;
  var sec = Number(stored.duration_sec != null ? stored.duration_sec : stored.time) || 0;
  var dist0 = stored.distance_km != null ? Number(stored.distance_km) : 0;
  var spdStored0 = stored.avg_speed_kmh != null ? Number(stored.avg_speed_kmh) : null;
  var spd0 = spdStored0 != null && spdStored0 > 0 ? spdStored0 : openRidingReviewAvgSpeedKmh(dist0, sec);
  return {
    date: stored.date != null ? stored.date : rideDateYmd,
    distance_km: stored.distance_km,
    duration_sec: sec,
    tss: stored.tss,
    if: stored.if,
    kilojoules: stored.kilojoules,
    elevation_gain: stored.elevation_gain != null ? Number(stored.elevation_gain) : null,
    avg_speed_kmh: spd0,
    avg_cadence: stored.avg_cadence,
    avg_hr: stored.avg_hr,
    max_hr: stored.max_hr,
    zone_ref_max_hr: stored.zone_ref_max_hr,
    zone_ref_year: stored.zone_ref_year,
    zone_ref_window: stored.zone_ref_window,
    avg_watts: stored.avg_watts,
    weighted_watts: stored.weighted_watts,
    max_watts: stored.max_watts,
    time_in_zones: stored.time_in_zones,
    source: stored.source != null ? stored.source : 'strava'
  };
}

function getOpenRidingJournalUserProfileForCharts() {
  var u = typeof window !== 'undefined' && window.currentUser ? window.currentUser : null;
  if (!u) {
    try {
      u = JSON.parse(localStorage.getItem('currentUser') || 'null');
    } catch (eU) {
      u = null;
    }
  }
  var uid = u && (u.id != null ? String(u.id) : u.uid != null ? String(u.uid) : '');
  return {
    id: uid,
    uid: uid,
    ftp: Number(u && u.ftp) || 200,
    max_hr: Number(u && (u.max_hr != null ? u.max_hr : u.maxHr)) || 190
  };
}

/** Firestore hostPublicReviewSummary.chartProfile → DailyTimeInZonesCharts용 */
function openRidingNormalizeChartProfileFromFirestore(cp) {
  if (!cp || typeof cp !== 'object') return null;
  var uid = String(cp.uid != null ? cp.uid : cp.id != null ? cp.id : '').trim();
  if (!uid) return null;
  return {
    id: uid,
    uid: uid,
    ftp: Number(cp.ftp) > 0 ? Number(cp.ftp) : 200,
    max_hr: Number(cp.max_hr) > 0 ? Number(cp.max_hr) : 190
  };
}

/**
 * Host-public review: zone charts use the host (review owner), not the viewer.
 * @param {object|null} log
 * @param {'self'|'host_public'|'host_fallback'|null} reviewMergedLogSource
 * @param {object|null} ride
 */
function openRidingResolveReviewChartUserProfile(log, reviewMergedLogSource, ride) {
  if (reviewMergedLogSource === 'host_public' || reviewMergedLogSource === 'host_fallback') {
    var h = ride && ride.hostPublicReviewSummary;
    var zoneRef = log && Number(log.zone_ref_max_hr) > 0 ? Number(log.zone_ref_max_hr) : 0;
    if (zoneRef <= 0 && h && h.summary && Number(h.summary.zone_ref_max_hr) > 0) {
      zoneRef = Number(h.summary.zone_ref_max_hr);
    }
    var cp = h && openRidingNormalizeChartProfileFromFirestore(h.chartProfile);
    if (zoneRef > 0) {
      if (cp) {
        return { id: cp.id, uid: cp.uid, ftp: cp.ftp, max_hr: zoneRef };
      }
      var hostUidZ = ride && ride.hostUserId != null ? String(ride.hostUserId).trim() : '';
      if (hostUidZ) {
        return { id: hostUidZ, uid: hostUidZ, ftp: 200, max_hr: zoneRef };
      }
    }
    if (cp) return cp;
    var hostUid = ride && ride.hostUserId != null ? String(ride.hostUserId).trim() : '';
    if (hostUid) {
      return {
        id: hostUid,
        uid: hostUid,
        ftp: 200,
        max_hr: log && Number(log.max_hr) > 0 ? Number(log.max_hr) : 190
      };
    }
  }
  return getOpenRidingJournalUserProfileForCharts();
}

/** 서울 기준 라이딩일 → M/D (요일) 예: 4/7 (화) */
function formatRideDateMdDowSeoul(ride) {
  var ts = ride && ride.date != null ? openRidingCoerceRideDateToDate(ride.date) : null;
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

function parseOpenRidingDepartureHm(str) {
  var s = String(str || '').trim();
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return { h: 0, mi: 0 };
  var h = parseInt(m[1], 10);
  var mi = parseInt(m[2], 10);
  if (!Number.isFinite(h) || h < 0) h = 0;
  if (!Number.isFinite(mi) || mi < 0) mi = 0;
  h = Math.min(23, h);
  mi = Math.min(59, mi);
  return { h: h, mi: mi };
}

function getSeoulClockHourMinuteNow() {
  try {
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    var h = 0;
    var mi = 0;
    parts.forEach(function (p) {
      if (p.type === 'hour') h = parseInt(p.value, 10) || 0;
      if (p.type === 'minute') mi = parseInt(p.value, 10) || 0;
    });
    return { h: h, mi: mi };
  } catch (e) {
    var d = new Date();
    return { h: d.getHours(), mi: d.getMinutes() };
  }
}

/** 거리 기반 예상 라이딩 소요(분): 그룹 라이딩 가정 + 여유 버퍼 */
function openRidingEstimatedRideDurationMinutes(ride) {
  var km = Number(ride != null ? ride.distance : 0) || 0;
  if (!(km > 0)) return 180;
  var rideMin = Math.ceil((km / 22) * 60);
  return Math.min(780, Math.max(45, rideMin + 30));
}

/**
 * [나의 라이딩] 주최 행 보라 배지: 연한 보라 = 당일 일정상 종료(출발+예상 소요 경과 등).
 * — 취소된 라이딩은 취소 아이콘만 사용
 */
function isHostedRideScheduleEndedForListIcon(ride) {
  if (!ride || String(ride.rideStatus || 'active') === 'cancelled') return false;
  var ry = getRideDateSeoulYmd(ride);
  if (!ry) return false;
  if (!openRidingYmdEqual(ry, getTodaySeoulYmd())) return false;
  var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
  if (typeof svc.isOpenRidingScheduleEnded === 'function' && svc.isOpenRidingScheduleEnded(ride)) return true;
  var dep = parseOpenRidingDepartureHm(ride.departureTime);
  var depMin = dep.h * 60 + dep.mi;
  var now = getSeoulClockHourMinuteNow();
  var nowMin = now.h * 60 + now.mi;
  var dur = openRidingEstimatedRideDurationMinutes(ride);
  var endMin = depMin + dur;
  if (endMin < 24 * 60) return nowMin >= endMin;
  return nowMin >= depMin || nowMin < endMin - 24 * 60;
}


/**
 * Seoul calendar: ride YMD <= today YMD (today included). Host review for non-participants.
 */
function isOpenRidingRideDayOnOrBeforeTodaySeoul(ride) {
  var rideYmd = getRideDateSeoulYmd(ride);
  if (!rideYmd) return false;
  return rideYmd <= getTodaySeoulYmd();
}

/** Ride schedule date is today (Seoul) */
function openRidingIsRideScheduleDayTodaySeoul(ride) {
  var ry = getRideDateSeoulYmd(ride);
  return !!ry && openRidingYmdEqual(ry, getTodaySeoulYmd());
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

/** GPX 지도: 스크롤 가능한 조상(페이지 본문 등) — veil 위 휠 시 전달 */
function openRidingFindScrollableAncestor(el) {
  var p = el;
  var i;
  for (i = 0; i < 32 && p; i++) {
    if (p === document.body || p === document.documentElement) {
      return document.scrollingElement || document.documentElement;
    }
    try {
      var st = window.getComputedStyle(p);
      var oy = st.overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && p.scrollHeight > p.clientHeight + 1) return p;
    } catch (e0) {}
    p = p.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

var OPEN_RIDING_GPX_VEIL_CLASS = 'open-riding-gpx-map-interact-veil';

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
  /** false = OFF(기본): 지도 고정 · 페이지 스크롤 우선 / true = ON: 이동·휠·터치 줌 허용 */
  var _mi = useState(false);
  var mapInteractOn = _mi[0];
  var setMapInteractOn = _mi[1];

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

  /**
   * OFF: Leaflet 핸들러는 건드리지 않고 투명 veil로 이벤트 차단(타일 유지).
   * z-index 2000 > 타일·벡터·Leaflet +/-(~1000) → OFF에서 지도 클릭·드래그·휠·핀치·줌 버튼 모두 차단.
   * ON/OFF 토글은 leaflet 밖 형제 노드(z-index 1000)라 계속 클릭 가능.
   */
  useEffect(
    function () {
      var map = mapInstRef.current;
      var container = map && map.getContainer ? map.getContainer() : null;
      if (!container) return undefined;

      function removeAllVeils() {
        var found = container.querySelectorAll('.' + OPEN_RIDING_GPX_VEIL_CLASS);
        var fi;
        for (fi = 0; fi < found.length; fi++) {
          try {
            found[fi].remove();
          } catch (er) {}
        }
      }

      removeAllVeils();

      if (!mapInteractOn) {
        var veil = document.createElement('div');
        veil.className = OPEN_RIDING_GPX_VEIL_CLASS;
        veil.setAttribute('aria-hidden', 'true');
        veil.style.cssText =
          'position:absolute;left:0;top:0;right:0;bottom:0;z-index:2000;' +
          'touch-action:none;cursor:default;background:transparent;pointer-events:auto;';
        var scrollEl = openRidingFindScrollableAncestor(container);

        function stopBubble(ev) {
          ev.stopPropagation();
        }

        var blockTypes = ['pointerdown', 'pointerup', 'pointercancel', 'click', 'dblclick', 'contextmenu', 'mousedown', 'mouseup'];
        var bi;
        for (bi = 0; bi < blockTypes.length; bi++) {
          veil.addEventListener(blockTypes[bi], stopBubble, true);
        }

        var onWheel = function (ev) {
          ev.stopPropagation();
          if (scrollEl) scrollEl.scrollTop += ev.deltaY;
        };
        veil.addEventListener('wheel', onWheel, { passive: true });

        var lastTouchY = null;
        function onTouchStart(ev) {
          stopBubble(ev);
          if (ev.touches.length === 1) lastTouchY = ev.touches[0].clientY;
          else lastTouchY = null;
        }
        function onTouchMove(ev) {
          stopBubble(ev);
          if (ev.touches.length >= 2) {
            try {
              ev.preventDefault();
            } catch (ep) {}
            return;
          }
          if (!scrollEl || ev.touches.length !== 1 || lastTouchY == null) return;
          var y = ev.touches[0].clientY;
          var dy = lastTouchY - y;
          lastTouchY = y;
          scrollEl.scrollTop += dy;
        }
        function onTouchEnd(ev) {
          stopBubble(ev);
          if (!ev.touches || ev.touches.length === 0) lastTouchY = null;
          else if (ev.touches.length === 1) lastTouchY = ev.touches[0].clientY;
        }
        veil.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
        veil.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
        veil.addEventListener('touchend', onTouchEnd, { passive: false, capture: true });
        veil.addEventListener('touchcancel', onTouchEnd, { passive: false, capture: true });

        function onGestureBlock(ev) {
          try {
            ev.preventDefault();
          } catch (eg) {}
        }
        if (typeof veil.addEventListener === 'function') {
          try {
            veil.addEventListener('gesturestart', onGestureBlock, { passive: false });
            veil.addEventListener('gesturechange', onGestureBlock, { passive: false });
            veil.addEventListener('gestureend', onGestureBlock, { passive: false });
          } catch (eg2) {}
        }

        container.appendChild(veil);
        return function () {
          var bj;
          for (bj = 0; bj < blockTypes.length; bj++) {
            try {
              veil.removeEventListener(blockTypes[bj], stopBubble, true);
            } catch (e1) {}
          }
          try {
            veil.removeEventListener('wheel', onWheel);
          } catch (ew) {}
          try {
            veil.removeEventListener('touchstart', onTouchStart, true);
            veil.removeEventListener('touchmove', onTouchMove, true);
            veil.removeEventListener('touchend', onTouchEnd, true);
            veil.removeEventListener('touchcancel', onTouchEnd, true);
            veil.removeEventListener('gesturestart', onGestureBlock);
            veil.removeEventListener('gesturechange', onGestureBlock);
            veil.removeEventListener('gestureend', onGestureBlock);
          } catch (et) {}
          removeAllVeils();
        };
      }

      return function () {
        removeAllVeils();
      };
    },
    [mapInteractOn, loadState.status, loadState.track, mapRemountKey]
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
        className="relative w-full rounded-xl overflow-hidden border border-violet-200/80 bg-slate-100 shadow-sm open-riding-gpx-map-wrap"
        style={{ height: 'clamp(220px, 42vh, 300px)', width: '100%' }}
      >
        {/*
          z-index:0 wrapper → 독립 stacking context 생성.
          veil(z-2000)은 이 wrapper 안에 갇혀, 외부 toggle(z-10)이 항상 위에 위치.
        */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          <div ref={mapRef} className="open-riding-gpx-map-inner w-full h-full" style={{ height: '100%', minHeight: '220px' }} />
        </div>
        {/* toggle: 외부 stacking context z-10 → Leaflet wrapper(z-0) 전체보다 위 */}
        <div
          className="absolute pointer-events-none flex flex-col gap-1 open-riding-gpx-map-interact-toggle-wrap"
          style={{ top: '4.75rem', left: '10px', zIndex: 10 }}
        >
          <div
            className="pointer-events-auto flex rounded-md border border-slate-300/90 bg-white shadow-md overflow-hidden text-[11px] font-bold select-none"
            role="group"
            aria-label="지도 확대·이동 허용"
          >
            <button
              type="button"
              aria-pressed={!mapInteractOn}
              className={
                'px-2.5 py-1 min-w-[2.25rem] transition ' +
                (!mapInteractOn ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')
              }
              onClick={function () {
                setMapInteractOn(false);
              }}
            >
              OFF
            </button>
            <button
              type="button"
              aria-pressed={mapInteractOn}
              className={
                'px-2.5 py-1 min-w-[2.25rem] border-l border-slate-200 transition ' +
                (mapInteractOn ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')
              }
              onClick={function () {
                setMapInteractOn(true);
              }}
            >
              ON
            </button>
          </div>
        </div>
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

function openRidingGlassNavBtnClass(isActive) {
  return (
    'open-riding-bottom-glass-nav__btn rounded-xl border-0 bg-transparent' +
    (isActive ? ' open-riding-bottom-glass-nav__btn--active' : '')
  );
}

/** 라이딩 모임 하단 네비 가로 스크롤 — 좌·우 더 스크롤 가능 힌트(랭킹 허브 네비와 동일 규칙) */
function openRidingMoimNavUpdateScrollEdgeHints(root) {
  if (!root) return;
  var sc = root.querySelector('.global-hub-glass-nav-scroll');
  var left = root.querySelector('.global-hub-glass-nav-edge--left');
  var right = root.querySelector('.global-hub-glass-nav-edge--right');
  if (!sc || !left || !right) return;
  var epsilon = 3;
  var maxScroll = sc.scrollWidth - sc.clientWidth;
  if (maxScroll <= epsilon) {
    left.classList.remove('global-hub-glass-nav-edge--visible');
    right.classList.remove('global-hub-glass-nav-edge--visible');
    return;
  }
  if (sc.scrollLeft <= epsilon) left.classList.remove('global-hub-glass-nav-edge--visible');
  else left.classList.add('global-hub-glass-nav-edge--visible');
  if (sc.scrollLeft >= maxScroll - epsilon) right.classList.remove('global-hub-glass-nav-edge--visible');
  else right.classList.add('global-hub-glass-nav-edge--visible');
}

function openRidingMoimNavScrollActiveIntoView(root, activeBtn) {
  if (!root || !activeBtn) return;
  var sc = root.querySelector('.global-hub-glass-nav-scroll');
  if (!sc) return;
  requestAnimationFrame(function () {
    try {
      var br = activeBtn.getBoundingClientRect();
      var sr = sc.getBoundingClientRect();
      var btnCx = br.left + br.width / 2;
      var scCx = sr.left + sr.width / 2;
      var delta = btnCx - scCx;
      var maxScroll = Math.max(0, sc.scrollWidth - sc.clientWidth);
      sc.scrollLeft = Math.max(0, Math.min(sc.scrollLeft + delta, maxScroll));
      openRidingMoimNavUpdateScrollEdgeHints(root);
    } catch (err) {}
  });
}

/** iOS 휴대폰(Android 제외). 포털 네비 하단 추가 오프셋·본문 패딩 보정용 */
function openRidingIsIOSPhoneUA() {
  if (typeof navigator === 'undefined') return false;
  var ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return false;
  if (/iPhone|iPod/.test(ua)) return true;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  return false;
}

function OpenRidingGlassNavSlot(p) {
  return <div className="open-riding-bottom-glass-nav__slot">{p.children}</div>;
}

/** body 포털 + 동일 글래스 DOM — 터치 레이어 규칙은 style.css(#openRidingBottomGlassNavRoot)에 일괄 정의 */
function OpenRidingGlassNavPortal(p) {
  var innerContent = p.innerContent;
  var ariaLabel = p.ariaLabel || '하단 메뉴';
  var enableScrollStrip = !!p.enableScrollStrip;
  var scrollSyncKey = p.scrollSyncKey;
  var navRef = useRef(null);

  useEffect(
    function () {
      if (!openRidingIsIOSPhoneUA()) return undefined;
      var el = document.documentElement;
      el.classList.add('open-riding-glass-nav-ios-phone');
      return function () {
        el.classList.remove('open-riding-glass-nav-ios-phone');
      };
    },
    []
  );

  useEffect(
    function () {
      if (!enableScrollStrip) return undefined;
      var root = navRef.current;
      if (!root) return undefined;
      if (root.getAttribute('data-open-riding-scroll-hint') === '1') return undefined;
      root.setAttribute('data-open-riding-scroll-hint', '1');
      var sc = root.querySelector('.global-hub-glass-nav-scroll');
      if (!sc) return undefined;
      var onScroll = function () {
        openRidingMoimNavUpdateScrollEdgeHints(root);
      };
      sc.addEventListener('scroll', onScroll, { passive: true });
      var onResize = function () {
        openRidingMoimNavUpdateScrollEdgeHints(root);
      };
      window.addEventListener('resize', onResize);
      var ro = null;
      if (typeof ResizeObserver !== 'undefined') {
        try {
          ro = new ResizeObserver(function () {
            openRidingMoimNavUpdateScrollEdgeHints(root);
          });
          ro.observe(sc);
        } catch (eRo) {}
      }
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          openRidingMoimNavUpdateScrollEdgeHints(root);
        });
      });
      return function () {
        sc.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
        if (ro) {
          try {
            ro.disconnect();
          } catch (eD) {}
        }
        root.removeAttribute('data-open-riding-scroll-hint');
      };
    },
    [enableScrollStrip]
  );

  useEffect(
    function () {
      if (!enableScrollStrip) return;
      var root = navRef.current;
      if (!root) return;
      var activeBtn = root.querySelector('.open-riding-bottom-glass-nav__btn--active');
      openRidingMoimNavScrollActiveIntoView(root, activeBtn);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          openRidingMoimNavUpdateScrollEdgeHints(root);
        });
      });
    },
    [enableScrollStrip, scrollSyncKey]
  );

  var edgeLeft = (
    <span className="global-hub-glass-nav-edge global-hub-glass-nav-edge--left" aria-hidden="true">
      <span className="global-hub-glass-nav-edge__blob">
        <svg
          className="global-hub-glass-nav-edge__svg"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </span>
    </span>
  );
  var edgeRight = (
    <span className="global-hub-glass-nav-edge global-hub-glass-nav-edge--right" aria-hidden="true">
      <span className="global-hub-glass-nav-edge__blob">
        <svg
          className="global-hub-glass-nav-edge__svg"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </span>
    </span>
  );

  var surfaceInner = enableScrollStrip ? (
    <div className="global-hub-glass-nav-scroll-wrap">
      <div className="global-hub-glass-nav-scroll">
        <div className="open-riding-bottom-glass-nav__inner global-hub-glass-nav-inner global-hub-glass-nav-inner--scroll">{innerContent}</div>
      </div>
      {edgeLeft}
      {edgeRight}
    </div>
  ) : (
    <div className="open-riding-bottom-glass-nav__inner">{innerContent}</div>
  );

  var navEl = (
    <nav
      ref={navRef}
      id="openRidingBottomGlassNavRoot"
      className={'open-riding-bottom-glass-nav' + (enableScrollStrip ? ' open-riding-moim-glass-nav--scroll' : '')}
      role="navigation"
      aria-label={ariaLabel}
    >
      <div className="open-riding-bottom-glass-nav__pill">
        <div className="open-riding-bottom-glass-nav__pill-bg" aria-hidden="true" />
        <div className="open-riding-bottom-glass-nav__pill-surface">{surfaceInner}</div>
      </div>
    </nav>
  );
  var rd = typeof ReactDOM !== 'undefined' ? ReactDOM : typeof window !== 'undefined' ? window.ReactDOM : undefined;
  if (typeof document !== 'undefined' && rd && typeof rd.createPortal === 'function') {
    return rd.createPortal(navEl, document.body);
  }
  return navEl;
}

/**
 * 라이딩 모임 하단 네비: 홈·모임·주최·그룹·친구·맞춤 (가로 스크롤 + 허브와 동일 좌우 힌트)
 */
function OpenRidingBottomGlassNav(props) {
  var nv = props.navVariant || 'main';
  var navVariant =
    nv === 'filter' || nv === 'friends' || nv === 'groups' ? nv : 'main';
  var moimActive = navVariant === 'main';
  var filterActive = navVariant === 'filter';
  var groupsActive = navVariant === 'groups';
  var onHome = props.onHome || function () {};
  var onMoim = props.onMoim || function () {};
  var onFilter = props.onFilter || function () {};
  var onCreate = props.onCreate || function () {};
  var onGroups = props.onGroups || function () {};
  var onFriends = props.onFriends || function () {};
  var pendingIncomingCount = typeof props.pendingIncomingCount === 'number' ? props.pendingIncomingCount : 0;
  var pendingGroupJoinCount = typeof props.pendingGroupJoinCount === 'number' ? props.pendingGroupJoinCount : 0;
  var userId = props.userId || '';

  function iconHome() {
    return (
      <svg className="open-riding-bottom-glass-nav__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    );
  }

  function iconMoim() {
    return (
      <svg className="open-riding-bottom-glass-nav__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }

  function iconFilter() {
    return (
      <svg className="open-riding-bottom-glass-nav__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
      </svg>
    );
  }

  function iconJuchey() {
    return (
      <svg className="open-riding-bottom-glass-nav__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
      </svg>
    );
  }

  function renderFriendsButton(isActive) {
    if (!userId) {
      return (
        <OpenRidingGlassNavSlot>
          <button type="button" className={openRidingGlassNavBtnClass(false)} disabled aria-disabled="true" title="로그인 후 이용 가능합니다">
            <img src="assets/img/friends.png" alt="" width={20} height={20} className="open-riding-bottom-glass-nav__friend-img block object-contain" decoding="async" onError={function (e) { e.currentTarget.src = 'assets/img/friends.svg'; e.currentTarget.onerror = null; }} />
            <span className="open-riding-bottom-glass-nav__label">친구</span>
          </button>
        </OpenRidingGlassNavSlot>
      );
    }
    return (
      <OpenRidingGlassNavSlot>
        <button type="button" className={openRidingGlassNavBtnClass(isActive)} onClick={onFriends} aria-current={isActive ? 'page' : undefined} aria-label={'친구' + (pendingIncomingCount > 0 ? ' (새 요청 ' + pendingIncomingCount + '건)' : '')}>
          <span className="open-riding-bottom-glass-nav__icon-wrap relative inline-flex items-center justify-center">
            <img src="assets/img/friends.png" alt="" width={20} height={20} className="open-riding-bottom-glass-nav__friend-img block object-contain" decoding="async" onError={function (e) { e.currentTarget.src = 'assets/img/friends.svg'; e.currentTarget.onerror = null; }} />
            {pendingIncomingCount > 0 ? (
              <span className="open-riding-bottom-glass-nav__badge absolute flex items-center justify-center rounded-full bg-violet-600 text-white font-bold leading-none border-2 border-white shadow-sm pointer-events-none" style={{ minWidth: '17px', height: '17px', fontSize: pendingIncomingCount > 9 ? 9 : 10, paddingLeft: pendingIncomingCount > 9 ? 3 : 4, paddingRight: pendingIncomingCount > 9 ? 3 : 4, top: 0, right: 0, transform: 'translate(45%, -40%)' }} aria-hidden="true">
                {pendingIncomingCount > 99 ? '99+' : pendingIncomingCount}
              </span>
            ) : null}
          </span>
          <span className="open-riding-bottom-glass-nav__label">친구</span>
        </button>
      </OpenRidingGlassNavSlot>
    );
  }

  var friendsActive = navVariant === 'friends';

  function renderGroupsButton(isActive) {
    return (
      <OpenRidingGlassNavSlot>
        <button
          type="button"
          className={openRidingGlassNavBtnClass(isActive)}
          onClick={onGroups}
          aria-current={isActive ? 'page' : undefined}
          aria-label={'그룹' + (pendingGroupJoinCount > 0 ? ' (가입 요청 ' + pendingGroupJoinCount + '건)' : '')}
        >
          <span className="open-riding-bottom-glass-nav__icon-wrap relative inline-flex items-center justify-center">
            <img
              src="assets/img/people.png"
              alt=""
              width={20}
              height={20}
              className="open-riding-bottom-glass-nav__friend-img block object-contain"
              decoding="async"
              onError={function (e) {
                e.currentTarget.src = 'assets/img/user.png';
                e.currentTarget.onerror = function () { e.currentTarget.style.display = 'none'; };
              }}
            />
            {pendingGroupJoinCount > 0 ? (
              <span
                className="open-riding-bottom-glass-nav__badge absolute flex items-center justify-center rounded-full bg-violet-600 text-white font-bold leading-none border-2 border-white shadow-sm pointer-events-none"
                style={{ minWidth: '17px', height: '17px', fontSize: pendingGroupJoinCount > 9 ? 9 : 10, paddingLeft: pendingGroupJoinCount > 9 ? 3 : 4, paddingRight: pendingGroupJoinCount > 9 ? 3 : 4, top: 0, right: 0, transform: 'translate(45%, -40%)' }}
                aria-hidden="true"
              >
                {pendingGroupJoinCount > 99 ? '99+' : pendingGroupJoinCount}
              </span>
            ) : null}
          </span>
          <span className="open-riding-bottom-glass-nav__label">그룹</span>
        </button>
      </OpenRidingGlassNavSlot>
    );
  }

  var innerContent = (
    <>
      <OpenRidingGlassNavSlot>
        <button type="button" className={openRidingGlassNavBtnClass(false)} onClick={onHome} aria-label="홈 — 베이스캠프">
          {iconHome()}
          <span className="open-riding-bottom-glass-nav__label">홈</span>
        </button>
      </OpenRidingGlassNavSlot>
      <OpenRidingGlassNavSlot>
        <button
          type="button"
          className={openRidingGlassNavBtnClass(moimActive)}
          onClick={onMoim}
          aria-current={moimActive ? 'page' : undefined}
          aria-label="라이딩 모임 달력"
        >
          {iconMoim()}
          <span className="open-riding-bottom-glass-nav__label">모임</span>
        </button>
      </OpenRidingGlassNavSlot>
      {renderGroupsButton(groupsActive)}
      {renderFriendsButton(friendsActive)}
      <OpenRidingGlassNavSlot>
        <button type="button" className={openRidingGlassNavBtnClass(filterActive)} onClick={onFilter} aria-current={filterActive ? 'page' : undefined} aria-label="맞춤 필터">
          {iconFilter()}
          <span className="open-riding-bottom-glass-nav__label">맞춤</span>
        </button>
      </OpenRidingGlassNavSlot>
    </>
  );

  return (
    <OpenRidingGlassNavPortal
      innerContent={innerContent}
      ariaLabel="라이딩 모임 하단 메뉴"
      enableScrollStrip={true}
      scrollSyncKey={navVariant}
    />
  );
}

/** 상세 화면 하단: 홈·모임·수정·폭파·삭제 (기존 툴바 아이콘 재사용) */
function OpenRidingDetailGlassNav(props) {
  var onHome = props.onHome || function () {};
  var onMoim = props.onMoim || function () {};
  var onEdit = props.onEdit || function () {};
  var onCancel = props.onCancel || function () {};
  var onDelete = props.onDelete || function () {};
  var hostToolbarLocked = !!props.hostToolbarLocked;
  var showHostActions = !!props.showHostActions;

  function iconHomeNav() {
    return (
      <svg className="open-riding-bottom-glass-nav__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    );
  }

  function iconMoimNav() {
    return (
      <svg className="open-riding-bottom-glass-nav__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }

  var innerContent = (
    <>
      <OpenRidingGlassNavSlot>
        <button type="button" className={openRidingGlassNavBtnClass(false)} onClick={onHome} aria-label="홈 — 베이스캠프">
          {iconHomeNav()}
          <span className="open-riding-bottom-glass-nav__label">홈</span>
        </button>
      </OpenRidingGlassNavSlot>
      <OpenRidingGlassNavSlot>
        <button type="button" className={openRidingGlassNavBtnClass(false)} onClick={onMoim} aria-label="라이딩 모임 달력으로">
          {iconMoimNav()}
          <span className="open-riding-bottom-glass-nav__label">모임</span>
        </button>
      </OpenRidingGlassNavSlot>
      <OpenRidingGlassNavSlot>
        <button
          type="button"
          className={openRidingGlassNavBtnClass(false)}
          onClick={onEdit}
          disabled={!showHostActions || hostToolbarLocked}
          aria-label="라이딩 수정"
          title={
            !showHostActions
              ? '방장 또는 관리자만 이용할 수 있습니다.'
              : hostToolbarLocked
                ? '라이딩 일정일이 지나 수정할 수 없습니다.'
                : undefined
          }
        >
          <OpenRidingDashboardEditIcon className="open-riding-bottom-glass-nav__icon text-violet-600 shrink-0" />
          <span className="open-riding-bottom-glass-nav__label">수정</span>
        </button>
      </OpenRidingGlassNavSlot>
      <OpenRidingGlassNavSlot>
        <button
          type="button"
          className={openRidingGlassNavBtnClass(false)}
          onClick={onCancel}
          disabled={!showHostActions || hostToolbarLocked}
          aria-label="라이딩 폭파"
          title={
            !showHostActions
              ? '방장 또는 관리자만 이용할 수 있습니다.'
              : hostToolbarLocked
                ? '라이딩 일정일이 지나 폭파할 수 없습니다.'
                : undefined
          }
        >
          <img src="assets/img/cancel01.png" alt="" width={20} height={20} className="open-riding-bottom-glass-nav__friend-img block object-contain" decoding="async" />
          <span className="open-riding-bottom-glass-nav__label">폭파</span>
        </button>
      </OpenRidingGlassNavSlot>
      <OpenRidingGlassNavSlot>
        <button
          type="button"
          className={openRidingGlassNavBtnClass(false)}
          onClick={onDelete}
          disabled={!showHostActions || hostToolbarLocked}
          aria-label="라이딩 삭제"
          title={
            !showHostActions
              ? '방장 또는 관리자만 이용할 수 있습니다.'
              : hostToolbarLocked
                ? '라이딩 일정일이 지나 삭제할 수 없습니다.'
                : undefined
          }
        >
          <img src="assets/img/delete2.png" alt="" width={20} height={20} className="open-riding-bottom-glass-nav__friend-img block object-contain" decoding="async" />
          <span className="open-riding-bottom-glass-nav__label">삭제</span>
        </button>
      </OpenRidingGlassNavSlot>
    </>
  );

  return <OpenRidingGlassNavPortal innerContent={innerContent} ariaLabel="라이딩 상세 하단 메뉴" />;
}

/** 수정 폼 하단: 모임·수정(상세)·삭제·저장 */
function OpenRidingEditGlassNav(props) {
  var onMoim = props.onMoim || function () {};
  var onEdit = props.onEdit || function () {};
  var onDelete = props.onDelete || function () {};
  var onSave = props.onSave || function () {};
  var isBusy = !!props.isBusy;
  var hostToolbarLocked = !!props.hostToolbarLocked;

  function iconMoimNav() {
    return (
      <svg className="open-riding-bottom-glass-nav__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  var innerContent = (
    <>
      <OpenRidingGlassNavSlot>
        <button type="button" className={openRidingGlassNavBtnClass(false)} onClick={onMoim} aria-label="라이딩 모임 달력으로">
          {iconMoimNav()}
          <span className="open-riding-bottom-glass-nav__label">모임</span>
        </button>
      </OpenRidingGlassNavSlot>
      <OpenRidingGlassNavSlot>
        <button
          type="button"
          className={openRidingGlassNavBtnClass(true)}
          onClick={onEdit}
          aria-current="page"
          aria-label="세부 내용 화면으로"
        >
          <OpenRidingDashboardEditIcon className="open-riding-bottom-glass-nav__icon text-violet-600 shrink-0" />
          <span className="open-riding-bottom-glass-nav__label">수정</span>
        </button>
      </OpenRidingGlassNavSlot>
      <OpenRidingGlassNavSlot>
        <button
          type="button"
          className={openRidingGlassNavBtnClass(false)}
          onClick={onDelete}
          disabled={hostToolbarLocked}
          aria-label="라이딩 삭제"
          title={hostToolbarLocked ? '라이딩 일정일이 지나 삭제할 수 없습니다.' : undefined}
        >
          <img src="assets/img/delete2.png" alt="" width={20} height={20} className="open-riding-bottom-glass-nav__friend-img block object-contain" decoding="async" />
          <span className="open-riding-bottom-glass-nav__label">삭제</span>
        </button>
      </OpenRidingGlassNavSlot>
      <OpenRidingGlassNavSlot>
        <button type="button" className={openRidingGlassNavBtnClass(false)} onClick={onSave} disabled={isBusy} aria-label="저장">
          <img src="assets/img/save3.png" alt="" width={20} height={20} className="open-riding-bottom-glass-nav__friend-img block object-contain" decoding="async" />
          <span className="open-riding-bottom-glass-nav__label">저장</span>
        </button>
      </OpenRidingGlassNavSlot>
    </>
  );

  return <OpenRidingGlassNavPortal innerContent={innerContent} ariaLabel="라이딩 수정 하단 메뉴" />;
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
  var ridesMyList = hook.ridesMyList || [];
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

  /** 주최 목록의 종료(연한 보라) 표시가 출발+예상 시각 경과 시 갱신되도록 1분마다 리렌더 */
  var _hostedClock = useState(0);
  var hostedListClockBump = _hostedClock[0];
  var setHostedListClockBump = _hostedClock[1];
  useEffect(
    function () {
      var id = typeof window !== 'undefined' ? window.setInterval(function () {
        setHostedListClockBump(function (n) {
          return n + 1;
        });
      }, 60000) : 0;
      return function () {
        if (id) window.clearInterval(id);
      };
    },
    []
  );
  void hostedListClockBump;

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

  /**
   * 컴팩트 라이딩 모임 [나의 라이딩]: 주최 · 전화 초대 · 그 외 참석 확정(비초대 경로)
   * — 행별 kind로 원 체크 색 구분(보라/녹/빨)
   */
  var myRidesUnifiedRows = useMemo(
    function () {
      var uid = String(userId || '');
      if (!uid) return [];
      var phone = String(inviteCheckPhone || '').trim();
      var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
      var isInv =
        typeof svc.isUserPhoneInvitedToRide === 'function'
          ? svc.isUserPhoneInvitedToRide
          : function () {
              return false;
            };
      var rows = [];
      var seen = Object.create(null);
      function addRow(r, kind) {
        if (!r || r.id == null) return;
        var id = String(r.id);
        if (seen[id]) return;
        if (isOpenRidingPastBySeoulDate(r)) return;
        seen[id] = true;
        rows.push({ r: r, kind: kind });
      }
      ridesMyList.forEach(function (r) {
        if (String(r.hostUserId || '') === uid) {
          addRow(r, 'host');
        }
      });
      if (phone) {
        ridesMyList.forEach(function (r) {
          if (String(r.hostUserId || '') === uid) return;
          var il = Array.isArray(r.invitedList) ? r.invitedList : [];
          if (!il.length) return;
          if (!isInv(phone, r.invitedList)) return;
          addRow(r, 'invited');
        });
      }
      ridesMyList.forEach(function (r) {
        if (isOpenRidingPastBySeoulDate(r)) return;
        if (String(r.hostUserId || '') === uid) return;
        var id = r != null && r.id != null ? String(r.id) : '';
        if (!id || seen[id]) return;
        if (String(r.rideStatus || 'active') === 'cancelled') return;
        var parts = openRideIdsFromFirestoreListField(r.participants);
        var inPart = parts.some(function (p) {
          return String(p) === uid;
        });
        if (!inPart) return;
        var il = Array.isArray(r.invitedList) ? r.invitedList : [];
        if (phone && il.length && isInv(phone, r.invitedList)) return;
        addRow(r, 'other');
      });
      var sorted = sortOpenRidingListByDateTime(rows.map(function (x) {
        return x.r;
      }));
      var kindById = Object.create(null);
      rows.forEach(function (x) {
        kindById[String(x.r.id)] = x.kind;
      });
      return sorted.map(function (r) {
        return { r: r, kind: kindById[String(r.id)] };
      });
    },
    [ridesMyList, userId, inviteCheckPhone]
  );

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
        period: 'rolling6m',
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
    var chartRefValueNote = realisticStats ? ' (최근 6개월)' : ' (프로필)';

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
                    {(opt.label != null && String(opt.label).trim() ? opt.label : opt.value) + ' '}
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
              관심 레벨 판별: 평지 개인 평속(60분 피크 우선, 없으면 FTP×93%) · 구간은 입문~상급 항속 기준
            </span>
          </div>
          {!prof.ok ? (
            <p className="text-xs text-slate-600 m-0 leading-relaxed">
              프로필에 <strong>FTP</strong>와 <strong>체중</strong>을 입력하면, 관심 레벨 배지는
              <strong> 평지 개인 평속(60분 피크·없으면 FTP 평속×93%)</strong>으로 입문~상급 항속 구간과 비교합니다.
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
                현실 지표 (최근 6개월 · 60분 최대 평균 파워·체중, 랭킹보드와 동일 산출)
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
              pillLabelOverride="전체 · 60분 W/kg · 최근 6개월"
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

  /* Hosted-list green badge: guest in participants, waitlist, or participantDisplay */
  function openRideIdsFromFirestoreListField(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.keys(v);
    return [];
  }

  function openRidingMoimSpectatorBadgeGradeOk() {
    if (typeof window === 'undefined') return true;
    if (typeof window.getLoginUserGrade !== 'function') return true;
    var g = window.getLoginUserGrade();
    if (g == null || g === '') return true;
    var s = String(g).trim();
    var n = Number(s);
    return s === '1' || s === '2' || s === '3' || n === 1 || n === 2 || n === 3;
  }

  function isUserParticipantConfirmedForRide(r) {
    var uid = String(userId || '');
    if (!uid) return false;
    if (String(r.rideStatus || 'active') === 'cancelled') return false;
    var parts = openRideIdsFromFirestoreListField(r.participants);
    return parts.some(function (p) {
      return String(p) === uid;
    });
  }

  /** 현재 사용자가 해당 라이��� 대기열(waitlist)에 있는지 */
  function isUserWaitlistedForRide(r) {
    var uid = String(userId || '');
    if (!uid) return false;
    if (String(r.rideStatus || 'active') === 'cancelled') return false;
    var waits = openRideIdsFromFirestoreListField(r.waitlist);
    return waits.some(function (w) {
      return String(w) === uid;
    });
  }

  /** 날짜 선택 패널: 참석 신청 가능(공개·초대·입장 비번) — 등급과 무관 */
  function canUserApplyOpenRidingDayList(ride) {
    if (!ride || String(ride.rideStatus || 'active') === 'cancelled') return false;
    var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
    if (typeof svc.isOpenRidingScheduleEnded === 'function' && svc.isOpenRidingScheduleEnded(ride)) return false;
    if (!userId) return false;
    if (isUserParticipantConfirmedForRide(ride)) return false;
    if (isUserWaitlistedForRide(ride)) return false;
    if (!ride.isPrivate) return true;
    var phone = String(inviteCheckPhone || '').trim();
    if (phone && typeof svc.isUserPhoneInvitedToRide === 'function' && svc.isUserPhoneInvitedToRide(phone, ride.invitedList)) {
      return true;
    }
    var pwd = String(ride.rideJoinPassword != null ? ride.rideJoinPassword : '')
      .replace(/\D/g, '')
      .slice(0, 4);
    return pwd.length === 4;
  }

  /** 라이딩 모임 > 날짜 선택 목록 전용 — 아이콘만 (취소·참석확정·참석가능·구경) */
  function renderSelectedDayListPanelTitleIcons(ride) {
    var isCancelled = String(ride.rideStatus || 'active') === 'cancelled';
    var isPast = isOpenRidingPastBySeoulDate(ride);
    var fade = isPast ? ' opacity-45' : '';
    var fadeLock = isPast ? ' opacity-45' : '';
    var chkSvg = (
      <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 6L5 8.5L9.5 3.5" />
      </svg>
    );
    if (isCancelled) {
      return (
        <span
          className={
            'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm ring-1 ring-red-900/30' +
            fade
          }
          title="취소된 라이딩"
          aria-label="취소된 라이딩"
        >
          <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden="true">
            <path d="M3 3l6 6M9 3L3 9" />
          </svg>
        </span>
      );
    }
    var stIcon;
    if (isUserParticipantConfirmedForRide(ride)) {
      stIcon = (
        <span
          className={
            'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm ring-1 ring-red-700/30' +
            fade
          }
          title="참석 확정"
          aria-label="참석 확정"
        >
          {chkSvg}
        </span>
      );
    } else if (isUserWaitlistedForRide(ride)) {
      stIcon = (
        <span
          className={
            'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm ring-1 ring-red-700/30' +
            fade
          }
          title="대기열 신청"
          aria-label="대기열 신청"
        >
          {chkSvg}
        </span>
      );
    } else if (canUserApplyOpenRidingDayList(ride)) {
      stIcon = (
        <span
          className={
            'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-700/25' +
            fade
          }
          title="참석 가능"
          aria-label="참석 가능"
        >
          {chkSvg}
        </span>
      );
    } else {
      stIcon = (
        <span
          className={
            'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-slate-300/90 text-slate-700 shadow-sm ring-1 ring-slate-400/35' +
            fade
          }
          title="구경 하기"
          aria-label="구경 하기"
        >
          {chkSvg}
        </span>
      );
    }
    return (
      <>
        {ride.isPrivate ? (
          <img
            src="assets/img/lock.png"
            alt=""
            className={'w-4 h-4 shrink-0 object-contain' + fadeLock}
            width={16}
            height={16}
            decoding="async"
          />
        ) : null}
        {stIcon}
      </>
    );
  }

  function openRideHostHasAttendanceApplications(r) {
    if (String(r.rideStatus || 'active') === 'cancelled') return false;
    var hostNorm = String(r.hostUserId || '').trim();
    function uidNotHost(uid) {
      var u = String(uid != null ? uid : '').trim();
      return u && u !== hostNorm;
    }
    var parts = openRideIdsFromFirestoreListField(r.participants);
    if (parts.some(function (p) { return uidNotHost(p); })) return true;
    var waits = openRideIdsFromFirestoreListField(r.waitlist);
    if (waits.some(function (w) { return String(w != null ? w : '').trim(); })) return true;
    var pd =
      r.participantDisplay && typeof r.participantDisplay === 'object' && !Array.isArray(r.participantDisplay)
        ? r.participantDisplay
        : null;
    if (pd) {
      var pk;
      for (pk in pd) {
        if (Object.prototype.hasOwnProperty.call(pd, pk) && uidNotHost(pk)) return true;
      }
    }
    return false;
  }

  /** extra.showRideDate: 월간 합성 목록에서 일자 표시 */
  function renderMonthRideListRow(r, extra) {
    var ex = extra || {};
    var isCancelled = String(r.rideStatus || 'active') === 'cancelled';
    var isMine = !!(userId && String(r.hostUserId || '') === String(userId));
    var isCompactHostListRow = !!(ex.hostedListSection || (ex.myRidesUnifiedList && ex.myRideKind === 'host'));
    var titleRowClass = 'font-medium text-sm flex items-center gap-1.5 min-w-0 ';
    var hostedCancelledMine = !!(isCompactHostListRow && isMine && isCancelled);
    if (isCancelled) {
      titleRowClass += hostedCancelledMine
        ? 'text-slate-600'
        : isMine
          ? 'open-riding-list-title-cancelled-mine'
          : 'open-riding-list-title-cancelled';
    } else if (isMine && isCompactHostListRow) {
      titleRowClass += 'text-black';
    } else if (isMine) {
      titleRowClass += 'open-riding-list-title-mine';
    } else if (r.isPrivate) {
      titleRowClass += 'open-riding-list-title-private-black';
    } else {
      titleRowClass += 'text-slate-800';
    }
    var isSelectedDayListPanel = !!ex.selectedDayListPanel;
    var isPastDayListFade = isSelectedDayListPanel && isOpenRidingPastBySeoulDate(r);
    if (isPastDayListFade) {
      titleRowClass += ' opacity-[0.72]';
    }
    var rideYmd = getRideDateSeoulYmd(r);
    var useInviteHostedRow = !!(ex.compactInviteOrHostedList || ex.myRidesUnifiedList);
    var dateLabel = '';
    if (ex.showRideDate) {
      dateLabel = useInviteHostedRow ? formatRideDateMdDowSeoul(r) : rideYmd && formatKoreanDateLabelFromYmd(rideYmd);
    }
    var regionFull = r.region != null && String(r.region).trim() ? String(r.region).trim() : '';
    var regionShort = formatOpenRidingRegionShort(regionFull);
    var placeLabel = regionShort;
    var regionTitleAttr = regionFull ? regionFull : undefined;
    var showParticipantConfirmedIcon = false;
    var attendeeCheckTitle = '참석 확정';
    var attendeeCheckAria = '참석 확정';
    var showMyRidePurpleHost = false;
    var myRidePurpleMuted = false;
    var showMyRideInvitedGreen = false;
    var showMyRideRed = false;
    if (ex.myRidesUnifiedList && ex.myRideKind && !isCancelled) {
      if (ex.myRideKind === 'host') {
        showMyRidePurpleHost = true;
        myRidePurpleMuted = isHostedRideScheduleEndedForListIcon(r);
      } else if (ex.myRideKind === 'invited') {
        if (isUserParticipantConfirmedForRide(r)) {
          showMyRideRed = true;
        } else {
          showMyRideInvitedGreen = true;
        }
      } else if (ex.myRideKind === 'other') {
        showMyRideRed = true;
      }
    } else if (!isSelectedDayListPanel) {
      showParticipantConfirmedIcon = isUserParticipantConfirmedForRide(r);
    }
    var attendeeCheckCircleClass =
      'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm ring-1 ring-red-700/30';
    var spectatorBrowseCircleClass =
      'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-slate-300/90 text-slate-700 shadow-sm ring-1 ring-slate-400/35';
    var showSpectatorBrowseIcon = false;
    if (
      !ex.myRidesUnifiedList &&
      !isSelectedDayListPanel &&
      userId &&
      !isCancelled &&
      openRidingMoimSpectatorBadgeGradeOk()
    ) {
      var appliedJoin = isUserParticipantConfirmedForRide(r) || isUserWaitlistedForRide(r);
      if (!appliedJoin) {
        showSpectatorBrowseIcon = true;
      }
    }
    return (
      <li key={r.id}>
        <button
          type="button"
          className="w-full text-left py-2.5 hover:bg-slate-50 px-2 rounded-lg"
          onClick={function () { onSelectRide(r.id); }}
        >
          <div className={titleRowClass}>
            {isSelectedDayListPanel ? (
              renderSelectedDayListPanelTitleIcons(r)
            ) : (
              <>
            {isCancelled ? (
              <img src="assets/img/rcancel.svg" alt="" className="w-4 h-4 shrink-0 object-contain" width={16} height={16} decoding="async" />
            ) : r.isPrivate ? (
              <img src="assets/img/lock.png" alt="" className="w-4 h-4 shrink-0 object-contain" width={16} height={16} decoding="async" />
            ) : null}
            {showMyRidePurpleHost ? (
              <span
                className={
                  myRidePurpleMuted
                    ? 'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-violet-200 text-violet-900 shadow-sm ring-1 ring-violet-400/55'
                    : 'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-violet-600 text-white shadow-sm ring-1 ring-violet-800/35'
                }
                title={myRidePurpleMuted ? '라이딩 일정이 종료되었습니다' : '내가 주최한 라이딩'}
                aria-label={myRidePurpleMuted ? '라이딩 일정 종료' : '내가 주최한 라이딩'}
              >
                <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2.5 6L5 8.5L9.5 3.5" />
                </svg>
              </span>
            ) : null}
            {showMyRideInvitedGreen ? (
              <span
                className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-700/25"
                title="초대받은 라이딩 · 참석 미확정"
                aria-label="초대받은 라이딩 · 참석 미확정"
              >
                <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2.5 6L5 8.5L9.5 3.5" />
                </svg>
              </span>
            ) : null}
            {showMyRideRed ? (
              <span
                className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm ring-1 ring-red-700/30"
                title="참석 확정"
                aria-label="참석 확정"
              >
                <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2.5 6L5 8.5L9.5 3.5" />
                </svg>
              </span>
            ) : null}
            {showParticipantConfirmedIcon ? (
              <span
                className={attendeeCheckCircleClass}
                title={attendeeCheckTitle}
                aria-label={attendeeCheckAria}
              >
                <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2.5 6L5 8.5L9.5 3.5" />
                </svg>
              </span>
            ) : null}
            {showSpectatorBrowseIcon ? (
              <span
                className={spectatorBrowseCircleClass}
                title="구경 하기"
                aria-label="참석·대기 신청 전, 구경 하기"
              >
                <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2.5 6L5 8.5L9.5 3.5" />
                </svg>
              </span>
            ) : null}
              </>
            )}
            <span className="truncate">{r.title}</span>
          </div>
          <div
            className={
              'text-xs mt-1 flex flex-wrap items-center gap-y-0.5 ' +
              (hostedCancelledMine ? 'text-slate-600' : isCancelled ? 'text-slate-400' : 'text-slate-600') +
              (isPastDayListFade ? ' opacity-60' : '')
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
            <span className="shrink-0">
              {r.level != null && String(r.level).trim()
                ? typeof window !== 'undefined' && typeof window.ridingLevelDisplayNameForStorageValue === 'function'
                  ? window.ridingLevelDisplayNameForStorageValue(r.level)
                  : r.level
                : '-'}
            </span>
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
      <section
        className={
          (compact ? 'rounded-xl p-3 ' : 'rounded-2xl p-4 ') +
          'border-2 border-slate-400 bg-slate-50/80 shadow-sm open-riding-selected-day-list-panel'
        }
      >
        <h2 className="text-sm font-semibold text-slate-800 mb-2">
          {selectedKey ? formatMdDowFromYmdSeoul(selectedKey) || selectedKey : '날짜를 선택하세요'}
        </h2>
        {!selectedKey ? (
          <p className="text-sm text-slate-400">달력에서 날짜를 탭하면 목록이 표시됩니다.</p>
        ) : ridesForDay.length === 0 ? (
          <p className="text-sm text-slate-400">이 날 등록된 라이딩이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
            {ridesForDay.map(function (r) {
              return renderMonthRideListRow(r, { selectedDayListPanel: true });
            })}
          </ul>
        )}
      </section>
    );
  }

  function renderMyRidesUnifiedSection() {
    var phoneMissing = !!(userId && !String(inviteCheckPhone || '').trim());
    return (
      <>
        <section
          className="rounded-2xl p-3 border-2 border-violet-600 bg-white shadow-sm open-riding-my-rides-panel"
          aria-labelledby="open-riding-my-rides-heading"
        >
          <div className="flex items-center justify-start gap-2 mb-2 flex-wrap">
            <span
              id="open-riding-my-rides-heading"
              role="heading"
              aria-level={2}
              className="text-xs font-bold px-3 py-1.5 rounded-xl border border-violet-200 bg-white text-violet-900 shadow-sm shrink-0 tracking-tight open-riding-my-rides-title-pill"
            >
              [나의 라이딩]
            </span>
          </div>
          {!userId ? (
            <p className="text-sm text-slate-400 m-0">로그인 후 나의 라이딩(주최·초대·참석 확정)을 확인할 수 있습니다.</p>
          ) : (
            <>
              {phoneMissing ? (
                <p className="text-[11px] text-slate-500 m-0 mb-2 leading-snug">
                  프로필·계정에 전화번호를 등록하면 초대받은 라이딩이 목록에 포함됩니다. (내가 주최한 라이딩·초대 없이 참석 확정한 라이딩은 연락처 없이도 표시됩니다.)
                </p>
              ) : null}
              {myRidesUnifiedRows.length === 0 ? (
                <p className="text-sm text-slate-400 m-0">이번 달 표시할 나의 라이딩이 없습니다.</p>
              ) : (
                <ul className="divide-y divide-slate-100 max-h-56 overflow-y-auto rounded-lg bg-white">
                  {myRidesUnifiedRows.map(function (row) {
                    return renderMonthRideListRow(row.r, {
                      showRideDate: true,
                      myRidesUnifiedList: true,
                      myRideKind: row.kind,
                    });
                  })}
                </ul>
              )}
            </>
          )}
          <div
            className="mt-2 pt-2 border-t border-slate-200 flex flex-wrap items-center justify-start gap-x-1.5 gap-y-1 text-[10px] sm:text-[11px] text-slate-600 leading-tight open-riding-my-rides-legend"
            role="note"
          >
          <span className="inline-flex items-center gap-1 shrink-0">
            <span className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-700/25">
              <svg className="h-2 w-2" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 6L5 8.5L9.5 3.5" />
              </svg>
            </span>
            <span className="text-slate-500">초대됨</span>
          </span>
          <span className="text-slate-300 shrink-0 px-1 select-none" aria-hidden="true">
            |
          </span>
          <span className="inline-flex items-center gap-1 shrink-0">
            <span className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm ring-1 ring-red-700/30">
              <svg className="h-2 w-2" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 6L5 8.5L9.5 3.5" />
              </svg>
            </span>
            <span className="text-slate-500">참석확정</span>
          </span>
          <span className="text-slate-300 shrink-0 px-1 select-none" aria-hidden="true">
            |
          </span>
          <span className="inline-flex items-center gap-1 shrink-0">
            <span className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-violet-600 text-white shadow-sm ring-1 ring-violet-800/35">
              <svg className="h-2 w-2" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.5 6L5 8.5L9.5 3.5" />
              </svg>
            </span>
            <span className="text-slate-500">내가주최</span>
          </span>
          </div>
        </section>
        <p className="mt-1.5 ml-1 text-[11px] sm:text-xs text-slate-500 leading-snug">
          * 라이딩 모임 생성(100SP) 및 참석(10SP)에 마일리지 포인트 사용
        </p>
      </>
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
        </div>
      </div>
    );
  }

  var calendarTodayYmd = getTodaySeoulYmd();

  return (
    <div className={compact ? 'open-riding-compact w-full max-w-full space-y-3 text-left' : 'open-riding-main max-w-4xl mx-auto p-4 space-y-6'}>
      {!compact ? (
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
      ) : null}

      <div className={compact ? 'flex flex-col gap-3' : 'grid grid-cols-1 md:grid-cols-3 gap-4'}>
        <section className={(compact ? 'rounded-xl p-3 ' : 'md:col-span-2 rounded-2xl p-4 ') + 'border border-slate-200 bg-white shadow-sm'}>
          <div className="flex items-center justify-center mb-3 gap-2">
            <button type="button" className="text-slate-600 shrink-0" onClick={function () { setViewMonth(new Date(year, month - 1, 1)); }}>{'‹'}</button>
            <span className="font-semibold text-sm sm:text-base">{year}년 {month + 1}월</span>
            <button type="button" className="text-slate-600 shrink-0" onClick={function () { setViewMonth(new Date(year, month + 1, 1)); }}>{'›'}</button>
          </div>
          {loadingRides ? <p className="text-sm text-slate-400">불러오는 중…</p> : null}
          <div className="grid grid-cols-7 gap-1 text-center text-xs mb-1 font-semibold">
            {['일', '월', '화', '수', '목', '금', '토'].map(function (w) {
              var wc =
                w === '일' ? 'text-red-600' : w === '토' ? 'text-blue-600' : 'text-slate-500';
              return (
                <div key={w} className={wc}>
                  {w}
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-7 gap-1 overflow-visible pt-0.5">
            {days.map(function (day, idx) {
              if (day == null) return <div key={'e' + idx} className={emptyH} />;
              var key = dateKey(year, month, day);
              var isPastCell = key < calendarTodayYmd;
              var isHostDay = hostDateKeys.has(key);
              var hasMatch = matchingDateKeys.has(key);
              var hasAnyRide = allRideDateKeys.has(key);
              var showOtherOnly = !isHostDay && !hasMatch && hasAnyRide;
              var isSel = selectedKey === key;
              var isConfirmedDay = participantConfirmedDateKeys.has(key);
              var dayNumClass = 'relative z-10 tabular-nums ';
              if (isHostDay) {
                dayNumClass += isPastCell ? 'text-violet-800/55 font-medium' : 'text-white font-semibold drop-shadow-[0_1px_0_rgba(0,0,0,0.2)]';
              } else if (hasMatch) {
                dayNumClass += isPastCell ? 'text-emerald-800/50 font-medium' : 'text-emerald-950 font-semibold';
              } else if (showOtherOnly) {
                dayNumClass += 'text-slate-500 font-medium';
              } else {
                var dowPlain = seoulDowSun0FromYmd(key);
                if (dowPlain === 0) {
                  dayNumClass += isPastCell ? 'text-red-600/55 font-medium' : 'text-red-600 font-semibold';
                } else if (dowPlain === 6) {
                  dayNumClass += isPastCell ? 'text-blue-600/55 font-medium' : 'text-blue-600 font-semibold';
                } else {
                  dayNumClass += 'text-slate-800';
                }
              }
              return (
                <button
                  key={key}
                  type="button"
                  onClick={function () { setSelectedKey(key); }}
                  className={
                    'relative overflow-visible ' + cellH + ' rounded-lg text-sm flex items-center justify-center transition ' +
                    (isSel ? 'ring-2 ring-violet-500 font-semibold ' : '') +
                    ' hover:bg-slate-50'
                  }
                >
                  {isHostDay ? (
                    <span
                      className={
                        'absolute inset-1 z-[1] rounded-md pointer-events-none border ' +
                        (isPastCell
                          ? 'bg-violet-200/45 border-violet-300/40'
                          : 'bg-violet-600 border-violet-700/45')
                      }
                      aria-hidden
                    />
                  ) : hasMatch ? (
                    <span
                      className={
                        'absolute inset-1 z-[1] rounded-md pointer-events-none border ' +
                        (isPastCell
                          ? 'bg-emerald-200/45 border-emerald-400/35'
                          : 'bg-emerald-400/80 border-emerald-600/40')
                      }
                      aria-hidden
                    />
                  ) : showOtherOnly ? (
                    <span
                      className="absolute inset-1 z-[1] rounded-md bg-slate-200/60 border border-slate-400/35 pointer-events-none"
                      aria-hidden
                    />
                  ) : null}
                  {isConfirmedDay ? (
                    <span
                      className={
                        'open-riding-cal-participant-badge absolute z-[20] pointer-events-none flex items-center justify-center rounded-full text-white shadow-sm ring-1 ring-white/90 ' +
                        (isPastCell ? 'bg-red-400/75 opacity-90' : 'bg-red-600')
                      }
                      style={{ width: '11px', height: '11px', top: '50%', right: '4px', transform: 'translate(50%, -50%)' }}
                      title="참석 확정"
                      aria-hidden
                    >
                      <svg className="block" width={7} height={7} viewBox="0 0 12 12" fill="none" aria-hidden>
                        <path
                          d="M2.5 6L5 8.5L9.5 3.5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  ) : null}
                  <span className={dayNumClass}>{day}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px] sm:text-[11px] text-slate-600 leading-snug open-riding-calendar-legend">
            <div className="flex gap-2 items-center min-w-0">
              <span className="inline-block w-3.5 h-3.5 rounded-sm shrink-0 bg-emerald-400/90 border border-emerald-600/25" aria-hidden />
              <span className="font-semibold text-slate-700 min-w-0">참석 가능</span>
            </div>
            <div className="flex gap-2 items-center min-w-0">
              <span className="inline-block w-3.5 h-3.5 rounded-sm shrink-0 bg-violet-600 border border-violet-800/30" aria-hidden />
              <span className="font-semibold text-slate-700 min-w-0">내가 주최</span>
            </div>
            <div className="flex gap-2 items-center min-w-0">
              <span className="inline-block w-3.5 h-3.5 rounded-sm shrink-0 bg-slate-300/90 border border-slate-400/35" aria-hidden />
              <span className="font-semibold text-slate-700 min-w-0">구경 하기</span>
            </div>
            <div className="flex gap-2 items-center min-w-0">
              <span
                className="open-riding-cal-legend-badge shrink-0 inline-flex items-center justify-center rounded-full bg-red-600 text-white ring-1 ring-white/90 shadow-sm"
                style={{ width: '12px', height: '12px' }}
                aria-hidden
              >
                <svg className="block" width={8} height={8} viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="font-semibold text-slate-700 min-w-0 leading-tight">참석 확정</span>
            </div>
          </div>
        </section>

        {compact ? renderListSection() : null}
        {compact ? renderMyRidesUnifiedSection() : null}

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

      {userId ? (
        <button
          type="button"
          className="open-riding-action-btn open-riding-group-fab fixed flex h-12 w-12 items-center justify-center rounded-full border-0 text-white shadow-lg md:h-14 md:w-14 box-border"
          style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            boxShadow: '0 4px 16px rgba(102, 126, 234, 0.4)'
          }}
          title="라이딩 생성"
          aria-label="라이딩 생성"
          onClick={onOpenCreate}
        >
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 4v16m8-8H4" />
          </svg>
        </button>
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
  var RIDING_LEVEL_OPTIONS = _koForm.RIDING_LEVEL_OPTIONS;

  var firestore = props.firestore;
  var storage = props.storage;
  var hostUserId = props.hostUserId;
  var editRideId = props.editRideId || null;
  var onCreated = props.onCreated || function () {};
  var onEditSaved = props.onEditSaved || function () {};
  var onEditNavMoim = props.onEditNavMoim;
  var onEditNavDetail = props.onEditNavDetail;
  var onEditNavDelete = props.onEditNavDelete;

  var formRef = useRef(null);

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
  var _hostChargeDlg = useState({ open: false, remaining: null });
  var hostChargeDlg = _hostChargeDlg[0];
  var setHostChargeDlg = _hostChargeDlg[1];

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
              pending.push({
                name: row.name,
                phone: row.phone,
                key: row.key,
                friendUid: row.friendUid != null ? String(row.friendUid).trim() : undefined
              });
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
          var ts = ride.date != null ? openRidingCoerceRideDateToDate(ride.date) : null;
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
          var fuidMap =
            ride.inviteFriendUidByPhone &&
            typeof ride.inviteFriendUidByPhone === 'object' &&
            !Array.isArray(ride.inviteFriendUidByPhone)
              ? ride.inviteFriendUidByPhone
              : {};
          function lookupInviteFriendUid(normKey) {
            if (!normKey || normKey.length < 8) return undefined;
            if (fuidMap[normKey] != null && String(fuidMap[normKey]).trim()) {
              return String(fuidMap[normKey]).trim();
            }
            var w8 = normKey.slice(-8);
            var fk = Object.keys(fuidMap);
            for (var fi = 0; fi < fk.length; fi++) {
              var nk = normFn(String(fk[fi]));
              if (
                nk === normKey ||
                (nk.length >= 8 && nk.slice(-8) === w8)
              ) {
                return String(fuidMap[fk[fi]]).trim();
              }
            }
            return undefined;
          }
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
            var fUid = lookupInviteFriendUid(k);
            var rowOut = { name: nm, phone: p, key: k };
            if (fUid) rowOut.friendUid = fUid;
            return rowOut;
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
        period: 'rolling6m',
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

  async function fetchUserAccPointsForOpenRiding(uid) {
    var key = String(uid != null ? uid : '').trim();
    if (!key) return null;
    try {
      if (typeof window !== 'undefined' && typeof window.getUserByUid === 'function') {
        var row = await window.getUserByUid(key);
        var n = Number(row && row.acc_points != null ? row.acc_points : NaN);
        if (Number.isFinite(n)) return n;
      }
    } catch (_e) {}
    try {
      if (typeof window !== 'undefined' && window.currentUser) {
        var n2 = Number(window.currentUser.acc_points != null ? window.currentUser.acc_points : NaN);
        if (Number.isFinite(n2)) return n2;
      }
    } catch (_e2) {}
    return null;
  }

  async function submitCore(skipHostChargeConfirm) {
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
    if (!editRideId && !skipHostChargeConfirm) {
      var hostAcc = await fetchUserAccPointsForOpenRiding(hostUserId);
      if (Number.isFinite(hostAcc) && hostAcc < 100) {
        showFormValidationMessages(['누적 포인트가 부족합니다. 모임 주최에는 100SP가 필요합니다.']);
        return;
      }
      var remain = Number.isFinite(hostAcc) ? Math.max(0, Math.floor(hostAcc - 100)) : null;
      setHostChargeDlg({ open: true, remaining: remain });
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
          inviteFriendUidByPhone: buildOpenRidingInviteFriendUidMap(form.inviteSelected),
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
        inviteFriendUidByPhone: buildOpenRidingInviteFriendUidMap(form.inviteSelected),
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
    } catch (err) {
      var rawMsg = err && err.message ? String(err.message) : '';
      if (rawMsg === 'INSUFFICIENT_ACC_POINTS_HOST') {
        showFormValidationMessages(['누적 포인트가 부족합니다. 모임 주최에는 100SP가 필요합니다.']);
      } else {
        showFormValidationMessages([rawMsg || '모임 생성 처리 중 오류가 발생했습니다.']);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    await submitCore(false);
  }

  if (editRideId && !editHydrated) {
    return <div className="py-12 text-center text-sm text-slate-500">불러오는 중…</div>;
  }

  var _loginGrForm =
    typeof window !== 'undefined' && typeof window.getLoginUserGrade === 'function' ? window.getLoginUserGrade() : null;
  var _isAdmin1Form =
    typeof window !== 'undefined' && typeof window.isStelvioAdminGrade === 'function'
      ? window.isStelvioAdminGrade(_loginGrForm)
      : false;
  var editGlassNavPastLocked =
    !!editRideId &&
    !!form.date &&
    String(form.date) < getTodaySeoulYmd() &&
    !_isAdmin1Form;

  /* 폼 루트 z-0, 하단 CTA는 style.css에서 z-5(고정 로고바 10000 미만)로 본문보다만 위 — 스크롤 시 고정바 뒤로 가려짐 */
  return (
    <>
    <form ref={formRef} id="open-riding-ride-form" className="open-riding-create-form-root w-full max-w-lg mx-auto space-y-3 pb-1 text-sm text-slate-700 relative z-0" onSubmit={submit} noValidate>
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
                {sortOpenRidingInviteRowsByDisplayNameKo(form.invitePending).map(function (row) {
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
                        <span className="block min-w-0 truncate">
                          <span className="font-medium text-slate-800">{row.name}</span>
                          <span className="text-xs text-slate-500"> {row.phone}</span>
                        </span>
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
                {sortOpenRidingInviteRowsByDisplayNameKo(form.inviteSelected).map(function (row) {
                  return (
                    <li key={row.key} className="flex items-start gap-2 rounded-md bg-violet-50/80 px-2 py-1.5 text-sm">
                      <div className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-slate-800">{row.name}</span>
                        <span className="text-xs text-slate-600"> {row.phone}</span>
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
                지정한 전화번호(뒤 8자리 일치)로 로그인한 친구는 「나의 라이딩」에서 이 모임을 바로 볼 수 있습니다.
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
                <span className="font-medium text-slate-800">
                  {opt.label != null && String(opt.label).trim() ? opt.label : opt.value}
                </span>
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
                  최대 참석 가능 레벨:{' '}
                  <strong className="text-emerald-950">
                    {typeof window !== 'undefined' && typeof window.ridingLevelDisplayNameForStorageValue === 'function'
                      ? window.ridingLevelDisplayNameForStorageValue(createFormPeakHint.maxGoLevel)
                      : createFormPeakHint.maxGoLevel}
                  </strong>
                </>
              ) : createFormPeakHint.maxCautionLevel ? (
                <>
                  참석 가능(안정) 구간 없음 · 주의 수준 최고:{' '}
                  <strong className="text-emerald-950">
                    {typeof window !== 'undefined' && typeof window.ridingLevelDisplayNameForStorageValue === 'function'
                      ? window.ridingLevelDisplayNameForStorageValue(createFormPeakHint.maxCautionLevel)
                      : createFormPeakHint.maxCautionLevel}
                  </strong>
                </>
              ) : (
                <span className="text-emerald-800/95">
                  여유가 큰 참석 가능 레벨이 없습니다. 입문·하위 모임을 권장합니다.
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
            <span>식수/개인용(파워젤 및 보급)</span>
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

      {!editRideId ? (
        <div className="open-riding-bottom-actions">
          <button type="submit" className="open-riding-create-submit open-riding-action-btn h-11 inline-flex items-center justify-center w-full flex-1 px-4 bg-violet-600 text-white rounded-xl font-medium leading-none disabled:opacity-50" disabled={isBusy}>
            {isBusy ? '저장 중…' : '생성'}
          </button>
        </div>
      ) : null}

      {dateModalOpen ? (
        <div
          className="fixed inset-0 z-[200060] flex items-end sm:items-center justify-center bg-black/45 p-3"
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
          className="fixed inset-0 z-[200070] flex items-center justify-center p-4"
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
      {hostChargeDlg.open ? (
        <div className="open-riding-bomb-modal-backdrop fixed inset-0 z-[200073] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="open-riding-host-charge-title">
          <div className="open-riding-bomb-modal-panel w-full max-w-sm py-7 px-8 text-center" onClick={function (e) { e.stopPropagation(); }}>
            <div className="flex items-center justify-center gap-2.5 mb-4 pb-4 border-b border-slate-200">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-700 text-sm font-bold border border-violet-200" aria-hidden>SP</span>
              <h2 id="open-riding-host-charge-title" className="text-base font-bold text-slate-800 m-0 leading-tight">라이딩 모임 주최</h2>
            </div>
            <p className="stelvio-exit-confirm-message text-center m-0">라이딩 모임 주최 시 TSS 마일리지 누적 포인트에서 100SP 차감됩니다.</p>
            <p className="text-xs text-slate-500 mt-2 mb-5 leading-snug text-center">
              {hostChargeDlg.remaining == null ? '(차감 후 잔여 포인트는 생성 후 반영됩니다.)' : '(차감후 잔여 포인트는 ' + hostChargeDlg.remaining + ' SP)'}
            </p>
            <div className="stelvio-exit-confirm-buttons">
              <button type="button" className="open-riding-action-btn stelvio-exit-confirm-btn stelvio-exit-confirm-btn-cancel inline-flex items-center justify-center" onClick={function () { setHostChargeDlg({ open: false, remaining: null }); }}>
                취소
              </button>
              <button type="button" className="open-riding-action-btn stelvio-exit-confirm-btn stelvio-exit-confirm-btn-ok inline-flex items-center justify-center" onClick={function () { setHostChargeDlg({ open: false, remaining: null }); submitCore(true); }}>
                생성
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
    {editRideId && isBusy ? (
      <div
        className="fixed left-1/2 z-[99990] flex -translate-x-1/2 flex-col items-center gap-1.5 px-4 pointer-events-none"
        style={{ bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex flex-col items-center gap-1 rounded-2xl border border-emerald-200/90 bg-white/95 px-4 py-3 shadow-lg">
          <span
            className="inline-block h-9 w-9 rounded-full border-[3px] border-emerald-200 border-t-emerald-600 animate-spin"
            style={{ animationDuration: '0.85s' }}
            role="status"
            aria-live="polite"
            aria-label="저장 중"
          />
          <span className="text-[11px] font-semibold text-emerald-800">저장 중…</span>
        </div>
      </div>
    ) : null}
    {editRideId ? (
      <OpenRidingEditGlassNav
        onMoim={typeof onEditNavMoim === 'function' ? onEditNavMoim : function () {}}
        onEdit={typeof onEditNavDetail === 'function' ? onEditNavDetail : function () {}}
        onDelete={typeof onEditNavDelete === 'function' ? onEditNavDelete : function () {}}
        onSave={function () {
          if (formRef.current && typeof formRef.current.requestSubmit === 'function') {
            formRef.current.requestSubmit();
          }
        }}
        isBusy={isBusy}
        hostToolbarLocked={editGlassNavPastLocked}
      />
    ) : null}
    </>
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

/** 라이딩 상세 후기: 일지 Summary 탭과 동일 지표 + 존 차트(가능 시) */
function OpenRidingRideReviewSummaryContent(props) {
  var log = props.log;
  var chartUserProfile = props.chartUserProfile;
  var participantsStravaCumulativeKm = props.participantsStravaCumulativeKm;
  if (!log) return null;
  var spd =
    log.avg_speed_kmh != null && Number(log.avg_speed_kmh) > 0
      ? Number(log.avg_speed_kmh)
      : openRidingReviewAvgSpeedKmh(log.distance_km, log.duration_sec);
  var cumRow = null;
  if (participantsStravaCumulativeKm !== undefined) {
    var ckm = Number(participantsStravaCumulativeKm);
    cumRow = {
      label: '참석자 합산 거리',
      value:
        participantsStravaCumulativeKm != null && Number.isFinite(ckm)
          ? ckm.toFixed(1) + ' km'
          : '-'
    };
  }
  var rows = [
    ...(cumRow ? [cumRow] : []),
    { label: '거리', value: log.distance_km != null && log.distance_km > 0 ? log.distance_km.toFixed(1) + ' km' : '-' },
    { label: '라이딩 시간', value: openRidingReviewFormatDuration(log.duration_sec) },
    { label: '평균 속도', value: openRidingReviewFormatSpeedKmh(spd) },
    { label: '평균 파워', value: openRidingReviewFormatWatts(log.avg_watts) },
    { label: 'NP', value: openRidingReviewFormatWatts(log.weighted_watts) },
    { label: '최대 파워', value: openRidingReviewFormatWatts(log.max_watts) },
    { label: '상승고도', value: openRidingReviewFormatElevationM(log.elevation_gain) },
    { label: '평균 케이던스', value: openRidingReviewFormatCadenceRpm(log.avg_cadence) },
    { label: 'TSS', value: log.tss != null && log.tss > 0 ? String(Math.round(log.tss)) : '-' },
    { label: 'IF', value: log.if != null && log.if > 0 ? log.if.toFixed(2) : '-' },
    { label: 'KJ', value: log.kilojoules != null && log.kilojoules > 0 ? Math.round(log.kilojoules) + ' KJ' : '-' }
  ];
  var DailyCharts = typeof window !== 'undefined' ? window.DailyTimeInZonesCharts : null;
  var up =
    chartUserProfile && typeof chartUserProfile === 'object' && (chartUserProfile.uid || chartUserProfile.id)
      ? chartUserProfile
      : getOpenRidingJournalUserProfileForCharts();
  var tizEl = null;
  if (log.time_in_zones && DailyCharts) {
    tizEl = (
      <div className="journal-detail-time-in-zones-wrap mt-3">
        <DailyCharts
          log={log}
          userProfile={up}
          sectionTitleClassName="text-sm font-semibold text-gray-800 mb-2 text-center w-full"
        />
      </div>
    );
  }
  return (
    <div className="journal-tab-content border border-slate-200 rounded-xl overflow-hidden bg-white">
      <table className="w-full text-sm border-collapse">
        <tbody>
          {rows.map(function (r) {
            return (
              <tr key={r.label} className="border-b border-slate-100 last:border-b-0">
                <th className="text-left py-2 px-3 font-medium text-slate-600 align-middle whitespace-nowrap w-[48%]">{r.label}</th>
                <td className="py-2 px-3 text-slate-800 font-semibold text-right tabular-nums align-middle">{r.value}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {tizEl}
      {String(log.source || '').toLowerCase() === 'strava' ? (
        <div className="px-3 py-2 border-t border-slate-100 flex justify-center bg-slate-50/50">
          <img src="assets/img/api_strava.png" alt="Powered by Strava" style={{ height: 12 }} />
        </div>
      ) : null}
    </div>
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
  var onHome = props.onHome || function () {};
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
  var _hostRefundRemain = useState(null);
  var hostRefundRemain = _hostRefundRemain[0];
  var setHostRefundRemain = _hostRefundRemain[1];
  var _jpw = useState('');
  var joinPasswordInput = _jpw[0];
  var setJoinPasswordInput = _jpw[1];
  var _jsm = useState(false);
  var joinShareModalOpen = _jsm[0];
  var setJoinShareModalOpen = _jsm[1];
  var _joinChargeRemain = useState(null);
  var joinChargeRemain = _joinChargeRemain[0];
  var setJoinChargeRemain = _joinChargeRemain[1];
  var _leaveRefundModal = useState(false);
  var leaveRefundModalOpen = _leaveRefundModal[0];
  var setLeaveRefundModalOpen = _leaveRefundModal[1];
  var _leaveRefundRemain = useState(null);
  var leaveRefundRemain = _leaveRefundRemain[0];
  var setLeaveRefundRemain = _leaveRefundRemain[1];
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
  var _revExp = useState(false);
  var reviewExpanded = _revExp[0];
  var setReviewExpanded = _revExp[1];
  var _revMerged = useState(null);
  var reviewMergedLog = _revMerged[0];
  var setReviewMergedLog = _revMerged[1];
  /** 'self' | 'host_public' | 'host_fallback' — who the merged review log represents */
  var _revSrc = useState(null);
  var reviewMergedLogSource = _revSrc[0];
  var setReviewMergedLogSource = _revSrc[1];
  var _revLd = useState(false);
  var reviewLogsLoading = _revLd[0];
  var setReviewLogsLoading = _revLd[1];
  var _revCum = useState(null);
  var reviewParticipantsStravaCumulativeKm = _revCum[0];
  var setReviewParticipantsStravaCumulativeKm = _revCum[1];

  /* 참석 검증 결과 맵: ride.attendanceResults 에서 직접 읽음 (별도 쿼리 불필요) */

  /** Snapshot updates change ride reference; review fetch effect deps use primitives only. */
  var rideYmdRv = ride ? getRideDateSeoulYmd(ride) : '';
  var rideStatusRv = ride ? String(ride.rideStatus || 'active') : '';
  var rideHostRv = ride && ride.hostUserId != null ? String(ride.hostUserId).trim() : '';
  var rideParticipantsKeyRv =
    ride && Array.isArray(ride.participants)
      ? ride.participants
          .map(function (p) {
            return String(p != null ? p : '').trim();
          })
          .filter(Boolean)
          .sort()
          .join('|')
      : '';
  var rideDistRv =
    ride && ride.distance != null && Number.isFinite(Number(ride.distance)) ? Number(ride.distance) : null;
  var hStableRv = openRidingHostPublicSummaryStableKey(ride && ride.hostPublicReviewSummary);
  var todayRv = getTodaySeoulYmd();
  /* 참석 검증 완료 여부 (primitive — useEffect deps 안정) */
  var attVerRan = !!(ride && ride.attendanceVerificationRan === true);

  useEffect(
    function () {
      setJoinPasswordInput('');
      setJoinShareModalOpen(false);
      setDeleteModalOpen(false);
      setInviteListExpanded(false);
      setOperationRulesExpanded(false);
      setParticipantListExpanded(false);
      setReviewExpanded(false);
      setReviewMergedLog(null);
      setReviewMergedLogSource(null);
      setReviewParticipantsStravaCumulativeKm(null);
    },
    [rideId]
  );

  useEffect(
    function () {
      if (!reviewExpanded || !rideId) {
        setReviewParticipantsStravaCumulativeKm(null);
        return undefined;
      }
      var db = firestore || (typeof window !== 'undefined' ? window.firestoreV9 : null);
      var ymd = rideYmdRv;
      if (!db || !ymd) {
        setReviewParticipantsStravaCumulativeKm(null);
        return undefined;
      }
      var svcOr = typeof window !== 'undefined' ? window.openRidingService || {} : {};
      var subFn =
        typeof svcOr.subscribeParticipantStravaReviewSumKm === 'function'
          ? svcOr.subscribeParticipantStravaReviewSumKm
          : null;
      if (!subFn) {
        setReviewParticipantsStravaCumulativeKm(null);
        return undefined;
      }
      setReviewParticipantsStravaCumulativeKm(null);
      var hostUidForCum = rideHostRv && String(rideHostRv).trim() ? String(rideHostRv).trim() : '';
      var unsub = subFn(
        db,
        String(rideId).trim(),
        ymd,
        hostUidForCum,
        function (sum) {
          var s = Number(sum);
          setReviewParticipantsStravaCumulativeKm(Number.isFinite(s) ? s : 0);
        },
        function () {
          setReviewParticipantsStravaCumulativeKm(null);
        }
      );
      return function () {
        if (typeof unsub === 'function') unsub();
      };
    },
    [reviewExpanded, rideId, rideYmdRv, rideHostRv, firestore]
  );

  /**
   * 상세 화면 진입만 한 참가자도 후기 (+)를 펼치지 않아도 일지→participantStravaReview 동기화.
   * (이전에는 후기 로드 effect와 겹치지만, 펼침 전·로딩 타이밍 누락을 보강)
   */
  useEffect(
    function () {
      if (!userId || !ride || loading || !rideId) return undefined;
      if (String(ride.rideStatus || 'active') === 'cancelled') return undefined;
      var ymd = getRideDateSeoulYmd(ride);
      if (!ymd || !isOpenRidingRideDayOnOrBeforeTodaySeoul(ride)) return undefined;
      var uid = String(userId).trim();
      var parts = Array.isArray(ride.participants) ? ride.participants : [];
      var inParts = parts.some(function (p) {
        return String(p != null ? p : '').trim() === uid;
      });
      if (!inParts) return undefined;
      var db = firestore || (typeof window !== 'undefined' ? window.firestoreV9 : null);
      var getRng = typeof window.getTrainingLogsByDateRange === 'function' ? window.getTrainingLogsByDateRange : null;
      var svcPart = typeof window !== 'undefined' ? window.openRidingService || {} : {};
      var syncPartFn =
        typeof svcPart.syncParticipantStravaReviewContribution === 'function'
          ? svcPart.syncParticipantStravaReviewContribution
          : null;
      if (!db || !getRng || !syncPartFn) return undefined;
      var yParts = String(ymd).split('-');
      var year = parseInt(yParts[0], 10);
      var month = parseInt(yParts[1], 10) - 1;
      if (!Number.isFinite(year) || !Number.isFinite(month)) return undefined;
      var hostUid = ride.hostUserId != null ? String(ride.hostUserId).trim() : '';
      var cancelled = false;
      getRng(uid, year, month, db)
        .then(function (logs) {
          if (cancelled) return;
          var dayLogs = (logs || []).filter(function (log) {
            return openRidingYmdEqual(openRidingLogYmdSeoul(log), ymd) && openRidingLogIsStrava(log);
          });
          if (hostUid && uid === hostUid) {
            dayLogs = openRidingPickStravaLogsForHostReview(dayLogs, ride);
          }
          var merged = openRidingMergeLogsForReviewSummary(dayLogs);
          if (!merged || String(merged.source || '').toLowerCase() !== 'strava') return;
          var dist = Number(merged.distance_km);
          if (!Number.isFinite(dist) || dist <= 0) return;
          syncPartFn(db, String(rideId).trim(), uid, ymd, merged).catch(function (e) {
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[openRiding] syncParticipantStravaReviewContribution (상세 진입)', e);
            }
          });
        })
        .catch(function () {});
      return function () {
        cancelled = true;
      };
    },
    [
      userId,
      rideId,
      loading,
      firestore,
      rideYmdRv,
      rideParticipantsKeyRv,
      rideStatusRv,
      rideHostRv,
      rideDistRv
    ]
  );

  /**
   * 후기에 표시된 본인 STRAVA 병합 로그가 있으면 항상 participantStravaReview에 기록해
   * '함께 달린 거리'에 반영. 합계는 방장 공개 후기(ride.hostPublicReviewSummary) 거리 + 서브컬렉션 참석자 합(서비스에서 병합).
   */
  useEffect(
    function () {
      if (!reviewMergedLog || typeof reviewMergedLog !== 'object') return undefined;
      if (reviewMergedLogSource !== 'self') return undefined;
      if (String(reviewMergedLog.source || '').toLowerCase() !== 'strava') return undefined;
      var dist = Number(reviewMergedLog.distance_km);
      if (!Number.isFinite(dist) || dist <= 0) return undefined;
      if (!rideId || !userId || !ride) return undefined;
      if (String(ride.rideStatus || 'active') === 'cancelled') return undefined;
      var ymd = getRideDateSeoulYmd(ride);
      if (!ymd) return undefined;
      var db = firestore || (typeof window !== 'undefined' ? window.firestoreV9 : null);
      if (!db) return undefined;
      var uid = String(userId).trim();
      var parts = Array.isArray(ride.participants) ? ride.participants : [];
      var inParts = parts.some(function (p) {
        return String(p).trim() === uid;
      });
      if (!inParts) return undefined;
      var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
      var fn = svc.syncParticipantStravaReviewContribution;
      if (typeof fn !== 'function') return undefined;
      fn(db, String(rideId).trim(), uid, ymd, reviewMergedLog).catch(function (e) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[openRiding] syncParticipantStravaReviewContribution (후기 표시 동기화)', e);
        }
      });
      return undefined;
    },
    [
      reviewMergedLog,
      reviewMergedLogSource,
      rideId,
      userId,
      firestore,
      rideYmdRv,
      rideStatusRv,
      rideParticipantsKeyRv
    ]
  );

  useEffect(
    function () {
      setReviewMergedLog(null);
      setReviewMergedLogSource(null);
      if (!userId || !ride || loading) {
        setReviewLogsLoading(false);
        return undefined;
      }
      var ymd = getRideDateSeoulYmd(ride);
      if (!ymd) {
        setReviewLogsLoading(false);
        return undefined;
      }
      var yParts = String(ymd).split('-');
      var year = parseInt(yParts[0], 10);
      var month = parseInt(yParts[1], 10) - 1;
      if (!Number.isFinite(year) || !Number.isFinite(month)) {
        setReviewLogsLoading(false);
        return undefined;
      }
      var getRng = typeof window.getTrainingLogsByDateRange === 'function' ? window.getTrainingLogsByDateRange : null;
      var db = firestore || (typeof window !== 'undefined' ? window.firestoreV9 : null);
      var svcOr = typeof window !== 'undefined' ? window.openRidingService || {} : {};
      var fetchRideByIdFn = typeof svcOr.fetchRideById === 'function' ? svcOr.fetchRideById : null;
      if (!db) {
        setReviewLogsLoading(false);
        return undefined;
      }
      var rideCancelled = String(ride.rideStatus || 'active') === 'cancelled';
      var hostReviewPublicWindow = !rideCancelled && isOpenRidingRideDayOnOrBeforeTodaySeoul(ride);
      var hostUid = ride.hostUserId != null ? String(ride.hostUserId).trim() : '';
      var uidTrim = String(userId != null ? userId : '').trim();
      var hostViewingOwnRide = !!hostUid && uidTrim === hostUid;
      var useOwnOrHostTrainingLogs =
        role === 'participant' || (hostReviewPublicWindow && hostViewingOwnRide);
      if (!useOwnOrHostTrainingLogs) {
        if (!hostReviewPublicWindow || !hostUid || !rideId || !fetchRideByIdFn) {
          setReviewLogsLoading(false);
          return undefined;
        }
        var hProp = ride.hostPublicReviewSummary;
        var summaryFromRideProp =
          rideDocHostSummaryMatchesRideDate(ride, ymd) && openRidingHostSummaryQualifiesAsGroupRideUi(ride, hProp)
            ? openRidingReviewLogFromStoredSummary(hProp.summary, ymd)
            : null;
        if (summaryFromRideProp) {
          setReviewMergedLog(summaryFromRideProp);
          setReviewMergedLogSource('host_public');
        }
        var cancelledPub = false;
        setReviewLogsLoading(true);
        fetchRideByIdFn(db, rideId)
          .then(function (fresh) {
            if (cancelledPub) return;
            var h = fresh && fresh.hostPublicReviewSummary;
            var s = h && h.summary;
            var d = h && h.rideDateYmd != null ? String(h.rideDateYmd).trim() : '';
            if (
              s &&
              typeof s === 'object' &&
              openRidingYmdEqual(d, ymd) &&
              openRidingHostSummaryQualifiesAsGroupRideUi(fresh, { rideDateYmd: d, summary: s })
            ) {
              setReviewMergedLog(openRidingReviewLogFromStoredSummary(s, ymd));
              setReviewMergedLogSource('host_public');
            } else if (summaryFromRideProp) {
              setReviewMergedLog(summaryFromRideProp);
              setReviewMergedLogSource('host_public');
            } else {
              setReviewMergedLog(null);
              setReviewMergedLogSource(null);
            }
          })
          .catch(function () {
            if (!cancelledPub) {
              if (summaryFromRideProp) {
                setReviewMergedLog(summaryFromRideProp);
                setReviewMergedLogSource('host_public');
              } else {
                setReviewMergedLog(null);
                setReviewMergedLogSource(null);
              }
            }
          })
          .finally(function () {
            if (!cancelledPub) setReviewLogsLoading(false);
          });
        return function () {
          cancelledPub = true;
        };
      }
      if (!getRng) {
        setReviewLogsLoading(false);
        return undefined;
      }
      var reviewLogUserId = role === 'participant' ? String(userId) : hostUid;
      if (!reviewLogUserId) {
        setReviewLogsLoading(false);
        return undefined;
      }
      var cancelled = false;
      setReviewLogsLoading(true);
      function applyHostPublicSummaryDoc(rideDoc, summaryPropFallback) {
        if (cancelled) return;
        var h0 = rideDoc && rideDoc.hostPublicReviewSummary;
        var s0 = h0 && h0.summary;
        var d0 = h0 && h0.rideDateYmd != null ? String(h0.rideDateYmd).trim() : '';
        if (
          s0 &&
          typeof s0 === 'object' &&
          openRidingYmdEqual(d0, ymd) &&
          openRidingHostSummaryQualifiesAsGroupRideUi(rideDoc, { rideDateYmd: d0, summary: s0 })
        ) {
          setReviewMergedLog(openRidingReviewLogFromStoredSummary(s0, ymd));
          if (role === 'participant' && !hostViewingOwnRide) {
            setReviewMergedLogSource('host_fallback');
          } else {
            setReviewMergedLogSource('self');
          }
          return;
        }
        if (summaryPropFallback) {
          setReviewMergedLog(summaryPropFallback);
          if (role === 'participant' && !hostViewingOwnRide) {
            setReviewMergedLogSource('host_fallback');
          } else {
            setReviewMergedLogSource('self');
          }
          return;
        }
        setReviewMergedLog(null);
        setReviewMergedLogSource(null);
      }
      getRng(reviewLogUserId, year, month, db)
        .then(function (logs) {
          if (cancelled) return;
          var dayLogs = (logs || []).filter(function (log) {
            return openRidingYmdEqual(openRidingLogYmdSeoul(log), ymd) && openRidingLogIsStrava(log);
          });
          if (String(reviewLogUserId) === String(hostUid) && hostUid) {
            dayLogs = openRidingPickStravaLogsForHostReview(dayLogs, ride);
          }
          var merged = openRidingMergeLogsForReviewSummary(dayLogs);
          if (merged) {
            setReviewMergedLog(merged);
            setReviewMergedLogSource('self');
            if (
              !cancelled &&
              hostViewingOwnRide &&
              hostReviewPublicWindow &&
              rideId &&
              db
            ) {
              var svcSync = typeof window !== 'undefined' ? window.openRidingService || {} : {};
              var syncFn0 =
                typeof svcSync.syncHostPublicReviewSummary === 'function' ? svcSync.syncHostPublicReviewSummary : null;
              if (syncFn0) {
                var chartProfBase = getOpenRidingJournalUserProfileForCharts();
                syncFn0(db, rideId, ymd, merged, chartProfBase).catch(function (e) {
                  if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[openRiding] syncHostPublicReviewSummary', e);
                  }
                });
              }
            }
            if (!cancelled && rideId && db && !rideCancelled) {
              var svcPart = typeof window !== 'undefined' ? window.openRidingService || {} : {};
              var syncPartFn =
                typeof svcPart.syncParticipantStravaReviewContribution === 'function'
                  ? svcPart.syncParticipantStravaReviewContribution
                  : null;
              if (syncPartFn) {
                var partsForCum = Array.isArray(ride.participants) ? ride.participants : [];
                var uidInParticipants = partsForCum.some(function (p) {
                  return String(p).trim() === String(reviewLogUserId).trim();
                });
                if (uidInParticipants) {
                  syncPartFn(db, rideId, reviewLogUserId, ymd, merged).catch(function (e) {
                    if (typeof console !== 'undefined' && console.warn) {
                      console.warn('[openRiding] syncParticipantStravaReviewContribution', e);
                    }
                  });
                }
              }
            }
            if (!cancelled) setReviewLogsLoading(false);
            return;
          }
          if (!hostReviewPublicWindow || !fetchRideByIdFn || !rideId) {
            setReviewMergedLog(null);
            setReviewMergedLogSource(null);
            if (!cancelled) setReviewLogsLoading(false);
            return;
          }
          var hProp2 = ride.hostPublicReviewSummary;
          var summaryFromRideProp2 =
            rideDocHostSummaryMatchesRideDate(ride, ymd) && openRidingHostSummaryQualifiesAsGroupRideUi(ride, hProp2)
              ? openRidingReviewLogFromStoredSummary(hProp2.summary, ymd)
              : null;
          fetchRideByIdFn(db, rideId)
            .then(function (fresh) {
              applyHostPublicSummaryDoc(fresh || ride, summaryFromRideProp2);
            })
            .catch(function () {
              applyHostPublicSummaryDoc(ride, summaryFromRideProp2);
            })
            .finally(function () {
              if (!cancelled) setReviewLogsLoading(false);
            });
        })
        .catch(function () {
          if (!cancelled) {
            setReviewMergedLog(null);
            setReviewMergedLogSource(null);
            setReviewLogsLoading(false);
          }
        });
      return function () {
        cancelled = true;
      };
    },
    [
      firestore,
      userId,
      rideId,
      loading,
      role,
      rideYmdRv,
      rideStatusRv,
      rideHostRv,
      rideDistRv,
      hStableRv,
      todayRv
    ]
  );

  /** Non-participants: refetch rides when expanding review (host may have just synced summary). */
  useEffect(
    function () {
      if (!reviewExpanded) return undefined;
      if (!userId || !ride || loading) return undefined;
      var ymd2 = getRideDateSeoulYmd(ride);
      if (!ymd2) return undefined;
      var db2 = firestore || (typeof window !== 'undefined' ? window.firestoreV9 : null);
      var svcOr2 = typeof window !== 'undefined' ? window.openRidingService || {} : {};
      var fetchRideByIdFn2 = typeof svcOr2.fetchRideById === 'function' ? svcOr2.fetchRideById : null;
      var rideCancelled2 = String(ride.rideStatus || 'active') === 'cancelled';
      var hostReviewPublicWindow2 = !rideCancelled2 && isOpenRidingRideDayOnOrBeforeTodaySeoul(ride);
      var hostUid2 = ride.hostUserId != null ? String(ride.hostUserId).trim() : '';
      var uidTrim2 = String(userId != null ? userId : '').trim();
      var hostViewingOwnRide2 = !!hostUid2 && uidTrim2 === hostUid2;
      var useOwnOrHostTrainingLogs2 =
        role === 'participant' || (hostReviewPublicWindow2 && hostViewingOwnRide2);
      if (useOwnOrHostTrainingLogs2 || !hostReviewPublicWindow2 || !rideId || !fetchRideByIdFn2 || !db2) {
        return undefined;
      }
      var hProp2 = ride.hostPublicReviewSummary;
      var summaryFromRideProp2 =
        rideDocHostSummaryMatchesRideDate(ride, ymd2) && openRidingHostSummaryQualifiesAsGroupRideUi(ride, hProp2)
          ? openRidingReviewLogFromStoredSummary(hProp2.summary, ymd2)
          : null;
      var cancelledEx = false;
      fetchRideByIdFn2(db2, rideId)
        .then(function (fresh) {
          if (cancelledEx) return;
          var h = fresh && fresh.hostPublicReviewSummary;
          var s = h && h.summary;
          var d = h && h.rideDateYmd != null ? String(h.rideDateYmd).trim() : '';
          if (
            s &&
            typeof s === 'object' &&
            openRidingYmdEqual(d, ymd2) &&
            openRidingHostSummaryQualifiesAsGroupRideUi(fresh, { rideDateYmd: d, summary: s })
          ) {
            setReviewMergedLog(openRidingReviewLogFromStoredSummary(s, ymd2));
            setReviewMergedLogSource('host_public');
          } else if (summaryFromRideProp2) {
            setReviewMergedLog(summaryFromRideProp2);
            setReviewMergedLogSource('host_public');
          }
        })
        .catch(function () {});
      return function () {
        cancelledEx = true;
      };
    },
    [
      reviewExpanded,
      firestore,
      userId,
      rideId,
      loading,
      role,
      rideYmdRv,
      rideStatusRv,
      rideHostRv,
      rideDistRv,
      hStableRv,
      todayRv
    ]
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
        period: 'rolling6m',
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
      var jres = await join({
        contactPublicToParticipants: !!contactPublic,
        joinPasswordAttempt: joinPasswordInput
      });
      if (jres && jres.status) setJoinShareModalOpen(false);
    } finally {
      setBusy(false);
    }
  }
  async function openJoinChargeConfirmModal() {
    var acc = null;
    try {
      if (typeof window !== 'undefined' && typeof window.getUserByUid === 'function' && userId) {
        var row = await window.getUserByUid(String(userId).trim());
        var n = Number(row && row.acc_points != null ? row.acc_points : NaN);
        if (Number.isFinite(n)) acc = n;
      }
    } catch (_e) {}
    if (acc == null) {
      try {
        if (typeof window !== 'undefined' && window.currentUser) {
          var n2 = Number(window.currentUser.acc_points != null ? window.currentUser.acc_points : NaN);
          if (Number.isFinite(n2)) acc = n2;
        }
      } catch (_e2) {}
    }
    if (Number.isFinite(acc) && acc < 10) {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('누적 포인트가 부족합니다. 참석 신청에는 10SP가 필요합니다.');
      }
      return;
    }
    setJoinChargeRemain(Number.isFinite(acc) ? Math.max(0, Math.floor(acc - 10)) : null);
    setJoinShareModalOpen(true);
  }
  async function onLeave() {
    setBusy(true);
    try {
      await leave();
    } finally {
      setBusy(false);
    }
  }
  async function openLeaveRefundConfirmModal() {
    var acc = null;
    try {
      if (typeof window !== 'undefined' && typeof window.getUserByUid === 'function' && userId) {
        var row = await window.getUserByUid(String(userId).trim());
        var n = Number(row && row.acc_points != null ? row.acc_points : NaN);
        if (Number.isFinite(n)) acc = n;
      }
    } catch (_e) {}
    if (acc == null) {
      try {
        if (typeof window !== 'undefined' && window.currentUser) {
          var n2 = Number(window.currentUser.acc_points != null ? window.currentUser.acc_points : NaN);
          if (Number.isFinite(n2)) acc = n2;
        }
      } catch (_e2) {}
    }
    setLeaveRefundRemain(Number.isFinite(acc) ? Math.max(0, Math.floor(acc + 10)) : null);
    setLeaveRefundModalOpen(true);
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

  async function prepareHostRefundPreviewAndOpen(kind) {
    var acc = null;
    try {
      if (typeof window !== 'undefined' && typeof window.getUserByUid === 'function' && userId) {
        var row = await window.getUserByUid(String(userId).trim());
        var n = Number(row && row.acc_points != null ? row.acc_points : NaN);
        if (Number.isFinite(n)) acc = n;
      }
    } catch (_e) {}
    if (acc == null) {
      try {
        if (typeof window !== 'undefined' && window.currentUser) {
          var n2 = Number(window.currentUser.acc_points != null ? window.currentUser.acc_points : NaN);
          if (Number.isFinite(n2)) acc = n2;
        }
      } catch (_e2) {}
    }
    setHostRefundRemain(Number.isFinite(acc) ? Math.max(0, Math.floor(acc + 100)) : null);
    if (kind === 'delete') setDeleteModalOpen(true);
    else setBombOpen(true);
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
      </div>
    );
  }

  var ts = ride.date != null ? openRidingCoerceRideDateToDate(ride.date) : null;
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
  /** (+) 펼침: 방장 또는 (전화 초대 대상이면서 참석·대기 신청 완료) */
  var inviteListToggleEnabled = isHost || (!!userId && phoneInvited && hasApplied);
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
  var joinApplyClosedBySchedule = openRidingIsJoinClosedByScheduleUi(ride);
  /** Non-participant host review: from ride day (Seoul, today inclusive), not cancelled. */
  var hostPublicReviewWindow = !isCancelled && isOpenRidingRideDayOnOrBeforeTodaySeoul(ride);
  var rideYmdHint = getRideDateSeoulYmd(ride);
  var guestHostSummaryOnRide =
    role !== 'participant' &&
    !!rideYmdHint &&
    openRidingHostSummaryQualifiesAsGroupRideUi(ride, ride.hostPublicReviewSummary);
  /** 서울 기준 일정일이 지난 뒤에는 방장도 수정/취소/삭제 불가 — grade=1 관리자는 예외 */
  var _loginGr =
    typeof window !== 'undefined' && typeof window.getLoginUserGrade === 'function' ? window.getLoginUserGrade() : null;
  var _isAdmin1 =
    typeof window !== 'undefined' && typeof window.isStelvioAdminGrade === 'function'
      ? window.isStelvioAdminGrade(_loginGr)
      : false;
  var hostToolbarPastLocked = isOpenRidingPastBySeoulDate(ride) && !_isAdmin1;

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

  /* 상세 본문 루트 z-0, 방장 수정/폭파/삭제는 하단 글래스 네비(OpenRidingDetailGlassNav) */
  return (
    <>
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
                <p className="text-xs font-medium text-slate-600 mb-1">
                  참석 확정 ({parts.length}명)
                  {attVerRan ? (
                    <span className="ml-1.5 text-[10px] font-normal text-slate-400">· Strava 참석 검증 완료</span>
                  ) : null}
                </p>
                {parts.length === 0 ? (
                  <p className="text-xs text-slate-400">아직 없습니다.</p>
                ) : (
                  <ol className="list-none text-sm text-slate-700 space-y-1.5 pl-0">
                    {parts.map(function (uid, idx) {
                      var suf = participantListPhoneSuffix(uid);
                      /* ride.attendanceResults 맵에서 직접 읽기 (별도 쿼리 불필요) */
                      var attResultsMap = attVerRan && ride.attendanceResults && typeof ride.attendanceResults === 'object'
                        ? ride.attendanceResults : null;
                      var attStatus = attResultsMap ? (attResultsMap[String(uid)] || null) : null;
                      /* attVerRan이고 맵은 있는데 이 uid 결과가 없으면 → SKIPPED */
                      var attSkipped = attVerRan && attResultsMap !== null && attStatus === null;
                      return (
                        <li key={String(uid) + '-p'} className="flex items-center gap-1 flex-wrap">
                          <span className="font-semibold text-violet-700">{idx + 1}번</span>{' '}
                          <span>{participantRowName(uid, '참가자')}</span>
                          {suf ? <span className="text-slate-600">{suf}</span> : null}
                          {attStatus === 'ATTENDED' ? (
                            <span
                              className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-emerald-50 border border-emerald-200 px-1.5 py-0 text-[10px] font-medium text-emerald-700 leading-4"
                              title="Strava 활동으로 참석이 확인되었습니다"
                            >
                              ✅ 참석
                            </span>
                          ) : attStatus === 'MISSED' ? (
                            <span
                              className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-red-50 border border-red-200 px-1.5 py-0 text-[10px] font-medium text-red-600 leading-4"
                              title="Strava 활동으로 참석이 확인되지 않았습니다"
                            >
                              ❌ 미참석
                            </span>
                          ) : attSkipped ? (
                            <span
                              className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-slate-50 border border-slate-200 px-1.5 py-0 text-[10px] font-medium text-slate-400 leading-4"
                              title="Strava 연동 없음 또는 토큰 만료로 확인 불가"
                            >
                              ❓ 미확인
                            </span>
                          ) : null}
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
                  disabled={!inviteListToggleEnabled}
                  title={
                    !inviteListToggleEnabled && !isHost
                      ? '초대받은 뒤 참석(또는 대기) 신청을 완료한 경우에만 펼칠 수 있습니다.'
                      : undefined
                  }
                  className={
                    'm-0 p-0 bg-transparent border-0 text-left text-sm font-semibold leading-[1.25rem] rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ' +
                    (inviteListToggleEnabled
                      ? 'cursor-pointer text-[#6d28d9] hover:text-[#5b21b6]'
                      : 'cursor-not-allowed text-slate-400 opacity-70')
                  }
                  onClick={function () {
                    if (!inviteListToggleEnabled) return;
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
        <div className="open-riding-detail-pack-rules-fold open-riding-detail-invite-fold--block w-full min-w-0">
          <div className="open-riding-detail-stat-row open-riding-detail-stat-row--invite items-start gap-2">
            <span className="open-riding-detail-stat-label shrink-0 pt-0.5">
              <button
                type="button"
                className="m-0 p-0 bg-transparent border-0 cursor-pointer text-left text-sm font-semibold leading-[1.25rem] text-[#6d28d9] hover:text-[#5b21b6] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 rounded"
                onClick={function () {
                  setReviewExpanded(function (v) {
                    return !v;
                  });
                }}
                aria-expanded={reviewExpanded}
                id="open-riding-review-toggle"
              >
                후기{' '}
                <span className="tabular-nums font-semibold text-inherit" aria-hidden>
                  {reviewExpanded ? '(−)' : '(+)'}
                </span>
              </button>
            </span>
            <div className="open-riding-detail-stat-value min-w-0 flex flex-col items-end text-right gap-0.5">
              <span className="text-xs text-slate-500 leading-tight font-medium">
                {reviewMergedLog
                  ? '펼치어보기 하면 라이딩 후기를 확인하실 수 있습니다.'
                  : role === 'participant' && hostPublicReviewWindow
                    ? joinApplyClosedBySchedule
                      ? "종료된 일정입니다. (+)를 눌러 후기 요약을 확인하세요."
                      : openRidingIsRideScheduleDayTodaySeoul(ride) &&
                          !rideDocHostSummaryMatchesRideDate(ride, rideYmdHint) &&
                          !isOpenRidingPastBySeoulDate(ride)
                        ? "오늘 일정입니다. 훈련일지에 라이딩이 반영되면 종료·후기 요약이 표시될 수 있습니다. (+)를 다시 눌러 최신 상태를 불러오세요."
                        : "해당 일정일 STRAVA 기록이 훈련일지에 반영되면 본인 후기가 표시되고, 없으면 방장 후기가 표시됩니다."
                    : role !== 'participant' && hostPublicReviewWindow
                      ? joinApplyClosedBySchedule
                        ? '종료된 일정입니다. (+)를 눌러 방장 후기 요약을 확인하세요.'
                        : openRidingIsRideScheduleDayTodaySeoul(ride) &&
                            !guestHostSummaryOnRide &&
                            !isOpenRidingPastBySeoulDate(ride)
                          ? "오늘 일정입니다. 방장의 훈련일지에 라이딩이 반영되면 종료로 보고 방장 후기 요약이 표시됩니다. (+)를 다시 눌러 최신 상태를 불러오세요."
                          : "방장 후기가 등록되면 요약이 표시됩니다."
                      : "라이딩이 종료되면 후기가 자동 작성됩니다."}
              </span>
            </div>
          </div>
          {reviewExpanded ? (
            <div
              className="m-0 w-full min-w-0 border-t border-slate-100/90 px-3 py-3 space-y-2 text-left"
              role="region"
              aria-labelledby="open-riding-review-toggle"
            >
              {role === 'participant' ? (
                reviewLogsLoading ? (
                  <p className="text-xs text-slate-500 m-0">불러오는 중…</p>
                ) : reviewMergedLog ? (
                  <div className="w-full min-w-0 space-y-2">
                    {reviewMergedLogSource === 'host_fallback' ? (
                      <p className="text-xs text-slate-600 m-0 font-semibold">방장 후기 (본인 STRAVA 기록 없음)</p>
                    ) : null}
                    <OpenRidingRideReviewSummaryContent
                      log={reviewMergedLog}
                      chartUserProfile={openRidingResolveReviewChartUserProfile(
                        reviewMergedLog,
                        reviewMergedLogSource,
                        ride
                      )}
                      participantsStravaCumulativeKm={reviewParticipantsStravaCumulativeKm}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 m-0 leading-relaxed">
                    이 일정일에 본인 STRAVA 라이딩 기록이 없고, 방장 공개 후기도 아직 없거나 종료 조건에 해당하지 않습니다.
                  </p>
                )
              ) : hostPublicReviewWindow ? (
                reviewLogsLoading ? (
                  <p className="text-xs text-slate-500 m-0">불러오는 중…</p>
                ) : reviewMergedLog ? (
                  <div className="w-full min-w-0 space-y-2">
                    <p className="text-xs text-slate-600 m-0 font-semibold">방장 후기(공개)</p>
                    <OpenRidingRideReviewSummaryContent
                      log={reviewMergedLog}
                      chartUserProfile={openRidingResolveReviewChartUserProfile(
                        reviewMergedLog,
                        reviewMergedLogSource,
                        ride
                      )}
                      participantsStravaCumulativeKm={reviewParticipantsStravaCumulativeKm}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 m-0 leading-relaxed">
                    {openRidingIsRideScheduleDayTodaySeoul(ride)
                      ? '오늘 일정입니다. 방장의 STRAVA 라이딩 기록이 훈련일지에 반영되면 방장 후기 요약이 여기에 표시됩니다. 이미 반영되었다면 후기 (+)를 다시 눌러 최신 내용을 불러오세요.'
                      : '방장 후기가 아직 등록되지 않았습니다. 해당 일정일(서울 기준)에 방장의 STRAVA 라이딩 기록이 훈련일지에 반영되면 여기에 표시됩니다.'}
                  </p>
                )
              ) : (
                <p className="text-xs text-slate-500 m-0 leading-relaxed">
                  참석 확정인 경우, 해당 일정일(서울 기준)에 STRAVA로 수집된 라이딩 기록이 훈련일지에 반영되어 있으면 아래에 요약이 표시됩니다. 모임 일정일이 도래한 날부터는 방장 후기가 등록되면 요약을 확인할 수 있습니다.
                </p>
              )}
            </div>
          ) : null}
        </div>
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
                  <button
                    type="button"
                    className="open-riding-action-btn h-11 inline-flex items-center justify-center flex-1 px-4 border border-red-200 text-red-700 rounded-xl font-medium leading-none disabled:opacity-50"
                    disabled={isActionBusy || joinApplyClosedBySchedule}
                    title={
                      joinApplyClosedBySchedule
                        ? '일정이 지났거나 방장 후기가 등록되어 참석 신청·취소가 마감되었습니다'
                        : undefined
                    }
                    onClick={function () {
                      if (joinApplyClosedBySchedule || isActionBusy) return;
                      openLeaveRefundConfirmModal();
                    }}
                  >
                    {joinApplyClosedBySchedule ? '참석 변경 마감' : '참석 취소'}
                  </button>
                ) : !role && !isHost ? (
                  <button
                    type="button"
                    className="open-riding-action-btn h-11 inline-flex items-center justify-center flex-1 px-4 bg-violet-600 text-white rounded-xl font-medium leading-none disabled:opacity-50"
                    disabled={isActionBusy || !userId || !joinInviteOk || joinApplyClosedBySchedule}
                    title={
                      joinApplyClosedBySchedule
                        ? '일정이 지났거나 방장 후기가 등록되어 참석 신청·취소가 마감되었습니다'
                        : !joinInviteOk
                          ? '초대된 연락처 또는 입장 비밀번호가 필요합니다'
                          : undefined
                    }
                    onClick={function () {
                      if (!joinInviteOk || joinApplyClosedBySchedule) return;
                      openJoinChargeConfirmModal();
                    }}
                  >
                    {joinApplyClosedBySchedule
                      ? '참석 신청 마감'
                      : joinInviteOk
                        ? '참석 신청'
                        : '참석 신청 (입장 조건)'}
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
        </div>
      ) : null}

      {joinShareModalOpen ? (
        <div
          className="fixed inset-0 z-[200075] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm"
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
                라이딩 모임 참석 신청
              </h2>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-slate-800 font-medium m-0">라이딩 모임 참석 시 TSS 마일리지 누적 포인트에서 10SP 차감됩니다.</p>
              <p className="text-xs text-slate-500 m-0 leading-relaxed">
                {joinChargeRemain == null ? '(차감 후 잔여 포인트는 신청 후 반영됩니다.)' : '(차감후 잔여 포인트는 ' + joinChargeRemain + ' SP)'}
              </p>
              <p className="text-xs text-slate-500 m-0 leading-relaxed">(참석자에게 연락처를 공개할지 선택해 주세요.)</p>
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
      {leaveRefundModalOpen ? (
        <div
          className="open-riding-bomb-modal-backdrop fixed inset-0 z-[200076] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-riding-leave-refund-title"
          onClick={function () {
            if (!isActionBusy) setLeaveRefundModalOpen(false);
          }}
        >
          <div
            className="open-riding-bomb-modal-panel w-full max-w-sm py-7 px-8 text-center"
            onClick={function (e) { e.stopPropagation(); }}
          >
            <div className="flex items-center justify-center gap-2.5 mb-4 pb-4 border-b border-slate-200">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-700 text-sm font-bold border border-violet-200" aria-hidden>SP</span>
              <h2 id="open-riding-leave-refund-title" className="text-base font-bold text-slate-800 m-0 leading-tight">
                참석 취소
              </h2>
            </div>
            <p className="stelvio-exit-confirm-message text-center m-0">참석 취소 시 차감된 누적 포인트 10SP가 환급 처리됩니다.</p>
            <p className="text-xs text-slate-500 mt-2 mb-5 leading-snug text-center">
              {leaveRefundRemain == null ? '(환급 후 포인트는 처리 후 반영됩니다.)' : '(환급 후 누적 포인트는 ' + leaveRefundRemain + ' SP)'}
            </p>
            <div className="stelvio-exit-confirm-buttons">
              <button
                type="button"
                className="open-riding-action-btn stelvio-exit-confirm-btn stelvio-exit-confirm-btn-cancel inline-flex items-center justify-center disabled:opacity-50"
                disabled={isActionBusy}
                onClick={function () { setLeaveRefundModalOpen(false); }}
              >
                취소
              </button>
              <button
                type="button"
                className="open-riding-action-btn stelvio-exit-confirm-btn stelvio-exit-confirm-btn-ok inline-flex items-center justify-center disabled:opacity-50"
                disabled={isActionBusy}
                onClick={function () {
                  setLeaveRefundModalOpen(false);
                  onLeave();
                }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bombOpen ? (
        <div
          className="open-riding-bomb-modal-backdrop fixed inset-0 z-[200070] flex items-center justify-center p-4"
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
                라이딩 폭파
              </h2>
            </div>
            <p className="stelvio-exit-confirm-message text-center">정말 라이딩을 폭파하시겠습니까?</p>
            <p className="text-xs text-slate-500 mt-2 leading-snug m-0 text-center">
              모임 생성 시 차감되었던 100SP가 환급 처리됩니다.
            </p>
            <p className="text-xs text-slate-500 mb-5 leading-snug m-0 text-center">
              {hostRefundRemain == null ? '(환급 후 포인트는 처리 후 반영됩니다.)' : '(환급 후 누적 포인트는 ' + hostRefundRemain + ' SP)'}
            </p>
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
          className="open-riding-bomb-modal-backdrop fixed inset-0 z-[200071] flex items-center justify-center p-4"
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
            <p className="text-xs text-slate-500 mt-2 leading-snug m-0 text-center">
              모임 생성 시 차감되었던 100SP가 환급 처리됩니다.
            </p>
            <p className="text-xs text-slate-500 mb-5 leading-snug m-0 text-center">
              {hostRefundRemain == null ? '(환급 후 포인트는 처리 후 반영됩니다.)' : '(환급 후 누적 포인트는 ' + hostRefundRemain + ' SP)'}
            </p>
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
    <OpenRidingDetailGlassNav
      onHome={onHome}
      onMoim={onBack}
      onEdit={onOpenEdit}
      onCancel={function () {
        prepareHostRefundPreviewAndOpen('cancel');
      }}
      onDelete={function () {
        prepareHostRefundPreviewAndOpen('delete');
      }}
      hostToolbarLocked={hostToolbarPastLocked}
      showHostActions={!isCancelled && (isHost || _isAdmin1)}
    />
    </>
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
  var _fe = useState(true);
  var friendsExpanded = _fe[0];
  var setFriendsExpanded = _fe[1];
  /** 친구 수락: native alert 대신 STELVIO 모달 — success는 확인 시 목록 반영 */
  var _fad = useState(null);
  var friendAcceptDialog = _fad[0];
  var setFriendAcceptDialog = _fad[1];
  /** 등록 친구 삭제 확인 */
  var _frc = useState(null);
  var friendRemoveConfirm = _frc[0];
  var setFriendRemoveConfirm = _frc[1];

  function refresh() {
    var fr = typeof window !== 'undefined' ? window.openRidingFriendsService || {} : {};
    if (!firestore || !userId || typeof fr.fetchFriendManagementSnapshot !== 'function') {
      setBundle(function (x) {
        return Object.assign({}, x, { loading: false });
      });
      return Promise.resolve();
    }
    setBundle(function (x) {
      return Object.assign({}, x, { loading: true, err: '' });
    });
    return fr.fetchFriendManagementSnapshot(firestore, userId).then(function (data) {
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

  /** 수락 API 성공 직후: 받은 요청에서 해당 건 제거·친구 목록에 반영, 이어서 refresh로 서버와 일치 */
  function applyLocalStateAfterAccept(row, fromUid) {
    var from = String(fromUid || '');
    var rowId = row && row.id != null ? String(row.id) : '';
    setBundle(function (x) {
      var incoming = (x.incoming || []).filter(function (r) {
        if (rowId && String(r.id) === rowId) return false;
        if (!rowId && String(r.fromUid || '') === from && String(r.status || '') === 'pending') return false;
        return true;
      });
      var friends = (x.friends || []).slice();
      var exists = friends.some(function (f) {
        return String(f.friendUid || f.id || '') === from;
      });
      if (!exists) {
        var nm = row && row.fromDisplayName != null ? String(row.fromDisplayName) : '회원';
        var ct = row && row.fromContact != null ? String(row.fromContact) : '';
        friends.push({
          id: from,
          friendUid: from,
          displayName: nm,
          contact: ct
        });
        friends.sort(function (a, b) {
          return String(a.displayName || '').localeCompare(String(b.displayName || ''), 'ko');
        });
      }
      return Object.assign({}, x, { incoming: incoming, friends: friends });
    });
  }

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
    var pr = profForSend();
    if (!pr.fromContact) {
      alert('프로필에 연락처를 등록한 뒤 친구 요청을 보낼 수 있습니다.');
      return;
    }
    setActionBusy(true);
    var accepter = { toDisplayName: pr.fromDisplayName, toContact: pr.fromContact };
    var preview = { targetName: c.name, targetContact: c.contact };
    var chain;
    if (c.theyHaveMe && typeof fr.tryCompleteMutualFriend === 'function') {
      chain = fr.tryCompleteMutualFriend(firestore, userId, c.uid, accepter, preview);
    } else if (typeof fr.sendFriendRequest === 'function') {
      chain = fr.sendFriendRequest(firestore, userId, c.uid, pr, preview);
    } else {
      setActionBusy(false);
      return;
    }
    chain
      .then(function () {
        return refresh();
      })
      .catch(function (e) {
        alert(e && e.message ? e.message : '처리 실패');
      })
      .finally(function () {
        setActionBusy(false);
      });
  }

  function searchRowStatus(c) {
    var fr = typeof window !== 'undefined' ? window.openRidingFriendsService || {} : {};
    if (typeof fr.getFriendSearchRowStatus !== 'function') return '—';
    var opts = c && c.theyHaveMe ? { theyHaveMe: true } : undefined;
    return fr.getFriendSearchRowStatus(c.uid, bundle.friends, bundle.outgoing, bundle.incoming, opts);
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
    return (
      st === '친구 요청 가능' ||
      st === '거절됨' ||
      st === '요청 취소됨' ||
      st === '바로 친구 추가'
    );
  }

  function searchStatusDisplay(st) {
    var s = String(st || '');
    if (s === '이미 친구') return '친구';
    if (s === '바로 친구 추가') return '상대 등록됨';
    if (s === '친구 요청 가능') return '요청 가능';
    return s || '—';
  }

  function outgoingDisplayName(row) {
    var nm = row.targetPreviewName != null ? String(row.targetPreviewName).trim() : '';
    if (nm) return nm;
    return row.toDisplayName != null ? String(row.toDisplayName).trim() : '상대';
  }

  /** 4글자 이상은 앞 2글자 + .., 1~3글자는 그대로 (한 줄 표기용) */
  function truncateNameThreeDots(name) {
    var s = String(name != null ? name : '').trim();
    if (s.length >= 4) return s.slice(0, 2) + '..';
    return s || '-';
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

  var friendActionSpinnerVisible = searchBusy || actionBusy;

  return (
    <div className="open-riding-filter-full-page w-full max-w-lg mx-auto text-left relative z-0">
      {friendActionSpinnerVisible ? (
        <div
          className="fixed inset-0 z-[200050] flex items-center justify-center bg-slate-900/30 pointer-events-auto"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-8 py-6 shadow-xl border border-slate-200">
            <div
              className="h-11 w-11 rounded-full border-[3px] border-emerald-100 border-t-emerald-600 animate-spin shrink-0"
              style={{ animationDuration: '0.7s' }}
            />
            <p className="text-sm font-medium text-slate-700 m-0">동작 진행 중…</p>
          </div>
        </div>
      ) : null}
      <div className="open-riding-create-form-root w-full max-w-lg mx-auto space-y-3 pb-4 text-sm text-slate-700 relative z-0">
        {/* 1. 친구 요청 대상자 검색 */}
        <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
          <h2 className="text-sm font-semibold text-slate-800 m-0">친구 요청 대상자 검색</h2>
          <p className="text-xs text-slate-500 m-0 leading-snug">
            검색 결과·보낸/받은 요청에서는 상대 전화번호가 수락되기 전까지 마스킹(예: 010-4017-****)되어 표시됩니다.
          </p>
          <div className="flex flex-row flex-nowrap gap-2 items-stretch">
            <input
              type="text"
              className="min-w-0 flex-1 border border-slate-300 rounded-lg px-2 py-2 text-sm"
              placeholder="이름 또는 전화 뒤 4자리"
              value={searchTerm}
              onChange={function (e) {
                setSearchTerm(e.target.value);
              }}
            />
            <button
              type="button"
              className="shrink-0 rounded-lg border-0 px-3 py-2 text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
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
                        var reqLabel = rowSt === '바로 친구 추가' ? '친구 추가' : '친구 요청';
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
                                {reqLabel}
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
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            aria-expanded={friendsExpanded}
            className="w-full text-left bg-violet-100 border-0 border-b border-violet-200/60 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 cursor-pointer hover:bg-violet-100/90"
            onClick={function () {
              setFriendsExpanded(function (v) {
                return !v;
              });
            }}
          >
            <span className="text-sm font-semibold text-slate-800 inline-flex items-center gap-1.5">
              등록된 친구
              <span className="text-violet-700 tabular-nums" aria-hidden="true">
                {friendsExpanded ? '(−)' : '(+)'}
              </span>
            </span>
            <span className="text-sm text-slate-700 font-medium tabular-nums shrink-0">
              {bundle.loading ? '…' : bundle.friends.length + '명'}
            </span>
          </button>
          {friendsExpanded ? (
            <div className="p-3 space-y-2">
              {bundle.loading ? (
                <p className="text-sm text-slate-500 m-0">불러오는 중…</p>
              ) : bundle.friends.length === 0 ? (
                <p className="text-sm text-slate-500 m-0">등록된 친구가 없습니다. 요청이 수락되면 여기에 표시됩니다.</p>
              ) : (
                <div className="overflow-x-auto -mx-0.5">
                  <table className="w-full table-fixed text-sm leading-snug text-left border-collapse border border-slate-100 rounded-lg overflow-hidden">
                    <thead>
                      <tr className="text-slate-600 bg-violet-50 border-b border-slate-100">
                        <th className="py-2 pl-2 pr-1 font-medium w-[10%] whitespace-nowrap">순번</th>
                        <th className="py-2 px-1 font-medium w-[20%] whitespace-nowrap">이름</th>
                        <th className="py-2 px-1 font-medium w-[38%] whitespace-nowrap">연락처</th>
                        <th className="py-2 pr-2 pl-1 font-medium w-[14%] text-center whitespace-nowrap">삭제</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.friends.map(function (row, idx) {
                        var disp = row.displayName != null ? String(row.displayName) : '-';
                        var cont = row.contact != null ? String(row.contact) : '-';
                        var fUid = String(row.friendUid != null ? row.friendUid : row.id != null ? row.id : '');
                        return (
                          <tr key={String(row.id || row.friendUid || idx)} className="border-b border-slate-50 last:border-b-0 align-middle">
                            <td className="py-2 pl-2 pr-1 text-slate-600 tabular-nums whitespace-nowrap align-middle">{idx + 1}</td>
                            <td
                              className="py-2 px-1 font-medium text-slate-800 whitespace-nowrap overflow-hidden text-ellipsis align-middle min-w-0"
                              title={disp}
                            >
                              {disp}
                            </td>
                            <td
                              className="py-2 px-1 text-slate-700 tabular-nums whitespace-nowrap overflow-hidden text-ellipsis align-middle min-w-0"
                              title={cont}
                            >
                              {cont}
                            </td>
                            <td className="py-2 pr-2 pl-1 text-center align-middle">
                              <button
                                type="button"
                                className="text-sm font-semibold px-2 py-1 rounded border border-red-200 text-red-700 bg-white hover:bg-red-50 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                                disabled={actionBusy || !fUid}
                                onClick={function () {
                                  setFriendRemoveConfirm({ friendUid: fUid, displayName: disp });
                                }}
                              >
                                삭제
                              </button>
                            </td>
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

        {/* 3. 내가 보낸 요청 */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="bg-violet-100 border-b border-violet-200/60 px-3 py-2.5">
            <h2 className="text-sm font-semibold text-slate-800 m-0">내가 보낸 요청</h2>
          </div>
          <div className="p-3 space-y-2">
            {outgoingList.length === 0 ? (
              <p className="text-sm text-slate-500 m-0">보낸 요청이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto -mx-0.5">
                <table className="w-full table-fixed text-sm leading-snug text-left border-collapse border border-slate-100 rounded-lg overflow-hidden">
                  <thead>
                    <tr className="text-slate-600 bg-violet-50 border-b border-slate-100">
                      <th className="py-2 pl-2 pr-1 font-medium w-[18%]">이름</th>
                      <th className="py-2 px-1 font-medium w-[36%]">연락처</th>
                      <th className="py-2 px-1 font-medium w-[14%]">상태</th>
                      <th className="py-2 pr-2 pl-1 font-medium text-center align-middle w-[32%]">요청</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outgoingList.map(function (row) {
                      var st = String(row.status || '');
                      var to = String(row.toUid || '');
                      return (
                        <tr key={String(row.id || 'out-' + to)} className="border-b border-slate-50 last:border-b-0 align-middle">
                          <td className="py-2 pl-2 pr-1 font-medium text-slate-800 whitespace-nowrap overflow-hidden text-ellipsis align-middle" title={outgoingDisplayName(row)}>
                            {truncateNameThreeDots(outgoingDisplayName(row))}
                          </td>
                          <td className="py-2 px-1 text-slate-600 tabular-nums whitespace-nowrap align-middle">{outgoingContactForDisplay(row)}</td>
                          <td className="py-2 px-1 text-slate-600 whitespace-nowrap align-middle">{outgoingStatusShort(st)}</td>
                          <td className="py-2 pr-2 pl-1 text-center align-middle">
                            <div className="inline-flex flex-nowrap items-center justify-center gap-0.5 max-w-full">
                              {st === 'pending' ? (
                                <button
                                  type="button"
                                  className="text-sm font-semibold px-2 py-1 rounded border border-amber-200 text-amber-800 bg-white hover:bg-amber-50 whitespace-nowrap shrink-0"
                                disabled={actionBusy}
                                onClick={function () {
                                  var fr = window.openRidingFriendsService || {};
                                  if (typeof fr.cancelFriendRequest !== 'function') return;
                                  setActionBusy(true);
                                  fr.cancelFriendRequest(firestore, userId, to).then(function () {
                                    return refresh();
                                  }).catch(function (e) {
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
                                className="text-sm font-semibold px-2 py-1 rounded border border-violet-200 text-violet-800 bg-white hover:bg-violet-50 whitespace-nowrap shrink-0"
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
                                  }).then(function () {
                                    return refresh();
                                  }).catch(function (e) {
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
                                className="text-sm font-semibold px-2 py-1 rounded border border-slate-300 text-slate-600 bg-white hover:bg-slate-50 whitespace-nowrap shrink-0"
                                disabled={actionBusy}
                                onClick={function () {
                                  var fr = window.openRidingFriendsService || {};
                                  if (typeof fr.deleteFriendRequestForSender !== 'function') return;
                                  setActionBusy(true);
                                  fr.deleteFriendRequestForSender(firestore, userId, to).then(function () {
                                    return refresh();
                                  }).catch(function (e) {
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
          </div>
        </section>

        {/* 4. 나에게 온 요청 */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="bg-violet-100 border-b border-violet-200/60 px-3 py-2.5">
            <h2 className="text-sm font-semibold text-slate-800 m-0">나에게 온 요청</h2>
          </div>
          <div className="p-3 space-y-2">
            {incomingList.length === 0 ? (
              <p className="text-sm text-slate-500 m-0">새 요청이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto -mx-0.5">
                <table className="w-full text-sm text-left border-collapse border border-slate-100 rounded-lg overflow-hidden min-w-[280px]">
                  <thead>
                    <tr className="text-slate-600 bg-violet-50 border-b border-slate-100">
                      <th className="py-2 px-2 font-medium whitespace-nowrap">이름</th>
                      <th className="py-2 px-2 font-medium min-w-[6rem]">연락처</th>
                      <th className="py-2 px-2 font-medium text-center whitespace-nowrap w-[1%]">처리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomingList.map(function (row) {
                      var st = String(row.status || '');
                      var from = String(row.fromUid || '');
                      return (
                        <tr key={String(row.id || 'in-' + from)} className="border-b border-slate-50 last:border-b-0 align-middle">
                          <td className="py-2 px-2 font-medium text-slate-800 align-middle">
                            {row.fromDisplayName != null ? String(row.fromDisplayName) : '회원'}
                          </td>
                          <td className="py-2 px-2 text-slate-600 break-all tabular-nums align-middle">{incomingContactForDisplay(row)}</td>
                          <td className="py-2 px-2 text-center align-middle whitespace-nowrap">
                            <div className="inline-flex flex-row flex-nowrap items-center justify-center gap-1 max-w-full">
                              {st === 'pending' || st === 'rejected' ? (
                                <button
                                  type="button"
                                  className="text-sm font-semibold px-2 py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                                disabled={actionBusy}
                                onClick={function () {
                                  if (!acceptProfMemo.toContact) {
                                    setFriendAcceptDialog({ type: 'needContact' });
                                    return;
                                  }
                                  var fr = window.openRidingFriendsService || {};
                                  if (typeof fr.acceptFriendRequest !== 'function') return;
                                  setActionBusy(true);
                                  fr.acceptFriendRequest(firestore, from, userId, acceptProfMemo)
                                    .then(function () {
                                      setFriendAcceptDialog({ type: 'success', row: row, fromUid: from });
                                    })
                                    .catch(function (e) {
                                      setFriendAcceptDialog({
                                        type: 'error',
                                        message: e && e.message ? String(e.message) : '수락 실패'
                                      });
                                    })
                                    .finally(function () {
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
                                className="text-sm font-semibold px-2 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                                disabled={actionBusy}
                                onClick={function () {
                                  var fr = window.openRidingFriendsService || {};
                                  if (typeof fr.rejectFriendRequest !== 'function') return;
                                  setActionBusy(true);
                                  fr.rejectFriendRequest(firestore, from, userId).then(function () {
                                    return refresh();
                                  }).catch(function (e) {
                                    alert(e && e.message ? e.message : '거절 실패');
                                  }).finally(function () {
                                    setActionBusy(false);
                                  });
                                }}
                              >
                                거절
                              </button>
                            ) : null}
                            {st !== 'pending' && st !== 'rejected' ? (
                              <span className="text-sm text-slate-600">{statusKo(st)}</span>
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
          </div>
        </section>

        {bundle.err ? <p className="text-xs text-red-600 m-0 px-1">{bundle.err}</p> : null}
      </div>

      {friendAcceptDialog ? (
        <div
          className="open-riding-bomb-modal-backdrop fixed inset-0 z-[200060] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-riding-friend-accept-dialog-title"
          onClick={function (ev) {
            if (ev.target !== ev.currentTarget) return;
            if (friendAcceptDialog && friendAcceptDialog.type === 'success') return;
            setFriendAcceptDialog(null);
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
                className={
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold border ' +
                  (friendAcceptDialog.type === 'success'
                    ? 'bg-violet-50 text-violet-700 border-violet-200'
                    : 'bg-amber-50 text-amber-700 border-amber-100')
                }
                aria-hidden
              >
                {friendAcceptDialog.type === 'success' ? '✓' : '!'}
              </span>
              <h2
                id="open-riding-friend-accept-dialog-title"
                className="text-base font-bold text-slate-800 m-0 leading-tight"
              >
                {friendAcceptDialog.type === 'success'
                  ? '친구 수락'
                  : friendAcceptDialog.type === 'needContact'
                    ? '안내'
                    : '알림'}
              </h2>
            </div>
            <p className="stelvio-exit-confirm-message text-center m-0">
              {friendAcceptDialog.type === 'success'
                ? '친구수락이 완료되었습니다.'
                : friendAcceptDialog.type === 'needContact'
                  ? '수락 시 상대에게 공개할 연락처가 필요합니다. 프로필에서 등록해 주세요.'
                  : friendAcceptDialog.message || '수락에 실패했습니다.'}
            </p>
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                className="open-riding-action-btn stelvio-exit-confirm-btn stelvio-exit-confirm-btn-ok inline-flex items-center justify-center min-w-[8rem] px-6"
                onClick={function () {
                  setFriendAcceptDialog(function (prev) {
                    if (prev && prev.type === 'success' && prev.row && prev.fromUid) {
                      applyLocalStateAfterAccept(prev.row, prev.fromUid);
                      setFriendsExpanded(true);
                      refresh();
                    }
                    return null;
                  });
                }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {friendRemoveConfirm ? (
        <div
          className="open-riding-bomb-modal-backdrop fixed inset-0 z-[200060] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-riding-friend-remove-dialog-title"
          onClick={function (ev) {
            if (ev.target !== ev.currentTarget) return;
            if (actionBusy) return;
            setFriendRemoveConfirm(null);
          }}
        >
          <div
            className="open-riding-bomb-modal-panel w-full max-w-sm py-7 px-8 text-center"
            onClick={function (e) {
              e.stopPropagation();
            }}
          >
            <h2 id="open-riding-friend-remove-dialog-title" className="text-base font-bold text-slate-800 m-0 mb-4 leading-tight">
              친구 삭제
            </h2>
            <p className="stelvio-exit-confirm-message text-center m-0">
              정말 삭제 하시겠습니까?
            </p>
            <div className="mt-6 flex flex-row flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                className="open-riding-action-btn stelvio-exit-confirm-btn stelvio-exit-confirm-btn-cancel inline-flex items-center justify-center min-w-[6rem] px-5"
                disabled={actionBusy}
                onClick={function () {
                  if (actionBusy) return;
                  setFriendRemoveConfirm(null);
                }}
              >
                취소
              </button>
              <button
                type="button"
                className="open-riding-action-btn stelvio-exit-confirm-btn stelvio-exit-confirm-btn-ok inline-flex items-center justify-center min-w-[6rem] px-5"
                disabled={actionBusy}
                onClick={function () {
                  if (!friendRemoveConfirm || !friendRemoveConfirm.friendUid) return;
                  var fr = window.openRidingFriendsService || {};
                  if (typeof fr.removeRegisteredFriend !== 'function') return;
                  setActionBusy(true);
                  fr.removeRegisteredFriend(firestore, userId, friendRemoveConfirm.friendUid)
                    .then(function () {
                      setFriendRemoveConfirm(null);
                      return refresh();
                    })
                    .catch(function (e) {
                      alert(e && e.message ? e.message : '삭제 실패');
                    })
                    .finally(function () {
                      setActionBusy(false);
                    });
                }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function openRidingGroupsIsAdminGrade() {
  var g =
    typeof window !== 'undefined' && typeof window.getLoginUserGrade === 'function' ? window.getLoginUserGrade() : null;
  return !!(typeof window !== 'undefined' && typeof window.isStelvioAdminGrade === 'function' && window.isStelvioAdminGrade(g));
}

/** 소모임(그룹) 목록 — 승인/대기 필터·좌측 생성 FAB(맨 위로 버튼과 동일 bottom, 항상 표시) */
function OpenRidingGroupsList(props) {
  var firestore = props.firestore;
  var userId = props.userId || '';
  var joinRequestCountMap = props.joinRequestCountMap || {};
  var onOpenDetail = props.onOpenDetail || function () {};
  var onCreate = props.onCreate || function () {};
  var _rows = useState([]);
  var rows = _rows[0];
  var setRows = _rows[1];
  var _filterText = useState('');
  var filterText = _filterText[0];
  var setFilterText = _filterText[1];
  var _owp = useState({});
  var ownerProfiles = _owp[0];
  var setOwnerProfiles = _owp[1];
  var isAdmin = openRidingGroupsIsAdminGrade();
  var gs = typeof window !== 'undefined' ? window.openRidingGroupService || {} : {};
  var GROUP_ST = gs.GROUP_STATUS || { PENDING: 'PENDING', APPROVED: 'APPROVED' };

  var ownerUidsKey = useMemo(
    function () {
      var u = {};
      rows.forEach(function (g) {
        var o = String(g.createdBy || '').trim();
        if (o) u[o] = true;
      });
      return Object.keys(u)
        .sort()
        .join('\u0000');
    },
    [rows]
  );

  useEffect(
    function () {
      if (!ownerUidsKey) {
        setOwnerProfiles({});
        return;
      }
      var uids = ownerUidsKey.split('\u0000').filter(Boolean);
      if (typeof window === 'undefined' || typeof window.getUserByUid !== 'function') {
        setOwnerProfiles({});
        return;
      }
      var cancelled = false;
      Promise.all(
        uids.map(function (uid) {
          return window
            .getUserByUid(uid)
            .then(function (row) {
              return { uid: uid, row: row };
            })
            .catch(function () {
              return { uid: uid, row: null };
            });
        })
      ).then(function (pairs) {
        if (cancelled) return;
        var next = {};
        pairs.forEach(function (p) {
          next[p.uid] = p.row;
        });
        setOwnerProfiles(next);
      });
      return function () {
        cancelled = true;
      };
    },
    [ownerUidsKey]
  );

  var filteredRows = useMemo(
    function () {
      var q = String(filterText || '')
        .trim()
        .toLowerCase();
      if (!q) return rows;
      return rows.filter(function (g) {
        if (String(g.name || '').toLowerCase().indexOf(q) >= 0) return true;
        var ouid = String(g.createdBy || '').toLowerCase();
        if (ouid.indexOf(q) >= 0) return true;
        var op = ownerProfiles[String(g.createdBy || '')];
        var oname = op ? openRidingFirestoreUserDisplayName(op).toLowerCase() : '';
        return oname.indexOf(q) >= 0;
      });
    },
    [rows, filterText, ownerProfiles]
  );

  useEffect(
    function () {
      if (!firestore || typeof gs.subscribeRidingGroups !== 'function') return;
      return gs.subscribeRidingGroups(firestore, isAdmin, function (list) {
        setRows(Array.isArray(list) ? list : []);
      });
    },
    [firestore, isAdmin]
  );

  useEffect(
    function () {
      var scrollEl = document.querySelector('#openRidingRoomScreen .open-riding-app-body');
      if (!scrollEl) return;
      function onScroll() {
        if (typeof window.refreshGlobalBackToTopState === 'function') window.refreshGlobalBackToTopState();
      }
      onScroll();
      scrollEl.addEventListener('scroll', onScroll, { passive: true });
      return function () {
        scrollEl.removeEventListener('scroll', onScroll);
      };
    },
    []
  );

  function regionLine(regions) {
    var arr = Array.isArray(regions) ? regions : [];
    if (!arr.length) return '-';
    return arr
      .map(function (r) {
        return formatOpenRidingRegionShort(r);
      })
      .join(' · ');
  }

  return (
    <div
      className="relative w-full max-w-lg mx-auto text-left box-border"
      style={{
        /* 스크롤 끝에서도 + 버튼·하단 네비에 가리지 않도록 (FAB bottom과 동일 토큰) */
        paddingBottom:
          'calc(4.5rem + (2 * var(--open-riding-glass-nav-inner-fixed-height)) + env(safe-area-inset-bottom, 0px))'
      }}
    >
      <div className="w-full mb-3 box-border">
        <input
          type="search"
          enterKeyHint="search"
          className="open-riding-group-search-input w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm box-border"
          placeholder="그룹명 또는 라이더 이름으로 검색"
          value={filterText}
          onChange={function (e) {
            setFilterText(e.target.value);
          }}
        />
      </div>
      <ul className="space-y-2">
        {!firestore ? (
          <li className="text-sm text-slate-500">연결 오류</li>
        ) : filteredRows.length === 0 ? (
          <li className="text-sm text-slate-500 rounded-xl border border-slate-200 bg-white px-3 py-6 text-center">
            {rows.length === 0 ? '표시할 그룹이 없습니다.' : '검색 결과가 없습니다.'}
          </li>
        ) : (
          filteredRows.map(function (g) {
            var st = String(g.status || '');
            var pending = st === GROUP_ST.PENDING;
            var name = g.name != null ? String(g.name) : '';
            var photo = g.photoUrl != null ? String(g.photoUrl) : '';
            var isHost = userId && String(g.createdBy || '') === String(userId);
            var groupIsPublic = g.isPublic !== false;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  className="open-riding-action-btn open-riding-group-list-row-btn w-full flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm hover:bg-slate-50/90 transition box-border"
                  onClick={function () {
                    onOpenDetail(g.id);
                  }}
                >
                  <span className="relative shrink-0">
                    <span className="inline-flex h-14 w-14 items-center justify-center rounded-full ring-2 ring-violet-200 overflow-hidden bg-gradient-to-br from-violet-50 to-slate-100">
                      {photo ? (
                        <img src={photo} alt="" className="h-full w-full object-cover" decoding="async" />
                      ) : (
                        <span className="text-lg font-bold text-violet-700">{name ? name.charAt(0) : 'G'}</span>
                      )}
                    </span>
                    {pending && isAdmin ? (
                      <span className="absolute -bottom-1 -right-1 rounded-full bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 border border-white shadow">
                        승인 대기
                      </span>
                    ) : null}
                    {/* 2시 방향: 가입 요청 건수 */}
                    {(function () {
                      var cnt = joinRequestCountMap[g.id];
                      if (!cnt || cnt <= 0) return null;
                      return (
                        <span
                          className="absolute flex items-center justify-center rounded-full bg-violet-600 text-white font-bold border-2 border-white shadow pointer-events-none"
                          style={{ minWidth: '18px', height: '18px', fontSize: cnt > 9 ? 8 : 9, paddingLeft: 2, paddingRight: 2, top: '2px', right: '0px', transform: 'translate(30%, -20%)' }}
                          aria-label={'가입 요청 ' + cnt + '건'}
                        >
                          {cnt > 99 ? '99+' : cnt}
                        </span>
                      );
                    })()}
                    {/* 10시 방향: 내 역할 (방장 / 가입) */}
                    {userId ? (
                      <span
                        className={'absolute flex items-center justify-center rounded-full text-white border-2 border-white shadow pointer-events-none ' + (isHost ? 'bg-violet-600' : 'bg-red-600')}
                        style={{ width: '16px', height: '16px', top: '2px', left: '0px', transform: 'translate(-30%, -20%)' }}
                        aria-label={isHost ? '내가 방장' : '가입한 그룹'}
                      >
                        <svg className="block" width={9} height={9} viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-900 truncate text-[15px]">{name || '이름 없음'}</span>
                    <span className="block text-xs text-slate-500 mt-0.5 truncate">
                      {regionLine(g.regions)}
                      <span className="text-slate-300 mx-1">·</span>
                      {g.memberCount != null ? String(g.memberCount) : '0'}명
                      <span className="text-slate-300 mx-1">·</span>
                      <span className={groupIsPublic ? 'text-emerald-600' : 'text-slate-400'}>
                        {groupIsPublic ? '공개' : '비공개'}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      {userId ? (
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px] sm:text-[11px] text-slate-600 leading-snug px-1">
          <div className="flex gap-2 items-center min-w-0">
            <span className="inline-flex items-center justify-center rounded-full bg-violet-600 text-white ring-1 ring-white/90 shadow-sm shrink-0" style={{ width: '13px', height: '13px' }} aria-hidden="true">
              <svg className="block" width={8} height={8} viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="font-semibold text-slate-700 min-w-0">내가 방장</span>
          </div>
          <div className="flex gap-2 items-center min-w-0">
            <span className="inline-flex items-center justify-center rounded-full bg-red-600 text-white ring-1 ring-white/90 shadow-sm shrink-0" style={{ width: '13px', height: '13px' }} aria-hidden="true">
              <svg className="block" width={8} height={8} viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="font-semibold text-slate-700 min-w-0">가입 그룹</span>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="open-riding-action-btn open-riding-group-fab fixed flex h-12 w-12 items-center justify-center rounded-full border-0 text-white shadow-lg md:h-14 md:w-14 box-border"
        style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          boxShadow: '0 4px 16px rgba(102, 126, 234, 0.4)'
        }}
        title="그룹 생성"
        aria-label="그룹 생성"
        onClick={function () {
          onCreate();
        }}
      >
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
}

/** 소모임 생성·수정 폼 */
function OpenRidingGroupForm(props) {
  var firestore = props.firestore;
  var storage = props.storage;
  var userId = props.userId || '';
  var editGroupId = props.editGroupId || '';
  var onCancel = props.onCancel || function () {};
  var onSaved = props.onSaved || function () {};
  var isEdit = !!editGroupId;
  var koreaList = getKoreaRegionGroupsResolved();
  var _sido = useState('');
  var sidoPick = _sido[0];
  var setSidoPick = _sido[1];
  var _dist = useState('');
  var distPick = _dist[0];
  var setDistPick = _dist[1];
  var _regions = useState([]);
  var regions = _regions[0];
  var setRegions = _regions[1];
  var _name = useState('');
  var name = _name[0];
  var setName = _name[1];
  var _intro = useState('');
  var intro = _intro[0];
  var setIntro = _intro[1];
  var _pub = useState(true);
  var isPublic = _pub[0];
  var setPublic = _pub[1];
  var _pw = useState('');
  var joinPw = _pw[0];
  var setJoinPw = _pw[1];
  var _photoUrl = useState('');
  var photoUrl = _photoUrl[0];
  var setPhotoUrl = _photoUrl[1];
  var _photoFile = useState(null);
  var photoFile = _photoFile[0];
  var setPhotoFile = _photoFile[1];
  var _photoPreview = useState('');
  var photoPreview = _photoPreview[0];
  var setPhotoPreview = _photoPreview[1];
  var _busy = useState(false);
  var busy = _busy[0];
  var setBusy = _busy[1];
  var _loaded = useState(!isEdit);
  var loaded = _loaded[0];
  var setLoaded = _loaded[1];
  var gs = typeof window !== 'undefined' ? window.openRidingGroupService || {} : {};

  var districtsForSido = useMemo(
    function () {
      var i;
      for (i = 0; i < koreaList.length; i++) {
        if (koreaList[i].sido === sidoPick) return koreaList[i].districts || [];
      }
      return [];
    },
    [koreaList, sidoPick]
  );

  useEffect(
    function () {
      if (!photoFile) {
        setPhotoPreview('');
        return;
      }
      var u = URL.createObjectURL(photoFile);
      setPhotoPreview(u);
      return function () {
        URL.revokeObjectURL(u);
      };
    },
    [photoFile]
  );

  useEffect(
    function () {
      if (!isEdit || !firestore || !editGroupId) {
        setLoaded(true);
        return;
      }
      setLoaded(false);
      var cancelled = false;
      if (typeof gs.fetchRidingGroupById !== 'function') {
        setLoaded(true);
        return;
      }
      gs
        .fetchRidingGroupById(firestore, editGroupId)
        .then(function (doc) {
          if (cancelled || !doc) return;
          setName(doc.name != null ? String(doc.name) : '');
          setIntro(doc.intro != null ? String(doc.intro) : '');
          setPublic(doc.isPublic !== false);
          setJoinPw(doc.joinPassword != null ? String(doc.joinPassword) : '');
          setRegions(Array.isArray(doc.regions) ? doc.regions.map(function (x) { return String(x); }) : []);
          setPhotoUrl(doc.photoUrl != null ? String(doc.photoUrl) : '');
          setPhotoFile(null);
        })
        .catch(function () {})
        .finally(function () {
          if (!cancelled) setLoaded(true);
        });
      return function () {
        cancelled = true;
      };
    },
    [firestore, editGroupId, isEdit]
  );

  function addRegion() {
    var label = resolveOpenRidingFullRegionLabel(sidoPick, distPick, districtsForSido);
    if (!label) return;
    if (regions.indexOf(label) >= 0) {
      setSidoPick('');
      setDistPick('');
      return;
    }
    setRegions(regions.concat([label]));
    setSidoPick('');
    setDistPick('');
  }

  function removeRegion(r) {
    setRegions(regions.filter(function (x) {
      return x !== r;
    }));
  }

  function payloadFromForm(urlOverride) {
    var url = urlOverride != null ? urlOverride : photoUrl;
    return {
      name: name.trim(),
      regions: regions,
      intro: intro.trim(),
      isPublic: isPublic,
      joinPassword: joinPw,
      photoUrl: url || null
    };
  }

  function submitCreate() {
    if (!firestore || !userId) return;
    if (!window.confirm('관리자 승인 후 리스트에 노출됩니다. 지금 저장할까요?')) return;
    if (typeof gs.createRidingGroupPending !== 'function') return;
    setBusy(true);
    gs
      .createRidingGroupPending(firestore, userId, payloadFromForm(null))
      .then(function (newId) {
        var chain = Promise.resolve();
        if (photoFile && storage && typeof gs.uploadRidingGroupCover === 'function') {
          chain = gs.uploadRidingGroupCover(storage, newId, photoFile).then(function (url) {
            return gs.updateRidingGroupByOwner(firestore, userId, newId, payloadFromForm(url));
          });
        }
        return chain.then(function () {
          alert('저장되었습니다. 관리자 승인 후 목록에 노출됩니다.');
          onSaved(newId);
        });
      })
      .catch(function (e) {
        alert(e && e.message ? e.message : '저장 실패');
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function submitEdit() {
    if (!firestore || !userId || !editGroupId) return;
    if (typeof gs.updateRidingGroupByOwner !== 'function') return;
    setBusy(true);
    var id = editGroupId;
    var chain = Promise.resolve();
    if (photoFile && storage && typeof gs.uploadRidingGroupCover === 'function') {
      chain = gs.uploadRidingGroupCover(storage, id, photoFile).then(function (url) {
        return gs.updateRidingGroupByOwner(firestore, userId, id, payloadFromForm(url));
      });
    } else {
      chain = gs.updateRidingGroupByOwner(firestore, userId, id, payloadFromForm());
    }
    chain
      .then(function () {
        onSaved(id);
      })
      .catch(function (e) {
        alert(e && e.message ? e.message : '수정 실패');
      })
      .finally(function () {
        setBusy(false);
      });
  }

  if (!loaded) {
    return (
      <div className="flex justify-center py-16">
        <span
          className="inline-block h-10 w-10 rounded-full border-[3px] border-violet-200 border-t-violet-600 animate-spin"
          style={{ animationDuration: '0.85s' }}
          role="status"
          aria-label="불러오는 중"
        />
      </div>
    );
  }

  return (
    <div className="open-riding-create-form-root w-full max-w-lg mx-auto space-y-3 pb-28 text-sm text-slate-700">
      <div>
        <label className="text-xs text-slate-500 block mb-1">그룹명 (최대 24자)</label>
        <input
          type="text"
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          maxLength={24}
          value={name}
          onChange={function (e) {
            setName(e.target.value);
          }}
        />
      </div>
      <div>
        <label className="text-xs text-slate-500 block mb-1">활동 지역</label>
        <div className="flex gap-1 flex-wrap items-center">
          <select
            className="flex-1 min-w-[120px] rounded-lg border border-slate-200 px-2 py-1 text-sm bg-white"
            aria-label="시·도"
            value={sidoPick}
            onChange={function (e) {
              setSidoPick(e.target.value);
              setDistPick('');
            }}
          >
            <option value="">시·도</option>
            {koreaList.map(function (g) {
              return (
                <option key={g.sido} value={g.sido}>
                  {g.sido}
                </option>
              );
            })}
          </select>
          <select
            className="flex-1 min-w-[120px] rounded-lg border border-slate-200 px-2 py-1 text-sm bg-white"
            aria-label="구·군"
            value={distPick}
            disabled={!sidoPick || !districtsForSido.length}
            onChange={function (e) {
              setDistPick(e.target.value);
            }}
          >
            <option value="">{!sidoPick ? '시·도 먼저' : !districtsForSido.length ? '구·군 없음' : '구·군'}</option>
            {districtsForSido.map(function (d) {
              return (
                <option key={d} value={d}>
                  {d}
                </option>
              );
            })}
          </select>
          <button type="button" className="rounded-lg bg-violet-600 text-white px-3 py-1 text-sm shrink-0 hover:bg-violet-700" onClick={addRegion}>
            추가
          </button>
        </div>
        <ul className="mt-2 flex flex-wrap gap-1">
          {regions.map(function (r) {
            return (
              <li key={r}>
                <button
                  type="button"
                  className="text-xs bg-white border border-slate-200 rounded-full px-2 py-0.5"
                  onClick={function () {
                    removeRegion(r);
                  }}
                >
                  {r} ×
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <label className="text-xs text-slate-500 block mb-1">그룹 사진</label>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex h-20 w-20 rounded-full ring-2 ring-violet-200 overflow-hidden bg-slate-100 items-center justify-center shrink-0">
            {photoFile && photoPreview ? (
              <img src={photoPreview} alt="" className="h-full w-full object-cover" />
            ) : photoUrl ? (
              <img src={photoUrl} alt="" className="h-full w-full object-cover" decoding="async" />
            ) : (
              <span className="text-xs text-slate-400">없음</span>
            )}
          </span>
          <input
            type="file"
            accept="image/*"
            className="text-xs max-w-[12rem]"
            onChange={function (e) {
              var f = e.target.files && e.target.files[0];
              setPhotoFile(f || null);
            }}
          />
        </div>
      </div>
      <div>
        <label className="text-xs text-slate-500 block mb-1">소개 (최대 500자)</label>
        <textarea
          className="w-full min-h-[120px] rounded-xl border border-slate-200 px-3 py-2 text-sm resize-y"
          maxLength={500}
          value={intro}
          onChange={function (e) {
            setIntro(e.target.value);
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-800">공개 그룹</label>
        <input
          type="checkbox"
          className="h-4 w-4 accent-violet-600"
          checked={isPublic}
          onChange={function (e) {
            setPublic(e.target.checked);
          }}
        />
      </div>
      {!isPublic ? (
        <div>
          <label className="text-xs text-slate-500 block mb-1">가입 비밀번호 (4자 이상)</label>
          <input
            type="password"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            maxLength={32}
            value={joinPw}
            placeholder="비공개 시 필수"
            autoComplete="new-password"
            onChange={function (e) {
              setJoinPw(e.target.value);
            }}
          />
        </div>
      ) : null}

      <div className="open-riding-bottom-actions open-riding-group-form-footer fixed left-0 right-0 px-3 pt-2 bg-[rgba(255,255,255,0.97)] border-t border-slate-200/90 backdrop-blur-[6px]">
        <div className="max-w-lg mx-auto flex gap-2">
          {isEdit ? (
            <>
              <button
                type="button"
                className="open-riding-action-btn flex-1 h-11 rounded-xl border border-slate-300 bg-white text-slate-800 font-medium"
                disabled={busy}
                onClick={onCancel}
              >
                취소
              </button>
              <button
                type="button"
                className="open-riding-action-btn flex-1 h-11 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700"
                disabled={busy}
                onClick={submitEdit}
              >
                {busy ? '처리 중…' : '수정'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="open-riding-action-btn flex-1 h-11 rounded-xl border border-slate-300 bg-white text-slate-800 font-medium"
                disabled={busy}
                onClick={onCancel}
              >
                취소
              </button>
              <button
                type="button"
                className="open-riding-action-btn flex-1 h-11 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700"
                disabled={busy}
                onClick={submitCreate}
              >
                {busy ? '처리 중…' : '그룹 생성'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function openRidingFirestoreUserDisplayName(userRow) {
  if (!userRow || typeof userRow !== 'object') return '';
  var n = userRow.name != null ? String(userRow.name).trim() : '';
  if (n) return n;
  var d = userRow.displayName != null ? String(userRow.displayName).trim() : '';
  return d || '';
}

function openRidingFirestoreUserProfileImageUrl(userRow) {
  if (!userRow || typeof userRow !== 'object') return '';
  var u = userRow.profileImageUrl || userRow.photoURL || userRow.avatarUrl || '';
  return String(u || '').trim();
}

/** 소모임 상세 + 멤버 + 가입·승인 */
function OpenRidingGroupDetailView(props) {
  var firestore = props.firestore;
  var userId = props.userId || '';
  var groupId = props.groupId || '';
  var onBack = props.onBack || function () {};
  var onEdit = props.onEdit || function () {};
  var _g = useState(null);
  var grp = _g[0];
  var setGrp = _g[1];
  var _mem = useState([]);
  var members = _mem[0];
  var setMembers = _mem[1];
  var _busy = useState(false);
  var busy = _busy[0];
  var setBusy = _busy[1];
  var _pw = useState('');
  var joinPw = _pw[0];
  var setJoinPw = _pw[1];
  var _detailReady = useState(false);
  var detailReady = _detailReady[0];
  var setDetailReady = _detailReady[1];
  var _mp = useState({});
  var memberProfiles = _mp[0];
  var setMemberProfiles = _mp[1];
  var _to = useState(false);
  var transferOpen = _to[0];
  var setTransferOpen = _to[1];
  var _ts = useState('');
  var transferSearch = _ts[0];
  var setTransferSearch = _ts[1];
  var _tsb = useState(false);
  var transferSearchBusy = _tsb[0];
  var setTransferSearchBusy = _tsb[1];
  var _tcand = useState([]);
  var transferCandidates = _tcand[0];
  var setTransferCandidates = _tcand[1];
  var _terr = useState('');
  var transferErr = _terr[0];
  var setTransferErr = _terr[1];
  var _jr = useState([]);
  var joinRequests = _jr[0];
  var setJoinRequests = _jr[1];
  var _mjr = useState(null);
  var myJoinRequest = _mjr[0];
  var setMyJoinRequest = _mjr[1];
  var gs = typeof window !== 'undefined' ? window.openRidingGroupService || {} : {};
  var GROUP_ST = gs.GROUP_STATUS || { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' };
  var isAdmin = openRidingGroupsIsAdminGrade();

  var memberUidsKey = useMemo(
    function () {
      var set = {};
      members.forEach(function (m) {
        var u = String(m.userId || '').trim();
        if (u) set[u] = true;
      });
      joinRequests.forEach(function (j) {
        var u = String(j.userId || '').trim();
        if (u) set[u] = true;
      });
      return Object.keys(set)
        .sort()
        .join('\u0000');
    },
    [members, joinRequests]
  );

  var memberUidSet = useMemo(
    function () {
      var set = {};
      members.forEach(function (m) {
        var u = String(m.userId || '').trim();
        if (u) set[u] = true;
      });
      return set;
    },
    [members]
  );

  useEffect(
    function () {
      if (!memberUidsKey) {
        setMemberProfiles({});
        return;
      }
      var uids = memberUidsKey.split('\u0000').filter(Boolean);
      if (typeof window === 'undefined' || typeof window.getUserByUid !== 'function') {
        setMemberProfiles({});
        return;
      }
      var cancelled = false;
      Promise.all(
        uids.map(function (uid) {
          return window
            .getUserByUid(uid)
            .then(function (row) {
              return { uid: uid, row: row };
            })
            .catch(function () {
              return { uid: uid, row: null };
            });
        })
      ).then(function (pairs) {
        if (cancelled) return;
        var next = {};
        pairs.forEach(function (p) {
          next[p.uid] = p.row;
        });
        setMemberProfiles(next);
      });
      return function () {
        cancelled = true;
      };
    },
    [memberUidsKey]
  );

  useEffect(
    function () {
      if (!firestore || !groupId || typeof gs.subscribeRidingGroupDetail !== 'function') return;
      setDetailReady(false);
      setGrp(null);
      return gs.subscribeRidingGroupDetail(firestore, groupId, function (doc) {
        setGrp(doc);
        setDetailReady(true);
      });
    },
    [firestore, groupId]
  );

  useEffect(
    function () {
      if (!firestore || !groupId || typeof gs.subscribeRidingGroupMembers !== 'function') return;
      return gs.subscribeRidingGroupMembers(firestore, groupId, function (list) {
        setMembers(Array.isArray(list) ? list : []);
      });
    },
    [firestore, groupId]
  );

  var grpJoinReqSig = grp ? String(grp.status || '') + ':' + String(grp.createdBy || '') : '';

  useEffect(
    function () {
      if (!firestore || !groupId || typeof gs.subscribeRidingGroupJoinRequests !== 'function') return undefined;
      if (!grp || String(grp.status || '') !== GROUP_ST.APPROVED) {
        setJoinRequests([]);
        return undefined;
      }
      if (!(String(grp.createdBy || '') === String(userId) || isAdmin)) {
        setJoinRequests([]);
        return undefined;
      }
      return gs.subscribeRidingGroupJoinRequests(firestore, groupId, function (list) {
        setJoinRequests(Array.isArray(list) ? list : []);
      });
    },
    [firestore, groupId, grpJoinReqSig, userId, isAdmin]
  );

  useEffect(
    function () {
      if (!firestore || !groupId || !userId || typeof gs.subscribeRidingGroupMyJoinRequest !== 'function') {
        return undefined;
      }
      if (!grp || String(grp.status || '') !== GROUP_ST.APPROVED) {
        setMyJoinRequest(null);
        return undefined;
      }
      return gs.subscribeRidingGroupMyJoinRequest(firestore, groupId, userId, function (row) {
        setMyJoinRequest(row);
      });
    },
    [firestore, groupId, userId, grpJoinReqSig]
  );

  var isMember = useMemo(
    function () {
      var uid = String(userId);
      return members.some(function (m) {
        return String(m.userId || '') === uid;
      });
    },
    [members, userId]
  );

  var isOwner = grp && String(grp.createdBy || '') === String(userId);

  function displayNameForMember(m) {
    var uid = String(m.userId || '');
    var row = memberProfiles[uid];
    var fromProf = row ? openRidingFirestoreUserDisplayName(row) : '';
    if (fromProf) return fromProf;
    var n = m.displayName != null ? String(m.displayName).trim() : '';
    if (n) return n;
    return uid.length > 4 ? '라이더 …' + uid.slice(-4) : '라이더';
  }

  function photoForMember(m) {
    var uid = String(m.userId || '');
    var row = memberProfiles[uid];
    var u = row ? openRidingFirestoreUserProfileImageUrl(row) : '';
    if (u) return u;
    var mimg = m.profileImageUrl != null ? String(m.profileImageUrl).trim() : '';
    return mimg || '';
  }

  function displayNameForJoinRequest(j) {
    var uid = String(j.userId || '');
    var row = memberProfiles[uid];
    var fromProf = row ? openRidingFirestoreUserDisplayName(row) : '';
    if (fromProf) return fromProf;
    var n = j.displayName != null ? String(j.displayName).trim() : '';
    if (n) return n;
    return uid.length > 4 ? '라이더 …' + uid.slice(-4) : '라이더';
  }

  function photoForJoinRequest(j) {
    var uid = String(j.userId || '');
    var row = memberProfiles[uid];
    var u = row ? openRidingFirestoreUserProfileImageUrl(row) : '';
    if (u) return u;
    var mimg = j.profileImageUrl != null ? String(j.profileImageUrl).trim() : '';
    return mimg || '';
  }

  function maskTransferContact(contact) {
    var fr = typeof window !== 'undefined' ? window.openRidingFriendsService || {} : {};
    if (typeof fr.maskContactPrivacy === 'function') {
      return fr.maskContactPrivacy(contact);
    }
    return String(contact || '').trim() ? '****' : '-';
  }

  function openTransferModal() {
    setTransferSearch('');
    setTransferCandidates([]);
    setTransferErr('');
    setTransferOpen(true);
  }

  function runTransferSearch() {
    var fr = typeof window !== 'undefined' ? window.openRidingFriendsService || {} : {};
    if (!firestore || typeof fr.searchUsersForFriendRequest !== 'function') {
      setTransferErr('검색을 사용할 수 없습니다.');
      return;
    }
    var term = String(transferSearch || '').trim();
    if (!term) {
      setTransferErr('이름 또는 연락처를 입력해 주세요.');
      return;
    }
    setTransferSearchBusy(true);
    setTransferErr('');
    fr
      .searchUsersForFriendRequest(firestore, term, userId)
      .then(function (res) {
        var rows = (res && Array.isArray(res.rows) && res.rows) || [];
        var my = String(userId);
        var filtered = rows.filter(function (r) {
          var u = String(r.uid || '').trim();
          return u && u !== my && memberUidSet[u];
        });
        setTransferCandidates(filtered);
        if (!filtered.length) {
          setTransferErr('검색된 회원 중 이 그룹에 속한 다른 멤버가 없습니다.');
        }
      })
      .catch(function (e) {
        setTransferCandidates([]);
        setTransferErr(e && e.message ? String(e.message) : '검색 실패');
      })
      .finally(function () {
        setTransferSearchBusy(false);
      });
  }

  function confirmTransferToCandidate(c) {
    if (!c || !c.uid || !firestore || !userId || !groupId) return;
    if (!memberUidSet[String(c.uid)]) {
      alert('이 그룹 멤버에게만 방장을 이관할 수 있습니다.');
      return;
    }
    var nm = c.name != null ? String(c.name).trim() : '해당 회원';
    if (!window.confirm(nm + '님에게 방장 권한을 이관할까요?\n확인 후에는 새 방장만 그룹 정보를 수정할 수 있습니다.')) return;
    if (typeof gs.transferRidingGroupOwnership !== 'function') {
      alert('이관 기능을 사용할 수 없습니다. 앱을 새로고침한 뒤 다시 시도해 주세요.');
      return;
    }
    setBusy(true);
    gs
      .transferRidingGroupOwnership(firestore, String(userId), String(groupId), String(c.uid))
      .then(function () {
        setTransferOpen(false);
        setTransferCandidates([]);
        setTransferSearch('');
        setTransferErr('');
      })
      .catch(function (e) {
        alert(e && e.message ? e.message : '이관에 실패했습니다.');
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function profileHintsForJoin() {
    var pr = getOpenRidingProfileDefaults();
    var cu =
      typeof window !== 'undefined' && window.currentUser
        ? window.currentUser
        : (function () {
            try {
              return JSON.parse(localStorage.getItem('currentUser') || 'null');
            } catch (e) {
              return null;
            }
          })();
    var img = '';
    if (cu) {
      img =
        (cu.profileImageUrl && String(cu.profileImageUrl)) ||
        (cu.photoURL && String(cu.photoURL)) ||
        (cu.avatarUrl && String(cu.avatarUrl)) ||
        '';
    }
    return { displayName: pr.hostName || '', profileImageUrl: img || null };
  }

  function doJoin() {
    if (!firestore || !userId || !groupId) return;
    if (typeof gs.joinRidingGroup !== 'function') return;
    setBusy(true);
    gs
      .joinRidingGroup(firestore, userId, groupId, joinPw, profileHintsForJoin())
      .then(function () {
        setJoinPw('');
      })
      .catch(function (e) {
        alert(e && e.message ? e.message : '가입 실패');
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function doLeave() {
    if (!firestore || !userId || !groupId) return;
    if (!window.confirm('이 그룹에서 탈퇴할까요?')) return;
    if (typeof gs.leaveRidingGroup !== 'function') return;
    setBusy(true);
    gs
      .leaveRidingGroup(firestore, userId, groupId)
      .catch(function (e) {
        alert(e && e.message ? e.message : '탈퇴 실패');
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function doApproveJoinRequest(applicantUid) {
    if (!firestore || !userId || !groupId || !applicantUid) return;
    if (typeof gs.approveRidingGroupJoinRequest !== 'function') return;
    if (!window.confirm('이 신청을 수락해 멤버로 등록할까요?')) return;
    setBusy(true);
    gs
      .approveRidingGroupJoinRequest(firestore, String(userId), String(groupId), String(applicantUid))
      .catch(function (e) {
        alert(e && e.message ? e.message : '수락 처리에 실패했습니다.');
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function doRejectJoinRequest(applicantUid) {
    if (!firestore || !userId || !groupId || !applicantUid) return;
    if (typeof gs.rejectRidingGroupJoinRequest !== 'function') return;
    if (!window.confirm('이 가입 신청을 거절하고 목록에서 삭제할까요?')) return;
    setBusy(true);
    gs
      .rejectRidingGroupJoinRequest(firestore, String(userId), String(groupId), String(applicantUid))
      .catch(function (e) {
        alert(e && e.message ? e.message : '거절 처리에 실패했습니다.');
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function doApprove() {
    if (!firestore || !userId || !groupId) return;
    if (!window.confirm('이 그룹을 승인하고 목록에 공개할까요?')) return;
    if (typeof gs.setRidingGroupStatusByAdmin !== 'function') return;
    setBusy(true);
    gs
      .setRidingGroupStatusByAdmin(firestore, userId, groupId, GROUP_ST.APPROVED)
      .catch(function (e) {
        alert(e && e.message ? e.message : '처리 실패');
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function doReject() {
    if (!firestore || !userId || !groupId) return;
    if (!window.confirm('이 그룹을 반려할까요? 목록에서 제외됩니다.')) return;
    if (typeof gs.setRidingGroupStatusByAdmin !== 'function') return;
    setBusy(true);
    gs
      .setRidingGroupStatusByAdmin(firestore, userId, groupId, GROUP_ST.REJECTED)
      .then(function () {
        onBack();
      })
      .catch(function (e) {
        alert(e && e.message ? e.message : '처리 실패');
      })
      .finally(function () {
        setBusy(false);
      });
  }

  if (!detailReady) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <span
          className="inline-block h-10 w-10 rounded-full border-[3px] border-violet-200 border-t-violet-600 animate-spin"
          style={{ animationDuration: '0.85s' }}
          role="status"
          aria-label="불러오는 중"
        />
        <span className="text-xs text-slate-500">그룹 정보를 불러오는 중…</span>
      </div>
    );
  }

  if (!grp) {
    return (
      <div className="text-sm text-slate-500 py-8 text-center">
        불러오는 중이거나 볼 수 없는 그룹입니다.
        <div className="mt-4">
          <button type="button" className="text-violet-700 font-medium underline" onClick={onBack}>
            목록으로
          </button>
        </div>
      </div>
    );
  }

  var st = String(grp.status || '');
  var approved = st === GROUP_ST.APPROVED;
  var pending = st === GROUP_ST.PENDING;
  var regLine = regionLineFromRegions(grp.regions);
  var canModerateJoin = approved && (isOwner || isAdmin);

  return (
    <div className="w-full max-w-lg mx-auto space-y-4 pb-6 text-left">
      <div className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden relative isolate bg-white">
        {grp.photoUrl ? (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-50"
              style={{
                backgroundImage: 'url(' + JSON.stringify(String(grp.photoUrl)) + ')'
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-white/75 via-white/86 to-white/95"
            />
          </>
        ) : null}
        <div className="relative z-[1] p-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full ring-2 ring-violet-200 overflow-hidden bg-gradient-to-br from-violet-50 to-slate-100">
              {grp.photoUrl ? (
                <img src={String(grp.photoUrl)} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-xl font-bold text-violet-700">{(grp.name || 'G').charAt(0)}</span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-slate-900 m-0 truncate">{grp.name != null ? String(grp.name) : ''}</h2>
              <p className="text-xs text-slate-500 m-0 mt-1">
                {regLine}
                <span className="text-slate-300 mx-1">·</span>
                {grp.memberCount != null ? String(grp.memberCount) : '0'}명
                {grp.isPublic === false ? (
                  <span className="ml-2 rounded-full bg-slate-200 text-slate-700 text-[10px] px-2 py-0.5">비공개</span>
                ) : (
                  <span className="ml-2 rounded-full bg-emerald-50 text-emerald-800 text-[10px] px-2 py-0.5 border border-emerald-200">공개</span>
                )}
              </p>
              {pending && isAdmin ? (
                <span className="inline-block mt-2 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200">승인 대기</span>
              ) : null}
            </div>
          </div>
          {grp.intro ? (
            <p className="text-sm text-slate-700 mt-3 whitespace-pre-wrap m-0 leading-relaxed">{String(grp.intro)}</p>
          ) : (
            <p className="text-sm text-slate-400 mt-3 m-0">등록된 소개가 없습니다.</p>
          )}
          {isOwner && (pending || approved) ? (
            <button
              type="button"
              className="mt-3 text-sm font-semibold text-violet-700 underline"
              onClick={function () {
                onEdit();
              }}
            >
              그룹 정보 수정
            </button>
          ) : null}
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden stelvio-category-card">
        <div className="bg-violet-100 border-b border-violet-200/60 px-3 py-2.5 stelvio-category-header">
          <h3 className="text-sm font-semibold text-slate-800 m-0">멤버</h3>
        </div>
        <div className="stelvio-category-body px-2 sm:px-3 py-1 open-riding-group-member-rank-list">
          {members.length === 0 ? (
            <p className="text-sm text-slate-500 m-0 px-1 py-2">멤버 정보를 불러오는 중입니다.</p>
          ) : (
            <div className="space-y-0">
              {members.map(function (m, idx) {
                var uid = String(m.userId || '');
                var self = uid && uid === String(userId);
                var isRowOwner = String(m.role || '') === 'owner';
                var canLeave = self && !isRowOwner;
                var canTransferOwnership = self && isRowOwner && !!isOwner;
                var rank = idx + 1;
                var nm = displayNameForMember(m);
                var photo = photoForMember(m);
                var initial = nm.charAt(0) || '·';
                return (
                  <div
                    key={uid || idx}
                    className={
                      'stelvio-rank-row open-riding-group-rank-row' + (self ? ' stelvio-rank-current' : '')
                    }
                  >
                    <span className="stelvio-rank-pos open-riding-group-seq tabular-nums">{rank}</span>
                    <span className="stelvio-rank-name">
                      {photo ? (
                        <span className="inline-flex h-[30px] w-[30px] shrink-0 rounded-full overflow-hidden ring-1 ring-indigo-300/90 bg-slate-100">
                          <img className="stelvio-rank-avatar-img" src={photo} alt="" decoding="async" />
                        </span>
                      ) : (
                        <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full ring-1 ring-indigo-300/90 bg-gradient-to-br from-violet-50 to-slate-100 text-[10px] font-bold text-violet-800">
                          {initial}
                        </span>
                      )}
                      <span className="stelvio-rank-name-text truncate" title={nm}>
                        {nm}
                        {isRowOwner ? (
                          <span className="ml-1 text-[10px] font-semibold text-violet-600">방장</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="stelvio-rank-wkg open-riding-group-rank-actions">
                      {canTransferOwnership ? (
                        <button
                          type="button"
                          className="open-riding-action-btn text-[11px] font-semibold px-2 py-1 rounded-md border border-violet-400 text-violet-800 bg-violet-50 hover:bg-violet-100 disabled:opacity-40"
                          disabled={busy}
                          onClick={openTransferModal}
                        >
                          이관
                        </button>
                      ) : canLeave ? (
                        <button
                          type="button"
                          className="open-riding-action-btn text-[11px] font-semibold px-2 py-1 rounded-md border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40"
                          disabled={busy}
                          onClick={doLeave}
                        >
                          탈퇴
                        </button>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {(approved && !isMember) || (pending && isAdmin) ? (
          <div className="open-riding-group-member-cta-slot open-riding-bottom-actions border-t border-slate-200/90 bg-[rgba(255,255,255,0.98)] px-3 pt-2 pb-3 space-y-2 box-border">
            {approved && !isMember ? (
              myJoinRequest ? (
                <p className="text-sm text-center text-slate-600 m-0 py-2 font-medium">가입 신청이 접수되었습니다. 방장 승인을 기다려 주세요.</p>
              ) : (
                <>
                  {grp.isPublic === false ? (
                    <input
                      type="password"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm box-border"
                      placeholder="가입 비밀번호"
                      value={joinPw}
                      onChange={function (e) {
                        setJoinPw(e.target.value);
                      }}
                    />
                  ) : null}
                  <p className="text-xs text-slate-500 text-center m-0 pb-1 leading-snug">
                    그룹 가입 시 멤버들에게 내 프로필이 공개됩니다
                  </p>
                  <button
                    type="button"
                    className="open-riding-action-btn w-full min-h-[clamp(2.75rem,10vw,3.5rem)] rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50 text-[clamp(0.8125rem,3.8vw,0.9375rem)] px-3 box-border"
                    disabled={busy}
                    onClick={doJoin}
                  >
                    그룹 가입하기
                  </button>
                </>
              )
            ) : null}
            {pending && isAdmin ? (
              <div className="open-riding-group-admin-footer-row flex gap-1.5 sm:gap-2 w-full max-w-full min-w-0 box-border">
                <button
                  type="button"
                  className="open-riding-action-btn open-riding-group-admin-cta-hitbox flex-1 min-w-0 max-w-full flex flex-col justify-end items-stretch p-0 m-0 bg-transparent border-0 shadow-none rounded-none min-h-0 ring-0 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                  disabled={busy}
                  onClick={doApprove}
                >
                  <span className="open-riding-group-admin-cta-face min-h-[clamp(2.75rem,10vw,3.5rem)] rounded-xl border border-emerald-500 bg-emerald-600 text-white font-medium text-[clamp(0.8125rem,3.8vw,0.9375rem)] px-2 sm:px-2.5 box-border inline-flex items-center justify-center w-full max-w-full">
                    승인
                  </span>
                </button>
                <button
                  type="button"
                  className="open-riding-action-btn open-riding-group-admin-cta-hitbox flex-1 min-w-0 max-w-full flex flex-col justify-end items-stretch p-0 m-0 bg-transparent border-0 shadow-none rounded-none min-h-0 ring-0 outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
                  disabled={busy}
                  onClick={doReject}
                >
                  <span className="open-riding-group-admin-cta-face min-h-[clamp(2.75rem,10vw,3.5rem)] rounded-xl border border-red-300 bg-white text-red-700 font-medium text-[clamp(0.8125rem,3.8vw,0.9375rem)] px-2 sm:px-2.5 box-border inline-flex items-center justify-center w-full max-w-full">
                    반려
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {canModerateJoin ? (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden stelvio-category-card">
          <div className="bg-amber-50 border-b border-amber-200/70 px-3 py-2.5 stelvio-category-header">
            <h3 className="text-sm font-semibold text-slate-800 m-0">가입 신청</h3>
          </div>
          <div className="stelvio-category-body px-2 sm:px-3 py-1 open-riding-group-member-rank-list">
            {joinRequests.length === 0 ? (
              <p className="text-sm text-slate-500 m-0 px-1 py-3 text-center">대기 중인 가입 신청이 없습니다.</p>
            ) : (
              <div className="space-y-0">
                {joinRequests.map(function (j, idx) {
                  var uid = String(j.userId || '');
                  var rank = idx + 1;
                  var nm = displayNameForJoinRequest(j);
                  var photo = photoForJoinRequest(j);
                  var initial = nm.charAt(0) || '·';
                  return (
                    <div key={uid || idx} className="stelvio-rank-row open-riding-group-rank-row">
                      <span className="stelvio-rank-pos open-riding-group-seq tabular-nums">{rank}</span>
                      <span className="stelvio-rank-name">
                        {photo ? (
                          <span className="inline-flex h-[30px] w-[30px] shrink-0 rounded-full overflow-hidden ring-1 ring-indigo-300/90 bg-slate-100">
                            <img className="stelvio-rank-avatar-img" src={photo} alt="" decoding="async" />
                          </span>
                        ) : (
                          <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full ring-1 ring-indigo-300/90 bg-gradient-to-br from-amber-50 to-slate-100 text-[10px] font-bold text-amber-900">
                            {initial}
                          </span>
                        )}
                        <span className="stelvio-rank-name-text truncate" title={nm}>
                          {nm}
                        </span>
                      </span>
                      <span className="stelvio-rank-wkg open-riding-group-rank-actions open-riding-group-join-request-actions inline-flex flex-row flex-nowrap items-center justify-end gap-1.5 shrink-0 whitespace-nowrap">
                        <button
                          type="button"
                          className="open-riding-action-btn shrink-0 text-[11px] font-semibold px-2 py-1 rounded-md border border-emerald-500 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:opacity-40"
                          disabled={busy}
                          onClick={function () {
                            doApproveJoinRequest(uid);
                          }}
                        >
                          수락
                        </button>
                        <button
                          type="button"
                          className="open-riding-action-btn shrink-0 text-[11px] font-semibold px-2 py-1 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                          disabled={busy}
                          onClick={function () {
                            doRejectJoinRequest(uid);
                          }}
                        >
                          거절
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {transferOpen ? (
        <div
          className="fixed inset-0 z-[100100] flex items-center justify-center p-3 sm:p-4 bg-black/40 overflow-y-auto overscroll-contain"
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-riding-transfer-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-slate-200 overflow-hidden max-h-[min(85vh,100%)] flex flex-col my-auto">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
              <h4 id="open-riding-transfer-title" className="text-sm font-semibold text-slate-900 m-0">
                방장 이관
              </h4>
              <button
                type="button"
                className="text-xs font-medium text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg"
                onClick={function () {
                  setTransferOpen(false);
                }}
              >
                닫기
              </button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              <p className="text-xs text-slate-600 m-0 leading-relaxed">
                이름 또는 연락처로 검색한 뒤, <strong>이 그룹에 이미 참여 중인 멤버</strong>만 선택할 수 있습니다.
              </p>
              <div className="flex gap-2">
                <input
                  type="search"
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="이름 또는 연락처"
                  value={transferSearch}
                  onChange={function (e) {
                    setTransferSearch(e.target.value);
                  }}
                  onKeyDown={function (e) {
                    if (e.key === 'Enter') runTransferSearch();
                  }}
                />
                <button
                  type="button"
                  className="shrink-0 rounded-xl bg-violet-600 text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
                  disabled={transferSearchBusy}
                  onClick={runTransferSearch}
                >
                  {transferSearchBusy ? '검색…' : '검색'}
                </button>
              </div>
              {transferErr ? <p className="text-xs text-amber-800 m-0">{transferErr}</p> : null}
              {transferCandidates.length ? (
                <ul className="list-none m-0 p-0 space-y-2">
                  {transferCandidates.map(function (c) {
                    var cuid = String(c.uid || '');
                    return (
                      <li
                        key={cuid}
                        className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate">{c.name || '회원'}</div>
                          <div className="text-[11px] text-slate-500 truncate">
                            연락처 {maskTransferContact(c.contact)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-violet-500 text-violet-800 bg-white hover:bg-violet-50 disabled:opacity-40"
                          disabled={busy}
                          onClick={function () {
                            confirmTransferToCandidate(c);
                          }}
                        >
                          이관하기
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function regionLineFromRegions(regions) {
  var arr = Array.isArray(regions) ? regions : [];
  if (!arr.length) return '-';
  return arr
    .map(function (r) {
      return formatOpenRidingRegionShort(r);
    })
    .join(' · ');
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
  var _gfd = useState(null);
  var detailGroupId = _gfd[0];
  var setDetailGroupId = _gfd[1];
  var _pic = useState(0);
  var pendingIncomingCount = _pic[0];
  var setPendingIncomingCount = _pic[1];

  var _pgj = useState(0);
  var pendingGroupJoinCount = _pgj[0];
  var setPendingGroupJoinCount = _pgj[1];

  var _gjm = useState({});
  var groupJoinCountMap = _gjm[0];
  var setGroupJoinCountMap = _gjm[1];

  useEffect(
    function () {
      if (!firestore || !userId) {
        setPendingIncomingCount(0);
        return;
      }
      var fr = typeof window !== 'undefined' ? window.openRidingFriendsService || {} : {};
      if (typeof fr.countPendingIncomingFriendRequests !== 'function') return;
      var cancelled = false;
      fr.countPendingIncomingFriendRequests(firestore, userId).then(function (n) {
        if (!cancelled) setPendingIncomingCount(typeof n === 'number' ? n : 0);
      }).catch(function () {
        if (!cancelled) setPendingIncomingCount(0);
      });
      return function () {
        cancelled = true;
      };
    },
    [firestore, userId, view]
  );

  useEffect(
    function () {
      if (!firestore || !userId) {
        setPendingGroupJoinCount(0);
        setGroupJoinCountMap({});
        return;
      }
      var gs = typeof window !== 'undefined' ? window.openRidingGroupService || {} : {};
      if (typeof gs.subscribeMyManagedGroupsJoinRequestCounts !== 'function') return;
      var unsub = gs.subscribeMyManagedGroupsJoinRequestCounts(firestore, userId, function (total, countMap) {
        setPendingGroupJoinCount(typeof total === 'number' ? total : 0);
        setGroupJoinCountMap(countMap || {});
      });
      return function () {
        if (typeof unsub === 'function') unsub();
      };
    },
    [firestore, userId]
  );

  function handleEditNavDeleteRide() {
    if (!firestore || !userId || !detailRideId) return;
    var svc = typeof window !== 'undefined' ? window.openRidingService || {} : {};
    if (typeof svc.deleteRideByHost !== 'function') return;
    if (!window.confirm('등록한 라이딩을 삭제하시겠습니까? 삭제 후에는 복구할 수 없습니다.')) return;
    svc
      .deleteRideByHost(firestore, detailRideId, userId)
      .then(function () {
        setDetailRideId(null);
        setView('main');
      })
      .catch(function (err) {
        console.warn('[openRiding] deleteRideByHost', err);
        alert('삭제에 실패했습니다.');
      });
  }

  var headerTitle =
    view === 'create'
      ? '라이딩 생성'
      : view === 'edit'
        ? '라이딩 수정'
        : view === 'detail'
          ? '세부 내용'
          : view === 'filter'
            ? '맞춤 필터 설정'
            : view === 'friends'
              ? '친구 관리'
              : view === 'groups'
                ? '그룹 관리'
                : view === 'groupCreate'
                  ? '그룹 만들기'
                  : view === 'groupEdit'
                    ? '그룹 수정'
                    : view === 'groupDetail'
                      ? '그룹 상세'
                      : '라이딩 모임';

  var useGlassBottomNavSpacer = !!(
    firestore &&
    (view === 'main' ||
      view === 'filter' ||
      view === 'create' ||
      view === 'friends' ||
      view === 'groups' ||
      view === 'groupCreate' ||
      view === 'groupEdit' ||
      (view === 'groupDetail' && detailGroupId) ||
      (view === 'detail' && detailRideId) ||
      (view === 'edit' && detailRideId))
  );

  var inner = null;
  if (!firestore) {
    inner = (
      <div className="p-4 text-center text-sm text-amber-900 rounded-xl border border-amber-200 bg-amber-50">
        Firestore에 연결되지 않았습니다. 네트워크 또는 로그인 상태를 확인한 뒤 다시 시도해 주세요.
      </div>
    );
  } else if (view === 'groupDetail' && detailGroupId) {
    inner = (
      <OpenRidingGroupDetailView
        firestore={firestore}
        userId={userId}
        groupId={detailGroupId}
        onBack={function () {
          setDetailGroupId(null);
          setView('groups');
        }}
        onEdit={function () {
          setView('groupEdit');
        }}
      />
    );
  } else if (view === 'groupEdit' && detailGroupId) {
    inner = (
      <OpenRidingGroupForm
        firestore={firestore}
        storage={storage}
        userId={userId}
        editGroupId={detailGroupId}
        onCancel={function () {
          setView('groupDetail');
        }}
        onSaved={function () {
          setView('groupDetail');
        }}
      />
    );
  } else if (view === 'groupCreate') {
    inner = (
      <OpenRidingGroupForm
        firestore={firestore}
        storage={storage}
        userId={userId}
        onCancel={function () {
          setView('groups');
        }}
        onSaved={function () {
          setView('groups');
        }}
      />
    );
  } else if (view === 'groups') {
    inner = (
      <OpenRidingGroupsList
        firestore={firestore}
        userId={userId}
        joinRequestCountMap={groupJoinCountMap}
        onOpenDetail={function (id) {
          setDetailGroupId(id);
          setView('groupDetail');
        }}
        onCreate={function () {
          setView('groupCreate');
        }}
      />
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
        onEditNavMoim={function () {
          setView('main');
        }}
        onEditNavDetail={function () {
          setView('detail');
        }}
        onEditNavDelete={handleEditNavDeleteRide}
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
        onHome={function () {
          if (typeof showScreen === 'function') showScreen('basecampScreen');
        }}
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
        onOpenCreate={function () {
          setDetailGroupId(null);
          setView('create');
        }}
        onSelectRide={function (id) {
          setDetailGroupId(null);
          setDetailRideId(id);
          setView('detail');
        }}
      />
    );
  }

  /* 스크롤/.open-riding-app-body 터치: style.css — html/body overflow 미적용, 스크롤 래퍼에 pointer-events 미무력화 */
  return (
    <div className="open-riding-app-root relative z-0">
      <div className="open-riding-inner-header">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center w-full min-w-0 flex-1 gap-x-1">
          <span className="shrink-0 inline-block w-[2.5em]" aria-hidden="true" />
          <h1 className="open-riding-screen-title m-0 min-w-0 px-0.5 text-center truncate" title={headerTitle}>
            {headerTitle}
          </h1>
          <span className="shrink-0 inline-block w-[2.5em]" aria-hidden="true" />
        </div>
      </div>
      {/* 스크롤 전용 본문: pseudo는 pointer-events:none. 메인·필터는 글래스 하단 네비만큼 하단 여백(style.css) */}
      <div
        className={
          'open-riding-app-body flex-1 min-h-0 overflow-y-auto px-3 w-full box-border ' +
          (view === 'groupDetail' && detailGroupId ? 'open-riding-app-body--group-detail-no-scrollbar ' : '') +
          (view === 'groups' ? 'open-riding-app-body--groups-no-scrollbar ' : '') +
          ((view === 'detail' && detailRideId) || (view === 'groupDetail' && detailGroupId)
            ? 'open-riding-app-body--riding-detail '
            : 'pt-2 ') +
          (useGlassBottomNavSpacer
            ? 'open-riding-app-body--glass-nav-spacer'
            : 'pb-[calc(1rem+env(safe-area-inset-bottom,0px))]')
        }
      >
        {inner}
      </div>
      {firestore &&
      (view === 'main' ||
        view === 'filter' ||
        view === 'create' ||
        view === 'friends' ||
        view === 'groups' ||
        view === 'groupCreate' ||
        view === 'groupEdit' ||
        (view === 'groupDetail' && detailGroupId)) ? (
        <OpenRidingBottomGlassNav
          navVariant={
            view === 'filter'
              ? 'filter'
              : view === 'friends'
                ? 'friends'
                : view === 'groups' ||
                    view === 'groupCreate' ||
                    view === 'groupEdit' ||
                    (view === 'groupDetail' && detailGroupId)
                  ? 'groups'
                  : 'main'
          }
          onHome={function () {
            if (typeof showScreen === 'function') showScreen('basecampScreen');
          }}
          onMoim={function () {
            setDetailGroupId(null);
            setView('main');
          }}
          onFilter={function () {
            setView('filter');
          }}
          onCreate={function () {
            setDetailGroupId(null);
            setView('create');
          }}
          onGroups={function () {
            setDetailRideId(null);
            setDetailGroupId(null);
            setView('groups');
          }}
          onFriends={function () {
            setDetailGroupId(null);
            setView('friends');
          }}
          pendingIncomingCount={pendingIncomingCount}
          pendingGroupJoinCount={pendingGroupJoinCount}
          userId={userId}
        />
      ) : null}
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

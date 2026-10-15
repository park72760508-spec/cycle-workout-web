/**
 * 친구 초대 이벤트 (2026-10-15)
 *
 * - 추천인 코드: 사용자별 고유 6자리(대문자·숫자) — referralCodes/{code} { uid } 를 생성 전용으로 만들어 소유를 보장하고,
 *   users/{uid}.referral_code 에 저장해 이후 계속 같은 코드를 쓴다.
 * - 초대 링크: https://stelvio.ai.kr/?ref=CODE → 접속 시 코드를 기억했다가 사용자 등록 화면 추천인 코드 칸에 자동 입력.
 * - 추천 인정: 신규 가입 시 users/{uid} 생성과 같은 묶음 쓰기(batch)로만 referralClaims/{신규 uid} 를 만들 수 있다
 *   (보안 규칙: 가입 전 문서 없음 + 가입 후 문서 있음 + 코드 소유자 일치 + 본인 코드 불가) → 기존 회원·재가입은 인정 안 됨.
 * - 카운트: referralClaims 중 referrerUid == 나 인 문서 수. 10명 이상이면 기념품 신청(구글 폼) 활성.
 * - 기념품 신청(2026-10-16): 구글 폼 대신 자체 신청 화면 — referralGiftRequests/{uid} 문서 1개(생성 전용)로
 *   계정당 1건(발송 전까지 본인 수정·취소 가능). 관리자는 마이 화면 '기념품 신청' 탭에서 목록 확인·CSV(배송 파일) 다운로드.
 * - 공유: 카카오 JavaScript 키(window.STELVIO_KAKAO_JS_KEY)가 있으면 카카오톡 공유, 없으면 기기 공유 시트 → 링크 복사.
 */
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getCountFromServer,
  getDocs,
  writeBatch,
  serverTimestamp
} from '/assets/js/vendor/firebasejs/10.14.1/firebase-firestore.js';

export const REFERRAL_GOAL = 10;
export const GIFT_SIZES = [
  { value: 'XS', label: 'XS', range: '225~240mm' },
  { value: 'S', label: 'S', range: '240~255mm' },
  { value: 'M', label: 'M', range: '255~270mm' },
  { value: 'L', label: 'L', range: '270~285mm' }
];
const GIFT_REQ_COLLECTION = 'referralGiftRequests';
export const GIFT_IMAGE_URL = 'https://stelvio.ai.kr/assets/img/stelviogift_v2_720.jpg';
const SITE_URL = 'https://stelvio.ai.kr/';
const LS_REF_KEY = 'stelvioPendingReferralCode';
const CODE_RE = /^[A-Z0-9]{6}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동 문자(0·O·1·I) 제외

function db() {
  return typeof window !== 'undefined' ? window.firestoreV9 : null;
}

function currentUid() {
  try {
    return (window.authV9 && window.authV9.currentUser && window.authV9.currentUser.uid) || '';
  } catch (e) {
    return '';
  }
}

export function normalizeReferralCode(v) {
  const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODE_RE.test(s) ? s : '';
}

function randomCode() {
  const buf = new Uint8Array(6);
  window.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function inviteUrl(code) {
  return SITE_URL + '?ref=' + encodeURIComponent(code);
}

/**
 * 내 추천인 코드 — 2026-10-15 수정:
 *  기준은 referralCodes 중 내 uid 로 가장 먼저 만들어진 코드(어느 기기·화면에서 불러도 같은 코드).
 *  이전 버전은 팝업·프로필·초대 버튼이 동시에 호출하거나 기존 코드 확인이 한 번 실패하면 새 코드를 또 만들어
 *  화면마다 다른 코드가 보였다 → ① 같은 페이지 안에서는 한 번만 조회(single-flight)
 *  ② 조회가 실패하면 새로 만들지 않고 오류 ③ 내 코드가 하나도 없을 때만 발급.
 *  이미 만들어진 다른 코드들도 소유자가 나이므로 그 코드로 가입한 친구는 그대로 집계된다.
 */
const myCodePromises = new Map();

async function readMyCanonicalCode(fs, uid) {
  const snap = await getDocs(query(collection(fs, 'referralCodes'), where('uid', '==', uid)));
  let best = null;
  snap.forEach((d) => {
    const ts = d.get('createdAt');
    const ms = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : Number.MAX_SAFE_INTEGER;
    if (!best || ms < best.ms || (ms === best.ms && d.id < best.code)) best = { code: d.id, ms };
  });
  return best ? best.code : '';
}

async function ensureMyReferralCodeOnce(fs, uid) {
  const userRef = doc(fs, 'users', uid);
  let code = await readMyCanonicalCode(fs, uid); // 실패하면 그대로 throw — 새 코드를 만들지 않는다
  if (!code) {
    for (let i = 0; i < 6 && !code; i++) {
      const cand = randomCode();
      try {
        await setDoc(doc(fs, 'referralCodes', cand), { uid, createdAt: serverTimestamp() }); // 생성 전용(중복이면 거부)
        code = cand;
      } catch (e) {
        if (i === 5) throw e;
      }
    }
    // 다른 기기에서 동시에 만들었을 수 있으니 다시 읽어 가장 먼저 만든 코드로 맞춘다
    code = (await readMyCanonicalCode(fs, uid).catch(() => '')) || code;
  }
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists() || snap.get('referral_code') !== code) await updateDoc(userRef, { referral_code: code });
  } catch (e) {
    /* 표시용 사본 — 실패해도 무방 */
  }
  return code;
}

export function ensureMyReferralCode(uidArg) {
  const fs = db();
  const uid = uidArg || currentUid();
  if (!fs || !uid) return Promise.reject(new Error('로그인 후 이용해 주세요.'));
  if (!myCodePromises.has(uid)) {
    const p = ensureMyReferralCodeOnce(fs, uid).catch((e) => {
      myCodePromises.delete(uid); // 실패는 캐시하지 않음(다음 호출에서 재시도)
      throw e;
    });
    myCodePromises.set(uid, p);
  }
  return myCodePromises.get(uid);
}

/** 코드 → 추천인 uid (없으면 '') — 가입 전(비로그인)에도 조회 가능 */
export async function lookupReferralCode(codeRaw) {
  const code = normalizeReferralCode(codeRaw);
  const fs = db();
  if (!code || !fs) return '';
  const snap = await getDoc(doc(fs, 'referralCodes', code));
  return snap.exists() ? String(snap.get('uid') || '') : '';
}

/**
 * 신규 가입 저장 — 사용자 문서 + 추천 기록을 한 번에(batch). allowFallback 이면 추천 기록이 규칙에 막힐 때 사용자 문서만 저장.
 * @returns {Promise<{ referred: boolean }>}
 */
export async function saveNewUserWithReferral(uid, userData, codeRaw, referrerUid, allowFallback = true) {
  const fs = db();
  const code = normalizeReferralCode(codeRaw);
  if (!fs) throw new Error('Firestore V9가 초기화되지 않았습니다.');
  const userRef = doc(fs, 'users', uid);
  if (code && referrerUid && referrerUid !== uid) {
    try {
      const batch = writeBatch(fs);
      batch.set(userRef, Object.assign({}, userData, { referred_by_code: code }));
      batch.set(doc(fs, 'referralClaims', uid), { code, referrerUid, createdAt: serverTimestamp() });
      await batch.commit();
      return { referred: true };
    } catch (e) {
      // 가입 직후 토큰 전파 지연으로도 권한 오류가 날 수 있어, 마지막 시도 전까지는 그대로 실패시켜 재시도한다
      if (!allowFallback) throw e;
      console.warn('[referral] 추천 기록 저장 실패 — 회원 정보만 저장:', e && e.message);
    }
  }
  await setDoc(userRef, userData);
  return { referred: false };
}

/** 나를 추천인으로 가입한 회원 수 */
export async function countMyReferrals(uidArg) {
  const fs = db();
  const uid = uidArg || currentUid();
  if (!fs || !uid) return 0;
  const snap = await getCountFromServer(query(collection(fs, 'referralClaims'), where('referrerUid', '==', uid)));
  return Number(snap.data().count) || 0;
}

function toast(msg, type) {
  if (typeof window.showToast === 'function') window.showToast(msg, type);
  else alert(msg);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

let kakaoSdkP = null;
function loadKakaoSdk(key) {
  if (!key) return Promise.resolve(null);
  if (window.Kakao && window.Kakao.Share) {
    if (!window.Kakao.isInitialized()) window.Kakao.init(key);
    return Promise.resolve(window.Kakao);
  }
  if (!kakaoSdkP) {
    kakaoSdkP = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js';
      s.crossOrigin = 'anonymous';
      s.onload = () => {
        try {
          if (!window.Kakao.isInitialized()) window.Kakao.init(key);
          resolve(window.Kakao);
        } catch (e) {
          resolve(null);
        }
      };
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }
  return kakaoSdkP;
}

/** 친구 초대하기 — 카카오톡 공유(키 설정 시) → 기기 공유 시트 → 링크·코드 복사 */
export async function shareInvite() {
  let code;
  try {
    code = await ensureMyReferralCode();
  } catch (e) {
    toast((e && e.message) || '로그인 후 이용해 주세요.', 'error');
    return;
  }
  const url = inviteUrl(code);
  // 링크를 본문 위쪽에 넣어 "위에 링크로 가입" 안내와 순서를 맞춘다(공유 앱마다 url 위치가 달라 text 에 포함)
  const text =
    'STELVIO에서 함께 훈련해요! 🚴🏃\n' + url + '\n위에 링크로 가입하고 사용자 등록 화면에 추천인 코드를 입력해 주세요.\n추천인 코드: ' + code;

  const kakaoKey = window.STELVIO_KAKAO_JS_KEY || '';
  const Kakao = await loadKakaoSdk(kakaoKey);
  if (Kakao && Kakao.Share) {
    try {
      Kakao.Share.sendDefault({
        objectType: 'feed',
        content: {
          title: 'STELVIO 친구 초대 · 추천인 코드 ' + code,
          description: '링크로 가입하고 사용자 등록 화면에 추천인 코드 ' + code + ' 를 입력해 주세요.',
          imageUrl: GIFT_IMAGE_URL,
          link: { mobileWebUrl: url, webUrl: url }
        },
        buttons: [{ title: 'STELVIO 가입하기', link: { mobileWebUrl: url, webUrl: url } }]
      });
      return;
    } catch (e) {
      console.warn('[referral] 카카오 공유 실패 — 기기 공유로 전환:', e && e.message);
    }
  }
  if (navigator.share) {
    try {
      await navigator.share({ title: 'STELVIO 친구 초대', text });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const ok = await copyText(text);
  toast(ok ? '초대 링크와 추천인 코드를 복사했습니다. 카카오톡 대화방에 붙여넣어 보내 주세요.' : '추천인 코드: ' + code + '\n' + url, ok ? 'success' : 'info');
}

/** 프로필 카드 아바타 줄 아래 — 추천인 코드·카운트·기념품 신청 */
export async function hydrateProfileReferralRow(uid) {
  const els = document.querySelectorAll('[data-stelvio-referral-row="' + uid + '"]');
  if (!els.length) return;
  let code = '';
  let count = 0;
  let applied = false;
  try {
    [code, count] = await Promise.all([ensureMyReferralCode(uid), countMyReferrals(uid)]);
    if (count >= REFERRAL_GOAL) applied = !!(await getMyGiftRequest(uid).catch(() => null));
  } catch (e) {
    console.warn('[referral] 프로필 표시 실패:', e && e.message);
    return;
  }
  const done = count >= REFERRAL_GOAL;
  els.forEach((el) => {
    el.innerHTML =
      '<span class="stelvio-referral-code" title="내 추천인 코드">추천인 코드 <b>' + code + '</b></span>' +
      '<span class="stelvio-referral-count' + (done ? ' is-done' : '') + '" title="나를 추천인으로 가입한 친구 수">🎁 ' +
      count + ' / ' + REFERRAL_GOAL + '</span>' +
      '<button type="button" class="stelvio-referral-gift-btn' + (applied ? ' is-applied' : '') + '" ' + (done ? '' : 'disabled ') +
      'title="' + (done ? (applied ? '신청 내역 보기' : '기념품 신청서 작성') : '친구 ' + REFERRAL_GOAL + '명 가입 시 신청할 수 있습니다') + '">' +
      (applied ? '신청 완료' : '기념품 신청') + '</button>';
    el.hidden = false;
    const btn = el.querySelector('.stelvio-referral-gift-btn');
    if (btn && done) {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openGiftRequestModal(uid);
      });
    }
  });
}

/* ===== 기념품 신청 (2026-10-16) ===== */

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatPhone(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 11) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
  if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
  return d;
}

function sizeLabel(v) {
  const s = GIFT_SIZES.find((x) => x.value === v);
  return s ? s.label + ' (' + s.range + ')' : String(v || '');
}

function tsToDate(ts) {
  if (ts && typeof ts.toDate === 'function') return ts.toDate();
  return null;
}

function fmtDateTime(d) {
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

export async function getMyGiftRequest(uidArg) {
  const fs = db();
  const uid = uidArg || currentUid();
  if (!fs || !uid) return null;
  const snap = await getDoc(doc(fs, GIFT_REQ_COLLECTION, uid));
  return snap.exists() ? snap.data() : null;
}

/** 주소 검색 — 중고랜드(marketScreen.js openDaumPostcode)와 동일: .embed()로 오버레이 안에 렌더링(iOS 팝업 차단 회피) */
function openDaumPostcode(onComplete) {
  function launch() {
    const overlay = document.createElement('div');
    overlay.className = 'competition-postcode-overlay';
    overlay.innerHTML =
      '<div class="competition-postcode-modal">' +
      '  <div class="competition-postcode-header">' +
      '    <span>주소 검색</span>' +
      '    <button type="button" class="competition-postcode-close" aria-label="닫기">&times;</button>' +
      '  </div>' +
      '  <div class="competition-postcode-embed"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };
    overlay.querySelector('.competition-postcode-close').addEventListener('click', remove);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) remove();
    });
    new window.daum.Postcode({
      oncomplete: (data) => {
        let addr = data.userSelectedType === 'R' ? data.roadAddress : data.jibunAddress;
        let extra = '';
        if (data.userSelectedType === 'R') {
          if (data.bname) extra += data.bname;
          if (data.buildingName) extra += extra ? ', ' + data.buildingName : data.buildingName;
          if (extra) addr += ' (' + extra + ')';
        }
        remove();
        onComplete({ zonecode: data.zonecode, address: addr });
      },
      width: '100%',
      height: '100%'
    }).embed(overlay.querySelector('.competition-postcode-embed'));
  }
  if (window.daum && window.daum.Postcode) {
    launch();
    return;
  }
  const script = document.createElement('script');
  script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
  script.onload = launch;
  script.onerror = () => alert('우편번호 서비스를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  document.body.appendChild(script);
}

function closeGiftModal() {
  const m = document.getElementById('stelvioGiftRequestModal');
  if (m && m.parentNode) m.parentNode.removeChild(m);
}

function showGiftModal(innerHtml) {
  closeGiftModal();
  const m = document.createElement('div');
  m.id = 'stelvioGiftRequestModal';
  m.className = 'stelvio-gift-modal';
  m.innerHTML =
    '<div class="stelvio-gift-modal__overlay" data-gift-close></div>' +
    '<div class="stelvio-gift-modal__card" role="dialog" aria-modal="true" aria-labelledby="stelvioGiftTitle">' + innerHtml + '</div>';
  m.addEventListener('click', (e) => {
    if (e.target.closest('[data-gift-close]')) closeGiftModal();
  });
  document.body.appendChild(m);
  return m;
}

function giftSummaryHtml(req) {
  const rows = [
    ['성명', req.name],
    ['연락처', req.phone],
    ['주소', '(' + req.zipCode + ') ' + req.address1 + ' ' + req.address2],
    ['사이즈', sizeLabel(req.size)],
    ['신청일', fmtDateTime(tsToDate(req.createdAt))]
  ];
  if (req.updatedAt) rows.push(['수정일', fmtDateTime(tsToDate(req.updatedAt))]);
  return (
    '<dl class="stelvio-gift-summary">' +
    rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>').join('') +
    '</dl>'
  );
}

/** 기념품 신청 화면 — 이미 신청했으면 신청 내역(수정·신청 취소 가능)을 보여 준다(계정당 1건) */
export async function openGiftRequestModal(uidArg) {
  const uid = uidArg || currentUid();
  if (!uid || uid !== currentUid()) {
    toast('로그인한 본인 계정에서만 신청할 수 있습니다.', 'error');
    return;
  }
  let existing = null;
  let count = 0;
  try {
    [existing, count] = await Promise.all([getMyGiftRequest(uid), countMyReferrals(uid)]);
  } catch (e) {
    toast('신청 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    return;
  }
  if (existing) {
    showGiftRequestDetail(uid, existing, count);
    return;
  }
  if (count < REFERRAL_GOAL) {
    toast('친구 ' + REFERRAL_GOAL + '명 가입 시 신청할 수 있습니다. (현재 ' + count + '명)', 'info');
    return;
  }
  showGiftRequestForm(uid, count, null);
}

/** 신청 내역 — 접수 상태(REQUESTED)일 때만 본인이 수정·신청 취소 가능 */
function showGiftRequestDetail(uid, req, count) {
  const editable = req.status === 'REQUESTED';
  const m = showGiftModal(
    '<h3 class="stelvio-gift-modal__title" id="stelvioGiftTitle">기념품 신청 완료</h3>' +
    '<p class="stelvio-gift-modal__desc">기념품 신청이 접수되었습니다. 기념품은 계정당 1건만 신청할 수 있습니다.</p>' +
    giftSummaryHtml(req) +
    '<p class="stelvio-gift-modal__note">배송비 수신자 부담' +
    (editable ? ' · 발송 전까지 수정하거나 신청을 취소할 수 있습니다.' : ' · 발송 준비가 시작되어 변경은 STELVIO 관리자에게 문의해 주세요.') + '</p>' +
    '<div class="stelvio-gift-modal__actions">' +
    (editable
      ? '<button type="button" class="stelvio-gift-btn stelvio-gift-btn--danger" data-gift-cancel>신청 취소</button>' +
        '<button type="button" class="stelvio-gift-btn stelvio-gift-btn--outline" data-gift-edit>수정</button>'
      : '') +
    '<button type="button" class="stelvio-gift-btn stelvio-gift-btn--primary" data-gift-close>확인</button>' +
    '</div>'
  );
  const editBtn = m.querySelector('[data-gift-edit]');
  if (editBtn) editBtn.addEventListener('click', () => showGiftRequestForm(uid, count, req));
  const cancelBtn = m.querySelector('[data-gift-cancel]');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      if (!window.confirm('기념품 신청을 취소할까요?')) return;
      cancelBtn.disabled = true;
      try {
        await deleteDoc(doc(db(), GIFT_REQ_COLLECTION, uid));
        closeGiftModal();
        toast('기념품 신청을 취소했습니다.', 'success');
        hydrateProfileReferralRow(uid);
      } catch (e) {
        cancelBtn.disabled = false;
        toast('신청 취소에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'error');
      }
    });
  }
}

/** 신청서 — prev 가 있으면 수정 모드(기존 값 채움, 신청일 유지) */
function showGiftRequestForm(uid, count, prev) {
  const isEdit = !!prev;
  if (isEdit && count < REFERRAL_GOAL) {
    toast('친구 ' + REFERRAL_GOAL + '명 이상일 때만 수정할 수 있습니다. (현재 ' + count + '명)', 'info');
    return;
  }
  let me = null;
  try {
    me = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch (e) {}
  const mine = me && String(me.id) === uid;
  const v = prev || {
    name: mine ? me.name || '' : '',
    phone: mine ? formatPhone(me.contact || '') : '',
    zipCode: '',
    address1: '',
    address2: '',
    size: ''
  };

  const m = showGiftModal(
    '<h3 class="stelvio-gift-modal__title" id="stelvioGiftTitle">' + (isEdit ? '기념품 신청 수정' : '기념품 신청') + '</h3>' +
    '<p class="stelvio-gift-modal__desc">STELVIO 기념 양말 2개를 보내 드립니다. 받으실 정보를 정확히 입력해 주세요.</p>' +
    '<form class="stelvio-gift-form" novalidate>' +
    '  <label class="stelvio-gift-label">성명<input type="text" class="stelvio-gift-input" name="name" maxlength="30" autocomplete="name" value="' + esc(v.name) + '" /></label>' +
    '  <label class="stelvio-gift-label">연락처<input type="tel" class="stelvio-gift-input" name="phone" maxlength="13" inputmode="numeric" autocomplete="tel" placeholder="010-0000-0000" value="' + esc(v.phone) + '" /></label>' +
    '  <div class="stelvio-gift-label">주소' +
    '    <div class="stelvio-gift-zip-row">' +
    '      <input type="text" class="stelvio-gift-input" name="zipCode" placeholder="우편번호" readonly value="' + esc(v.zipCode) + '" />' +
    '      <button type="button" class="stelvio-gift-btn stelvio-gift-btn--outline" data-gift-zip>주소 검색</button>' +
    '    </div>' +
    '    <input type="text" class="stelvio-gift-input" name="address1" placeholder="주소" readonly value="' + esc(v.address1) + '" />' +
    '    <input type="text" class="stelvio-gift-input" name="address2" maxlength="100" placeholder="상세주소" value="' + esc(v.address2) + '" />' +
    '  </div>' +
    '  <div class="stelvio-gift-label">사이즈' +
    '    <div class="stelvio-gift-sizes">' +
    GIFT_SIZES.map(
      (sz) =>
        '<label class="stelvio-gift-size"><input type="radio" name="size" value="' + sz.value + '"' + (v.size === sz.value ? ' checked' : '') + ' />' +
        '<span><b>' + sz.label + '</b><small>' + sz.range + '</small></span></label>'
    ).join('') +
    '    </div>' +
    '  </div>' +
    '  <p class="stelvio-gift-modal__note">배송비 수신자 부담 · 기념품은 계정당 1건만 신청할 수 있으며, 발송 전까지 수정·취소할 수 있습니다.</p>' +
    '  <div class="stelvio-gift-modal__actions">' +
    '    <button type="button" class="stelvio-gift-btn stelvio-gift-btn--ghost" data-gift-back>취소</button>' +
    '    <button type="submit" class="stelvio-gift-btn stelvio-gift-btn--primary">' + (isEdit ? '수정하기' : '신청하기') + '</button>' +
    '  </div>' +
    '</form>'
  );
  const form = m.querySelector('form');
  const f = (n) => form.elements[n];
  m.querySelector('[data-gift-back]').addEventListener('click', () => {
    if (isEdit) showGiftRequestDetail(uid, prev, count);
    else closeGiftModal();
  });
  f('phone').addEventListener('input', () => {
    f('phone').value = formatPhone(f('phone').value);
  });
  m.querySelector('[data-gift-zip]').addEventListener('click', () => {
    openDaumPostcode((r) => {
      f('zipCode').value = r.zonecode;
      f('address1').value = r.address;
      f('address2').value = '';
      f('address2').focus();
    });
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = f('name').value.trim();
    const phone = formatPhone(f('phone').value);
    const zipCode = f('zipCode').value.trim();
    const address1 = f('address1').value.trim();
    const address2 = f('address2').value.trim();
    const sizeEl = form.querySelector('input[name="size"]:checked');
    const size = sizeEl ? sizeEl.value : '';
    if (!name) return toast('성명을 입력해 주세요.', 'error');
    if (!/^\d{2,3}-\d{3,4}-\d{4}$/.test(phone)) return toast('연락처를 정확히 입력해 주세요.', 'error');
    if (!zipCode || !address1) return toast('주소 검색으로 받으실 주소를 입력해 주세요.', 'error');
    if (!address2) return toast('상세주소를 입력해 주세요.', 'error');
    if (!size) return toast('사이즈를 선택해 주세요.', 'error');
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = isEdit ? '수정 중…' : '신청 중…';
    const ref = doc(db(), GIFT_REQ_COLLECTION, uid);
    try {
      if (isEdit) {
        // 본인 수정: 접수 상태일 때만, 신청일·상태는 그대로(보안 규칙에서 검증)
        await updateDoc(ref, { name, phone, zipCode, address1, address2, size, referralCount: count, updatedAt: serverTimestamp() });
        closeGiftModal();
        toast('기념품 신청 정보를 수정했습니다.', 'success');
      } else {
        // 문서 ID = 내 uid, 생성은 문서가 없을 때만 가능 → 계정당 1건
        await setDoc(ref, {
          uid, name, phone, zipCode, address1, address2, size,
          referralCount: count,
          status: 'REQUESTED',
          createdAt: serverTimestamp()
        });
        closeGiftModal();
        toast('기념품 신청이 접수되었습니다.', 'success');
      }
      hydrateProfileReferralRow(uid);
    } catch (e) {
      const cur = await getMyGiftRequest(uid).catch(() => null);
      if (!isEdit && cur) {
        toast('이미 기념품을 신청하셨습니다.', 'error');
        closeGiftModal();
        hydrateProfileReferralRow(uid);
        return;
      }
      if (isEdit && cur && cur.status !== 'REQUESTED') {
        toast('발송 준비가 시작되어 수정할 수 없습니다. STELVIO 관리자에게 문의해 주세요.', 'error');
        closeGiftModal();
        return;
      }
      toast((isEdit ? '수정' : '신청') + '에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = isEdit ? '수정하기' : '신청하기';
    }
  });
}

/* ----- 관리자: 마이 화면 '기념품 신청' 탭 ----- */

let adminGiftRows = [];

function giftDupKeys(r) {
  const phone = String(r.phone || '').replace(/\D/g, '');
  const addr = (String(r.zipCode || '') + String(r.address1 || '') + String(r.address2 || '')).replace(/[\s,.()-]/g, '');
  return { phone, addr };
}

async function loadAdminGiftRows() {
  const fs = db();
  const snap = await getDocs(collection(fs, GIFT_REQ_COLLECTION));
  const rows = [];
  snap.forEach((d) => rows.push(Object.assign({ id: d.id }, d.data())));
  rows.sort((a, b) => {
    const ta = tsToDate(a.createdAt);
    const tb = tsToDate(b.createdAt);
    return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
  });
  // 현재 초대 인원(신청 당시 값과 별개로 서버 집계) — 관리자만 referralClaims 집계 가능
  await Promise.all(
    rows.map((r) =>
      countMyReferrals(r.uid || r.id)
        .then((n) => { r.liveCount = n; })
        .catch(() => { r.liveCount = null; })
    )
  );
  // 다른 계정이 같은 연락처·주소로 신청한 경우 표시
  const phoneMap = new Map();
  const addrMap = new Map();
  rows.forEach((r) => {
    const k = giftDupKeys(r);
    if (k.phone) phoneMap.set(k.phone, (phoneMap.get(k.phone) || 0) + 1);
    if (k.addr) addrMap.set(k.addr, (addrMap.get(k.addr) || 0) + 1);
  });
  rows.forEach((r) => {
    const k = giftDupKeys(r);
    r.dupPhone = !!k.phone && phoneMap.get(k.phone) > 1;
    r.dupAddr = !!k.addr && addrMap.get(k.addr) > 1;
  });
  return rows;
}

function adminGiftMatches(r, nameQuery, contactDigits) {
  if (nameQuery && String(r.name || '').indexOf(nameQuery) < 0) return false;
  if (contactDigits && String(r.phone || '').replace(/\D/g, '').indexOf(contactDigits) < 0) return false;
  return true;
}

/**
 * 관리자 마이 화면 '기념품 신청' 탭 — 신청 목록 + CSV 다운로드
 * @param {HTMLElement} container
 * @param {{ name?: string, contact?: string, reload?: boolean }} [opts]
 */
export async function renderAdminGiftRequests(container, opts) {
  if (!container) return;
  opts = opts || {};
  if (!adminGiftRows.length || opts.reload !== false) {
    container.innerHTML = '<div class="stelvio-gift-admin"><p class="stelvio-gift-admin__empty">기념품 신청 목록을 불러오는 중…</p></div>';
    try {
      adminGiftRows = await loadAdminGiftRows();
    } catch (e) {
      container.innerHTML =
        '<div class="stelvio-gift-admin"><p class="stelvio-gift-admin__empty">신청 목록을 불러오지 못했습니다. (' + esc(e && e.message) + ')</p></div>';
      return;
    }
  }
  const nameQuery = String(opts.name || '').trim();
  const contactDigits = String(opts.contact || '').replace(/\D/g, '');
  const rows = adminGiftRows.filter((r) => adminGiftMatches(r, nameQuery, contactDigits));
  const dupCount = adminGiftRows.filter((r) => r.dupPhone || r.dupAddr).length;

  const sizeCounts = GIFT_SIZES.map((sz) => sz.label + ' ' + adminGiftRows.filter((r) => r.size === sz.value).length).join(' · ');
  let html =
    '<div class="stelvio-gift-admin">' +
    '<div class="stelvio-gift-admin__head">' +
    '<div class="stelvio-gift-admin__stat">신청 <b>' + adminGiftRows.length + '</b>건 <span>(' + sizeCounts + ')</span>' +
    (dupCount ? ' <span class="stelvio-gift-dup">중복 의심 ' + dupCount + '건</span>' : '') + '</div>' +
    '<div class="stelvio-gift-admin__btns">' +
    '<button type="button" class="stelvio-gift-btn stelvio-gift-btn--outline" data-gift-admin-reload>새로고침</button>' +
    '<button type="button" class="stelvio-gift-btn stelvio-gift-btn--primary" data-gift-admin-csv' + (adminGiftRows.length ? '' : ' disabled') + '>CSV 다운로드</button>' +
    '</div></div>';
  if (!rows.length) {
    html += '<p class="stelvio-gift-admin__empty">' + (nameQuery || contactDigits ? '검색 결과가 없습니다.' : '아직 기념품 신청이 없습니다.') + '</p>';
  } else {
    html += '<div class="stelvio-gift-admin__list">';
    rows.forEach((r) => {
      const cnt = r.liveCount == null ? (r.referralCount != null ? r.referralCount : '-') : r.liveCount;
      const short = typeof cnt === 'number' && cnt < REFERRAL_GOAL;
      html +=
        '<div class="stelvio-gift-row' + (r.dupPhone || r.dupAddr ? ' is-dup' : '') + '">' +
        '<div class="stelvio-gift-row__top">' +
        '<b class="stelvio-gift-row__name">' + esc(r.name) + '</b>' +
        '<span class="stelvio-gift-row__phone' + (r.dupPhone ? ' is-dup' : '') + '">' + esc(r.phone) + '</span>' +
        '<span class="stelvio-gift-row__size">' + esc(r.size) + '</span>' +
        '<span class="stelvio-gift-row__count' + (short ? ' is-short' : '') + '" title="현재 초대 인원">🎁 ' + esc(cnt) + '</span>' +
        '</div>' +
        '<div class="stelvio-gift-row__addr' + (r.dupAddr ? ' is-dup' : '') + '">(' + esc(r.zipCode) + ') ' + esc(r.address1) + ' ' + esc(r.address2) + '</div>' +
        '<div class="stelvio-gift-row__meta">' + esc(fmtDateTime(tsToDate(r.createdAt))) +
        (r.dupPhone ? ' · <span class="stelvio-gift-dup">연락처 중복</span>' : '') +
        (r.dupAddr ? ' · <span class="stelvio-gift-dup">주소 중복</span>' : '') +
        '</div>' +
        '</div>';
    });
    html += '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
  const reloadBtn = container.querySelector('[data-gift-admin-reload]');
  if (reloadBtn) reloadBtn.addEventListener('click', () => renderAdminGiftRequests(container, Object.assign({}, opts, { reload: true })));
  const csvBtn = container.querySelector('[data-gift-admin-csv]');
  if (csvBtn) csvBtn.addEventListener('click', () => downloadGiftCsv(adminGiftRows));
}

function downloadGiftCsv(rows) {
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const header = ['신청일시', '성명', '연락처', '우편번호', '주소', '상세주소', '전체주소', '사이즈', '사이즈(mm)', '초대 인원', '중복 의심', '회원ID'];
  const lines = [header.map(q).join(',')];
  rows
    .slice()
    .reverse() // 신청 순서대로
    .forEach((r) => {
      const sz = GIFT_SIZES.find((x) => x.value === r.size);
      const dup = [r.dupPhone ? '연락처' : '', r.dupAddr ? '주소' : ''].filter(Boolean).join('/');
      lines.push(
        [
          fmtDateTime(tsToDate(r.createdAt)),
          r.name,
          r.phone,
          r.zipCode,
          r.address1,
          r.address2,
          r.address1 + ' ' + r.address2,
          r.size,
          sz ? sz.range : '',
          r.liveCount == null ? r.referralCount : r.liveCount,
          dup,
          r.uid || r.id
        ].map(q).join(',')
      );
    });
  // 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM 추가
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'STELVIO_기념품신청_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/** 초대 링크(?ref=)로 접속하면 코드를 기억해 두고 사용자 등록 화면에 자동 입력 */
function capturePendingReferral() {
  try {
    const p = new URLSearchParams(window.location.search);
    const code = normalizeReferralCode(p.get('ref'));
    if (code) localStorage.setItem(LS_REF_KEY, code);
  } catch (e) {}
}

export function pendingReferralCode() {
  try {
    return normalizeReferralCode(localStorage.getItem(LS_REF_KEY));
  } catch (e) {
    return '';
  }
}

export function clearPendingReferralCode() {
  try {
    localStorage.removeItem(LS_REF_KEY);
  } catch (e) {}
}

capturePendingReferral();

window.stelvioReferral = {
  REFERRAL_GOAL,
  GIFT_SIZES,
  normalizeReferralCode,
  ensureMyReferralCode,
  lookupReferralCode,
  saveNewUserWithReferral,
  countMyReferrals,
  shareInvite,
  hydrateProfileReferralRow,
  openGiftRequestModal,
  getMyGiftRequest,
  renderAdminGiftRequests,
  pendingReferralCode,
  clearPendingReferralCode
};

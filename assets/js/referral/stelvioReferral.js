/**
 * 친구 초대 이벤트 (2026-10-15)
 *
 * - 추천인 코드: 사용자별 고유 6자리(대문자·숫자) — referralCodes/{code} { uid } 를 생성 전용으로 만들어 소유를 보장하고,
 *   users/{uid}.referral_code 에 저장해 이후 계속 같은 코드를 쓴다.
 * - 초대 링크: https://stelvio.ai.kr/?ref=CODE → 접속 시 코드를 기억했다가 사용자 등록 화면 추천인 코드 칸에 자동 입력.
 * - 추천 인정: 신규 가입 시 users/{uid} 생성과 같은 묶음 쓰기(batch)로만 referralClaims/{신규 uid} 를 만들 수 있다
 *   (보안 규칙: 가입 전 문서 없음 + 가입 후 문서 있음 + 코드 소유자 일치 + 본인 코드 불가) → 기존 회원·재가입은 인정 안 됨.
 * - 카운트: referralClaims 중 referrerUid == 나 인 문서 수. 10명 이상이면 기념품 신청(구글 폼) 활성.
 * - 공유: 카카오 JavaScript 키(window.STELVIO_KAKAO_JS_KEY)가 있으면 카카오톡 공유, 없으면 기기 공유 시트 → 링크 복사.
 */
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getCountFromServer,
  writeBatch,
  serverTimestamp
} from '/assets/js/vendor/firebasejs/10.14.1/firebase-firestore.js';

export const REFERRAL_GOAL = 10;
export const GIFT_FORM_URL = 'https://forms.gle/F8xocpUgQHaT78f79';
export const GIFT_IMAGE_URL = 'https://stelvio.ai.kr/assets/img/stelviogift.jpeg';
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

/** 내 추천인 코드(없으면 발급해 users 문서에 저장) */
export async function ensureMyReferralCode(uidArg) {
  const fs = db();
  const uid = uidArg || currentUid();
  if (!fs || !uid) throw new Error('로그인 후 이용해 주세요.');
  const userRef = doc(fs, 'users', uid);
  const snap = await getDoc(userRef);
  const existing = normalizeReferralCode(snap.exists() ? snap.get('referral_code') : '');
  if (existing) {
    // 소유 문서가 실제로 내 것인지 확인(드물게 저장만 되고 코드 문서 생성이 실패한 경우 복구)
    const own = await getDoc(doc(fs, 'referralCodes', existing)).catch(() => null);
    if (own && own.exists() && own.get('uid') === uid) return existing;
    if (own && !own.exists()) {
      try {
        await setDoc(doc(fs, 'referralCodes', existing), { uid, createdAt: serverTimestamp() });
        return existing;
      } catch (e) {
        /* 아래에서 새로 발급 */
      }
    }
  }
  for (let i = 0; i < 6; i++) {
    const code = randomCode();
    try {
      // 생성 전용 규칙 — 이미 있는 코드면 권한 오류로 실패 → 다른 코드로 재시도
      const ref = doc(fs, 'referralCodes', code);
      const taken = await getDoc(ref).catch(() => null);
      if (taken && taken.exists()) continue;
      await setDoc(ref, { uid, createdAt: serverTimestamp() });
      await updateDoc(userRef, { referral_code: code });
      return code;
    } catch (e) {
      if (i === 5) throw e;
    }
  }
  throw new Error('추천인 코드를 만들지 못했습니다.');
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
  const text =
    'STELVIO에서 함께 훈련해요! 🚴\n아래 링크로 가입하고 사용자 등록 화면에 추천인 코드를 입력해 주세요.\n추천인 코드: ' + code;

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
      await navigator.share({ title: 'STELVIO 친구 초대', text, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const ok = await copyText(text + '\n' + url);
  toast(ok ? '초대 링크와 추천인 코드를 복사했습니다. 카카오톡 대화방에 붙여넣어 보내 주세요.' : '추천인 코드: ' + code + '\n' + url, ok ? 'success' : 'info');
}

/** 프로필 카드 아바타 줄 아래 — 추천인 코드·카운트·기념품 신청 */
export async function hydrateProfileReferralRow(uid) {
  const els = document.querySelectorAll('[data-stelvio-referral-row="' + uid + '"]');
  if (!els.length) return;
  let code = '';
  let count = 0;
  try {
    [code, count] = await Promise.all([ensureMyReferralCode(uid), countMyReferrals(uid)]);
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
      '<button type="button" class="stelvio-referral-gift-btn" ' + (done ? '' : 'disabled ') +
      'title="' + (done ? '기념품 신청서 작성' : '친구 ' + REFERRAL_GOAL + '명 가입 시 신청할 수 있습니다') + '">기념품 신청</button>';
    el.hidden = false;
    const btn = el.querySelector('.stelvio-referral-gift-btn');
    if (btn && done) {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (typeof window.openStelvioExternalUrl === 'function') window.openStelvioExternalUrl(GIFT_FORM_URL);
        else window.open(GIFT_FORM_URL, '_blank', 'noopener,noreferrer');
      });
    }
  });
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
  GIFT_FORM_URL,
  normalizeReferralCode,
  ensureMyReferralCode,
  lookupReferralCode,
  saveNewUserWithReferral,
  countMyReferrals,
  shareInvite,
  hydrateProfileReferralRow,
  pendingReferralCode,
  clearPendingReferralCode
};

/**
 * 중고랜드(Market Land) — Supabase 데이터 계층 + 이미지 최적화/중복검사 + Toss 안전결제 연동.
 * market_items/market_favorites는 Supabase RLS(auth.uid())로 직접 read/write, 결제(가상계좌
 * 발급·구매확정)는 Toss 시크릿 키가 필요해 Cloud Functions를 거친다.
 */
import { fetchSupabaseSessionFromBridge } from '../supabaseDualWrite.js';

const MARKET_IMAGE_MAX_WIDTH = 800;
const MARKET_IMAGE_QUALITY = 0.7;
const MARKET_IMAGE_BUCKET = 'market-images';
const MARKET_BUMP_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SUPABASE_JS_URL = 'https://esm.sh/@supabase/supabase-js@2.49.1';

function functionsBaseUrl(region) {
  const projectId =
    (typeof window !== 'undefined' &&
      window.authV9 &&
      window.authV9.app &&
      window.authV9.app.options &&
      window.authV9.app.options.projectId) ||
    'stelvio-ai';
  return 'https://' + (region || 'us-central1') + '-' + projectId + '.cloudfunctions.net';
}

async function getFirebaseIdToken() {
  const user =
    (typeof window !== 'undefined' && window.authV9 && window.authV9.currentUser) ||
    (typeof window !== 'undefined' && window.auth && window.auth.currentUser) ||
    null;
  if (!user || typeof user.getIdToken !== 'function') {
    throw new Error('로그인이 필요합니다.');
  }
  return user.getIdToken();
}

async function callMarketFunction(name, body, region) {
  const idToken = await getFirebaseIdToken();
  const res = await fetch(functionsBaseUrl(region) + '/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('서버 응답을 읽을 수 없습니다.');
  }
  if (!res.ok || !data || data.success !== true) {
    throw new Error((data && data.error) || 'HTTP ' + res.status);
  }
  return data;
}

/** Supabase Edge Function 호출 — 중고랜드 세션(getFreshMarketAccessToken)이 발급한 커스텀 JWT를
 * 그대로 Authorization으로 붙인다. PostgREST의 auth.uid() 추출은 이 JWT로 잘 되지만, Edge
 * Function 플랫폼 게이트웨이의 verify_jwt는 별개 검증기라 이 커스텀 JWT를 통과시키지 못한다
 * (실제로 market-set-tracking에서 전량 401로 확인됨) — 그래서 사용자 인증이 필요한 Edge
 * Function은 반드시 verify_jwt: false로 배포하고, 함수 코드 안에서 supabase.auth.getUser(token)
 * 으로 직접 검증해야 한다. */
async function callMarketEdgeFunction(name, body) {
  const cfg = (typeof window !== 'undefined' && window.STELVIO_SUPABASE_CONFIG) || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('STELVIO_SUPABASE_CONFIG 미설정');
  const token = await getFreshMarketAccessToken();
  const res = await fetch(cfg.supabaseUrl + '/functions/v1/' + name, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      apikey: cfg.supabaseAnonKey,
    },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('서버 응답을 읽을 수 없습니다.');
  }
  if (!res.ok || !data || data.success !== true) {
    throw new Error((data && data.error) || 'HTTP ' + res.status);
  }
  return data;
}

/**
 * 중고랜드 전용 Supabase 클라이언트 — supabase.auth.setSession()을 쓰지 않는다.
 * mintSupabaseSessionHttp가 발급하는 토큰은 GoTrue가 실제로 추적하는 세션이 아니라 RLS
 * auth.uid() 추출용으로만 서명된 커스텀 JWT라, setSession()을 부르면 내부적으로 GoTrue
 * 자체 세션 검증 엔드포인트(/auth/v1/user)를 호출하는데 거기서 이 session_id를 모르니
 * 403이 나고 결국 "Auth session missing!"으로 이어진다(2026-08 콘솔 스택트레이스로 확인:
 * GoTrueClient._setSession → _getUser → /auth/v1/user 403).
 * 대신 supabase-js의 accessToken 콜백(서드파티 인증용 공식 옵션)으로 토큰을 직접 붙여
 * PostgREST/Storage 요청에만 사용하고 GoTrue 세션 엔드포인트는 아예 건드리지 않는다.
 */
let marketSupabaseClientPromise = null;
let marketTokenCache = { token: null, expiresAtSec: 0, supabaseUserId: null };

async function getFreshMarketAccessToken() {
  const nowSec = Math.floor(Date.now() / 1000);
  if (marketTokenCache.token && marketTokenCache.expiresAtSec > nowSec + 120) {
    return marketTokenCache.token;
  }
  const cfg = (typeof window !== 'undefined' && window.STELVIO_SUPABASE_CONFIG) || {};
  if (!cfg.authBridgeUrl) throw new Error('authBridgeUrl 미설정');
  const idToken = await getFirebaseIdToken();
  const minted = await fetchSupabaseSessionFromBridge(cfg.authBridgeUrl, idToken);
  marketTokenCache = {
    token: minted.access_token,
    expiresAtSec: nowSec + (Number(minted.expires_in) || 3600),
    supabaseUserId: minted.supabase_user_id || null,
  };
  return marketTokenCache.token;
}

function getMarketSupabaseClient() {
  if (!marketSupabaseClientPromise) {
    marketSupabaseClientPromise = (async () => {
      const cfg = (typeof window !== 'undefined' && window.STELVIO_SUPABASE_CONFIG) || {};
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        throw new Error('STELVIO_SUPABASE_CONFIG 미설정');
      }
      const { createClient } = await import(SUPABASE_JS_URL);
      return createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        accessToken: getFreshMarketAccessToken,
      });
    })();
  }
  return marketSupabaseClientPromise;
}

/** 로그인된 Supabase 클라이언트를 반환 — market_items/favorites RLS(user_id=auth.uid()) 전제 */
export async function ensureMarketSupabaseSession() {
  await getFreshMarketAccessToken();
  return getMarketSupabaseClient();
}

/** 현재 로그인 사용자의 Supabase UUID — mintSupabaseSessionHttp 응답에 이미 포함되어 있어
 *  supabase.auth.getUser()/getSession() 없이도 바로 알 수 있다. */
export async function getMySupabaseUserId() {
  await getFreshMarketAccessToken();
  return marketTokenCache.supabaseUserId;
}

/** 네트워크 오류 등 일시적 실패에 대비한 단순 1회 재시도(비-GoTrue 경로라 인증 자체는 안정적). */
async function withMarketAuthRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err || '');
    if (!/auth|jwt|token/i.test(msg)) throw err;
    marketTokenCache = { token: null, expiresAtSec: 0, supabaseUserId: null };
    await getFreshMarketAccessToken();
    return await fn();
  }
}

/**
 * 이미지 리사이즈+압축 — expo-image-manipulator의 웹 등가물(Canvas). 가로 최대 800px, JPEG 0.7.
 * @param {File} file
 * @returns {Promise<Blob>}
 */
export function resizeAndCompressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, MARKET_IMAGE_MAX_WIDTH / img.naturalWidth);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(objectUrl);
            if (!blob) {
              reject(new Error('이미지 압축에 실패했습니다.'));
              return;
            }
            resolve(blob);
          },
          'image/jpeg',
          MARKET_IMAGE_QUALITY
        );
      } catch (e) {
        URL.revokeObjectURL(objectUrl);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('이미지를 불러올 수 없습니다.'));
    };
    img.src = objectUrl;
  });
}

/** 리사이즈된 이미지의 SHA-256 서명 해시 — 동일 이미지 재등록(도배) 감지용 */
export async function hashImageBlob(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 이미 등록된 상품 중 동일 이미지 해시가 있는지 검사 — 있으면 그 상품 정보를 반환 */
export async function findDuplicateImageItem(hash) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { data, error } = await supabase
      .from('market_items')
      .select('id, title, user_id')
      .contains('image_hashes', [hash])
      .limit(1);
    if (error) throw error;
    return data && data.length ? data[0] : null;
  });
}

/**
 * 이미지 업로드 — 리사이즈+해시 계산 후 중복 검사, 통과하면 Storage 업로드.
 * @param {File} file
 * @param {string} userId - Supabase auth.uid()
 * @param {string} itemDraftId - 등록 중인 상품의 임시/실제 id (경로 구분용)
 * @param {number} index
 * @returns {Promise<{url:string, hash:string}>}
 */
export async function processAndUploadMarketImage(file, userId, itemDraftId, index) {
  const blob = await resizeAndCompressImage(file);
  const hash = await hashImageBlob(blob);
  const dup = await findDuplicateImageItem(hash);
  if (dup) {
    const err = new Error('이미 등록된 상품과 동일한 사진입니다. 중복 등록은 제한됩니다.');
    err.code = 'DUPLICATE_IMAGE';
    err.duplicateItem = dup;
    throw err;
  }
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const path = userId + '/' + itemDraftId + '/img' + index + '_' + Date.now() + '.jpg';
    const { error: upErr } = await supabase.storage
      .from(MARKET_IMAGE_BUCKET)
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from(MARKET_IMAGE_BUCKET).getPublicUrl(path);
    return { url: pub.publicUrl, hash };
  });
}

/** PostgREST .or() 필터 문자열에 섞이면 안 되는 문자(%,(),")를 제거 — ILIKE 와일드카드·필터 구문 보호 */
function sanitizeMarketSearchKeyword(raw) {
  return String(raw || '')
    .trim()
    .replace(/[%,()"]/g, '')
    .slice(0, 60);
}

/**
 * 상품 목록 조회 — 최신 등록/끌어올린 순(bumped_at desc), 60개(20줄×3개) 단위 페이지네이션.
 * keyword가 있으면 상품명·상품 설명에 포함된 경우만(대소문자 무관) 조회한다.
 * @param {{category?:string, subCategory?:string, keyword?:string, offset?:number, limit?:number}} opts
 */
export async function listMarketItems(opts) {
  return withMarketAuthRetry(async () => {
    opts = opts || {};
    const supabase = await ensureMarketSupabaseSession();
    const offset = opts.offset || 0;
    const limit = opts.limit || 60;
    let q = supabase
      .from('market_items')
      .select('*')
      .neq('status', 'HIDDEN')
      .order('bumped_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (opts.category) q = q.eq('category', opts.category);
    if (opts.subCategory) q = q.eq('sub_category', opts.subCategory);
    const kw = sanitizeMarketSearchKeyword(opts.keyword);
    if (kw) {
      q = q.or(`title.ilike.%${kw}%,description.ilike.%${kw}%`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  });
}

export async function getMarketItem(id) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { data, error } = await supabase.from('market_items').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  });
}

export async function createMarketItem(item) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const userId = await getMySupabaseUserId();
    if (!userId) throw new Error('Supabase 로그인 세션이 없습니다.');
    const row = Object.assign({}, item, { user_id: userId });
    const { data, error } = await supabase.from('market_items').insert(row).select().single();
    if (error) throw error;
    return data;
  });
}

export async function updateMarketItem(id, patch) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { data, error } = await supabase
      .from('market_items')
      .update(Object.assign({}, patch, { updated_at: new Date().toISOString() }))
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  });
}

export async function deleteMarketItem(id) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { error } = await supabase.from('market_items').delete().eq('id', id);
    if (error) throw error;
  });
}

/** 끌어올리기 — 최근 24시간 이내에 이미 끌어올렸으면 남은 시간을 담아 거절 */
export async function bumpMarketItem(id) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { data: item, error: fetchErr } = await supabase
      .from('market_items')
      .select('bumped_at, user_id')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr || !item) throw new Error('상품을 찾을 수 없습니다.');
    const lastBumpMs = item.bumped_at ? new Date(item.bumped_at).getTime() : 0;
    const elapsed = Date.now() - lastBumpMs;
    if (elapsed < MARKET_BUMP_COOLDOWN_MS) {
      const remainMin = Math.ceil((MARKET_BUMP_COOLDOWN_MS - elapsed) / 60000);
      const err = new Error('끌어올리기는 24시간에 한 번만 가능합니다. (' + Math.ceil(remainMin / 60) + '시간 후 다시 시도)');
      err.code = 'BUMP_COOLDOWN';
      err.remainMs = MARKET_BUMP_COOLDOWN_MS - elapsed;
      throw err;
    }
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('market_items')
      .update({ bumped_at: nowIso, updated_at: nowIso })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  });
}

export async function toggleMarketFavorite(itemId, nextFavorited) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const userId = await getMySupabaseUserId();
    if (!userId) throw new Error('Supabase 로그인 세션이 없습니다.');
    if (nextFavorited) {
      const { error } = await supabase
        .from('market_favorites')
        .upsert({ user_id: userId, item_id: itemId }, { onConflict: 'user_id,item_id' });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('market_favorites')
        .delete()
        .eq('user_id', userId)
        .eq('item_id', itemId);
      if (error) throw error;
    }
  });
}

export async function getMyFavoriteItemIds() {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const userId = await getMySupabaseUserId();
    if (!userId) return new Set();
    const { data, error } = await supabase
      .from('market_favorites')
      .select('item_id')
      .eq('user_id', userId);
    if (error) throw error;
    return new Set((data || []).map((r) => r.item_id));
  });
}

export async function getMyMarketItems() {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const userId = await getMySupabaseUserId();
    if (!userId) return [];
    const { data, error } = await supabase
      .from('market_items')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  });
}

/** 마이페이지 "나의거래내역" — 내가 구매자인 주문을 상품 정보와 함께 조회 */
export async function getMyMarketOrders() {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const userId = await getMySupabaseUserId();
    if (!userId) return [];
    const { data, error } = await supabase
      .from('market_orders')
      .select('*, item:market_items(*)')
      .eq('buyer_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  });
}

/** 구매 요청 — 가상계좌(안전결제) 발급. Cloud Function이 Toss 시크릿 키로 발급을 대행한다.
 *  createMarketOrder/confirmMarketPurchase는 다른 대회 결제 함수와 동일하게 asia-northeast3에 배포됨. */
export async function requestMarketPurchase(itemId) {
  return callMarketFunction('createMarketOrder', { itemId }, 'asia-northeast3');
}

/** 직거래 요청 — 안전결제(Toss 가상계좌) 없이 예약(escrow_status=RESERVED)만 한다. */
export async function requestMarketDirectDeal(itemId) {
  return callMarketFunction('requestMarketDirectDeal', { itemId }, 'asia-northeast3');
}

/** 판매자가 입금완료 주문에 택배사/송장번호를 등록 — 등록과 함께 배송 조회가 시작된다. */
export async function setMarketOrderTracking(orderId, courierCode, trackingNumber) {
  return callMarketEdgeFunction('market-set-tracking', { orderId, courierCode, trackingNumber });
}

/** 구매 확정 — 물품 수령 확인. */
export async function confirmMarketPurchase(orderId) {
  return callMarketFunction('confirmMarketPurchase', { orderId }, 'asia-northeast3');
}

/** 입금 전(PENDING) 주문 자기 취소 — Toss 호출 없이 즉시 처리됨. */
export async function cancelMarketOrder(orderId) {
  return callMarketFunction('cancelMarketOrder', { orderId }, 'asia-northeast3');
}

/** 입금 완료(PAID, 구매확정 전) 주문 환불 요청 — 본인 명의 환불 계좌 필요. */
export async function requestMarketOrderRefund(orderId, refundAccount) {
  return callMarketFunction('requestMarketOrderRefund', { orderId, refundAccount }, 'asia-northeast3');
}

export async function getMarketOrderForItem(itemId) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const userId = await getMySupabaseUserId();
    if (!userId) return null;
    const { data, error } = await supabase
      .from('market_orders')
      .select('*')
      .eq('item_id', itemId)
      .eq('buyer_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  });
}

/** 조회수 증가 — RLS를 우회하는 SECURITY DEFINER RPC. 실패해도 상세 화면 표시에 영향 없어야 하므로
 *  호출부에서 결과를 기다리지 않고 흘려보내는 형태로 쓴다(fire-and-forget). */
export async function incrementMarketItemView(itemId) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { error } = await supabase.rpc('increment_market_item_view', { p_item_id: itemId });
    if (error) throw error;
  });
}

/** 관심상품(하트) 클릭 수 — market_favorites 건수를 그대로 카운트(별도 카운터 불필요) */
export async function getMarketFavoriteCount(itemId) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { count, error } = await supabase
      .from('market_favorites')
      .select('*', { count: 'exact', head: true })
      .eq('item_id', itemId);
    if (error) throw error;
    return count || 0;
  });
}

/** 판매자 공개 프로필(v_user_public_profile) — RLS상 users 테이블은 본인 것만 보이므로 반드시
 *  이 공개 뷰를 통해서만 다른 사용자(판매자)의 이름·프로필 사진을 읽을 수 있다. */
/** v_user_public_profile.display_name은 비공개(is_private) 사용자를 '비공개' 문자열로
 * 마스킹해서 내려준다(랭킹보드 등 공통 정책). 중고랜드는 실거래 상대를 식별해야 하므로,
 * 정당한 거래 관계에 한해 실명을 조회하는 get_market_display_name으로 덮어쓴다. */
export async function getSellerPublicProfile(sellerId) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { data, error } = await supabase
      .from('v_user_public_profile')
      .select('id, display_name, profile_image_url, is_private')
      .eq('id', sellerId)
      .maybeSingle();
    if (error) throw error;
    if (data && data.is_private) {
      const { data: realName } = await supabase.rpc('get_market_display_name', { p_user_id: sellerId });
      if (realName) data.display_name = realName;
    }
    return data;
  });
}

/** 판매자 연락처(전화번호) — 실제 상품을 등록한 판매자에 한해 서버 함수(get_market_seller_contact)로만 노출 */
export async function getSellerPhone(sellerId) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { data, error } = await supabase.rpc('get_market_seller_contact', { p_seller_id: sellerId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row && row.phone ? row.phone : '';
  });
}

/** 구매자 연락처(전화번호) — 입금 확인(PAID) 이후 그 주문의 판매자에 한해서만 노출 */
export async function getBuyerPhone(buyerId) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { data, error } = await supabase.rpc('get_market_buyer_contact', { p_buyer_id: buyerId });
    if (error) throw error;
    return data || '';
  });
}

/** 판매자 상세화면 "거래내역" — 해당 상품의 전체 주문(RLS가 알아서 범위를 좁혀준다:
 * 판매자는 전체, 구매자는 본인 주문만) */
export async function getMarketOrdersForItem(itemId) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { data, error } = await supabase
      .from('market_orders')
      .select('*')
      .eq('item_id', itemId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  });
}

/** 가격 네고 제안 — 재제안 시 서버에서 upsert(status는 항상 PENDING으로 리셋) */
export async function submitMarketNegoRequest(itemId, price) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { error } = await supabase.rpc('submit_market_nego_request', { p_item_id: itemId, p_price: price });
    if (error) throw error;
  });
}

/** 판매자의 수락/거절 결정 — 본인 상품에 들어온 PENDING 제안만 가능(서버에서 검증) */
export async function decideMarketNegoRequest(requestId, accept) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { error } = await supabase.rpc('decide_market_nego_request', { p_request_id: requestId, p_accept: accept });
    if (error) throw error;
  });
}

/** 상품에 대한 네고 제안 목록 — RLS가 알아서 범위를 좁혀준다(판매자: 전체, 구매자: 본인 제안만) */
export async function getMarketNegoRequestsForItem(itemId) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { data, error } = await supabase
      .from('market_nego_requests')
      .select('*')
      .eq('item_id', itemId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  });
}

/** 판매자 만족도 평균 — 제휴사와 동일하게 2점 이상만 집계에 포함(1점·미평가 제외) */
export async function getSellerRatingAggregate(sellerId) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { data, error } = await supabase
      .from('market_seller_ratings')
      .select('score')
      .eq('seller_id', sellerId)
      .gte('score', 2);
    if (error) throw error;
    const rows = data || [];
    const count = rows.length;
    const sum = rows.reduce((acc, r) => acc + (Number(r.score) || 0), 0);
    return { avg: count > 0 ? sum / count : 0, count };
  });
}

export async function getMyRatingForOrder(orderId) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { data, error } = await supabase
      .from('market_seller_ratings')
      .select('score')
      .eq('order_id', orderId)
      .maybeSingle();
    if (error) throw error;
    return data ? Number(data.score) || 0 : 0;
  });
}

/** 구매확정된 주문 1건당 판매자 평가 등록/수정 — 같은 별 재클릭 시 clearSellerRating으로 초기화 */
export async function submitSellerRating(orderId, sellerId, score) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const buyerId = await getMySupabaseUserId();
    if (!buyerId) throw new Error('로그인이 필요합니다.');
    const { error } = await supabase
      .from('market_seller_ratings')
      .upsert(
        { order_id: orderId, seller_id: sellerId, buyer_id: buyerId, score, updated_at: new Date().toISOString() },
        { onConflict: 'order_id' }
      );
    if (error) throw error;
  });
}

export async function clearSellerRating(orderId) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { error } = await supabase.from('market_seller_ratings').delete().eq('order_id', orderId);
    if (error) throw error;
  });
}

if (typeof window !== 'undefined') {
  window.marketService = {
    ensureMarketSupabaseSession,
    resizeAndCompressImage,
    hashImageBlob,
    findDuplicateImageItem,
    processAndUploadMarketImage,
    listMarketItems,
    getMarketItem,
    createMarketItem,
    updateMarketItem,
    deleteMarketItem,
    bumpMarketItem,
    toggleMarketFavorite,
    getMyFavoriteItemIds,
    getMySupabaseUserId,
    getMyMarketItems,
    getMyMarketOrders,
    requestMarketPurchase,
    requestMarketDirectDeal,
    setMarketOrderTracking,
    confirmMarketPurchase,
    cancelMarketOrder,
    requestMarketOrderRefund,
    getMarketOrderForItem,
    getMarketOrdersForItem,
    incrementMarketItemView,
    getMarketFavoriteCount,
    getSellerPublicProfile,
    getSellerPhone,
    getBuyerPhone,
    submitMarketNegoRequest,
    decideMarketNegoRequest,
    getMarketNegoRequestsForItem,
    getSellerRatingAggregate,
    getMyRatingForOrder,
    submitSellerRating,
    clearSellerRating,
  };
}

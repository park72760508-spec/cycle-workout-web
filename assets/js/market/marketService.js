/**
 * 중고랜드(Market Land) — Supabase 데이터 계층 + 이미지 최적화/중복검사 + Toss 안전결제 연동.
 * market_items/market_favorites는 Supabase RLS(auth.uid())로 직접 read/write, 결제(가상계좌
 * 발급·구매확정)는 Toss 시크릿 키가 필요해 Cloud Functions를 거친다.
 */
import { getSupabaseClient, syncSupabaseSessionFromBridge } from '../supabaseDualWrite.js';

const MARKET_IMAGE_MAX_WIDTH = 800;
const MARKET_IMAGE_QUALITY = 0.7;
const MARKET_IMAGE_BUCKET = 'market-images';
const MARKET_BUMP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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

/** 로그인된 Supabase 세션이 붙은 클라이언트를 반환 — market_items/favorites RLS(user_id=auth.uid()) 전제 */
export async function ensureMarketSupabaseSession() {
  await syncSupabaseSessionFromBridge();
  return getSupabaseClient();
}

function isAuthSessionMissingError(err) {
  const msg = err && err.message ? String(err.message) : String(err || '');
  return /auth session missing/i.test(msg) || (err && err.name === 'AuthSessionMissingError');
}

/**
 * 커스텀 JWT 브리지 특성상 세션이 예기치 않게 사라지는 경우가 있어("Auth session missing!"),
 * 그 경우에만 세션을 강제로 다시 발급받고 한 번 재시도한다. 다른 종류의 오류는 그대로 던진다.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withMarketAuthRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!isAuthSessionMissingError(err)) throw err;
    await syncSupabaseSessionFromBridge();
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

/**
 * 상품 목록 조회 — 최신 등록/끌어올린 순(bumped_at desc), 60개(20줄×3개) 단위 페이지네이션.
 * @param {{category?:string, subCategory?:string, offset?:number, limit?:number}} opts
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
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session || !sess.session.user) throw new Error('Supabase 로그인 세션이 없습니다.');
    const row = Object.assign({}, item, { user_id: sess.session.user.id });
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
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session || !sess.session.user) throw new Error('Supabase 로그인 세션이 없습니다.');
    const userId = sess.session.user.id;
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
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session || !sess.session.user) return new Set();
    const { data, error } = await supabase
      .from('market_favorites')
      .select('item_id')
      .eq('user_id', sess.session.user.id);
    if (error) throw error;
    return new Set((data || []).map((r) => r.item_id));
  });
}

export async function getMySupabaseUserId() {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { data: sess } = await supabase.auth.getSession();
    return sess.session && sess.session.user ? sess.session.user.id : null;
  });
}

export async function getMyMarketItems() {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session || !sess.session.user) return [];
    const { data, error } = await supabase
      .from('market_items')
      .select('*')
      .eq('user_id', sess.session.user.id)
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

/** 구매 확정 — 물품 수령 확인. */
export async function confirmMarketPurchase(orderId) {
  return callMarketFunction('confirmMarketPurchase', { orderId }, 'asia-northeast3');
}

export async function getMarketOrderForItem(itemId) {
  return withMarketAuthRetry(async () => {
    const supabase = await ensureMarketSupabaseSession();
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session || !sess.session.user) return null;
    const { data, error } = await supabase
      .from('market_orders')
      .select('*')
      .eq('item_id', itemId)
      .eq('buyer_id', sess.session.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
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
    requestMarketPurchase,
    confirmMarketPurchase,
    getMarketOrderForItem,
  };
}

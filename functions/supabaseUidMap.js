/**
 * Supabase users(id, firebase_uid) → UUID↔Firebase UID 역매핑.
 * Firestore `users.select().get()` 전체 스캔( PageSize 300 ) 대체.
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

const UUID_MAP_TTL_MS = 5 * 60 * 1000;
const SUPABASE_PAGE_SIZE = 1000;

/** @type {{ map: Map<string, string>|null, loadedAt: number, source: string|null }} */
let cache = { map: null, loadedAt: 0, source: null };

function parseBool(raw) {
  if (raw === true || raw === 1) return true;
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/**
 * @returns {Promise<Map<string, string>>} lowercase uuid → firebase uid
 */
async function loadUuidToFirebaseMapFromSupabase() {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return new Map();

  const map = new Map();
  let from = 0;
  for (let page = 0; page < 100; page += 1) {
    /* eslint-disable no-await-in-loop */
    const { data, error } = await supabase
      .from("users")
      .select("id, firebase_uid")
      .not("firebase_uid", "is", null)
      .order("id", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    /* eslint-enable no-await-in-loop */
    if (error) throw error;

    for (const row of data || []) {
      const uuid = String(row.id || "").trim().toLowerCase();
      const fbUid = String(row.firebase_uid || "").trim();
      if (uuid && fbUid) map.set(uuid, fbUid);
    }

    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return map;
}

/**
 * @param {import('firebase-admin')} admin
 * @returns {Promise<Map<string, string>>}
 */
async function loadUuidToFirebaseMapFromFirestore(admin) {
  const map = new Map();
  if (!admin || !admin.firestore) return map;

  const { v5: uuidv5 } = require("uuid");
  const cfg = {
    uidNamespace: supabaseDualWriteServer.uidNamespaceParam.value(),
    uidMode:
      supabaseDualWriteServer.uidModeParam.value() === "literal" ? "literal" : "v5",
  };

  const snap = await admin.firestore().collection("users").select().get();
  snap.docs.forEach((doc) => {
    const fbUid = doc.id;
    let uuid;
    if (cfg.uidMode === "literal" || /^[0-9a-f-]{36}$/i.test(fbUid)) {
      uuid = fbUid.toLowerCase();
    } else {
      uuid = uuidv5(fbUid, cfg.uidNamespace);
    }
    map.set(uuid, fbUid);
  });
  return map;
}

/**
 * @param {import('firebase-admin')} admin
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<Map<string, string>>}
 */
async function getUuidToFirebaseUidMap(admin, options = {}) {
  const now = Date.now();
  const forceRefresh = options.forceRefresh === true;
  if (!forceRefresh && cache.map && now - cache.loadedAt < UUID_MAP_TTL_MS) {
    return cache.map;
  }

  const forceFirestore = parseBool(process.env.SUPABASE_UID_MAP_FORCE_FIRESTORE);
  const allowFirestoreFallback = parseBool(process.env.SUPABASE_UID_MAP_FIRESTORE_FALLBACK);

  if (!forceFirestore) {
    try {
      const fromSupabase = await loadUuidToFirebaseMapFromSupabase();
      if (fromSupabase.size > 0) {
        cache = { map: fromSupabase, loadedAt: now, source: "supabase" };
        return fromSupabase;
      }
      console.warn("[supabaseUidMap] Supabase users.firebase_uid map empty");
    } catch (err) {
      console.warn(
        "[supabaseUidMap] Supabase map load failed:",
        err && err.message ? err.message : err
      );
    }
  }

  if (allowFirestoreFallback || forceFirestore) {
    const fromFirestore = await loadUuidToFirebaseMapFromFirestore(admin);
    cache = { map: fromFirestore, loadedAt: now, source: "firestore" };
    return fromFirestore;
  }

  return cache.map || new Map();
}

function resetUuidToFirebaseUidMapCache() {
  cache = { map: null, loadedAt: 0, source: null };
}

function getUuidMapCacheMeta() {
  return {
    size: cache.map ? cache.map.size : 0,
    loadedAt: cache.loadedAt,
    source: cache.source,
  };
}

module.exports = {
  getUuidToFirebaseUidMap,
  resetUuidToFirebaseUidMapCache,
  getUuidMapCacheMeta,
  UUID_MAP_TTL_MS,
};

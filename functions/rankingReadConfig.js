/**
 * 랭킹 **Read** Canary — Supabase MV vs Firebase ranking_aggregates (쓰기 ingest 와 분리).
 *
 * Strava/훈련 Dual-Write는 전 사용자(supabaseDualWriteServer.evaluateSecondaryIngestWrite).
 * 여기서만 화이트리스트·글로벌 스위치로 “어느 DB 랭킹을 보여줄지” 결정.
 *
 * 우선순위: Firestore appConfig/supabase_read_routing > 환경변수
 *   - useSupabaseGlobal / USE_SUPABASE_GLOBAL
 *   - whitelistUids / SUPABASE_WHITELIST_UIDS (쉼표·JSON 배열)
 */
const FIRESTORE_DOC_PATH = { collection: "appConfig", doc: "supabase_read_routing" };

/** @type {{ useSupabaseGlobal: boolean, whitelistUids: string[], loadedAt: number }} */
let cache = {
  useSupabaseGlobal: false,
  whitelistUids: [],
  parityFallbackToFirebase: true,
  loadedAt: 0,
};

const CACHE_MS = 60 * 1000;

function parseBool(raw) {
  if (raw === true || raw === 1) return true;
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function parseUidList(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean);
  }
  const trimmed = String(raw).trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch (_) {
      /* comma */
    }
  }
  return trimmed
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadFromEnv() {
  return {
    useSupabaseGlobal: parseBool(process.env.USE_SUPABASE_GLOBAL),
    whitelistUids: parseUidList(process.env.SUPABASE_WHITELIST_UIDS),
  };
}

/**
 * @param {import('firebase-admin')} admin
 */
async function refreshRankingReadConfig(admin, force = false) {
  const now = Date.now();
  if (!force && now - cache.loadedAt < CACHE_MS) {
    return getRankingReadConfig();
  }

  let useSupabaseGlobal = false;
  let whitelistUids = [];
  let parityFallbackToFirebase = true;

  const envCfg = loadFromEnv();
  useSupabaseGlobal = envCfg.useSupabaseGlobal;
  whitelistUids = envCfg.whitelistUids.slice();

  if (admin && admin.firestore) {
    try {
      const snap = await admin
        .firestore()
        .collection(FIRESTORE_DOC_PATH.collection)
        .doc(FIRESTORE_DOC_PATH.doc)
        .get();
      if (snap.exists) {
        const d = snap.data() || {};
        if (d.useSupabaseGlobal != null) {
          useSupabaseGlobal = parseBool(d.useSupabaseGlobal);
        }
        if (d.whitelistUids != null) {
          whitelistUids = parseUidList(d.whitelistUids);
        } else if (d.SUPABASE_WHITELIST_UIDS != null) {
          whitelistUids = parseUidList(d.SUPABASE_WHITELIST_UIDS);
        }
        if (d.parityFallbackToFirebase != null) {
          parityFallbackToFirebase = parseParityFallback(d.parityFallbackToFirebase);
        }
      }
    } catch (err) {
      console.warn("[rankingReadConfig] Firestore load failed:", err.message);
    }
  }

  if (process.env.RANKING_PARITY_FALLBACK === "false") {
    parityFallbackToFirebase = false;
  }

  cache = {
    useSupabaseGlobal,
    whitelistUids,
    parityFallbackToFirebase,
    loadedAt: now,
  };
  return getRankingReadConfig();
}

function getRankingReadConfig() {
  return {
    useSupabaseGlobal: cache.useSupabaseGlobal,
    whitelistUids: cache.whitelistUids.slice(),
    /** true: Supabase·Firebase 불일치 시 Firebase 응답으로 폴백(화면 동일) */
    parityFallbackToFirebase: cache.parityFallbackToFirebase !== false,
  };
}

function parseParityFallback(raw) {
  if (raw === false || raw === 0) return false;
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "false" || s === "0" || s === "off") return false;
  return true;
}

/**
 * @param {import('firebase-admin')} admin
 * @param {string|null|undefined} requestFirebaseUid API 요청 사용자 Firebase UID
 */
async function shouldReadRankingFromSupabase(admin, requestFirebaseUid) {
  await refreshRankingReadConfig(admin, false);
  if (cache.useSupabaseGlobal) {
    return { route: "supabase", reason: "USE_SUPABASE_GLOBAL=true" };
  }
  const uid = String(requestFirebaseUid || "").trim();
  if (uid && cache.whitelistUids.includes(uid)) {
    return { route: "supabase", reason: "uid in SUPABASE_WHITELIST_UIDS" };
  }
  return { route: "firebase", reason: "default firebase primary read" };
}

module.exports = {
  refreshRankingReadConfig,
  getRankingReadConfig,
  shouldReadRankingFromSupabase,
  parseUidList,
};

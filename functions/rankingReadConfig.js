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
  useSupabaseGlobal: true,
  whitelistUids: [],
  /** Supabase Read 기본: parity 불일치 시 Firebase 전체 집계 폴백 금지(트래픽 폭주 방지) */
  parityFallbackToFirebase: false,
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

  /** Firestore 문서 없을 때 기본 Supabase Read (관리자가 Firebase로 명시 전환 시에만 false) */
  let useSupabaseGlobal = true;
  let whitelistUids = [];
  let parityFallbackToFirebase = false;

  const envCfg = loadFromEnv();
  if (process.env.USE_SUPABASE_GLOBAL != null && String(process.env.USE_SUPABASE_GLOBAL).trim() !== "") {
    useSupabaseGlobal = envCfg.useSupabaseGlobal;
  }
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
        } else if (useSupabaseGlobal) {
          parityFallbackToFirebase = false;
        }
      }
    } catch (err) {
      console.warn("[rankingReadConfig] Firestore load failed:", err.message);
    }
  }

  if (process.env.RANKING_PARITY_FALLBACK === "true") {
    parityFallbackToFirebase = true;
  } else if (process.env.RANKING_PARITY_FALLBACK === "false") {
    parityFallbackToFirebase = false;
  }

  /** Supabase 전용 Read(cutover) 시 Firestore parity=true 여도 Firebase 대량 폴백·500 방지 */
  if (useSupabaseGlobal && !safeIsFirebaseRankingReadAllowed()) {
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
    /** true: 긴급 Canary 시에만 — 기본 false(Supabase Read 시 Firebase ranking_aggregates·집계 스캔 금지) */
    parityFallbackToFirebase: cache.parityFallbackToFirebase === true,
  };
}

function parseParityFallback(raw) {
  if (raw === false || raw === 0) return false;
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "false" || s === "0" || s === "off") return false;
  return true;
}

/** 이관 완료 후 Firebase 랭킹 Read·집계 HTTP 폴백 — 긴급 복구 시에만 true */
function isFirebaseRankingReadAllowed() {
  return parseBool(process.env.RANKING_READ_FORCE_FIREBASE) === true;
}

/** 배포 버전 불일치·구버전 rankingReadConfig 대비 */
function safeIsFirebaseRankingReadAllowed() {
  if (typeof isFirebaseRankingReadAllowed === "function") {
    return isFirebaseRankingReadAllowed();
  }
  return false;
}

/**
 * @param {import('firebase-admin')} admin
 * @param {string|null|undefined} requestFirebaseUid API 요청 사용자 Firebase UID
 */
async function shouldReadRankingFromSupabase(admin, requestFirebaseUid) {
  await refreshRankingReadConfig(admin, false);
  if (!safeIsFirebaseRankingReadAllowed()) {
    return { route: "supabase", reason: "ranking_read_supabase_only(cutover)" };
  }
  if (cache.useSupabaseGlobal) {
    return { route: "supabase", reason: "USE_SUPABASE_GLOBAL=true" };
  }
  const uid = String(requestFirebaseUid || "").trim();
  if (uid && cache.whitelistUids.includes(uid)) {
    return { route: "supabase", reason: "uid in SUPABASE_WHITELIST_UIDS" };
  }
  return { route: "firebase", reason: "supabase_read_routing useSupabaseGlobal=false" };
}

/**
 * 관리자 UI — appConfig/supabase_read_routing 갱신 (랭킹·집계 Read DB 전환).
 * @param {import('firebase-admin')} admin
 * @param {{ useSupabaseGlobal: boolean, parityFallbackToFirebase?: boolean, updatedBy?: string }} patch
 */
async function persistRankingReadRouting(admin, patch) {
  if (!admin || !admin.firestore) {
    throw new Error("Firestore admin required");
  }
  const ref = admin
    .firestore()
    .collection(FIRESTORE_DOC_PATH.collection)
    .doc(FIRESTORE_DOC_PATH.doc);

  const payload = {
    useSupabaseGlobal: !!patch.useSupabaseGlobal,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (patch.updatedBy) {
    payload.updatedBy = String(patch.updatedBy).trim();
  }
  if (patch.parityFallbackToFirebase != null) {
    payload.parityFallbackToFirebase = !!patch.parityFallbackToFirebase;
  } else if (patch.useSupabaseGlobal) {
    payload.parityFallbackToFirebase = false;
  }

  await ref.set(payload, { merge: true });
  cache.loadedAt = 0;
  return refreshRankingReadConfig(admin, true);
}

/**
 * @param {import('firebase-admin')} admin
 */
async function getRankingReadRoutingDocMeta(admin) {
  if (!admin || !admin.firestore) {
    return { updatedAt: null, updatedBy: null };
  }
  try {
    const snap = await admin
      .firestore()
      .collection(FIRESTORE_DOC_PATH.collection)
      .doc(FIRESTORE_DOC_PATH.doc)
      .get();
    if (!snap.exists) return { updatedAt: null, updatedBy: null };
    const d = snap.data() || {};
    const ts = d.updatedAt;
    let updatedAt = null;
    if (ts && typeof ts.toDate === "function") {
      updatedAt = ts.toDate().toISOString();
    } else if (typeof ts === "string") {
      updatedAt = ts;
    }
    return {
      updatedAt,
      updatedBy: d.updatedBy ? String(d.updatedBy) : null,
    };
  } catch (_) {
    return { updatedAt: null, updatedBy: null };
  }
}

function buildReadRoutingStatus(cfg, meta) {
  const useSupabaseGlobal = !!cfg.useSupabaseGlobal;
  return {
    readSource: useSupabaseGlobal ? "supabase" : "firebase",
    useSupabaseGlobal,
    parityFallbackToFirebase: cfg.parityFallbackToFirebase === true,
    whitelistCount: Array.isArray(cfg.whitelistUids) ? cfg.whitelistUids.length : 0,
    updatedAt: meta.updatedAt,
    updatedBy: meta.updatedBy,
  };
}

module.exports = {
  refreshRankingReadConfig,
  getRankingReadConfig,
  shouldReadRankingFromSupabase,
  isFirebaseRankingReadAllowed,
  safeIsFirebaseRankingReadAllowed,
  parseUidList,
  persistRankingReadRouting,
  getRankingReadRoutingDocMeta,
  buildReadRoutingStatus,
  FIRESTORE_DOC_PATH,
};

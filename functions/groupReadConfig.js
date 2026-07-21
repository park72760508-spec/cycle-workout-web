/**
 * 라이딩 모임 **Read** Canary — Supabase vs Firebase (쓰기 Dual-Write ingest 와 분리).
 *
 * 우선순위: Firestore appConfig/supabase_groups_read_routing > 환경변수
 *   - useSupabaseGlobal / USE_SUPABASE_GLOBAL
 *   - whitelistUids / SUPABASE_WHITELIST_UIDS
 */
const FIRESTORE_DOC_PATH = {
  collection: "appConfig",
  doc: "supabase_groups_read_routing",
};
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

/** appConfig 문서를 Supabase app_config 미러에서 읽는다(우선 경로). 실패 시 null. */
async function loadAppConfigDocFromSupabase(configKey) {
  try {
    const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("app_config")
      .select("data")
      .eq("config_key", configKey)
      .maybeSingle();
    if (error) throw error;
    return data ? data.data || {} : null;
  } catch (err) {
    console.warn("[groupReadConfig] Supabase app_config 조회 실패, Firestore 폴백:", err && err.message ? err.message : err);
    return null;
  }
}

/** @type {{ useSupabaseGlobal: boolean, whitelistUids: string[], parityFallbackToFirebase: boolean, loadedAt: number }} */
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

async function refreshGroupReadConfig(admin, force = false) {
  const now = Date.now();
  if (!force && now - cache.loadedAt < CACHE_MS) {
    return getGroupReadConfig();
  }

  let useSupabaseGlobal = false;
  let whitelistUids = [];
  let parityFallbackToFirebase = true;

  const envCfg = loadFromEnv();
  useSupabaseGlobal = envCfg.useSupabaseGlobal;
  whitelistUids = envCfg.whitelistUids.slice();

  function applyRoutingDoc(d) {
    if (d.useSupabaseGlobal != null) {
      useSupabaseGlobal = parseBool(d.useSupabaseGlobal);
    }
    if (d.whitelistUids != null) {
      whitelistUids = parseUidList(d.whitelistUids);
    }
    if (d.parityFallbackToFirebase != null) {
      parityFallbackToFirebase = parseBool(d.parityFallbackToFirebase);
    }
  }

  const supabaseDoc = await loadAppConfigDocFromSupabase(FIRESTORE_DOC_PATH.doc);
  if (supabaseDoc) {
    applyRoutingDoc(supabaseDoc);
  } else if (admin && admin.firestore) {
    try {
      const snap = await admin
        .firestore()
        .collection(FIRESTORE_DOC_PATH.collection)
        .doc(FIRESTORE_DOC_PATH.doc)
        .get();
      if (snap.exists) {
        applyRoutingDoc(snap.data() || {});
      }
    } catch (err) {
      console.warn("[groupReadConfig] Firestore load failed, env fallback:", err.message);
    }
  }

  cache = {
    useSupabaseGlobal,
    whitelistUids,
    parityFallbackToFirebase,
    loadedAt: now,
  };
  return getGroupReadConfig();
}

function getGroupReadConfig() {
  return { ...cache };
}

/**
 * @param {import('firebase-admin')} admin
 * @param {string|null|undefined} uid Firebase UID
 */
async function shouldReadGroupsFromSupabase(admin, uid) {
  await refreshGroupReadConfig(admin);
  const cfg = getGroupReadConfig();
  const key = String(uid || "").trim();

  if (cfg.useSupabaseGlobal) {
    return { route: "supabase", reason: "useSupabaseGlobal" };
  }
  if (key && cfg.whitelistUids.includes(key)) {
    return { route: "supabase", reason: "whitelist" };
  }
  return { route: "firebase", reason: "default_firebase" };
}

module.exports = {
  refreshGroupReadConfig,
  getGroupReadConfig,
  shouldReadGroupsFromSupabase,
  FIRESTORE_DOC_PATH,
};

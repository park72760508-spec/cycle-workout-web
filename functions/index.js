/**
 * 관리자 비밀번호 초기화 Callable Function (v2)
 * Strava 토큰 교환/갱신 Callable (v2) - Client Secret은 서버에서만 사용
 * Strava 전날 갭 탐지 동기화 스케줄 함수 (Firebase 기반, 매일 00:10 Asia/Seoul)
 */
const { onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
/** v1 전용(runWith · firestore.document). v7 패키지 루트는 v2라 runWith 미제공 → /v1 필요 */
const functions = require("firebase-functions/v1");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

// Secret Manager에서 STRAVA_CLIENT_SECRET 읽기
// 임시: Secret 설정 문제로 인해 하드코딩된 값 사용 (보안상 권장하지 않음, 나중에 Secret으로 변경 필요)
const STRAVA_CLIENT_SECRET_VALUE = "6cd67a28f1c516c0f004f1c7f97f4d74be187d85";

// Secret 사용 시도 (실패하면 하드코딩된 값 사용)
let STRAVA_CLIENT_SECRET;
try {
  STRAVA_CLIENT_SECRET = defineSecret("STRAVA_CLIENT_SECRET");
} catch (e) {
  console.warn("[Functions] Secret 정의 실패, 하드코딩된 값 사용:", e.message);
  STRAVA_CLIENT_SECRET = null; // Secret 없음
}

/** 알리고 카카오 API — Secret Manager. 이 키를 읽으려면 각 함수 옵션에 `secrets`로 연결해야 함 (v2). */
const aligoApiKeySecret = defineSecret("ALIGO_API_KEY");
const aligoUserIdSecret = defineSecret("ALIGO_USER_ID");
const aligoTokenSecret = defineSecret("ALIGO_TOKEN");

if (!admin.apps.length) {
  admin.initializeApp();
}

const rankingDayRollup = require("./rankingDayRollup");
const { sanitizePeakPowerWattsOnRow } = require("./peakPowerMonotonic");
const peakBoardFast = require("./peakBoardFast");
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const stravaDualWrite = require("./stravaDualWrite");
const stravaRouteMerge = require("./stravaRouteMerge");
const stravaSyncRetry = require("./stravaSyncRetry");
const stravaGapDetect = require("./stravaGapDetect");
const stravaLogRead = require("./stravaLogRead");
const rankingReadRouter = require("./rankingReadRouter");
const rankingReadConfig = require("./rankingReadConfig");
const supabaseRankingReader = require("./supabaseRankingReader");
const rankingParity = require("./rankingParity");
const rankingReadRoutingAdmin = require("./rankingReadRoutingAdmin");
const rankingReadRoutingPublic = require("./rankingReadRoutingPublic");
const groupReadRouter = require("./groupReadRouter");
const supabaseGroupReader = require("./supabaseGroupReader");
const groupReadRoutingPublic = require("./groupReadRoutingPublic");
const logsReadRoutingPublic = require("./logsReadRoutingPublic");
const groupDualWriteTriggers = require("./groupDualWriteTriggers");
const supabaseGroupDualWrite = require("./supabaseGroupDualWriteServer");
const weeklyTssRankingBuilder = require("./weeklyTssRankingBuilder");

/** Firestore users 문서의 프로필 사진 URL (랭킹·클라이언트 표시용, 없으면 null) */
function profileImageUrlFromUserData(data) {
  if (!data || typeof data !== "object") return null;
  const v = data.profileImageUrl;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** 탈퇴(비활성) 사용자 — 랭킹·집계·프로필 노출 제외 (데이터는 보존) */
function isRankingEligibleUserData(data) {
  if (!data || typeof data !== "object") return false;
  if (data.is_active === false) return false;
  const accountStatus = String(data.account_status || "").trim().toLowerCase();
  if (accountStatus === "withdrawn" || accountStatus === "suspended" || accountStatus === "inactive" || accountStatus === "deleted") {
    return false;
  }
  const legacyStatus = String(data.status || "").trim().toLowerCase();
  if (legacyStatus === "withdrawn" || legacyStatus === "inactive" || legacyStatus === "deleted") {
    return false;
  }
  return true;
}

function filterRankingEligibleUserDocs(docs) {
  return (docs || []).filter((d) => isRankingEligibleUserData(d.data()));
}

/** API 응답·집계에서 탈퇴 사용자 행 제거 후 순위 재부여 */
function filterWithdrawnUsersFromRankingPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const cats = ["Supremo", "Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda"];
  if (payload.byCategory && typeof payload.byCategory === "object") {
    const nextCat = {};
    for (const cat of cats) {
      const rows = Array.isArray(payload.byCategory[cat]) ? payload.byCategory[cat] : [];
      const kept = rows.filter((r) => r && isRankingEligibleUserData(r) && r.isWithdrawn !== true);
      nextCat[cat] = kept.map((r, i) => ({ ...r, rank: i + 1 }));
    }
    payload.byCategory = nextCat;
  }
  const filterEntries = (arr) => {
    if (!Array.isArray(arr)) return arr;
    const kept = arr.filter((r) => r && isRankingEligibleUserData(r) && r.isWithdrawn !== true);
    return kept.map((r, i) => ({ ...r, rank: i + 1 }));
  };
  if (Array.isArray(payload.entries)) payload.entries = filterEntries(payload.entries);
  if (Array.isArray(payload.ranking)) payload.ranking = filterEntries(payload.ranking);
  if (Array.isArray(payload.fullEntries)) payload.fullEntries = filterEntries(payload.fullEntries);
  if (payload.myRankSupremo && !isRankingEligibleUserData(payload.myRankSupremo)) {
    payload.myRankSupremo = null;
  }
  if (payload.currentUser && !isRankingEligibleUserData(payload.currentUser)) {
    payload.currentUser = null;
  }
  try {
    const peakMovement = require("./rankingPeakMovement");
    if (typeof peakMovement.recomputePeakRankMovementAfterEligibleFilter === "function") {
      peakMovement.recomputePeakRankMovementAfterEligibleFilter(payload);
    }
    if (String(payload.durationType || "").trim() === "tss") {
      try {
        const peakSupabase = require("./rankingPeakMovementSupabase");
        if (typeof peakSupabase.syncEntriesRankMovementFromSupremo === "function") {
          peakSupabase.syncEntriesRankMovementFromSupremo(payload);
        }
      } catch (eTssSync) {
        console.warn(
          "[filterWithdrawnUsersFromRankingPayload] TSS entries rank sync skipped:",
          eTssSync && eTssSync.message ? eTssSync.message : eTssSync
        );
      }
    }
  } catch (eReMv) {
    console.warn(
      "[filterWithdrawnUsersFromRankingPayload] rank movement recompute skipped:",
      eReMv && eReMv.message ? eReMv.message : eReMv
    );
  }
  return payload;
}

/** 랭킹 응답·집계 행에 탈퇴 여부 전달 (클라이언트에서 일반/관리자 분기) */
function rankingUserStatusFieldsFromData(data) {
  const withdrawn = !isRankingEligibleUserData(data);
  const accountStatus = withdrawn
    ? "withdrawn"
    : (String(data.account_status || "active").trim() || "active");
  return { account_status: accountStatus, isWithdrawn: withdrawn };
}

function weeklyTop10RowFromEntry(e, index) {
  return {
    rank: index + 1,
    userId: e.userId,
    name: e.name,
    totalTss: Math.round(e.totalTss * 100) / 100,
    is_private: e.is_private === true,
    account_status: e.account_status || "active",
    isWithdrawn: e.isWithdrawn === true,
    rankChange: e.rankChange,
    previousBoardRank: e.previousBoardRank,
  };
}

/** uid 목록으로 users 문서 배치 조회 → profileImageUrl 맵 (랭킹 스냅샷·집계 행 보강용) */
async function fetchProfileImageUrlsMapForUsers(db, userIds) {
  const urlById = new Map();
  const unique = [...new Set((userIds || []).map((x) => String(x).trim()).filter(Boolean))];
  /** Firestore getAll은 한 번에 최대 10문서 — RTT·연결 수를 줄이기 위해 10묶음 병렬 여러 개 */
  const CHUNK = 10;
  const PARALLEL_GROUPS = Math.min(
    Math.max(1, Number(process.env.RANK_PROFILE_IMAGE_GETALL_PARALLEL) || 6),
    12
  );
  for (let i = 0; i < unique.length; i += CHUNK * PARALLEL_GROUPS) {
    const wave = [];
    for (let g = 0; g < PARALLEL_GROUPS && i + g * CHUNK < unique.length; g++) {
      const slice = unique.slice(i + g * CHUNK, i + (g + 1) * CHUNK);
      if (!slice.length) break;
      const refs = slice.map((id) => db.collection("users").doc(id));
      wave.push(
        db.getAll(...refs).then((snaps) => ({ slice, snaps }))
      );
    }
    const settled = await Promise.all(wave);
    for (let w = 0; w < settled.length; w++) {
      const { slice, snaps } = settled[w];
      for (let j = 0; j < slice.length; j++) {
        const id = slice[j];
        const docSnap = snaps[j];
        if (docSnap && docSnap.exists) urlById.set(id, profileImageUrlFromUserData(docSnap.data()));
        else urlById.set(id, null);
      }
    }
  }
  return urlById;
}

/**
 * users·heptagon_cohort_ranks 등 문서에서 비공개 동의어를 통일 (집계 캐시 스냅샷에 플래그가 누락·구형인 경우 대비)
 */
function privacyFlagFromFirestoreDoc(data) {
  if (!data || typeof data !== "object") return false;
  const v =
    data.is_private !== undefined && data.is_private !== null
      ? data.is_private
      : data.isPrivate;
  return v === true || v === "true" || v === 1 || v === "1";
}

/**
 * 집계본/캐시 행에 최신 users.is_private 반영 (TSS·거리·피크 탭이 GC 대비 스냅샷을 쓰는 경로에서 비공개가 풀리는 문제 방지)
 */
async function hydrateRankingBoardPrivacyFromUsers(db, byCategory, entries) {
  if (!byCategory || typeof byCategory !== "object" || !db) return;
  const idSet = new Set();
  const addFromRow = (r) => {
    if (r && r.userId != null) idSet.add(String(r.userId).trim());
  };
  for (const k of Object.keys(byCategory)) {
    const rows = byCategory[k];
    if (!Array.isArray(rows)) continue;
    for (const r of rows) addFromRow(r);
  }
  if (Array.isArray(entries)) {
    for (const r of entries) addFromRow(r);
  }
  const ids = [...idSet].filter((x) => x.length > 0);
  if (!ids.length) return;

  const privMap = new Map();
  const nameMap = new Map();
  const userDataMap = new Map();
  const FieldPath = admin.firestore.FieldPath;
  const CHUNK = 30;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    chunk.forEach((id) => privMap.set(id, false));
    try {
      const qSnap = await db.collection("users").where(FieldPath.documentId(), "in", chunk).get();
      qSnap.forEach((doc) => {
        const data = doc.data() || {};
        userDataMap.set(doc.id, data);
        privMap.set(doc.id, privacyFlagFromFirestoreDoc(data));
        const nm =
          (data.name && String(data.name).trim()) ||
          (data.displayName && String(data.displayName).trim()) ||
          (data.display_name && String(data.display_name).trim()) ||
          "";
        if (nm && nm !== "비공개") nameMap.set(doc.id, nm);
      });
    } catch (e) {
      console.warn("[hydrateRankingBoardPrivacyFromUsers]", e && e.message ? e.message : e);
    }
  }

  const apply = (r) => {
    if (!r || r.userId == null) return;
    const id = String(r.userId).trim();
    if (!privMap.has(id)) return;
    r.is_private = privMap.get(id);
    if (nameMap.has(id)) {
      r.name = nameMap.get(id);
    }
    const userData = userDataMap.get(id);
    if (userData) {
      const statusFields = rankingUserStatusFieldsFromData(userData);
      r.account_status = statusFields.account_status;
      r.isWithdrawn = statusFields.isWithdrawn;
    }
  };
  for (const k of Object.keys(byCategory)) {
    const rows = byCategory[k];
    if (!Array.isArray(rows)) continue;
    for (const r of rows) apply(r);
  }
  if (Array.isArray(entries)) {
    for (const r of entries) apply(r);
  }
}

/**
 * 랭킹 응답의 byCategory(및 선택적 entries)에 users.profileImageUrl 최신값 반영.
 * 집계 캐시(ranking_aggregates 등)에는 필드가 없거나 오래된 경우가 있어 GC와 동일하게 HTTP 응답 직전에 보강.
 *
 * 중요: 기존에는 profileImageUrl이 비어 있을 때만 보강했지만,
 * 사용자가 프로필 사진을 교체하면 Firebase Storage 토큰이 바뀌어 캐시된 구 URL이 403을 반환한다.
 * PC 브라우저는 디스크 캐시로 구 이미지를 보여줄 수 있지만 모바일은 캐시가 없어 깨진 이미지가 표시된다.
 * 이를 방지하기 위해 모든 항목의 URL을 항상 users 컬렉션의 최신값으로 덮어쓴다.
 */
async function hydrateRankingBoardProfileImages(db, byCategory, entries) {
  if (!byCategory || typeof byCategory !== "object") return;
  const idSet = new Set();
  const collectId = (r) => {
    if (!r || !r.userId) return;
    idSet.add(String(r.userId).trim());
  };
  for (const k of Object.keys(byCategory)) {
    const rows = byCategory[k];
    if (!Array.isArray(rows)) continue;
    for (const r of rows) collectId(r);
  }
  if (Array.isArray(entries)) {
    for (const r of entries) collectId(r);
  }
  const ids = [...idSet].filter(Boolean);
  if (!ids.length) return;
  const urlMap = await fetchProfileImageUrlsMapForUsers(db, ids);
  const apply = (r) => {
    if (!r || !r.userId) return;
    const u = String(r.userId).trim();
    if (!urlMap.has(u)) return;
    const fresh = urlMap.get(u);
    if (fresh != null) r.profileImageUrl = fresh;
  };
  for (const k of Object.keys(byCategory)) {
    const rows = byCategory[k];
    if (!Array.isArray(rows)) continue;
    for (const r of rows) apply(r);
  }
  if (Array.isArray(entries)) {
    for (const r of entries) apply(r);
  }
}

// CORS 설정: Firebase Functions v2 onCall - 허용할 출처 (localhost는 개발/테스트용)
const CORS_ORIGINS = [
  "https://stelvio.ai.kr",
  "https://www.stelvio.ai.kr",
  "http://localhost",
  "http://localhost:3000",
  "http://localhost:5000",
  "http://localhost:8080",
  "http://127.0.0.1",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5000",
  "http://127.0.0.1:8080",
];

/** 1일 500 이상 TSS: 치팅으로 간주, 합산·포인트 적립 제외 (주간 TOP10, Strava 동기화 공통) */
const TSS_PER_DAY_CHEAT_THRESHOLD = 500;

/** Strava에서 TSS·포인트·FTP·MMP 제외할 활동 타입. Run, Swim, Walk, TrailRun, WeightTraining */
const EXCLUDED_ACTIVITY_TYPES = new Set(["run", "swim", "walk", "trailrun", "weighttraining"]);

/** Strava 로그가 MMP/수집 대상인지. source가 strava가 아니면 true(Stelvio 등).
 *  Strava: Run, Swim, Walk, TrailRun, WeightTraining 제외, 나머지(Ride, VirtualRide 등) 수집 */
function isCyclingForMmp(logData) {
  const source = String(logData.source || "").toLowerCase();
  if (source !== "strava") return true; // Stelvio 등: 항상 수집
  const type = String(logData.activity_type || "").trim().toLowerCase();
  if (!type) return true; // activity_type 없음: 수집 (마이그레이션 전 legacy 포함)
  return !EXCLUDED_ACTIVITY_TYPES.has(type); // Run/Swim/Walk만 제외
}

/**
 * Phase 6 — appConfig/supabase_read_routing.useSupabaseLogsRead 가 켜져 있으면
 * users/{uid}/logs(Firestore) 대신 Supabase rides 에서 기간 내 라이딩 로그를 읽는다.
 * cutover 전(false)·실패 시 null 을 반환해 호출측이 기존 Firestore 쿼리로 폴백한다.
 * @returns {Promise<object[]|null>} 훈련 로그 배열(이미 isCyclingForMmp 필터됨) 또는 null
 */
async function tryFetchCyclingLogsFromSupabaseRidesInRange(userId, startStr, endStr) {
  try {
    if (typeof rankingReadConfig.refreshRankingReadConfig === "function") {
      try {
        await rankingReadConfig.refreshRankingReadConfig(admin, false);
      } catch (eCfg) {
        /* 캐시된 값 사용 */
      }
    }
    const cfg =
      typeof rankingReadConfig.getRankingReadConfig === "function"
        ? rankingReadConfig.getRankingReadConfig()
        : null;
    if (!cfg || cfg.useSupabaseLogsRead !== true) return null;
    if (
      !supabaseGroupReader ||
      typeof supabaseGroupReader.fetchUserRideLogsInDateRange !== "function"
    ) {
      return null;
    }
    const logs = await supabaseGroupReader.fetchUserRideLogsInDateRange(
      userId,
      startStr,
      endStr
    );
    if (!Array.isArray(logs)) return null;
    return logs.filter((d) => isCyclingForMmp(d));
  } catch (e) {
    console.warn(
      "[supabaseLogsRead] rides 기간 조회 실패 — Firestore 폴백:",
      (e && e.message) || e
    );
    return null;
  }
}

/**
 * 기간 내 싸이클링 로그(데이터 객체) — cutover 시 Supabase rides, 그 외/실패 시 Firestore logs.
 * 반환 배열은 isCyclingForMmp 로 필터링된 로그 데이터 객체.
 */
async function fetchCyclingLogsInDateRangeRouted(db, userId, startStr, endStr) {
  const supabaseLogs = await tryFetchCyclingLogsFromSupabaseRidesInRange(
    userId,
    startStr,
    endStr
  );
  if (supabaseLogs) return supabaseLogs;
  if (!db || !userId) return [];
  const snap = await db
    .collection("users")
    .doc(userId)
    .collection("logs")
    .where("date", ">=", startStr)
    .where("date", "<=", endStr)
    .get();
  const out = [];
  snap.docs.forEach((doc) => {
    const d = doc.data() || {};
    if (!isCyclingForMmp(d)) return;
    out.push(d);
  });
  return out;
}

// CORS 헤더 설정 헬퍼 (preflight 및 실제 응답에 사용)
function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "";
  const allowed = CORS_ORIGINS.some(
    (o) => (typeof o === "string" ? origin === o : o.test(origin))
  );
  if (allowed && origin) {
    res.set("Access-Control-Allow-Origin", origin);
  } else if (CORS_ORIGINS.indexOf("*") !== -1) {
    res.set("Access-Control-Allow-Origin", "*");
  } else if (origin) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
}

// 관리자 비밀번호 초기화: onRequest로 CORS preflight(OPTIONS) 수동 처리 (새 이름으로 배포, 기존 callable과 구분)
exports.adminResetUserPasswordHttp = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: { code: "method-not-allowed", message: "POST만 허용됩니다." } });
      return;
    }

    const sendError = (code, message, status = 400) => {
      res.status(status).json({ error: { code, message } });
    };

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        sendError("unauthenticated", "로그인한 후에만 비밀번호 초기화를 할 수 있습니다.", 401);
        return;
      }
      const idToken = authHeader.split("Bearer ")[1];
      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
      } catch (e) {
        sendError("unauthenticated", "로그인이 만료되었거나 유효하지 않습니다. 다시 로그인해 주세요.", 401);
        return;
      }
      const callerUid = decodedToken.uid;

      let body = {};
      try {
        body = typeof req.body === "object" && req.body !== null ? req.body : {};
      } catch (e) {
        sendError("invalid-argument", "요청 본문이 올바르지 않습니다.");
        return;
      }
      const targetUserId = body.targetUserId ? String(body.targetUserId).trim() : null;
      const newPassword = body.newPassword ? String(body.newPassword) : null;

      if (!targetUserId) {
        sendError("invalid-argument", "대상 사용자 ID(targetUserId)가 필요합니다.");
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        sendError("invalid-argument", "새 비밀번호는 6자 이상이어야 합니다.");
        return;
      }

      const callerDoc = await admin.firestore().collection("users").doc(callerUid).get();
      if (!callerDoc.exists) {
        sendError("permission-denied", "호출자 정보를 찾을 수 없습니다.", 403);
        return;
      }
      const grade = callerDoc.data().grade;
      const isAdmin = grade === 1 || grade === "1";
      if (!isAdmin) {
        sendError("permission-denied", "관리자(grade=1)만 다른 사용자의 비밀번호를 초기화할 수 있습니다.", 403);
        return;
      }

      const targetUserRef = admin.firestore().collection("users").doc(targetUserId);
      const targetUserSnap = await targetUserRef.get();
      if (!targetUserSnap.exists) {
        sendError("not-found", "대상 사용자 정보를 찾을 수 없습니다. 사용자 목록에서 선택한 계정인지 확인해 주세요.", 404);
        return;
      }
      const targetData = targetUserSnap.data() || {};
      const authUid =
        (targetData.uid && String(targetData.uid).trim()) ||
        (targetData.id && String(targetData.id).trim()) ||
        targetUserId;
      if (!authUid || authUid.length > 128) {
        sendError("invalid-argument", "대상 사용자 ID가 올바르지 않습니다.");
        return;
      }

      let resolvedAuthUid = null;
      try {
        await admin.auth().getUser(authUid);
        resolvedAuthUid = authUid;
      } catch (getUserErr) {
        const code = getUserErr.code || (getUserErr.errorInfo && getUserErr.errorInfo.code);
        if (code === "auth/user-not-found") {
          const email = targetData.email && String(targetData.email).trim();
          if (email) {
            try {
              const userRecord = await admin.auth().getUserByEmail(email);
              resolvedAuthUid = userRecord.uid;
              console.log("[adminResetUserPassword] 이메일로 Auth UID 조회 성공:", { email, uid: resolvedAuthUid });
            } catch (emailErr) {
              console.error("[adminResetUserPassword] getUserByEmail 실패:", emailErr);
              sendError("not-found", "해당 사용자는 Firebase 로그인 계정이 없습니다. 이메일/비밀번호로 가입한 사용자만 비밀번호 초기화가 가능합니다.", 404);
              return;
            }
          } else {
            sendError("not-found", "해당 사용자는 Firebase 로그인 계정이 없습니다. 이메일/비밀번호로 가입한 사용자만 비밀번호 초기화가 가능합니다.", 404);
            return;
          }
        } else {
          console.error("[adminResetUserPassword] getUser 실패:", getUserErr);
          sendError("internal", "대상 사용자 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
          return;
        }
      }

      if (!resolvedAuthUid) {
        sendError("not-found", "대상 사용자를 Firebase Auth에서 찾을 수 없습니다.", 404);
        return;
      }

      console.log("[adminResetUserPassword] 비밀번호 변경 시도:", { targetUserId, resolvedAuthUid });
      await admin.auth().updateUser(resolvedAuthUid, { password: newPassword });
      console.log("[adminResetUserPassword] 비밀번호 변경 완료:", resolvedAuthUid);
      res.status(200).json({ result: { success: true, message: "비밀번호가 초기화되었습니다." } });
    } catch (err) {
      const code = err.code || (err.errorInfo && err.errorInfo.code);
      const rawMessage = (err && err.message) ? String(err.message).trim() : "";
      console.error("[adminResetUserPassword] 오류 code=", code, "message=", rawMessage, "err=", err);

      if (code === "auth/user-not-found") {
        sendError("not-found", "대상 사용자를 Firebase Auth에서 찾을 수 없습니다.", 404);
        return;
      }
      if (code === "auth/weak-password") {
        sendError("invalid-argument", "비밀번호가 너무 약합니다. 6자 이상 입력해 주세요.");
        return;
      }
      if (code === "auth/invalid-uid" || code === "auth/argument-error") {
        sendError("invalid-argument", "대상 사용자 ID가 올바르지 않습니다. 사용자 목록에서 다시 선택해 주세요.");
        return;
      }
      if (code === "auth/operation-not-allowed") {
        sendError("failed-precondition", "비밀번호 변경이 허용되지 않은 로그인 방식입니다.", 412);
        return;
      }

      const userMessage =
        /^internal$/i.test(rawMessage) || !rawMessage
          ? "비밀번호 변경 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
          : rawMessage;
      sendError("internal", userMessage, 500);
    }
  }
);

/** 본인 확인용: 전화번호(contact)·생년(birth_year) 일치 시 이메일/비밀번호 계정 비밀번호만 변경 (로그인 불필요) */
function selfResetDigitsOnly(raw) {
  return String(raw || "").replace(/\D+/g, "");
}
function selfResetFormatContactForDb(digitsRaw) {
  const d = selfResetDigitsOnly(digitsRaw);
  if (!d) return "";
  if (d.length < 7) return d;
  const head = d.slice(0, 3);
  const tail = d.slice(-4);
  const mid = d.slice(head.length, d.length - tail.length);
  return `${head}-${mid}-${tail}`;
}

const SELF_SERVICE_RESET_GENERIC =
  "등록된 정보와 일치하지 않습니다. 전화번호·생년·비밀번호를 다시 확인해 주세요.";

exports.selfServiceResetPasswordHttp = onRequest(
  { cors: false },
  async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: { code: "method-not-allowed", message: "POST만 허용됩니다." } });
      return;
    }

    const sendError = (code, message, status = 400) => {
      res.status(status).json({ error: { code, message } });
    };

    try {
      let body = {};
      try {
        const raw = req.body;
        if (typeof raw === "string") {
          try {
            body = JSON.parse(raw) || {};
          } catch (eParse) {
            body = {};
          }
        } else if (typeof raw === "object" && raw !== null) {
          body = raw;
        }
      } catch (e) {
        sendError("invalid-argument", "요청 본문이 올바르지 않습니다.");
        return;
      }

      const contactRaw = body.contact != null ? String(body.contact).trim() : "";
      const birthYearRaw = body.birthYear != null ? String(body.birthYear).trim() : "";
      const newPassword = body.newPassword != null ? String(body.newPassword) : "";
      const newPasswordConfirm = body.newPasswordConfirm != null ? String(body.newPasswordConfirm) : "";

      const phoneDigits = selfResetDigitsOnly(contactRaw);
      if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        sendError("invalid-argument", "ID(전화번호)를 올바르게 입력해 주세요.");
        return;
      }
      if (!birthYearRaw || !/^\d{4}$/.test(birthYearRaw)) {
        sendError("invalid-argument", "생년(4자리)을 입력해 주세요.");
        return;
      }
      const birthYearNum = parseInt(birthYearRaw, 10);
      if (!Number.isFinite(birthYearNum) || birthYearNum < 1900 || birthYearNum > 2100) {
        sendError("invalid-argument", "생년(4자리)을 올바르게 입력해 주세요.");
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        sendError("invalid-argument", "비밀번호 초기화 번호는 6자 이상이어야 합니다.");
        return;
      }
      if (newPassword !== newPasswordConfirm) {
        sendError("invalid-argument", "비밀번호 초기화 번호와 확인 입력이 일치하지 않습니다.");
        return;
      }

      const db = admin.firestore();
      const formattedContact = selfResetFormatContactForDb(contactRaw);

      let snaps = await db.collection("users").where("contact", "==", formattedContact).limit(5).get();
      if (snaps.empty && phoneDigits !== formattedContact) {
        snaps = await db.collection("users").where("contact", "==", phoneDigits).limit(5).get();
      }

      if (snaps.empty || snaps.size !== 1) {
        sendError("permission-denied", SELF_SERVICE_RESET_GENERIC, 403);
        return;
      }

      const doc = snaps.docs[0];
      const data = doc.data() || {};
      const storedBirth = data.birth_year;
      const storedBirthNum =
        storedBirth == null || storedBirth === "" ? NaN : parseInt(String(storedBirth), 10);
      if (!Number.isFinite(storedBirthNum) || storedBirthNum !== birthYearNum) {
        sendError("permission-denied", SELF_SERVICE_RESET_GENERIC, 403);
        return;
      }

      const authUidFromDoc =
        (data.uid && String(data.uid).trim()) ||
        (data.id && String(data.id).trim()) ||
        doc.id;

      let resolvedAuthUid = null;
      try {
        await admin.auth().getUser(authUidFromDoc);
        resolvedAuthUid = authUidFromDoc;
      } catch (getUserErr) {
        const code = getUserErr.code || (getUserErr.errorInfo && getUserErr.errorInfo.code);
        if (code === "auth/user-not-found") {
          const email =
            (data.email && String(data.email).trim()) || `${phoneDigits}@stelvio.ai`;
          try {
            const userRecord = await admin.auth().getUserByEmail(email);
            resolvedAuthUid = userRecord.uid;
          } catch (emailErr) {
            sendError("permission-denied", SELF_SERVICE_RESET_GENERIC, 403);
            return;
          }
        } else {
          console.error("[selfServiceResetPassword] getUser 실패:", getUserErr);
          sendError("internal", "계정 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
          return;
        }
      }

      if (!resolvedAuthUid) {
        sendError("permission-denied", SELF_SERVICE_RESET_GENERIC, 403);
        return;
      }

      try {
        await admin.auth().updateUser(resolvedAuthUid, { password: newPassword });
      } catch (updErr) {
        const code = updErr.code || (updErr.errorInfo && updErr.errorInfo.code);
        const rawMessage = (updErr && updErr.message) ? String(updErr.message).trim() : "";
        console.error("[selfServiceResetPassword] updateUser 오류 code=", code, "message=", rawMessage);
        if (code === "auth/weak-password") {
          sendError("invalid-argument", "비밀번호가 너무 약합니다. 6자 이상으로 다시 입력해 주세요.");
          return;
        }
        if (code === "auth/user-not-found") {
          sendError("permission-denied", SELF_SERVICE_RESET_GENERIC, 403);
          return;
        }
        if (code === "auth/operation-not-allowed") {
          sendError(
            "failed-precondition",
            "이 계정은 비밀번호 로그인을 사용할 수 없습니다. 관리자에게 문의해 주세요.",
            412
          );
          return;
        }
        sendError("internal", "비밀번호 변경 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
        return;
      }

      res.status(200).json({
        result: { success: true, message: "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요." },
      });
    } catch (err) {
      console.error("[selfServiceResetPassword] 오류:", err);
      sendError("internal", "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
    }
  }
);

/**
 * Strava 인증 코드를 액세스/리프레시 토큰으로 교환하고 users/{userId}에 저장.
 * Client Secret은 서버(Secret Manager)에서만 사용. appConfig/strava에서 client_id, redirect_uri 읽음.
 * onRequest로 변경하여 CORS 수동 처리
 */
// Secret이 있으면 secrets 배열에 포함, 없으면 Secret 없이 배포
const exchangeStravaCodeConfig = { cors: CORS_ORIGINS };
if (STRAVA_CLIENT_SECRET) {
  exchangeStravaCodeConfig.secrets = [STRAVA_CLIENT_SECRET];
}

exports.exchangeStravaCode = onRequest(
  exchangeStravaCodeConfig,
  async (req, res) => {
    // OPTIONS preflight 요청 처리 (Firebase Functions v2의 cors 옵션과 함께 사용)
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.set("Access-Control-Max-Age", "3600");
      res.status(204).send("");
      return;
    }

    // CORS 헤더 설정 (실제 요청에 대해)
    const origin = req.headers.origin;
    if (origin && CORS_ORIGINS.some(allowed => 
      typeof allowed === 'string' ? origin === allowed : allowed.test(origin)
    )) {
      res.set("Access-Control-Allow-Origin", origin);
    } else if (CORS_ORIGINS.length === 0) {
      res.set("Access-Control-Allow-Origin", "*");
    }
    res.set("Access-Control-Allow-Credentials", "true");

    try {
      const data = req.method === "POST" ? req.body : {};
      const code = typeof data.code === "string" ? data.code.trim() : "";
      const userId = data.userId != null ? String(data.userId).trim() : "";

      if (!code || !userId) {
        throw new HttpsError(
          "invalid-argument",
          "code와 userId가 필요합니다."
        );
      }

      const db = admin.firestore();
      const appConfigSnap = await db.collection("appConfig").doc("strava").get();
      if (!appConfigSnap.exists) {
        throw new HttpsError(
          "failed-precondition",
          "Strava 앱 설정(appConfig/strava)이 없습니다. Firestore에 strava_client_id, strava_redirect_uri를 설정하세요."
        );
      }

      const appConfig = appConfigSnap.data();
      const clientId = appConfig.strava_client_id || "";
      const redirectUri = appConfig.strava_redirect_uri || "";
      
      // Secret에서 값을 가져오되, 없거나 빈 값이면 하드코딩된 값 사용
      let clientSecret;
      if (STRAVA_CLIENT_SECRET) {
        try {
          let secretValue = STRAVA_CLIENT_SECRET.value();
          // Secret 값에서 따옴표 제거 (JSON 파싱 오류 방지)
          if (secretValue && typeof secretValue === 'string') {
            secretValue = secretValue.trim();
            // 앞뒤 따옴표 제거
            if ((secretValue.startsWith('"') && secretValue.endsWith('"')) ||
                (secretValue.startsWith("'") && secretValue.endsWith("'"))) {
              secretValue = secretValue.slice(1, -1);
            }
          }
          clientSecret = secretValue && secretValue.trim() ? secretValue : STRAVA_CLIENT_SECRET_VALUE;
        } catch (e) {
          console.warn("[exchangeStravaCode] Secret 값 읽기 실패, 하드코딩된 값 사용:", e.message);
          clientSecret = STRAVA_CLIENT_SECRET_VALUE;
        }
      } else {
        clientSecret = STRAVA_CLIENT_SECRET_VALUE;
      }

      // Secret 값 검증 (앞부분만 로그)
      const expectedSecretPrefix = "6cd67a28f1"; // 실제 Secret의 앞 10자
      const actualSecretPrefix = clientSecret ? clientSecret.substring(0, 10) : "";
      const secretMatches = actualSecretPrefix === expectedSecretPrefix;
      
      console.log("[exchangeStravaCode] 설정 확인:", {
        hasClientId: !!clientId,
        hasRedirectUri: !!redirectUri,
        hasClientSecret: !!clientSecret,
        clientId: clientId,
        redirectUri: redirectUri,
        clientIdLength: clientId.length,
        redirectUriLength: redirectUri.length,
        clientSecretLength: clientSecret ? clientSecret.length : 0,
        clientSecretPrefix: actualSecretPrefix + "...", // Secret 일부만 로그
        secretMatches: secretMatches, // Secret 값이 올바른지 확인
        codeLength: code ? code.length : 0,
        codePrefix: code ? code.substring(0, 10) + "..." : "없음"
      });
      
      if (!secretMatches && clientSecret) {
        console.warn("[exchangeStravaCode] ⚠️ Secret 값이 예상과 다릅니다. Secret Manager 값을 확인하세요.");
      }

      if (!clientId || !clientSecret || !redirectUri) {
        const missing = [];
        if (!clientId) missing.push("strava_client_id");
        if (!clientSecret) missing.push("STRAVA_CLIENT_SECRET");
        if (!redirectUri) missing.push("strava_redirect_uri");
        throw new HttpsError(
          "failed-precondition",
          `Strava 설정이 불완전합니다. 누락된 항목: ${missing.join(", ")}`
        );
      }

      const tokenUrl = "https://www.strava.com/api/v3/oauth/token";
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      });

      const tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      const tokenData = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) {
        const errorDetails = {
          status: tokenRes.status,
          statusText: tokenRes.statusText,
          response: tokenData,
          requestBody: {
            client_id: clientId,
            redirect_uri: redirectUri,
            code: code ? code.substring(0, 10) + "..." : "없음",
            grant_type: "authorization_code",
            hasClientSecret: !!clientSecret,
            clientSecretLength: clientSecret ? clientSecret.length : 0
          }
        };
        console.error("[exchangeStravaCode] Strava API 오류:", JSON.stringify(errorDetails, null, 2));
        
        // 더 자세한 오류 메시지
        let errorMsg = "Strava 토큰 교환 실패: ";
        if (tokenData.error) {
          errorMsg += tokenData.error;
          if (tokenData.error_description) {
            errorMsg += " - " + tokenData.error_description;
          }
        } else if (tokenData.message) {
          errorMsg += tokenData.message;
        } else {
          errorMsg += `HTTP ${tokenRes.status}`;
        }
        
        throw new HttpsError("internal", errorMsg);
      }

      const accessToken = tokenData.access_token || "";
      const refreshToken = tokenData.refresh_token || "";
      const expiresAt = tokenData.expires_at != null ? Number(tokenData.expires_at) : 0;
      const scopeUpdate = buildStravaScopeUpdate(tokenData);
      const athleteId = tokenData.athlete != null && tokenData.athlete.id != null ? Number(tokenData.athlete.id) : null;

      if (!accessToken || !refreshToken) {
        throw new HttpsError(
          "internal",
          "Strava에서 access_token 또는 refresh_token을 받지 못했습니다."
        );
      }

      const userRef = db.collection("users").doc(userId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        throw new HttpsError("not-found", "해당 사용자를 찾을 수 없습니다.");
      }

      const updateData = {
        strava_access_token: accessToken,
        strava_refresh_token: refreshToken,
        strava_expires_at: expiresAt,
        ...scopeUpdate,
      };
      if (athleteId != null) updateData.strava_athlete_id = athleteId;
      await userRef.update(updateData);

      res.status(200).json({ success: true });
    } catch (err) {
      console.error("[exchangeStravaCode]", err);
      if (!res.headersSent) {
        const statusCode = (err && err.code === "invalid-argument") ? 400 :
          (err && err.code === "not-found") ? 404 :
          (err && err.code === "failed-precondition") ? 412 : 500;
        res.status(statusCode).json({
          success: false,
          error: (err && err.message) || "Strava 토큰 교환 중 오류가 발생했습니다."
        });
      }
    }
  }
);

/**
 * Strava 리프레시 토큰으로 액세스 토큰 갱신 후 users/{userId} 업데이트.
 * 클라이언트는 userId만 전달; 리프레시 토큰은 서버가 Firestore에서 읽음.
 * onRequest로 변경하여 CORS 수동 처리
 */
// refreshStravaToken도 동일한 설정 사용
const refreshStravaTokenConfig = { cors: CORS_ORIGINS };
if (STRAVA_CLIENT_SECRET) {
  refreshStravaTokenConfig.secrets = [STRAVA_CLIENT_SECRET];
}

exports.refreshStravaToken = onRequest(
  refreshStravaTokenConfig,
  async (req, res) => {
    // OPTIONS preflight 요청 처리 (Firebase Functions v2의 cors 옵션과 함께 사용)
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.set("Access-Control-Max-Age", "3600");
      res.status(204).send("");
      return;
    }

    // CORS 헤더 설정 (실제 요청에 대해)
    const origin = req.headers.origin;
    if (origin && CORS_ORIGINS.some(allowed => 
      typeof allowed === 'string' ? origin === allowed : allowed.test(origin)
    )) {
      res.set("Access-Control-Allow-Origin", origin);
    } else if (CORS_ORIGINS.length === 0) {
      res.set("Access-Control-Allow-Origin", "*");
    }
    res.set("Access-Control-Allow-Credentials", "true");

    try {
      const data = req.method === "POST" ? req.body : {};
      const userId = data.userId != null ? String(data.userId).trim() : "";

      if (!userId) {
        throw new HttpsError(
          "invalid-argument",
          "userId가 필요합니다."
        );
      }

      const db = admin.firestore();
      const userRef = db.collection("users").doc(userId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        throw new HttpsError("not-found", "해당 사용자를 찾을 수 없습니다.");
      }

      const refreshToken = userSnap.data().strava_refresh_token || "";
      if (!refreshToken) {
        throw new HttpsError(
          "failed-precondition",
          "해당 사용자에게 Strava 리프레시 토큰이 없습니다."
        );
      }

      const appConfigSnap = await db.collection("appConfig").doc("strava").get();
      if (!appConfigSnap.exists) {
        throw new HttpsError(
          "failed-precondition",
          "Strava 앱 설정(appConfig/strava)이 없습니다."
        );
      }

      const appConfig = appConfigSnap.data();
      const clientId = appConfig.strava_client_id || "";
      
      // Secret에서 값을 가져오되, 없거나 빈 값이면 하드코딩된 값 사용
      let clientSecret;
      if (STRAVA_CLIENT_SECRET) {
        try {
          let secretValue = STRAVA_CLIENT_SECRET.value();
          // Secret 값에서 따옴표 제거 (JSON 파싱 오류 방지)
          if (secretValue && typeof secretValue === 'string') {
            secretValue = secretValue.trim();
            // 앞뒤 따옴표 제거
            if ((secretValue.startsWith('"') && secretValue.endsWith('"')) ||
                (secretValue.startsWith("'") && secretValue.endsWith("'"))) {
              secretValue = secretValue.slice(1, -1);
            }
          }
          clientSecret = secretValue && secretValue.trim() ? secretValue : STRAVA_CLIENT_SECRET_VALUE;
        } catch (e) {
          console.warn("[refreshStravaToken] Secret 값 읽기 실패, 하드코딩된 값 사용:", e.message);
          clientSecret = STRAVA_CLIENT_SECRET_VALUE;
        }
      } else {
        clientSecret = STRAVA_CLIENT_SECRET_VALUE;
      }

      if (!clientId || !clientSecret) {
        throw new HttpsError(
          "failed-precondition",
          "Strava 설정이 불완전합니다."
        );
      }

      const tokenUrl = "https://www.strava.com/api/v3/oauth/token";
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });

      const tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      const tokenData = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) {
        const msg = tokenData.message || tokenData.error || `Strava ${tokenRes.status}`;
        throw new HttpsError("internal", "Strava 토큰 갱신 실패: " + msg);
      }

      const accessToken = tokenData.access_token || "";
      const newRefreshToken = tokenData.refresh_token || refreshToken;
      const expiresAt = tokenData.expires_at != null ? Number(tokenData.expires_at) : 0;
      const scopeUpdate = buildStravaScopeUpdate(tokenData);

      if (!accessToken) {
        throw new HttpsError(
          "internal",
          "Strava에서 access_token을 받지 못했습니다."
        );
      }

      await userRef.update({
        strava_access_token: accessToken,
        strava_refresh_token: newRefreshToken,
        strava_expires_at: expiresAt,
        ...scopeUpdate,
      });

      res.status(200).json({ success: true, accessToken, scope: scopeUpdate.strava_scope || undefined });
    } catch (err) {
      console.error("[refreshStravaToken]", err);
      if (!res.headersSent) {
        const statusCode = (err && err.code === "invalid-argument") ? 400 :
          (err && err.code === "not-found") ? 404 :
          (err && err.code === "failed-precondition") ? 412 : 500;
        res.status(statusCode).json({
          success: false,
          error: (err && err.message) || "Strava 토큰 갱신 중 오류가 발생했습니다."
        });
      }
    }
  }
);

// ---------- Strava 전날 로그 동기화 (Firebase 기반, 수동 동기화와 동일한 Firestore 사용자/로그/포인트 사용) ----------
function getStravaClientSecret() {
  let clientSecret = STRAVA_CLIENT_SECRET_VALUE;
  if (STRAVA_CLIENT_SECRET) {
    try {
      let v = STRAVA_CLIENT_SECRET.value();
      if (v && typeof v === "string") {
        v = v.trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (v) clientSecret = v;
      }
    } catch (e) {
      console.warn("[stravaSyncPreviousDay] Secret 읽기 실패, 기본값 사용:", e.message);
    }
  }
  return clientSecret;
}

function normalizeStravaScopes(scope) {
  return String(scope || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildStravaScopeUpdate(tokenData) {
  if (!tokenData || tokenData.scope == null) return {};
  const scopes = normalizeStravaScopes(tokenData.scope);
  return {
    strava_scope: scopes.join(" "),
    strava_scope_checked_at: new Date().toISOString(),
    strava_has_activity_read: scopes.includes("activity:read"),
    strava_has_activity_read_all: scopes.includes("activity:read_all"),
  };
}

/** STELVIO rTSS: 프로필 체중 없을 때 가정 체중 (kJ 가드레일·W/kg 가중치용) */
const STELVIO_RTSS_DEFAULT_WEIGHT_KG = 70;

/**
 * STELVIO 글로벌 개정 TSS (rTSS) — W/kg 가중치
 * [수정] kJ 가드레일 재설계 (클라이언트 stelvioRtss.js와 동일한 로직 적용)
 *  구버전 wPerKg < 2.5 → tssPerKJ > 15.0, wPerKg > 4.0 → tssPerKJ < 6.0 로직은
 *  정상 범위(0.05~0.8 TSS/kJ)보다 10~100배 높아 비정상 파워 데이터 입력 시 수천~수만 TSS 발생.
 *  (예: 2026-05-09~12 기간 TSS 4173·9927·9927.2 버그의 원인)
 *  변경 후: 1.5 TSS/kJ 단일 상한 + 500 TSS 절대 상한으로 통일.
 */
function calculateStelvioRevisedTSS(durationSec, avgPower, np, ftp, weight) {
  const d = Number(durationSec);
  // 비정상 파워 데이터 방어: 최대 2500W (세계 최고 스프린터 피크 파워 수준)
  const npN = Math.min(Number(np), 2500);
  const ftpN = Number(ftp);
  const w = Number(weight);
  const avgN = Math.min(Number(avgPower), 2500);
  if (!ftpN || !w || ftpN <= 0 || w <= 0) return 0;
  if (npN <= 0 || avgN <= 0) return 0;
  if (!d || d <= 0) return 0;
  const ifFactor = npN / ftpN;
  const baseTSS = ((d * npN * ifFactor) / (ftpN * 3600)) * 100;
  const totalKJ = (avgN * d) / 1000;
  if (totalKJ <= 0) return 0;
  const wPerKg = ftpN / w;
  let wFactor = Math.pow(3.0 / wPerKg, 0.15);
  wFactor = Math.max(0.8, Math.min(1.2, wFactor));
  let adjustedTSS = baseTSS * wFactor;
  // TSS/kJ 상한: 정상 라이딩 최대 허용치(1.5 TSS/kJ) 초과 시 보정
  const tssPerKJ = adjustedTSS / totalKJ;
  if (tssPerKJ > 1.5) {
    adjustedTSS = totalKJ * 1.5;
  }
  // 단일 세션 절대 상한: 약 8시간 극한 레이스 기준 500 TSS
  if (adjustedTSS > 500) {
    adjustedTSS = 500;
  }
  return Math.round(adjustedTSS * 10) / 10;
}

function computeTssFromActivity(activity, ftp, weightKg) {
  const durationSec = Number(activity.moving_time) || 0;
  if (durationSec <= 0) return 0;
  const np = Number(activity.weighted_average_watts) || Number(activity.average_watts) || 0;
  if (np <= 0) return 0;
  ftp = Number(ftp) || 0;
  if (ftp <= 0) return 0;
  const avgW = Number(activity.average_watts) || 0;
  const avgForTss = avgW > 0 ? avgW : np;
  const wEff = (Number(weightKg) > 0) ? Number(weightKg) : STELVIO_RTSS_DEFAULT_WEIGHT_KG;
  return Math.max(0, calculateStelvioRevisedTSS(durationSec, avgForTss, np, ftp, wEff));
}

/** Strava API Rate Limit: 15분당 100회. 429 시 Retry-After(또는 60초) 대기, 최대 15분(900초)까지 대기 */
async function waitForStravaRateLimit(res) {
  if (res.status !== 429) return;
  const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
  const waitMs = Math.min(retryAfter * 1000, 900000); // 최대 15분 (Strava 15분 단위 리셋)
  console.log(`[Strava] 429 Rate Limit, ${waitMs / 1000}초 대기 후 재시도`);
  await new Promise((r) => setTimeout(r, waitMs));
}

/** Strava API 호출 간 딜레이 (Rate Limit 예방: 15분당 100회 → 9초 간격 필요) */
const STRAVA_CALL_DELAY_MS = 9000;

/**
 * Strava 403 "Application Status Inactive" 판별.
 * Strava 개발자 프로그램 정책상 앱이 비활성/미승인 상태이면 모든 사용자 호출이
 * 403 {"resource":"Application","field":"Status","code":"Inactive"} 로 실패한다.
 * 이는 특정 사용자 토큰 문제가 아니라 client_id(앱) 레벨 공통 장애이므로,
 * 사용자별 재시도로는 복구되지 않고 Strava 설정(https://www.strava.com/settings/api)에서
 * 앱 재활성화/티어 상향 승인이 필요하다.
 */
function isStravaApplicationInactiveError(status, bodyText) {
  if (Number(status) !== 403) return false;
  const t = String(bodyText || "").toLowerCase();
  return t.includes("inactive") && (t.includes("application") || t.includes("status"));
}

/** 앱 비활성 상태를 운영자가 로그에서 즉시 식별하도록 남기는 공통 마커 로그 */
function logStravaApplicationInactive(context, extra) {
  console.error(
    "[Strava][APP_INACTIVE] Strava 애플리케이션이 비활성(Inactive) 상태입니다. " +
      "전체 사용자 수집 공통 장애 — https://www.strava.com/settings/api 에서 앱 상태/티어 확인 필요.",
    { context: context || "unknown", ...(extra || {}) }
  );
}

/** Strava 상세 활동 API 호출. 429 시 최대 5회 재시도 */
async function fetchStravaActivityDetail(accessToken, activityId) {
  const url = `https://www.strava.com/api/v3/activities/${activityId}`;
  const maxRetries = 5;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
      let res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.status === 429) {
        await waitForStravaRateLimit(res);
        continue;
      }
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        const appInactive = isStravaApplicationInactiveError(res.status, bodyText);
        if (appInactive) logStravaApplicationInactive("fetchStravaActivityDetail", { activityId });
        return {
          success: false,
          status: res.status,
          appInactive,
          error: `Strava ${res.status}${appInactive ? " Application Inactive" : ""}`,
        };
      }
      const activity = await res.json().catch(() => null);
      return activity ? { success: true, activity } : { success: false, error: "Invalid response" };
    } catch (e) {
      if (attempt === maxRetries) return { success: false, error: e.message || "Request failed" };
    }
  }
  return { success: false, error: "Strava 429 retries exhausted" };
}

const MAX_STRAVA_ELEVATION_PROFILE_POINTS = 160;

function downsampleNumericStreamArray(arr, maxN) {
  if (!Array.isArray(arr) || !arr.length) return null;
  if (arr.length <= maxN) {
    return arr.map((v) => Math.round(Number(v) || 0));
  }
  const n = arr.length;
  const step = Math.ceil(n / maxN);
  const out = [];
  for (let i = 0; i < n; i += step) out.push(Math.round(Number(arr[i]) || 0));
  const last = Math.round(Number(arr[n - 1]) || 0);
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Strava activity + streams → Firestore/Supabase 라우트 프로파일 필드 */
function buildStravaRouteProfileFields(activity, streamsRes) {
  const polyRaw =
    activity && activity.map && activity.map.summary_polyline
      ? String(activity.map.summary_polyline).trim()
      : activity && activity.summary_polyline
        ? String(activity.summary_polyline).trim()
        : "";
  const summaryPolyline = polyRaw || null;
  let elevationProfile = null;
  if (
    streamsRes &&
    streamsRes.success &&
    Array.isArray(streamsRes.altitude) &&
    streamsRes.altitude.length > 0
  ) {
    elevationProfile = downsampleNumericStreamArray(
      streamsRes.altitude,
      MAX_STRAVA_ELEVATION_PROFILE_POINTS
    );
  }
  if (!summaryPolyline && !elevationProfile) return null;
  return {
    summary_polyline: summaryPolyline,
    elevation_profile: elevationProfile,
    route_profile_updated_at: new Date().toISOString(),
  };
}

/** Firestore Strava 로그에 코스 polyline·고도 프로파일 보강이 필요한지 */
function stravaLogNeedsRouteProfile(logData) {
  const d = logData || {};
  if (!String(d.summary_polyline || "").trim()) return true;
  if (d.elevation_profile == null && d.elevation_profile_json == null) return true;
  if (Array.isArray(d.elevation_profile) && d.elevation_profile.length < 2) return true;
  if (Array.isArray(d.elevation_profile_json) && d.elevation_profile_json.length < 2) return true;
  return false;
}

/** Strava Streams API 호출 (watts, heartrate, altitude). 429 시 최대 5회 재시도 */
async function fetchStravaStreams(accessToken, activityId) {
  const url = `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=time,watts,heartrate,altitude&key_by_type=true`;
  const maxRetries = 5;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
      let res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.status === 429) {
        await waitForStravaRateLimit(res);
        continue;
      }
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        const appInactive = isStravaApplicationInactiveError(res.status, bodyText);
        if (appInactive) logStravaApplicationInactive("fetchStravaStreams", { activityId });
        return { success: false, status: res.status, appInactive, watts: null, heartrate: null, altitude: null };
      }
      const raw = await res.json().catch(() => null);
      let wattsArray = null;
      let heartrateArray = null;
      let altitudeArray = null;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        wattsArray = Array.isArray(raw.watts) ? raw.watts : (raw.watts && Array.isArray(raw.watts.data) ? raw.watts.data : null);
        heartrateArray = Array.isArray(raw.heartrate)
          ? raw.heartrate
          : raw.heartrate && Array.isArray(raw.heartrate.data)
            ? raw.heartrate.data
            : null;
        altitudeArray = Array.isArray(raw.altitude)
          ? raw.altitude
          : raw.altitude && Array.isArray(raw.altitude.data)
            ? raw.altitude.data
            : null;
      } else {
        const streamArray = Array.isArray(raw) ? raw : raw && Array.isArray(raw.data) ? raw.data : [];
        const wattsStream = streamArray.find((s) => s && String(s.type || "").toLowerCase() === "watts");
        const heartrateStream = streamArray.find((s) => s && String(s.type || "").toLowerCase() === "heartrate");
        const altitudeStream = streamArray.find((s) => s && String(s.type || "").toLowerCase() === "altitude");
        wattsArray = wattsStream && Array.isArray(wattsStream.data) ? wattsStream.data : null;
        heartrateArray = heartrateStream && Array.isArray(heartrateStream.data) ? heartrateStream.data : null;
        altitudeArray = altitudeStream && Array.isArray(altitudeStream.data) ? altitudeStream.data : null;
      }
      return { success: true, watts: wattsArray, heartrate: heartrateArray, altitude: altitudeArray };
    } catch (e) {
      if (attempt === maxRetries) return { success: false, watts: null, heartrate: null };
    }
  }
  return { success: false, watts: null, heartrate: null };
}

async function fetchStravaActivitiesPage(accessToken, afterUnix, beforeUnix, page, perPage) {
  const url =
    `https://www.strava.com/api/v3/athlete/activities?after=${afterUnix}&before=${beforeUnix}` +
    `&per_page=${perPage || 200}&page=${page || 1}`;
  const maxRetries = 8;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.status === 429) {
        await waitForStravaRateLimit(res);
        continue;
      }
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        const appInactive = isStravaApplicationInactiveError(res.status, bodyText);
        if (appInactive) logStravaApplicationInactive("fetchStravaActivitiesPage", { afterUnix, beforeUnix, page });
        return {
          success: false,
          status: res.status,
          appInactive,
          activities: [],
          error: `Strava ${res.status}${appInactive ? " Application Inactive" : ""}`,
        };
      }
      const activities = await res.json().catch(() => []);
      return {
        success: true,
        status: res.status,
        activities: Array.isArray(activities) ? activities : [],
      };
    } catch (e) {
      if (attempt === maxRetries) {
        return {
          success: false,
          status: 0,
          activities: [],
          error: e && e.message ? e.message : "Request failed",
        };
      }
    }
  }
  return { success: false, status: 429, activities: [], error: "Strava 429 retries exhausted" };
}

/** max_watts 필드: 1초 순간 최대가 아닌 5초 롤링 평균의 최대 (필드명 max_watts 유지) */
const MAX_WATTS_WINDOW_SEC = 5;

/**
 * O(N) 슬라이딩 윈도우로 최대 평균 파워(MMP) 계산.
 * watts 배열: 인덱스 1초당 1개 값. seconds 구간의 최대 평균 파워 반환.
 */
function calculateMaxAveragePower(wattsArray, seconds) {
  if (!wattsArray || wattsArray.length < seconds) return 0;
  const arr = wattsArray;
  const len = arr.length;
  let sum = 0;
  for (let i = 0; i < seconds; i++) sum += Number(arr[i]) || 0;
  let maxAvg = sum / seconds;
  for (let i = seconds; i < len; i++) {
    sum -= Number(arr[i - seconds]) || 0;
    sum += Number(arr[i]) || 0;
    const avg = sum / seconds;
    if (avg > maxAvg) maxAvg = avg;
  }
  return Math.round(maxAvg);
}

/** 파워 스트림(1Hz)에서 max_watts — 5초 롤링 평균 최대, 5초 미만이면 순간 최대 */
function calculateMaxWattsFromPowerStream(wattsArray) {
  if (!wattsArray || wattsArray.length === 0) return null;
  const smoothed = smoothPowerSpikes(wattsArray);
  if (smoothed.length >= MAX_WATTS_WINDOW_SEC) {
    const v = calculateMaxAveragePower(smoothed, MAX_WATTS_WINDOW_SEC);
    return v > 0 ? v : null;
  }
  const instant = Math.max(...smoothed.map((w) => Number(w) || 0));
  return instant > 0 ? Math.round(instant) : null;
}

/** 심박 스트림 배열에서 구간별 최대 평균 심박 및 전체 최대 심박 계산 (MMP와 동일한 구간)
 *  - 스파이크 제거(smoothHeartRateSpikes) 후 5초 롤링 평균의 최대를 max_hr로 사용 (신뢰도 향상)
 *  - 5초 미만이면 순간 최대 사용 */
function calculateMaxHeartRatePeaks(heartrateArray) {
  if (!heartrateArray || heartrateArray.length === 0) return null;
  const raw = heartrateArray.map((v) => Number(v) || 0);
  const arr = smoothHeartRateSpikes(raw);
  const maxHr5sec = arr.length >= 5 ? Math.round(calculateMaxAveragePower(arr, 5)) : 0;
  const maxHrInstant = arr.length > 0 ? Math.max(...arr.filter((v) => v > 0)) : 0;
  const maxHr = maxHr5sec > 0 ? maxHr5sec : (maxHrInstant > 0 ? maxHrInstant : 0);
  if (maxHr <= 0) return null;
  return {
    max_hr_5sec: arr.length >= 5 ? maxHr5sec : null,
    max_hr_1min: arr.length >= 60 ? Math.round(calculateMaxAveragePower(arr, 60)) : null,
    max_hr_5min: arr.length >= 300 ? Math.round(calculateMaxAveragePower(arr, 300)) : null,
    max_hr_10min: arr.length >= 600 ? Math.round(calculateMaxAveragePower(arr, 600)) : null,
    max_hr_20min: arr.length >= 1200 ? Math.round(calculateMaxAveragePower(arr, 1200)) : null,
    max_hr_40min: arr.length >= 2400 ? Math.round(calculateMaxAveragePower(arr, 2400)) : null,
    max_hr_60min: arr.length >= 3600 ? Math.round(calculateMaxAveragePower(arr, 3600)) : null,
    max_hr: maxHr,
  };
}

/** MMP/심박 필드가 비어있는지 (null, undefined, '', NaN) 체크. 값이 없으면 true */
function isEmptyMmpValue(v) {
  if (v == null || v === undefined || v === "") return true;
  if (typeof v === "number" && isNaN(v)) return true;
  return false;
}

/**
 * Strava Webhook 활동 생성 이벤트 처리 (비동기 호출용).
 * owner_id(Strava athlete ID)로 유저 조회 → Activity 상세 + Streams 병렬 호출 → MMP 계산 → TSS/포인트 정산 → 저장.
 * 실패 시 { error, status, userId?, activityId } 반환 (재시도 큐 연동용).
 */
function buildProcessStravaActivityFailure(activityId, meta) {
  return {
    userId: meta && meta.userId ? meta.userId : null,
    activityId: String(activityId),
    userTss: 0,
    isNew: false,
    error: (meta && meta.error) || "processStravaActivity 실패",
    status: meta && meta.status != null ? Number(meta.status) : 0,
    activityDate: meta && meta.activityDate ? meta.activityDate : null,
  };
}

async function processStravaActivity(db, ownerId, objectId, options = {}) {
  const skipPointUpdate = Boolean(options && options.skipPointUpdate);
  const ownerIdNum = Number(ownerId);
  const activityId = String(objectId);
  // options.userId가 오면 athlete_id 조회를 건너뛰고 해당 유저 문서를 직접 사용한다.
  // (스케줄/갭 스캔·재시도 경로는 이미 userId를 알고 있으므로, strava_athlete_id 누락·불일치가 있어도 수집이 되도록 한다.)
  const forcedUserId = options && options.userId ? String(options.userId).trim() : "";
  if (!activityId || (!ownerIdNum && !forcedUserId)) {
    console.warn("[processStravaActivity] owner_id 또는 object_id 없음:", { ownerId, objectId });
    return buildProcessStravaActivityFailure(activityId, { error: "owner_id 또는 object_id 없음" });
  }
  let userDoc;
  if (forcedUserId) {
    const forcedSnap = await db.collection("users").doc(forcedUserId).get();
    if (!forcedSnap.exists) {
      console.warn("[processStravaActivity] userId=", forcedUserId, "문서 없음");
      return buildProcessStravaActivityFailure(activityId, { userId: forcedUserId, error: "user_not_found" });
    }
    userDoc = forcedSnap;
  } else {
    const usersSnap = await db.collection("users").where("strava_athlete_id", "==", ownerIdNum).limit(1).get();
    if (usersSnap.empty) {
      console.warn("[processStravaActivity] strava_athlete_id=", ownerIdNum, "에 해당하는 유저 없음");
      return buildProcessStravaActivityFailure(activityId, { error: "user_not_found" });
    }
    userDoc = usersSnap.docs[0];
  }
  const userId = userDoc.id;
  const userData = userDoc.data();
  const ftp = Number(userData.ftp) || 0;

  // 만료 5분 전 이내거나 토큰 없을 때만 갱신 (무조건 갱신 시 Rotating Refresh Token 경쟁 조건 방지)
  let accessToken = userData.strava_access_token || "";
  const tokenExpiresAt = Number(userData.strava_expires_at || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!accessToken || tokenExpiresAt < nowSec + 300) {
    try {
      const tokenResult = await refreshStravaTokenForUser(db, userId);
      accessToken = tokenResult.accessToken;
    } catch (e) {
      console.error("[processStravaActivity] 토큰 갱신 실패:", userId, e.message);
      return buildProcessStravaActivityFailure(activityId, {
        userId,
        error: `토큰 갱신 실패: ${e.message}`,
        status: 401,
      });
    }
  }

  let [detailRes, streamsRes] = await Promise.all([
    fetchStravaActivityDetail(accessToken, activityId),
    fetchStravaStreams(accessToken, activityId),
  ]);
  if ((detailRes && detailRes.status === 401) || (streamsRes && streamsRes.status === 401)) {
    try {
      const tokenResult = await refreshStravaTokenForUser(db, userId);
      accessToken = tokenResult.accessToken;
      [detailRes, streamsRes] = await Promise.all([
        fetchStravaActivityDetail(accessToken, activityId),
        fetchStravaStreams(accessToken, activityId),
      ]);
    } catch (e) {
      console.error("[processStravaActivity] 401 후 토큰 재갱신 실패:", userId, e.message);
      return buildProcessStravaActivityFailure(activityId, {
        userId,
        error: `401 후 토큰 재갱신 실패: ${e.message}`,
        status: 401,
      });
    }
  }

  if (!detailRes.success || !detailRes.activity) {
    const failStatus = Number(detailRes && detailRes.status) || 0;
    console.warn("[processStravaActivity] 활동 상세 조회 실패:", activityId, detailRes.error);
    return buildProcessStravaActivityFailure(activityId, {
      userId,
      error: detailRes.error || "활동 상세 조회 실패",
      status: failStatus || (String(detailRes.error || "").includes("429") ? 429 : 0),
    });
  }

  const activity = detailRes.activity;
  const mapped = mapStravaActivityToLogSchema(activity, userId, ftp, userData.weight ?? userData.weightKg);

  let max1minWatts = null;
  let max5minWatts = null;
  let max10minWatts = null;
  let max20minWatts = null;
  let max30minWatts = null;
  let max40minWatts = null;
  let max60minWatts = null;
  let maxWattsFromStream = null;
  if (streamsRes.success && Array.isArray(streamsRes.watts) && streamsRes.watts.length > 0) {
    const watts = smoothPowerSpikes(streamsRes.watts);
    max1minWatts = calculateMaxAveragePower(watts, 60);
    max5minWatts = calculateMaxAveragePower(watts, 300);
    max10minWatts = calculateMaxAveragePower(watts, 600);
    max20minWatts = calculateMaxAveragePower(watts, 1200);
    max30minWatts = calculateMaxAveragePower(watts, 1800);
    max40minWatts = calculateMaxAveragePower(watts, 2400);
    max60minWatts = calculateMaxAveragePower(watts, 3600);
    maxWattsFromStream = calculateMaxWattsFromPowerStream(watts);
  }

  const hrPeaks = streamsRes.success && Array.isArray(streamsRes.heartrate) && streamsRes.heartrate.length > 0
    ? calculateMaxHeartRatePeaks(streamsRes.heartrate)
    : null;

  let timeInZones = null;
  if (streamsRes.success && (streamsRes.watts?.length > 0 || streamsRes.heartrate?.length > 0)) {
    const effectiveFtp = getFTPWithFallback(userData, streamsRes.watts || []);
    timeInZones = await calculateZoneTimesFromStreams({
      wattsArray: streamsRes.watts || [],
      hrArray: streamsRes.heartrate || [],
      ftp: effectiveFtp,
      userId,
      db,
      dateStr: mapped.date || "",
    });
  }

  const tssAppliedAt = new Date().toISOString();
  const userWeight = (Number(userData.weight ?? userData.weightKg ?? 0) > 0)
    ? Number(userData.weight ?? userData.weightKg)
    : null;
  const logDoc = {
    activity_id: mapped.activity_id,
    user_id: mapped.user_id,
    source: mapped.source,
    activity_type: mapped.activity_type ?? null,
    date: mapped.date,
    title: mapped.title,
    distance_km: mapped.distance_km,
    duration_sec: mapped.duration_sec,
    time: mapped.time,
    avg_cadence: mapped.avg_cadence,
    avg_hr: mapped.avg_hr,
    max_hr: mapped.max_hr,
    avg_watts: mapped.avg_watts,
    max_watts: maxWattsFromStream ?? mapped.max_watts,
    weighted_watts: mapped.weighted_watts,
    kilojoules: mapped.kilojoules,
    elevation_gain: mapped.elevation_gain,
    avg_speed_kmh: mapped.avg_speed_kmh ?? null,
    left_right_balance: mapped.left_right_balance ?? null,
    pedal_smoothness_left: mapped.pedal_smoothness_left ?? null,
    pedal_smoothness_right: mapped.pedal_smoothness_right ?? null,
    torque_effectiveness_left: mapped.torque_effectiveness_left ?? null,
    torque_effectiveness_right: mapped.torque_effectiveness_right ?? null,
    rpe: mapped.rpe,
    ftp_at_time: mapped.ftp_at_time,
    if: mapped.if,
    tss: mapped.tss,
    efficiency_factor: mapped.efficiency_factor,
    time_in_zones: timeInZones || mapped.time_in_zones,
    earned_points: mapped.earned_points,
    workout_id: mapped.workout_id,
    tss_applied: true,
    tss_applied_at: tssAppliedAt,
    created_at: mapped.created_at,
  };
  if (userWeight != null) logDoc.weight = userWeight;
  if (max1minWatts != null) logDoc.max_1min_watts = max1minWatts;
  if (max5minWatts != null) logDoc.max_5min_watts = max5minWatts;
  if (max10minWatts != null) logDoc.max_10min_watts = max10minWatts;
  if (max20minWatts != null) logDoc.max_20min_watts = max20minWatts;
  if (max30minWatts != null) logDoc.max_30min_watts = max30minWatts;
  if (max40minWatts != null) logDoc.max_40min_watts = max40minWatts;
  if (max60minWatts != null) logDoc.max_60min_watts = max60minWatts;
  if (userWeight != null && userWeight > 0) {
    sanitizePeakPowerWattsOnRow(logDoc, userWeight);
  }
  if (hrPeaks) {
    if (hrPeaks.max_hr_5sec != null) logDoc.max_hr_5sec = hrPeaks.max_hr_5sec;
    if (hrPeaks.max_hr_1min != null) logDoc.max_hr_1min = hrPeaks.max_hr_1min;
    if (hrPeaks.max_hr_5min != null) logDoc.max_hr_5min = hrPeaks.max_hr_5min;
    if (hrPeaks.max_hr_10min != null) logDoc.max_hr_10min = hrPeaks.max_hr_10min;
    if (hrPeaks.max_hr_20min != null) logDoc.max_hr_20min = hrPeaks.max_hr_20min;
    if (hrPeaks.max_hr_40min != null) logDoc.max_hr_40min = hrPeaks.max_hr_40min;
    if (hrPeaks.max_hr_60min != null) logDoc.max_hr_60min = hrPeaks.max_hr_60min;
    if (hrPeaks.max_hr != null) logDoc.max_hr = hrPeaks.max_hr;
  }

  const routeProfile = buildStravaRouteProfileFields(activity, streamsRes);
  if (routeProfile) {
    if (routeProfile.summary_polyline) logDoc.summary_polyline = routeProfile.summary_polyline;
    if (routeProfile.elevation_profile) logDoc.elevation_profile = routeProfile.elevation_profile;
    logDoc.route_profile_updated_at = routeProfile.route_profile_updated_at;
  }

  // Run/Swim/Walk/TrailRun/WeightTraining 등 비라이딩 활동은 라이딩 기록 컬렉션에 저장하지 않음
  if (!isCyclingForMmp(mapped)) {
    console.log(`[processStravaActivity] 비라이딩 활동 저장 제외: userId=${userId} activityId=${activityId} activity_type=${mapped.activity_type}`);
    return { userId, activityId, userTss: 0, isNew: false };
  }

  const isNew = !(await stravaLogRead.hasStravaActivityLog(db, userId, activityId, {
    supabaseDualWriteServer,
  }));

  const logsRef = db.collection("users").doc(userId).collection("logs");
  try {
    await stravaDualWrite.dualWriteStravaActivityLog(
      admin,
      userId,
      activityId,
      logDoc,
      () => logsRef.doc(activityId).set(logDoc, { merge: true })
    );
  } catch (e) {
    console.error("[processStravaActivity] dual-write 실패:", userId, activityId, e.message);
    return buildProcessStravaActivityFailure(activityId, {
      userId,
      error: `dual-write 실패: ${e.message}`,
      status: 500,
      activityDate: mapped.date || null,
    });
  }

  const activityDateYmd = rankingDayRollup.normalizeLogDateToSeoulYmd(mapped.date);
  if (activityDateYmd) {
    try {
      await supabaseDualWriteServer.syncRankingDayBucketsToSupabaseForUser(
        db,
        userId,
        activityDateYmd,
        activityDateYmd
      );
    } catch (parityErr) {
      console.warn(
        "[processStravaActivity] daily_summary bucket parity:",
        userId,
        activityDateYmd,
        parityErr && parityErr.message ? parityErr.message : parityErr
      );
    }
  }

  let userTss = 0;
  if (isCyclingForMmp(mapped) && isNew && mapped.tss > 0 && (mapped.distance_km || 0) !== 0) {
    const dateStr = mapped.date || "";
    const dayTotal = await getTotalTssForDate(db, userId, dateStr);
    if (dayTotal >= TSS_PER_DAY_CHEAT_THRESHOLD) {
      userTss = 0; // 1일 500+ TSS 치팅: 포인트 적립 제외
    } else {
      const stelvioDates = await getStelvioLogDates(db, userId);
      if (stelvioDates.has(dateStr)) {
        const stelvioPoints = await getStelvioPointsForDate(db, userId, dateStr);
        const diff = Math.max(0, (mapped.tss || 0) - (stelvioPoints || 0));
        userTss = diff;
      } else {
        userTss = mapped.tss || 0;
      }
    }
  }

  if (userTss > 0 && !skipPointUpdate) {
    try {
      await updateUserMileageInFirestore(db, userId, userTss);
    } catch (e) {
      console.error("[processStravaActivity] 포인트 업데이트 실패:", userId, e.message);
    }
  }

  console.log("[processStravaActivity] 완료:", { userId, activityId, isNew, userTss, max5minWatts, max10minWatts, max30minWatts });
  return { userId, activityId, userTss, isNew, activityDate: mapped.date || null };
}

function pickFirstFiniteNumberFromStravaActivity(obj, keys) {
  if (!obj || !keys || !keys.length) return null;
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function computeAvgSpeedKmhFromStravaActivity(activity, distanceKm, durationSec) {
  const avgMs = Number(activity && activity.average_speed);
  if (Number.isFinite(avgMs) && avgMs > 0) {
    return Math.round(avgMs * 3.6 * 100) / 100;
  }
  const d = Number(distanceKm) || 0;
  const t = Number(durationSec) || 0;
  if (d > 0 && t > 0) {
    return Math.round((d / (t / 3600)) * 100) / 100;
  }
  return null;
}

function extractStravaPedalingExtrasFromActivity(activity) {
  if (!activity || typeof activity !== "object") {
    return {
      left_right_balance: null,
      pedal_smoothness_left: null,
      pedal_smoothness_right: null,
      torque_effectiveness_left: null,
      torque_effectiveness_right: null,
    };
  }
  return {
    left_right_balance: pickFirstFiniteNumberFromStravaActivity(activity, [
      "left_right_balance",
      "average_left_right_balance",
      "avg_left_right_balance",
    ]),
    pedal_smoothness_left: pickFirstFiniteNumberFromStravaActivity(activity, [
      "average_pedal_smoothness_left",
      "pedal_smoothness_left",
      "avg_pedal_smoothness_left",
    ]),
    pedal_smoothness_right: pickFirstFiniteNumberFromStravaActivity(activity, [
      "average_pedal_smoothness_right",
      "pedal_smoothness_right",
      "avg_pedal_smoothness_right",
    ]),
    torque_effectiveness_left: pickFirstFiniteNumberFromStravaActivity(activity, [
      "average_torque_effectiveness_left",
      "torque_effectiveness_left",
      "avg_torque_effectiveness_left",
    ]),
    torque_effectiveness_right: pickFirstFiniteNumberFromStravaActivity(activity, [
      "average_torque_effectiveness_right",
      "torque_effectiveness_right",
      "avg_torque_effectiveness_right",
    ]),
  };
}

/**
 * Strava 활동 → 로그 스키마 매핑 (수동 동기화 mapStravaActivityToSchema와 동일한 필드)
 * 상세 API 응답 기준으로 avg_hr, max_hr, avg_cadence, elevation_gain, kilojoules 등 포함.
 * @param {number} [weightKg] - 체중(kg), rTSS
 */
function mapStravaActivityToLogSchema(activity, userId, ftpAtTime, weightKg) {
  const title = activity.name || "";
  const startDateLocal = activity.start_date_local || activity.start_date || "";
  let dateStr = "";
  if (startDateLocal) {
    try {
      const localDateMatch = String(startDateLocal).match(/^(\d{4}-\d{2}-\d{2})/);
      dateStr = localDateMatch
        ? localDateMatch[1]
        : new Date(startDateLocal).toISOString().split("T")[0];
    } catch (e) {
      dateStr = String(startDateLocal).split("T")[0] || "";
    }
  }
  const distanceMeters = Number(activity.distance) || 0;
  const distanceKm = Math.round((distanceMeters / 1000) * 100) / 100;
  const durationSec = Math.round(Number(activity.moving_time) || 0);
  const avgCadence = activity.average_cadence != null ? Number(activity.average_cadence) : null;
  const avgHr = activity.average_heartrate != null ? Number(activity.average_heartrate) : null;
  const maxHr = activity.max_heartrate != null ? Number(activity.max_heartrate) : null;
  const avgWatts = activity.average_watts != null ? Number(activity.average_watts) : null;
  const maxWatts = activity.max_watts != null ? Number(activity.max_watts) : null;
  const weightedWatts = activity.weighted_average_watts != null ? Number(activity.weighted_average_watts) : null;
  const kilojoules = activity.kilojoules != null ? Number(activity.kilojoules) : null;
  const elevationGain = activity.total_elevation_gain != null ? Number(activity.total_elevation_gain) : null;
  const rpe = activity.perceived_exertion != null ? Number(activity.perceived_exertion) : null;
  const ftp = Number(ftpAtTime) || 0;
  const np = weightedWatts != null ? weightedWatts : (avgWatts != null ? avgWatts : 0);
  const avgForTss = (avgWatts != null && avgWatts > 0) ? avgWatts : np;
  const wEff = (Number(weightKg) > 0) ? Number(weightKg) : STELVIO_RTSS_DEFAULT_WEIGHT_KG;
  let ifValue = null;
  if (ftp > 0 && np > 0) ifValue = Math.round((np / ftp) * 1000) / 1000;
  let tss = 0;
  if (ftp > 0 && np > 0 && durationSec > 0) {
    tss = Math.max(0, calculateStelvioRevisedTSS(durationSec, avgForTss, np, ftp, wEff));
  }
  let efficiencyFactor = null;
  if (np > 0 && avgHr != null && avgHr > 0) efficiencyFactor = Math.round((np / avgHr) * 100) / 100;
  const now = new Date().toISOString();
  const activityType = String(activity.sport_type || activity.type || "").trim() || null;
  const avgSpeedKmh = computeAvgSpeedKmhFromStravaActivity(activity, distanceKm, durationSec);
  const pedaling = extractStravaPedalingExtrasFromActivity(activity);
  return {
    activity_id: String(activity.id || ""),
    user_id: userId,
    source: "strava",
    activity_type: activityType,
    title,
    date: dateStr,
    distance_km: distanceKm,
    duration_sec: durationSec,
    time: durationSec,
    avg_cadence: avgCadence,
    avg_hr: avgHr,
    max_hr: maxHr,
    avg_watts: avgWatts,
    max_watts: maxWatts,
    weighted_watts: weightedWatts,
    kilojoules: kilojoules,
    elevation_gain: elevationGain,
    avg_speed_kmh: avgSpeedKmh,
    left_right_balance: pedaling.left_right_balance,
    pedal_smoothness_left: pedaling.pedal_smoothness_left,
    pedal_smoothness_right: pedaling.pedal_smoothness_right,
    torque_effectiveness_left: pedaling.torque_effectiveness_left,
    torque_effectiveness_right: pedaling.torque_effectiveness_right,
    rpe: rpe,
    ftp_at_time: ftp > 0 ? ftp : null,
    if: ifValue,
    tss: tss,
    efficiency_factor: efficiencyFactor,
    time_in_zones: null,
    earned_points: 0,
    workout_id: null,
    created_at: now,
  };
}

/**
 * 한국(Asia/Seoul) 기준 "전날" 00:00~23:59 구간을 반환.
 * Cloud Functions 서버는 UTC이므로, 서버 시간이 아닌 서울 시간 기준으로 계산해야
 * 한국 사용자 기준 "어제" 로그를 올바르게 가져온다.
 */
function getYesterdayAfterBefore() {
  const now = new Date();
  // 오늘 날짜를 서울 시간 기준 YYYY-MM-DD로 얻기
  const todaySeoulStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const [y, m, d] = todaySeoulStr.split("-").map(Number);
  // 전날(서울 기준) 날짜 계산
  const todaySeoul = new Date(y, m - 1, d);
  todaySeoul.setDate(todaySeoul.getDate() - 1);
  const yesterY = todaySeoul.getFullYear();
  const yesterM = todaySeoul.getMonth() + 1;
  const yesterD = todaySeoul.getDate();
  const pad = (n) => String(n).padStart(2, "0");
  const dateFrom = `${yesterY}-${pad(yesterM)}-${pad(yesterD)}`;
  const dateTo = dateFrom;
  // 서울 시간 00:00:00, 23:59:59.999 를 Unix 타임스탬프로 (Strava API는 UTC Unix 사용)
  const startSeoul = new Date(`${dateFrom}T00:00:00+09:00`);
  const endSeoul = new Date(`${dateTo}T23:59:59.999+09:00`);
  const afterUnix = Math.floor(startSeoul.getTime() / 1000);
  const beforeUnix = Math.floor(endSeoul.getTime() / 1000);
  return { afterUnix, beforeUnix, dateFrom, dateTo };
}

/**
 * 한국(Asia/Seoul) 기준 "오늘" 00:00~23:59 구간을 반환.
 * 일요일 19시 당일 Strava 수집 스케줄에서 사용.
 */
function getTodayAfterBefore() {
  const now = new Date();
  const todaySeoulStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const [y, m, d] = todaySeoulStr.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const dateFrom = `${y}-${pad(m)}-${pad(d)}`;
  const dateTo = dateFrom;
  const startSeoul = new Date(`${dateFrom}T00:00:00+09:00`);
  const endSeoul = new Date(`${dateTo}T23:59:59.999+09:00`);
  const afterUnix = Math.floor(startSeoul.getTime() / 1000);
  const beforeUnix = Math.floor(endSeoul.getTime() / 1000);
  return { afterUnix, beforeUnix, dateFrom, dateTo };
}

async function getStelvioLogDates(db, userId) {
  const dates = new Set();
  // [비용절감] 전체 로그 스캔 대신 최근 1년치만 조회 (Strava 비교는 최근 데이터만 필요)
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];
  const snapshot = await db.collection("users").doc(userId).collection("logs")
    .where("date", ">=", cutoffStr)
    .get();
  snapshot.docs.forEach((doc) => {
    const log = doc.data();
    if (log.source === "strava") return;
    let dateStr = "";
    if (log.date) {
      if (typeof log.date === "string") dateStr = log.date;
      else if (log.date.toDate) dateStr = log.date.toDate().toISOString().split("T")[0];
      else if (log.date instanceof Date) dateStr = log.date.toISOString().split("T")[0];
    }
    if (dateStr) dates.add(dateStr);
  });
  return dates;
}

/** 해당 날짜의 1일 총 TSS (Strava 우선, 없으면 Stelvio). 500+ 치팅 제외 판단용. */
async function getTotalTssForDate(db, userId, dateStr) {
  if (!userId || !dateStr) return 0;
  try {
    const snapshot = await db.collection("users").doc(userId).collection("logs").where("date", "==", dateStr).get();
    let strava = 0;
    let stelvio = 0;
    snapshot.docs.forEach((doc) => {
      const d = doc.data();
      if (!isCyclingForMmp(d)) return; // Run, Swim, Walk, TrailRun 제외
      const tss = Number(d.tss) || 0;
      const isStrava = String(d.source || "").toLowerCase() === "strava";
      if (isStrava) strava += tss;
      else stelvio += tss;
    });
    if (supabaseDualWriteServer.isPhase4FirestoreLogShadowStopped()) {
      try {
        strava = await supabaseDualWriteServer.fetchStravaTssSumForDate(userId, dateStr);
      } catch (sbErr) {
        console.warn("[getTotalTssForDate] supabase strava TSS 조회 실패:", dateStr, sbErr.message);
      }
    }
    return strava > 0 ? strava : stelvio;
  } catch (e) {
    console.warn("[getTotalTssForDate]", dateStr, e.message);
    return 0;
  }
}

/** 해당 날짜의 Stelvio(앱) 적립 포인트 합계 조회. 차액 적립 시 사용. */
async function getStelvioPointsForDate(db, userId, dateStr) {
  if (!userId || !dateStr) return 0;
  try {
    const snapshot = await db.collection("users").doc(userId).collection("logs").where("date", "==", dateStr).get();
    let sum = 0;
    snapshot.docs.forEach((doc) => {
      const log = doc.data();
      if (log.source === "strava") return;
      const pts = Number(log.earned_points != null ? log.earned_points : log.tss) || 0;
      sum += pts;
    });
    return sum;
  } catch (e) {
    console.warn("[getStelvioPointsForDate]", dateStr, e.message);
    return 0;
  }
}

async function getExistingStravaActivityIds(db, userId, activityIds) {
  if (Array.isArray(activityIds) && activityIds.length > 0) {
    const { ids } = await stravaLogRead.getExistingStravaLogDocsByActivityIds(db, userId, activityIds, {
      supabaseDualWriteServer,
    });
    return ids;
  }
  const ids = new Set();
  // legacy: activityIds 미지정 시 1년 range query
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];
  const snapshot = await db.collection("users").doc(userId).collection("logs")
    .where("source", "==", "strava")
    .where("date", ">=", cutoffStr)
    .get();
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    if (data.activity_id) ids.add(String(data.activity_id));
  });
  if (supabaseDualWriteServer.isPhase4FirestoreLogShadowStopped()) {
    try {
      const sbIds = await supabaseDualWriteServer.fetchStravaActivityIdsForUser(userId, cutoffStr);
      sbIds.forEach((id) => ids.add(id));
    } catch (sbErr) {
      console.warn("[getExistingStravaActivityIds] supabase 조회 실패:", userId, sbErr.message);
    }
  }
  return ids;
}

/** activityIds 있으면 doc.getAll, 없으면 legacy 1년 range query */
async function getExistingStravaLogsMap(db, userId, activityIds) {
  if (Array.isArray(activityIds) && activityIds.length > 0) {
    const { ids, docMap, readCount } = await stravaLogRead.getExistingStravaLogDocsByActivityIds(
      db,
      userId,
      activityIds,
      { supabaseDualWriteServer }
    );
    return { ids, docMap, readCount };
  }
  const ids = new Set();
  const docMap = new Map();
  // legacy: activityIds 미지정 시 1년 range query
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];
  const snapshot = await db.collection("users").doc(userId).collection("logs")
    .where("source", "==", "strava")
    .where("date", ">=", cutoffStr)
    .get();
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const actId = data.activity_id ? String(data.activity_id) : null;
    if (actId) {
      ids.add(actId);
      docMap.set(actId, { ref: doc.ref, data });
    }
  });
  return { ids, docMap, readCount: snapshot.size };
}

async function refreshStravaTokenForUser(db, userId) {
  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new Error("사용자를 찾을 수 없습니다.");
  const initialUserData = userSnap.data() || {};
  const refreshToken = initialUserData.strava_refresh_token || "";
  if (!refreshToken) throw new Error("Strava 리프레시 토큰이 없습니다.");
  const appConfigSnap = await db.collection("appConfig").doc("strava").get();
  if (!appConfigSnap.exists) throw new Error("Strava 앱 설정이 없습니다.");
  const clientId = appConfigSnap.data().strava_client_id || "";
  const clientSecret = getStravaClientSecret();
  if (!clientId || !clientSecret) throw new Error("Strava 설정이 불완전합니다.");
  const tokenUrl = "https://www.strava.com/api/v3/oauth/token";
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  let tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  let tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    /*
     * Strava refresh token은 회전형이다. 웹훅·수동·스케줄이 같은 사용자를 동시에 갱신하면
     * 한 요청은 이미 사용된 refresh token으로 실패할 수 있으므로 최신 사용자 문서를 다시 읽어 복구한다.
     */
    const latestSnap = await userRef.get();
    const latest = latestSnap.exists ? latestSnap.data() || {} : {};
    const latestAccess = String(latest.strava_access_token || "");
    const latestRefresh = String(latest.strava_refresh_token || "");
    const latestExpires = Number(latest.strava_expires_at || 0);
    const nowSec = Math.floor(Date.now() / 1000);
    if (latestAccess && latestRefresh && latestRefresh !== String(refreshToken) && latestExpires > nowSec + 300) {
      console.warn("[refreshStravaTokenForUser] concurrent refresh recovered:", userId);
      return { accessToken: latestAccess };
    }
    if (latestRefresh && latestRefresh !== String(refreshToken)) {
      const retryBody = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: latestRefresh,
      });
      tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: retryBody.toString(),
      });
      tokenData = await tokenRes.json().catch(() => ({}));
    }
  }
  if (!tokenRes.ok) {
    throw new Error(tokenData.message || tokenData.error || `Strava ${tokenRes.status}`);
  }
  const accessToken = tokenData.access_token || "";
  const newRefreshToken = tokenData.refresh_token || refreshToken;
  const expiresAt = tokenData.expires_at != null ? Number(tokenData.expires_at) : 0;
  const scopeUpdate = buildStravaScopeUpdate(tokenData);
  if (!accessToken) throw new Error("Strava에서 access_token을 받지 못했습니다.");
  await userRef.update({
    strava_access_token: accessToken,
    strava_refresh_token: newRefreshToken,
    strava_expires_at: expiresAt,
    ...scopeUpdate,
  });
  return { accessToken, scope: scopeUpdate.strava_scope || "" };
}

async function updateUserMileageInFirestore(db, userId, todayTss) {
  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new Error("사용자를 찾을 수 없습니다.");
  const userData = userSnap.data();
  let accPoints = Number(userData.acc_points || 0);
  let remPoints = Number(userData.rem_points || 0);
  const expiryDate = userData.expiry_date || "";
  const lastTrainingDate = userData.last_training_date || "";
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentDate = today.toISOString().split("T")[0];
  let shouldResetAccPoints = false;
  if (lastTrainingDate) {
    try {
      const lastYear = new Date(lastTrainingDate).getFullYear();
      if (lastYear < currentYear) shouldResetAccPoints = true;
    } catch (e) { /* ignore */ }
  } else {
    shouldResetAccPoints = true;
  }
  if (shouldResetAccPoints) accPoints = 0;
  const calcPool = remPoints + todayTss;
  const addDays = Math.floor(calcPool / 500);
  const newRemPoints = calcPool % 500;
  const newAccPoints = accPoints + todayTss;
  let newExpiryDate = expiryDate;
  // 이미 만료된 사용자: 오늘 기준 + addDays 적용. 미만료: 기존 만료일 + addDays
  if (addDays > 0) {
    try {
      let baseDate;
      if (expiryDate) {
        const expiry = new Date(expiryDate);
        expiry.setHours(0, 0, 0, 0);
        const todayStart = new Date(today);
        todayStart.setHours(0, 0, 0, 0);
        baseDate = expiry.getTime() < todayStart.getTime()
          ? new Date(today.getTime())
          : new Date(expiry.getTime());
      } else {
        baseDate = new Date(today.getTime());
      }
      baseDate.setDate(baseDate.getDate() + addDays);
      newExpiryDate = baseDate.toISOString().split("T")[0];
    } catch (e) { /* ignore */ }
  }
  const updateData = {
    acc_points: newAccPoints,
    rem_points: newRemPoints,
    last_training_date: currentDate,
  };
  if (addDays > 0 && newExpiryDate) updateData.expiry_date = newExpiryDate;
  await userRef.update(updateData);
  return { acc_points: newAccPoints, rem_points: newRemPoints, expiry_date: newExpiryDate };
}

// ---------- 1000명 규모 설계 상수 ----------
const STRAVA_SYNC_CHUNK_SIZE = 50;        // 청크당 사용자 수 (팬아웃)
const STRAVA_SYNC_CONCURRENCY = 10;      // 청크 내 동시 처리 사용자 수
const STRAVA_SYNC_CHUNK_THRESHOLD = 100; // 이 인원 초과 시 청크 팬아웃 사용
const INTERNAL_SYNC_SECRET = "stelvio-internal-sync-v1"; // 청크 HTTP 인증 (필요 시 Secret으로 교체)

async function ensureExistingStravaLogMirroredToSupabase(userId, logDocId, logData, contextLabel) {
  if (!userId || !logDocId || !logData) return false;
  if (!isCyclingForMmp(logData)) return false;
  try {
    await supabaseDualWriteServer.runSecondaryAfterStravaLogSave(
      admin,
      userId,
      logDocId,
      {
        ...logData,
        source: "strava",
        activity_id: logData.activity_id || logDocId,
      },
      { force: true }
    );
    return true;
  } catch (e) {
    console.warn(
      `[${contextLabel || "stravaSync"}] existing Firebase log → Supabase rides mirror failed:`,
      userId,
      logDocId,
      e && e.message ? e.message : e
    );
    try {
      const stravaSyncRetry = require("./stravaSyncRetry");
      const ymd = rankingDayRollup.normalizeLogDateToSeoulYmd(logData.date);
      if (ymd) {
        await stravaSyncRetry.markStravaSyncRetryPending(admin.firestore(), userId, {
          dateFrom: ymd,
          dateTo: ymd,
          reason: "mirror_failed",
          status: 500,
          activityId: logDocId,
        });
      }
    } catch (markErr) {
      console.warn("[stravaSync] mark mirror retry failed:", userId, logDocId, markErr.message);
    }
    return false;
  }
}

async function recordStravaActivityFetchDiagnostic(db, userId, diagnostic) {
  try {
    const count = Number(diagnostic && diagnostic.count);
    const status = Number(diagnostic && diagnostic.status);
    const update = {
      strava_last_activity_fetch_at: new Date().toISOString(),
      strava_last_activity_fetch_status: Number.isFinite(status) ? status : 0,
      strava_last_activity_fetch_count: Number.isFinite(count) ? count : 0,
      strava_last_activity_fetch_pages: Number(diagnostic && diagnostic.pages) || 0,
      strava_last_activity_fetch_empty: Number.isFinite(count) ? count === 0 : true,
      strava_last_activity_fetch_range: {
        dateFrom: diagnostic && diagnostic.dateFrom ? String(diagnostic.dateFrom) : null,
        dateTo: diagnostic && diagnostic.dateTo ? String(diagnostic.dateTo) : null,
        afterUnix: Number(diagnostic && diagnostic.afterUnix) || null,
        beforeUnix: Number(diagnostic && diagnostic.beforeUnix) || null,
      },
    };
    if (diagnostic && diagnostic.source) update.strava_last_activity_fetch_source = String(diagnostic.source).slice(0, 80);
    if (diagnostic && diagnostic.scope) update.strava_last_activity_fetch_scope = String(diagnostic.scope).slice(0, 300);
    if (diagnostic && diagnostic.hasActivityRead != null) {
      update.strava_last_activity_fetch_has_activity_read = diagnostic.hasActivityRead === true;
    }
    if (diagnostic && diagnostic.hasActivityReadAll != null) {
      update.strava_last_activity_fetch_has_activity_read_all = diagnostic.hasActivityReadAll === true;
    }
    if (diagnostic && diagnostic.storedAthleteId != null) {
      update.strava_last_activity_fetch_stored_athlete_id = Number(diagnostic.storedAthleteId) || null;
    }
    if (diagnostic && diagnostic.tokenAthleteId != null) {
      update.strava_last_activity_fetch_token_athlete_id = Number(diagnostic.tokenAthleteId) || null;
    }
    if (diagnostic && diagnostic.athleteIdMatches != null) {
      update.strava_last_activity_fetch_athlete_id_matches = diagnostic.athleteIdMatches === true;
    }
    if (diagnostic && diagnostic.hint) {
      update.strava_last_activity_fetch_hint = String(diagnostic.hint).slice(0, 500);
    }
    if (diagnostic && diagnostic.error) {
      update.strava_last_activity_fetch_error = String(diagnostic.error).slice(0, 500);
    } else {
      update.strava_last_activity_fetch_error = admin.firestore.FieldValue.delete();
    }
    await db.collection("users").doc(userId).update(update);
  } catch (e) {
    console.warn(
      "[recordStravaActivityFetchDiagnostic] failed:",
      userId,
      e && e.message ? e.message : e
    );
  }
}

function buildStravaFetchDiagnosticBase(userData, source) {
  const scope = String((userData && userData.strava_scope) || "").trim();
  return {
    source,
    scope,
    hasActivityRead:
      userData && userData.strava_has_activity_read != null
        ? userData.strava_has_activity_read === true
        : normalizeStravaScopes(scope).includes("activity:read"),
    hasActivityReadAll:
      userData && userData.strava_has_activity_read_all != null
        ? userData.strava_has_activity_read_all === true
        : normalizeStravaScopes(scope).includes("activity:read_all"),
    storedAthleteId: userData && userData.strava_athlete_id != null ? Number(userData.strava_athlete_id) : null,
  };
}

function buildEmptyStravaFetchHint(diagnosticBase, count, status) {
  const hasReadAll = diagnosticBase && diagnosticBase.hasActivityReadAll === true;
  const hasRead = diagnosticBase && diagnosticBase.hasActivityRead === true;
  if (Number(status) === 403) {
    return "Strava가 403(Forbidden)을 반환했습니다. 앱이 비활성(Application Inactive) 상태이면 전체 사용자 공통 장애이므로 https://www.strava.com/settings/api 에서 앱 상태/티어 승인을 확인해야 합니다.";
  }
  if (Number(status) !== 200) return "Strava 활동 목록 API가 200이 아니어서 수집 실패 상태입니다.";
  if (!hasReadAll && !hasRead) return "활동 읽기 권한(activity:read 또는 activity:read_all)이 없어 활동 목록을 가져올 수 없습니다.";
  if (hasReadAll && Number(count) === 0) {
    return "activity:read_all 권한은 있으나 조회 기간 활동 목록이 0건입니다. 기간 내 실제 라이딩 없음, 다른 Strava 계정 연결, 또는 Strava 활동 공개/계정 상태를 확인해야 합니다.";
  }
  if (Number(count) === 0) return "조회 기간 활동 목록이 0건입니다. 기간과 연결 계정을 확인해야 합니다.";
  return "";
}

async function fetchStravaAthleteProfileDiagnostic(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch("https://www.strava.com/api/v3/athlete", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { status: res.status, athleteId: null };
    const athlete = await res.json().catch(() => null);
    return {
      status: res.status,
      athleteId: athlete && athlete.id != null ? Number(athlete.id) : null,
    };
  } catch (e) {
    return { status: 0, athleteId: null, error: e && e.message ? e.message : String(e) };
  }
}

/** 단일 사용자 Strava 동기화 (병렬 배치용). Webhook 실패 보완: MMP(5/10/30분 파워) 없으면 Streams로 보완. */
async function processOneUserStravaSync(db, userId, userData, { afterUnix, beforeUnix, dateFrom, dateTo }) {
  const ftp = Number(userData.ftp) || 0;
  // 만료 5분 전 이내거나 토큰 없을 때만 갱신 (무조건 갱신 시 Rotating Refresh Token 경쟁 조건 방지)
  let accessToken = userData.strava_access_token || "";
  const tokenExpiresAt = Number(userData.strava_expires_at || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!accessToken || tokenExpiresAt < nowSec + 300) {
    try {
      const tokenResult = await refreshStravaTokenForUser(db, userId);
      accessToken = tokenResult.accessToken;
    } catch (e) {
      await recordStravaActivityFetchDiagnostic(db, userId, {
        afterUnix,
        beforeUnix,
        dateFrom,
        dateTo,
        status: 0,
        count: 0,
        pages: 0,
        error: `토큰 갱신 실패: ${e.message}`,
      });
      return { userId, processed: 0, newActivities: 0, userTss: 0, error: `토큰 갱신 실패: ${e.message}` };
    }
  }
  const activities = [];
  let page = 1;
  let firstPageStatus = 0;
  while (page <= 10) {
    let pageRes = await stravaSyncRetry.fetchActivitiesPageWithOuter429Retry(
      fetchStravaActivitiesPage,
      accessToken,
      afterUnix,
      beforeUnix,
      page,
      200,
      `stravaSync:${userId}`
    );
    if (!pageRes.success && pageRes.status === 401) {
      try {
        const tokenResult = await refreshStravaTokenForUser(db, userId);
        accessToken = tokenResult.accessToken;
        pageRes = await fetchStravaActivitiesPage(accessToken, afterUnix, beforeUnix, page, 200);
      } catch (e) {
        await recordStravaActivityFetchDiagnostic(db, userId, {
          afterUnix,
          beforeUnix,
          dateFrom,
          dateTo,
          status: 401,
          count: 0,
          pages: page,
          error: `토큰 재갱신 실패: ${e.message}`,
        });
        return { userId, processed: 0, newActivities: 0, userTss: 0, error: `토큰 재갱신 실패: ${e.message}` };
      }
    }
    if (page === 1) firstPageStatus = pageRes.status || 0;
    if (!pageRes.success) {
      const failStatus = pageRes.status || 0;
      const appInactive = pageRes.appInactive === true;
      await recordStravaActivityFetchDiagnostic(db, userId, {
        afterUnix,
        beforeUnix,
        dateFrom,
        dateTo,
        status: failStatus,
        count: activities.length,
        pages: page,
        error: `활동 조회 실패: ${pageRes.status || pageRes.error}`,
        hint: appInactive
          ? "Strava 애플리케이션이 비활성(Inactive) 상태입니다. 특정 사용자 문제가 아닌 앱(client_id) 공통 장애이며, https://www.strava.com/settings/api 에서 앱 상태/티어를 확인해 재활성화·승인해야 수집이 재개됩니다."
          : undefined,
      });
      // 앱 비활성(403 Inactive)은 사용자별 재시도로 복구 불가 → pending 큐에 쌓지 않음(무의미한 재시도·쿼터 소모 방지).
      // 앱 재활성화 후 스케줄 동기화가 자동으로 재수집한다.
      if (failStatus === 429) {
        await stravaSyncRetry.markStravaSyncRetryPending(db, userId, {
          dateFrom,
          dateTo,
          afterUnix,
          beforeUnix,
          reason: "429",
          status: 429,
        });
      }
      return {
        userId,
        processed: 0,
        newActivities: 0,
        userTss: 0,
        appInactive,
        status: failStatus,
        error: `활동 조회 실패: ${pageRes.status || pageRes.error}`,
      };
    }
    activities.push(...pageRes.activities);
    if (pageRes.activities.length < 200) break;
    page += 1;
  }
  const actCount = activities.length;
  console.log(`[stravaSync] userId=${userId} athlete_id=${userData.strava_athlete_id || "?"} activities=${actCount} status=${firstPageStatus} pages=${page}`);
  if (actCount === 0 || firstPageStatus !== 200) {
    const diagnosticBase = buildStravaFetchDiagnosticBase(userData, "processOneUserStravaSync");
    await recordStravaActivityFetchDiagnostic(db, userId, {
      ...diagnosticBase,
      afterUnix,
      beforeUnix,
      dateFrom,
      dateTo,
      status: firstPageStatus,
      count: actCount,
      pages: page,
      hint: buildEmptyStravaFetchHint(diagnosticBase, actCount, firstPageStatus),
    });
  }
  const syncActivityIds = (Array.isArray(activities) ? activities : [])
    .map((act) => (act && act.id != null ? String(act.id) : ""))
    .filter(Boolean);
  const { ids: existingIds, docMap: existingDocMap, readCount: existingLogReadCount } =
    await getExistingStravaLogsMap(db, userId, syncActivityIds);
  if (syncActivityIds.length > 0) {
    console.log(`[stravaSync] userId=${userId} existingLogReads=${existingLogReadCount}/${syncActivityIds.length}`);
  }
  const stelvioDates = await getStelvioLogDates(db, userId);
  const logsRef = db.collection("users").doc(userId).collection("logs");
  /** 같은 날 Stelvio가 있는 날짜별 Strava TSS 합산 → 차액만 추가 적립 */
  const stelvioDateStravaTssAccumulator = new Map();
  /** Stelvio 없는 날짜별 Strava TSS 합산 (1일 500+ 치팅 제외용) */
  const dateOnlyStravaTss = new Map();
  let userTss = 0;
  let newActivities = 0;
  const processRunningActivity = require("./processRunningActivity");
  for (const act of Array.isArray(activities) ? activities : []) {
    const actId = String(act.id);
    try {
    if (processRunningActivity.isRunningStravaActivityType(act.type, act.sport_type)) {
      let detailedRun = act;
      const runDetailRes = await fetchStravaActivityDetail(accessToken, actId);
      if (runDetailRes.success && runDetailRes.activity) detailedRun = runDetailRes.activity;
      const ownerId = Number(userData.strava_athlete_id);
      if (ownerId) {
        try {
          await processRunningActivity.processRunningActivity(db, ownerId, actId, detailedRun);
          newActivities += 1;
        } catch (runErr) {
          console.warn(
            "[processOneUserStravaSync] RUN ingest failed:",
            userId,
            actId,
            runErr && runErr.message ? runErr.message : runErr
          );
          const runYmd = rankingDayRollup.normalizeLogDateToSeoulYmd(
            detailedRun.start_date_local || detailedRun.start_date || act.start_date_local || act.start_date
          );
          await stravaSyncRetry.markStravaSyncRetryPending(db, userId, {
            dateFrom: runYmd || dateFrom,
            dateTo: runYmd || dateTo,
            afterUnix,
            beforeUnix,
            reason: "run_ingest_failed",
            status: (runErr && runErr.status) || 500,
            activityId: actId,
          });
        }
      }
      continue;
    }
    // Firestore doc만 업데이트 경로. Supabase-only(Phase4)는 docMap 없음 → 아래 신규 ingest로 dual-write
    if (existingDocMap.has(actId)) {
      const entry = existingDocMap.get(actId);
      const d = entry.data;
      const powerFields = ['max_1min_watts', 'max_5min_watts', 'max_10min_watts', 'max_20min_watts', 'max_30min_watts', 'max_40min_watts', 'max_60min_watts', 'max_watts'];
      const hrFields = ['max_hr_5sec', 'max_hr_1min', 'max_hr_5min', 'max_hr_10min', 'max_hr_20min', 'max_hr_40min', 'max_hr_60min', 'max_hr'];
      const needsMmp = powerFields.some((f) => isEmptyMmpValue(d[f]));
      const needsHrPeaks = hrFields.some((f) => isEmptyMmpValue(d[f]));
      const needsTimeInZones = !d.time_in_zones || !d.time_in_zones.power;
      const needsWeight = d.weight == null;
      const needsActivityType = !String(d.activity_type || "").trim();
      const needsRouteProfile = stravaLogNeedsRouteProfile(d);
      if ((needsMmp || needsHrPeaks || needsTimeInZones || needsWeight || needsActivityType || needsRouteProfile) && entry) {
        const streamsRes = await fetchStravaStreams(accessToken, actId);
        const updateData = {};
        if (needsActivityType) {
          const at = String(act.sport_type || act.type || "").trim() || null;
          if (at) updateData.activity_type = at;
        }
        const userWeight = (Number(userData.weight ?? userData.weightKg ?? 0) > 0)
          ? Number(userData.weight ?? userData.weightKg)
          : null;
        if (needsWeight && userWeight != null) updateData.weight = userWeight;
        if (streamsRes.success && Array.isArray(streamsRes.watts) && streamsRes.watts.length > 0) {
          const watts = smoothPowerSpikes(streamsRes.watts);
          updateData.max_1min_watts = calculateMaxAveragePower(watts, 60);
          updateData.max_5min_watts = calculateMaxAveragePower(watts, 300);
          updateData.max_10min_watts = calculateMaxAveragePower(watts, 600);
          updateData.max_20min_watts = calculateMaxAveragePower(watts, 1200);
          updateData.max_30min_watts = calculateMaxAveragePower(watts, 1800);
          updateData.max_40min_watts = calculateMaxAveragePower(watts, 2400);
          updateData.max_60min_watts = calculateMaxAveragePower(watts, 3600);
          const streamMaxW = calculateMaxWattsFromPowerStream(watts);
          if (streamMaxW != null) updateData.max_watts = streamMaxW;
          else if (act.max_watts != null) updateData.max_watts = Number(act.max_watts);
        }
        const hrPeaks = streamsRes.success && Array.isArray(streamsRes.heartrate) && streamsRes.heartrate.length > 0 ? calculateMaxHeartRatePeaks(streamsRes.heartrate) : null;
        if (hrPeaks) {
          if (hrPeaks.max_hr_5sec != null) updateData.max_hr_5sec = hrPeaks.max_hr_5sec;
          if (hrPeaks.max_hr_1min != null) updateData.max_hr_1min = hrPeaks.max_hr_1min;
          if (hrPeaks.max_hr_5min != null) updateData.max_hr_5min = hrPeaks.max_hr_5min;
          if (hrPeaks.max_hr_10min != null) updateData.max_hr_10min = hrPeaks.max_hr_10min;
          if (hrPeaks.max_hr_20min != null) updateData.max_hr_20min = hrPeaks.max_hr_20min;
          if (hrPeaks.max_hr_40min != null) updateData.max_hr_40min = hrPeaks.max_hr_40min;
          if (hrPeaks.max_hr_60min != null) updateData.max_hr_60min = hrPeaks.max_hr_60min;
          if (hrPeaks.max_hr != null) updateData.max_hr = hrPeaks.max_hr;
        }
        if (streamsRes.success && (streamsRes.watts?.length > 0 || streamsRes.heartrate?.length > 0)) {
          const effectiveFtp = getFTPWithFallback(userData, streamsRes.watts || []);
          const timeInZones = await calculateZoneTimesFromStreams({
            wattsArray: streamsRes.watts || [],
            hrArray: streamsRes.heartrate || [],
            ftp: effectiveFtp,
            userId,
            db,
            dateStr: d.date || "",
          });
          updateData.time_in_zones = timeInZones;
        }
        if (needsRouteProfile) {
          let detailAct = act;
          const detailResUp = await fetchStravaActivityDetail(accessToken, actId);
          if (detailResUp.success && detailResUp.activity) detailAct = detailResUp.activity;
          const routeUp = buildStravaRouteProfileFields(detailAct, streamsRes);
          if (routeUp) {
            if (routeUp.summary_polyline) updateData.summary_polyline = routeUp.summary_polyline;
            if (routeUp.elevation_profile) updateData.elevation_profile = routeUp.elevation_profile;
            updateData.route_profile_updated_at = routeUp.route_profile_updated_at;
          }
        }
        if (Object.keys(updateData).length > 0) {
          const mergedLog = { ...d, ...updateData };
          await stravaDualWrite.dualWriteStravaActivityLog(
            admin,
            userId,
            actId,
            mergedLog,
            () => entry.ref.update(updateData)
          );
        } else {
          await ensureExistingStravaLogMirroredToSupabase(
            userId,
            actId,
            d,
            "processOneUserStravaSync"
          );
        }
      } else {
        await ensureExistingStravaLogMirroredToSupabase(
          userId,
          actId,
          d,
          "processOneUserStravaSync:existing_complete"
        );
      }
      continue;
    }
    let detailedActivity = act;
    const detailRes = await fetchStravaActivityDetail(accessToken, actId);
    if (detailRes.success && detailRes.activity) detailedActivity = detailRes.activity;
    const mapped = mapStravaActivityToLogSchema(detailedActivity, userId, ftp, userData.weight ?? userData.weightKg);
    const streamsRes = await fetchStravaStreams(accessToken, actId);
    let max1minWatts = null;
    let max5minWatts = null;
    let max10minWatts = null;
    let max20minWatts = null;
    let max30minWatts = null;
    let max40minWatts = null;
    let max60minWatts = null;
    let maxWattsFromStream = null;
    if (streamsRes.success && Array.isArray(streamsRes.watts) && streamsRes.watts.length > 0) {
      const watts = smoothPowerSpikes(streamsRes.watts);
      max1minWatts = calculateMaxAveragePower(watts, 60);
      max5minWatts = calculateMaxAveragePower(watts, 300);
      max10minWatts = calculateMaxAveragePower(watts, 600);
      max20minWatts = calculateMaxAveragePower(watts, 1200);
      max30minWatts = calculateMaxAveragePower(watts, 1800);
      max40minWatts = calculateMaxAveragePower(watts, 2400);
      max60minWatts = calculateMaxAveragePower(watts, 3600);
      maxWattsFromStream = calculateMaxWattsFromPowerStream(watts);
    }
    const hrPeaks = streamsRes.success && Array.isArray(streamsRes.heartrate) && streamsRes.heartrate.length > 0 ? calculateMaxHeartRatePeaks(streamsRes.heartrate) : null;
    let timeInZones = null;
    if (streamsRes.success && (streamsRes.watts?.length > 0 || streamsRes.heartrate?.length > 0)) {
      const effectiveFtp = getFTPWithFallback(userData, streamsRes.watts || []);
      timeInZones = await calculateZoneTimesFromStreams({
        wattsArray: streamsRes.watts || [],
        hrArray: streamsRes.heartrate || [],
        ftp: effectiveFtp,
        userId,
        db,
        dateStr: mapped.date || "",
      });
    }
    const dateStr = mapped.date || "";
    const activityTss = mapped.tss || 0;
    const distanceKm = mapped.distance_km || 0;
    const tssAppliedAt = new Date().toISOString();
    const userWeight = (Number(userData.weight ?? userData.weightKg ?? 0) > 0)
      ? Number(userData.weight ?? userData.weightKg)
      : null;
    const logDoc = {
      activity_id: mapped.activity_id,
      user_id: mapped.user_id,
      source: mapped.source,
      activity_type: mapped.activity_type ?? null,
      date: mapped.date,
      title: mapped.title,
      distance_km: mapped.distance_km,
      duration_sec: mapped.duration_sec,
      time: mapped.time,
      avg_cadence: mapped.avg_cadence,
      avg_hr: mapped.avg_hr,
      max_hr: mapped.max_hr,
      avg_watts: mapped.avg_watts,
      max_watts: maxWattsFromStream ?? mapped.max_watts,
      weighted_watts: mapped.weighted_watts,
      kilojoules: mapped.kilojoules,
      elevation_gain: mapped.elevation_gain,
      avg_speed_kmh: mapped.avg_speed_kmh ?? null,
      left_right_balance: mapped.left_right_balance ?? null,
      pedal_smoothness_left: mapped.pedal_smoothness_left ?? null,
      pedal_smoothness_right: mapped.pedal_smoothness_right ?? null,
      torque_effectiveness_left: mapped.torque_effectiveness_left ?? null,
      torque_effectiveness_right: mapped.torque_effectiveness_right ?? null,
      rpe: mapped.rpe,
      ftp_at_time: mapped.ftp_at_time,
      if: mapped.if,
      tss: mapped.tss,
      efficiency_factor: mapped.efficiency_factor,
      time_in_zones: timeInZones || mapped.time_in_zones,
      earned_points: mapped.earned_points,
      workout_id: mapped.workout_id,
      tss_applied: true,
      tss_applied_at: tssAppliedAt,
      created_at: mapped.created_at,
    };
    if (userWeight != null) logDoc.weight = userWeight;
    if (max1minWatts != null) logDoc.max_1min_watts = max1minWatts;
    if (max5minWatts != null) logDoc.max_5min_watts = max5minWatts;
    if (max10minWatts != null) logDoc.max_10min_watts = max10minWatts;
    if (max20minWatts != null) logDoc.max_20min_watts = max20minWatts;
    if (max30minWatts != null) logDoc.max_30min_watts = max30minWatts;
    if (max40minWatts != null) logDoc.max_40min_watts = max40minWatts;
    if (max60minWatts != null) logDoc.max_60min_watts = max60minWatts;
    if (hrPeaks) {
      if (hrPeaks.max_hr_5sec != null) logDoc.max_hr_5sec = hrPeaks.max_hr_5sec;
      if (hrPeaks.max_hr_1min != null) logDoc.max_hr_1min = hrPeaks.max_hr_1min;
      if (hrPeaks.max_hr_5min != null) logDoc.max_hr_5min = hrPeaks.max_hr_5min;
      if (hrPeaks.max_hr_10min != null) logDoc.max_hr_10min = hrPeaks.max_hr_10min;
      if (hrPeaks.max_hr_20min != null) logDoc.max_hr_20min = hrPeaks.max_hr_20min;
      if (hrPeaks.max_hr_40min != null) logDoc.max_hr_40min = hrPeaks.max_hr_40min;
      if (hrPeaks.max_hr_60min != null) logDoc.max_hr_60min = hrPeaks.max_hr_60min;
      if (hrPeaks.max_hr != null) logDoc.max_hr = hrPeaks.max_hr;
    }
    const routeProfileBatch = buildStravaRouteProfileFields(detailedActivity, streamsRes);
    if (routeProfileBatch) {
      if (routeProfileBatch.summary_polyline) logDoc.summary_polyline = routeProfileBatch.summary_polyline;
      if (routeProfileBatch.elevation_profile) logDoc.elevation_profile = routeProfileBatch.elevation_profile;
      logDoc.route_profile_updated_at = routeProfileBatch.route_profile_updated_at;
    }
    // Run/Swim/Walk/TrailRun/WeightTraining 등 비라이딩 활동은 저장하지 않음
    if (!isCyclingForMmp(mapped)) {
      console.log(`[processOneUserStravaSync] 비라이딩 활동 저장 제외: userId=${userId} actId=${actId} activity_type=${mapped.activity_type}`);
      continue;
    }
    await stravaDualWrite.dualWriteStravaActivityLog(
      admin,
      userId,
      actId,
      logDoc,
      () => logsRef.doc(actId).set(logDoc, { merge: true })
    );
    existingIds.add(actId);
    newActivities += 1;
    if (isCyclingForMmp(mapped)) {
      if (stelvioDates.has(dateStr)) {
        if (distanceKm !== 0) {
          const prev = stelvioDateStravaTssAccumulator.get(dateStr) || 0;
          stelvioDateStravaTssAccumulator.set(dateStr, prev + activityTss);
        }
      } else {
        if (distanceKm !== 0) {
          const prev = dateOnlyStravaTss.get(dateStr) || 0;
          dateOnlyStravaTss.set(dateStr, prev + activityTss);
        }
      }
    }
    } catch (actErr) {
      console.warn(
        "[processOneUserStravaSync] activity skipped:",
        userId,
        actId,
        actErr && actErr.message ? actErr.message : actErr
      );
    }
  }
  for (const [dateStr, tss] of dateOnlyStravaTss) {
    if (tss < TSS_PER_DAY_CHEAT_THRESHOLD) userTss += tss;
  }
  for (const [dateStr, stravaSum] of stelvioDateStravaTssAccumulator) {
    const stelvioPoints = await getStelvioPointsForDate(db, userId, dateStr);
    const dayTotal = stelvioPoints + (stravaSum || 0);
    if (dayTotal >= TSS_PER_DAY_CHEAT_THRESHOLD) continue; // 1일 500+ TSS 치팅: 포인트 적립 제외
    const diff = Math.max(0, (stravaSum || 0) - (stelvioPoints || 0));
    if (diff > 0) {
      userTss += diff;
      console.log(`[processOneUserStravaSync] 차액 추가 적립: ${userId} ${dateStr} Stelvio ${stelvioPoints} + Strava합 ${stravaSum} → 추가 ${diff}`);
    }
  }
  await stravaSyncRetry.clearStravaSyncRetryPending(db, userId, {
    count: newActivities,
  });
  if (dateFrom && dateTo) {
    try {
      await supabaseDualWriteServer.syncUsersWeeklyTssParityToSupabase(
        db,
        admin,
        [userId],
        dateFrom,
        dateTo
      );
    } catch (parityErr) {
      console.warn(
        "[processOneUserStravaSync] Supabase TSS parity sync:",
        userId,
        parityErr && parityErr.message ? parityErr.message : parityErr
      );
    }
  }
  return { userId, processed: 1, newActivities, userTss, error: null };
}

/**
 * 지정 구간에 대해 Strava 로그 수집 및 Firestore 반영.
 * userIdsFilter 있으면 해당 사용자만 처리(청크 워커용). 없으면 전체.
 * 1000명 대비: 사용자별 병렬 배치(STRAVA_SYNC_CONCURRENCY) 처리.
 */
async function runStravaSyncForRange(db, { afterUnix, beforeUnix, dateFrom, dateTo }, logPrefix, userIdsFilter) {
  const prefix = logPrefix || "[stravaSync]";
  const errors = [];
  let processed = 0;
  let newActivitiesTotal = 0;
  const totalTssByUser = {};
  console.log(`${prefix} 시작`, { dateFrom, dateTo, userCount: userIdsFilter ? userIdsFilter.length : "all" });

  let docs;
  if (userIdsFilter && userIdsFilter.length > 0) {
    const snapshots = await Promise.all(userIdsFilter.map((id) => db.collection("users").doc(id).get()));
    docs = snapshots.filter((s) => s.exists).map((s) => ({ id: s.id, data: () => s.data() }));
  } else {
    const usersSnap = await db.collection("users").where("strava_refresh_token", "!=", "").get();
    docs = usersSnap.docs;
  }
  if (docs.length === 0) {
    console.log(`${prefix} 처리 대상 사용자 없음`);
    return;
  }

  const concurrency = stravaSyncRetry.STRAVA_SYNC_CONCURRENCY_SAFE;
  for (let i = 0; i < docs.length; i += concurrency) {
    const batch = docs.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map((doc) => processOneUserStravaSync(db, doc.id, doc.data(), { afterUnix, beforeUnix, dateFrom, dateTo }))
    );
    const results = settled.map((r, idx) => {
      if (r.status === "fulfilled") return r.value;
      const doc = batch[idx];
      return {
        userId: doc && doc.id ? doc.id : "(unknown)",
        processed: 0,
        newActivities: 0,
        userTss: 0,
        error: r.reason && r.reason.message ? r.reason.message : String(r.reason),
      };
    });
    for (const r of results) {
      if (r.error) errors.push(`사용자 ${r.userId}: ${r.error}`);
      if (r.processed) processed += 1;
      newActivitiesTotal += r.newActivities || 0;
      if (r.userTss > 0) totalTssByUser[r.userId] = (totalTssByUser[r.userId] || 0) + r.userTss;
    }
    if (i + concurrency < docs.length) {
      await new Promise((r) => setTimeout(r, stravaSyncRetry.STRAVA_USER_BATCH_DELAY_MS));
    }
  }

  for (const uid of Object.keys(totalTssByUser)) {
    const tss = totalTssByUser[uid];
    if (tss <= 0) continue;
    try {
      await updateUserMileageInFirestore(db, uid, tss);
    } catch (e) {
      errors.push(`사용자 ${uid}: 포인트 업데이트 실패 - ${e.message}`);
    }
  }

  const summary = {
    processed,
    newActivities: newActivitiesTotal,
    usersProcessed: docs.length,
    errors: errors.length,
    errorDetails: errors,
    tssByUser: totalTssByUser,
    dateFrom,
    dateTo,
  };
  console.log(`${prefix} 완료`, {
    processed,
    newActivities: newActivitiesTotal,
    errors: errors.length,
    dateFrom,
    dateTo,
    dualWriteIngest:
      "Firebase Primary + Supabase Secondary (all users when dual_write_status≠OFF)",
  });
  if (errors.length) console.warn(`${prefix} 오류:`, errors);
  return summary;
}

/** 1000명 대비: Strava 동기화 청크 워커 (50명/요청). 스케줄러가 팬아웃 호출. */
const runStravaSyncChunkOptions = supabaseDualWriteServer.appendServiceRoleSecret({
  cors: false,
  timeoutSeconds: 540,
});
if (STRAVA_CLIENT_SECRET) {
  runStravaSyncChunkOptions.secrets = runStravaSyncChunkOptions.secrets || [];
  if (!runStravaSyncChunkOptions.secrets.includes(STRAVA_CLIENT_SECRET)) {
    runStravaSyncChunkOptions.secrets.push(STRAVA_CLIENT_SECRET);
  }
}
exports.runStravaSyncChunk = onRequest(
  runStravaSyncChunkOptions,
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST only" });
      return;
    }
    const secret = req.headers["x-internal-secret"] || req.query.secret;
    if (secret !== INTERNAL_SYNC_SECRET) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    let body;
    try {
      body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    } catch (e) {
      res.status(400).json({ success: false, error: "Invalid JSON" });
      return;
    }
    const { startStr, endStr, dateFrom, dateTo, userIds } = body;
    const ids = Array.isArray(userIds) ? userIds.slice(0, STRAVA_SYNC_CHUNK_SIZE) : [];
    if (ids.length === 0) {
      res.status(200).json({ success: true, processed: 0 });
      return;
    }
    const pad = (n) => String(n).padStart(2, "0");
    const from = dateFrom || startStr;
    const to = dateTo || endStr;
    const startSeoul = new Date(`${from}T00:00:00+09:00`);
    const endSeoul = new Date(`${to}T23:59:59.999+09:00`);
    const afterUnix = Math.floor(startSeoul.getTime() / 1000);
    const beforeUnix = Math.floor(endSeoul.getTime() / 1000);
    const db = admin.firestore();
    await runStravaSyncForRange(
      db,
      { afterUnix, beforeUnix, dateFrom: from, dateTo: to },
      "[stravaSyncChunk]",
      ids
    );
    res.status(200).json({ success: true, userIds: ids.length });
  }
);

/**
 * Strava Athlete ID 마이그레이션 (1회성).
 * strava_refresh_token은 있으나 strava_athlete_id가 없는 유저에 대해 /athlete API로 ID 조회 후 업데이트.
 * Rate Limit 방어: 순차 처리 + 유저당 500ms 대기.
 */
const migrateStravaAthleteIdsOptions = { cors: false, timeoutSeconds: 540 };
if (STRAVA_CLIENT_SECRET) {
  migrateStravaAthleteIdsOptions.secrets = [STRAVA_CLIENT_SECRET];
}
exports.migrateStravaAthleteIds = onRequest(
  migrateStravaAthleteIdsOptions,
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    const secret = req.headers["x-internal-secret"] || req.query.secret;
    if (secret !== INTERNAL_SYNC_SECRET) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    const db = admin.firestore();
    const usersSnap = await db.collection("users").where("strava_refresh_token", "!=", "").get();
    const candidates = [];
    for (const doc of usersSnap.docs) {
      const data = doc.data();
      if (data.strava_athlete_id == null || data.strava_athlete_id === undefined) {
        candidates.push({ userId: doc.id, data });
      }
    }
    const total = candidates.length;
    let successCount = 0;
    let failCount = 0;
    for (const { userId, data } of candidates) {
      try {
        const tokenResult = await refreshStravaTokenForUser(db, userId);
        const accessToken = tokenResult.accessToken;
        const athleteRes = await fetch("https://www.strava.com/api/v3/athlete", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!athleteRes.ok) {
          failCount += 1;
          console.warn("[migrateStravaAthleteIds] /athlete 실패:", userId, athleteRes.status);
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        const athlete = await athleteRes.json().catch(() => ({}));
        const athleteId = athlete && athlete.id != null ? Number(athlete.id) : null;
        if (athleteId == null) {
          failCount += 1;
          console.warn("[migrateStravaAthleteIds] athlete.id 없음:", userId);
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        await db.collection("users").doc(userId).update({ strava_athlete_id: athleteId });
        successCount += 1;
        console.log("[migrateStravaAthleteIds] 성공:", userId, "→", athleteId);
      } catch (e) {
        failCount += 1;
        console.warn("[migrateStravaAthleteIds] 실패:", userId, e.message);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    res.status(200).json({
      success: true,
      total,
      successCount,
      failCount,
    });
  }
);

/** Strava API Rate Limit: 15분당 100회. 85회에서 중단하여 여유 확보. */
const STRAVA_API_CALL_LIMIT = 85;

/**
 * 수동 Strava 동기화 (과거 1~6개월, MMP 포함).
 * months / days / maxActivities+windowMonths / startDate~endDate 로 기간·건수 설정.
 * maxActivities: Strava after~before 구간(기본 최근 windowMonths개월)에서 최신순 최대 N개 활동만 처리.
 * Rate Limit: 활동당 1초 대기, API 85회 도달 시 중단, hasMore 반환.
 */
const manualStravaSyncWithMmpOptions = supabaseDualWriteServer.appendServiceRoleSecret({
  cors: true,
  timeoutSeconds: 3600,
  memory: "1GiB",
});
if (STRAVA_CLIENT_SECRET) {
  manualStravaSyncWithMmpOptions.secrets = manualStravaSyncWithMmpOptions.secrets || [];
  if (!manualStravaSyncWithMmpOptions.secrets.includes(STRAVA_CLIENT_SECRET)) {
    manualStravaSyncWithMmpOptions.secrets.push(STRAVA_CLIENT_SECRET);
  }
}
function setManualSyncCorsHeaders(req, res) {
  const origin = req.headers.origin || "";
  const allowed = CORS_ORIGINS.some((o) => (typeof o === "string" ? origin === o : o.test(origin)));
  res.set("Access-Control-Allow-Origin", (allowed && origin) ? origin : "https://stelvio.ai.kr");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
}

exports.manualStravaSyncWithMmp = onRequest(
  manualStravaSyncWithMmpOptions,
  async (req, res) => {
    setManualSyncCorsHeaders(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    const forceRecalcTimeInZones = String(req.query?.forceRecalcTimeInZones || req.body?.forceRecalcTimeInZones || "").toLowerCase() === "true";
    const daysParam = req.query?.days || req.body?.days;
    const monthsParam = req.query?.months || req.body?.months;
    const maxActivitiesParam = req.query?.maxActivities ?? req.body?.maxActivities;
    const windowMonthsParam = req.query?.windowMonths ?? req.body?.windowMonths;
    const startDateParam = req.query?.startDate || req.body?.startDate;
    const endDateParam = req.query?.endDate || req.body?.endDate;
    const targetUsersParam = String(req.query?.targetUsers || req.body?.targetUsers || "").toLowerCase();
    const targetUidParam = String(req.query?.targetUid || req.body?.targetUid || "").trim();
    let maxActivitiesCap = null;
    console.log("[manualStravaSyncWithMmp] 요청 수신:", req.method, "months=", monthsParam, "days=", daysParam, "maxActivities=", maxActivitiesParam, "windowMonths=", windowMonthsParam, "startDate=", startDateParam, "endDate=", endDateParam, "targetUsers=", targetUsersParam, "targetUid=", targetUidParam ? "[provided]" : "", "forceRecalcTimeInZones=", forceRecalcTimeInZones);

    try {
    const uid = await getUidFromRequest(req, res);
    if (!uid) {
      console.warn("[manualStravaSyncWithMmp] 인증 실패: Authorization Bearer 토큰 없음 또는 유효하지 않음");
      return;
    }
    console.log("[manualStravaSyncWithMmp] 인증 성공, userId:", uid);

    const db = admin.firestore();
    let userIdsToProcess = [uid];
    if (targetUidParam) {
      const callerSnap = await db.collection("users").doc(uid).get();
      const callerData = callerSnap.exists ? callerSnap.data() : {};
      const callerGrade = String(callerData.grade ?? "2");
      if (callerGrade !== "1") {
        res.status(403).json({ success: false, error: "관리자(grade=1)만 targetUid를 사용할 수 있습니다." });
        return;
      }
      userIdsToProcess = [targetUidParam];
      console.log("[manualStravaSyncWithMmp] 관리자 단일 사용자 대상:", targetUidParam);
    } else if (targetUsersParam === "all" || targetUsersParam === "admin") {
      if (!startDateParam || !endDateParam || !String(startDateParam).trim() || !String(endDateParam).trim()) {
        res.status(400).json({ success: false, error: "targetUsers=all|admin 사용 시 startDate와 endDate가 필요합니다." });
        return;
      }
      const callerSnap = await db.collection("users").doc(uid).get();
      const callerData = callerSnap.exists ? callerSnap.data() : {};
      const callerGrade = String(callerData.grade ?? "2");
      if (callerGrade !== "1") {
        res.status(403).json({ success: false, error: "관리자(grade=1)만 사용할 수 있습니다." });
        return;
      }
      const usersSnap = await db.collection("users").where("strava_refresh_token", "!=", "").get();
      if (targetUsersParam === "admin") {
        userIdsToProcess = [uid];
        console.log("[manualStravaSyncWithMmp] 관리자 MMP: 현재 로그인 관리자 1명 대상");
      } else {
        userIdsToProcess = usersSnap.docs.map((d) => d.id);
      }
      console.log("[manualStravaSyncWithMmp] targetUsers=" + targetUsersParam + ", 대상 " + userIdsToProcess.length + "명");
    }

    let afterUnix;
    let beforeUnix;
    let dateFromForDiagnostic;
    let dateToForDiagnostic;
    if (startDateParam && endDateParam && String(startDateParam).trim() && String(endDateParam).trim()) {
      const startYmd = String(startDateParam).trim().slice(0, 10);
      const endYmd = String(endDateParam).trim().slice(0, 10);
      const start = new Date(`${startYmd}T00:00:00+09:00`);
      const end = new Date(`${endYmd}T23:59:59.999+09:00`);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({ success: false, error: "startDate 또는 endDate 형식이 올바르지 않습니다. (YYYY-MM-DD)" });
        return;
      }
      if (start > end) {
        res.status(400).json({ success: false, error: "시작일이 종료일보다 늦을 수 없습니다." });
        return;
      }
      afterUnix = Math.floor(start.getTime() / 1000);
      beforeUnix = Math.floor(end.getTime() / 1000);
      dateFromForDiagnostic = startYmd;
      dateToForDiagnostic = endYmd;
    } else {
      const now = new Date();
      beforeUnix = Math.floor(now.getTime() / 1000);
      const afterDate = new Date(now);
      const isBulkTarget = targetUsersParam === "all" || targetUsersParam === "admin";
      if (
        !isBulkTarget &&
        maxActivitiesParam != null &&
        maxActivitiesParam !== ""
      ) {
        maxActivitiesCap = Math.max(1, Math.min(200, parseInt(String(maxActivitiesParam), 10) || 30));
        const wm = Math.max(1, Math.min(12, parseInt(String(windowMonthsParam ?? "3"), 10) || 3));
        afterDate.setMonth(afterDate.getMonth() - wm);
      } else if (daysParam != null && daysParam !== "") {
        const days = Math.max(1, parseInt(daysParam, 10) || 10);
        afterDate.setDate(afterDate.getDate() - days);
      } else {
        const months = Math.min(6, Math.max(1, parseInt(monthsParam || "1", 10) || 1));
        afterDate.setMonth(afterDate.getMonth() - months);
      }
      afterUnix = Math.floor(afterDate.getTime() / 1000);
      dateFromForDiagnostic = new Date(afterUnix * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      dateToForDiagnostic = new Date(beforeUnix * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    }

    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalCreated = 0;
    let globalApiCallCount = 0;
    const userResults = [];

    for (const targetUid of userIdsToProcess) {
      if (globalApiCallCount >= STRAVA_API_CALL_LIMIT) {
        console.log("[manualStravaSyncWithMmp] API 한도 도달, 조기 종료");
        break;
      }
      try {
        const uid = targetUid;
        const userRef = db.collection("users").doc(uid);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
          console.warn("[manualStravaSyncWithMmp] 사용자 없음, 건너뜀:", uid);
          continue;
        }
    const userData = userSnap.data();
    const ftp = Number(userData.ftp) || 0;

    let accessToken;
    try {
      const tokenResult = await refreshStravaTokenForUser(db, uid);
      accessToken = tokenResult.accessToken;
    } catch (e) {
      console.warn("[manualStravaSyncWithMmp] 토큰 갱신 실패, 건너뜀:", uid, e.message);
        const diagnosticBase = buildStravaFetchDiagnosticBase(userData, "manualStravaSyncWithMmp");
        await recordStravaActivityFetchDiagnostic(db, uid, {
          ...diagnosticBase,
          afterUnix,
          beforeUnix,
          dateFrom: dateFromForDiagnostic,
          dateTo: dateToForDiagnostic,
          status: 0,
          count: 0,
          pages: 0,
          error: `토큰 갱신 실패: ${e && e.message ? e.message : String(e)}`,
          hint: "Strava refresh_token이 만료·무효화되었거나 다른 동기화가 토큰을 회전시켰습니다. Strava 재연결 후 다시 실행해야 합니다.",
        });
        userResults.push({
          userId: uid,
          status: 0,
          activitiesFound: 0,
          processedCount: 0,
          updatedCount: 0,
          createdCount: 0,
          error: `토큰 갱신 실패: ${e && e.message ? e.message : String(e)}`,
          hint: "Strava 재연결 후 다시 실행해야 합니다.",
        });
      continue;
    }

    let apiCallCount = globalApiCallCount;
    const allActivities = [];
    let page = 1;
    let firstPageStatus = 0;
    const fetchActivitiesWithRetry = async (retriesLeft = 5) => {
      const actRes = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${afterUnix}&before=${beforeUnix}&per_page=200&page=${page}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (actRes.status === 429 && retriesLeft > 0) {
        await waitForStravaRateLimit(actRes);
        console.log(`[manualStravaSyncWithMmp] 429 재시도 (${retriesLeft}회 남음)`);
        return fetchActivitiesWithRetry(retriesLeft - 1);
      }
      return actRes;
    };
    while (apiCallCount < STRAVA_API_CALL_LIMIT) {
      if (page > 1) await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
      const actRes = await fetchActivitiesWithRetry();
      apiCallCount += 1;
      if (page === 1) firstPageStatus = actRes.status || 0;
      if (!actRes.ok) {
        const diagnosticBase = buildStravaFetchDiagnosticBase(userData, "manualStravaSyncWithMmp");
        await recordStravaActivityFetchDiagnostic(db, uid, {
          ...diagnosticBase,
          afterUnix,
          beforeUnix,
          dateFrom: dateFromForDiagnostic,
          dateTo: dateToForDiagnostic,
          status: actRes.status,
          count: allActivities.length,
          pages: page,
          error: `활동 조회 실패: ${actRes.status}`,
          hint: buildEmptyStravaFetchHint(diagnosticBase, allActivities.length, actRes.status),
        });
        throw new Error(`활동 조회 실패: ${actRes.status}`);
      }
      const pageActivities = await actRes.json().catch(() => []);
      if (page === 1) {
        console.log(`[manualStravaSyncWithMmp] userId=${uid} athlete_id=${userData.strava_athlete_id || "?"} 1st_page_activities=${Array.isArray(pageActivities) ? pageActivities.length : 0} status=${actRes.status}`);
      }
      if (!Array.isArray(pageActivities) || pageActivities.length === 0) break;
      allActivities.push(...pageActivities);
      if (maxActivitiesCap != null && allActivities.length >= maxActivitiesCap) break;
      if (pageActivities.length < 200) break;
      page += 1;
    }

    const activitiesToProcess =
      maxActivitiesCap != null ? allActivities.slice(0, maxActivitiesCap) : allActivities;
    if (maxActivitiesCap != null) {
      console.log(
        `[manualStravaSyncWithMmp] userId=${uid} maxActivitiesCap=${maxActivitiesCap} fetched=${allActivities.length} process=${activitiesToProcess.length}`
      );
    }
    const diagnosticBase = buildStravaFetchDiagnosticBase(userData, "manualStravaSyncWithMmp");
    const manualDiagnostic = {
      ...diagnosticBase,
      afterUnix,
      beforeUnix,
      dateFrom: dateFromForDiagnostic,
      dateTo: dateToForDiagnostic,
      status: firstPageStatus || 200,
      count: allActivities.length,
      pages: page,
      hint: buildEmptyStravaFetchHint(diagnosticBase, allActivities.length, firstPageStatus || 200),
    };
    if (allActivities.length === 0 && firstPageStatus === 200) {
      const athleteDiag = await fetchStravaAthleteProfileDiagnostic(accessToken);
      if (athleteDiag) {
        manualDiagnostic.tokenAthleteId = athleteDiag.athleteId;
        if (athleteDiag.athleteId != null && diagnosticBase.storedAthleteId != null) {
          manualDiagnostic.athleteIdMatches = Number(athleteDiag.athleteId) === Number(diagnosticBase.storedAthleteId);
          if (!manualDiagnostic.athleteIdMatches) {
            manualDiagnostic.hint = "토큰 소유 Strava athlete_id가 users 문서의 strava_athlete_id와 다릅니다. 다른 Strava 계정이 연결된 상태이므로 재연결이 필요합니다.";
          }
        }
        if (athleteDiag.error) manualDiagnostic.error = `athlete 진단 실패: ${athleteDiag.error}`;
      }
    }
    await recordStravaActivityFetchDiagnostic(db, uid, manualDiagnostic);
    if (activitiesToProcess.length === 0) {
      userResults.push({
        userId: uid,
        athleteId: userData.strava_athlete_id || null,
        status: firstPageStatus || 200,
        activitiesFound: allActivities.length,
        processedCount: 0,
        updatedCount: 0,
        createdCount: 0,
        hint: manualDiagnostic.hint || "",
      });
    }

    const logsRef = db.collection("users").doc(uid).collection("logs");
    const stelvioDates = await getStelvioLogDates(db, uid);
    const stelvioDateStravaTssAccumulator = new Map();
    const dateOnlyStravaTss = new Map();
    let processedCount = 0;
    let updatedCount = 0;
    let createdCount = 0;
    let userTss = 0;

    for (const act of activitiesToProcess) {
      if (apiCallCount >= STRAVA_API_CALL_LIMIT) break;
      const actId = String(act.id);
      let logDocRef = logsRef.doc(actId);
      let logSnap = await logDocRef.get();
      if (!logSnap.exists) {
        const qSnap = await logsRef.where("activity_id", "==", actId).limit(1).get();
        if (!qSnap.empty) {
          logDocRef = qSnap.docs[0].ref;
          logSnap = qSnap.docs[0];
        }
      }
      let exists = logSnap.exists;
      if (!exists) {
        exists = await stravaLogRead.hasStravaActivityLog(db, uid, actId, {
          supabaseDualWriteServer,
        });
      }

      if (exists) {
        const existingData = logSnap.exists ? logSnap.data() : {};
        const powerFields = ['max_1min_watts', 'max_5min_watts', 'max_10min_watts', 'max_20min_watts', 'max_30min_watts', 'max_40min_watts', 'max_60min_watts', 'max_watts'];
        const hrFields = ['max_hr_5sec', 'max_hr_1min', 'max_hr_5min', 'max_hr_10min', 'max_hr_20min', 'max_hr_40min', 'max_hr_60min', 'max_hr'];
        const needsMmp = powerFields.some((f) => isEmptyMmpValue(existingData[f]));
        const needsHrPeaks = hrFields.some((f) => isEmptyMmpValue(existingData[f]));
        const needsTimeInZones = forceRecalcTimeInZones || !existingData.time_in_zones || !existingData.time_in_zones.power;
        const needsWeight = existingData.weight == null;
        const needsActivityType = !String(existingData.activity_type || "").trim();
        const needsRouteProfile = stravaLogNeedsRouteProfile(existingData);
        if (needsMmp || needsHrPeaks || needsTimeInZones || needsWeight || needsActivityType || needsRouteProfile) {
          if (apiCallCount >= STRAVA_API_CALL_LIMIT) break;
          const updateData = {};
          if (needsActivityType) {
            const at = String(act.sport_type || act.type || "").trim() || null;
            if (at) updateData.activity_type = at;
          }
          await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
          const streamsRes = await fetchStravaStreams(accessToken, actId);
          apiCallCount += 1;
          const userWeight = (Number(userData.weight ?? userData.weightKg ?? 0) > 0)
            ? Number(userData.weight ?? userData.weightKg)
            : null;
          if (needsWeight && userWeight != null) updateData.weight = userWeight;
          const rawWatts = streamsRes.success && Array.isArray(streamsRes.watts) ? streamsRes.watts : null;
          const wattsArray = rawWatts && rawWatts.length > 0 ? smoothPowerSpikes(rawWatts) : null;
          console.log(`[manualStravaSyncWithMmp] [Activity ID: ${actId}] Watts Array Length:`, wattsArray?.length || 0);
          if (wattsArray && wattsArray.length > 0) {
            updateData.max_1min_watts = calculateMaxAveragePower(wattsArray, 60);
            updateData.max_5min_watts = calculateMaxAveragePower(wattsArray, 300);
            updateData.max_10min_watts = calculateMaxAveragePower(wattsArray, 600);
            updateData.max_20min_watts = calculateMaxAveragePower(wattsArray, 1200);
            updateData.max_30min_watts = calculateMaxAveragePower(wattsArray, 1800);
            updateData.max_40min_watts = calculateMaxAveragePower(wattsArray, 2400);
            updateData.max_60min_watts = calculateMaxAveragePower(wattsArray, 3600);
            const streamMaxW = calculateMaxWattsFromPowerStream(wattsArray);
            if (streamMaxW != null) updateData.max_watts = streamMaxW;
            else if (act.max_watts != null) updateData.max_watts = Number(act.max_watts);
            console.log(`[manualStravaSyncWithMmp] [Activity ID: ${actId}] Calculated MMP: 1m=${updateData.max_1min_watts}, 5m=${updateData.max_5min_watts}, 10m=${updateData.max_10min_watts}, 20m=${updateData.max_20min_watts}, 30m=${updateData.max_30min_watts}, 40m=${updateData.max_40min_watts}, 60m=${updateData.max_60min_watts}, max=${updateData.max_watts || "?"}`);
          }
          const hrPeaks = streamsRes.success && Array.isArray(streamsRes.heartrate) && streamsRes.heartrate.length > 0 ? calculateMaxHeartRatePeaks(streamsRes.heartrate) : null;
          if (hrPeaks) {
            if (hrPeaks.max_hr_5sec != null) updateData.max_hr_5sec = hrPeaks.max_hr_5sec;
            if (hrPeaks.max_hr_1min != null) updateData.max_hr_1min = hrPeaks.max_hr_1min;
            if (hrPeaks.max_hr_5min != null) updateData.max_hr_5min = hrPeaks.max_hr_5min;
            if (hrPeaks.max_hr_10min != null) updateData.max_hr_10min = hrPeaks.max_hr_10min;
            if (hrPeaks.max_hr_20min != null) updateData.max_hr_20min = hrPeaks.max_hr_20min;
            if (hrPeaks.max_hr_40min != null) updateData.max_hr_40min = hrPeaks.max_hr_40min;
            if (hrPeaks.max_hr_60min != null) updateData.max_hr_60min = hrPeaks.max_hr_60min;
            if (hrPeaks.max_hr != null) updateData.max_hr = hrPeaks.max_hr;
          }
          if (streamsRes.success && (streamsRes.watts?.length > 0 || streamsRes.heartrate?.length > 0)) {
            const effectiveFtp = getFTPWithFallback(userData, streamsRes.watts || []);
            const timeInZones = await calculateZoneTimesFromStreams({
              wattsArray: streamsRes.watts || [],
              hrArray: streamsRes.heartrate || [],
              ftp: effectiveFtp,
              userId: uid,
              db,
              dateStr: existingData.date || "",
            });
            updateData.time_in_zones = timeInZones;
          }
          if (needsRouteProfile) {
            let detailAct = act;
            if (apiCallCount < STRAVA_API_CALL_LIMIT) {
              await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
              const detailResUp = await fetchStravaActivityDetail(accessToken, actId);
              apiCallCount += 1;
              if (detailResUp.success && detailResUp.activity) detailAct = detailResUp.activity;
            }
            const routeUp = buildStravaRouteProfileFields(detailAct, streamsRes);
            if (routeUp) {
              if (routeUp.summary_polyline) updateData.summary_polyline = routeUp.summary_polyline;
              if (routeUp.elevation_profile) updateData.elevation_profile = routeUp.elevation_profile;
              updateData.route_profile_updated_at = routeUp.route_profile_updated_at;
            }
          }
          if (Object.keys(updateData).length > 0) {
            const mergedLog = { ...existingData, ...updateData };
            await stravaDualWrite.dualWriteStravaActivityLog(
              admin,
              uid,
              actId,
              mergedLog,
              function () {
                if (logSnap.exists) {
                  return logDocRef.update(updateData);
                }
                return logDocRef.set(mergedLog, { merge: true });
              }
            );
            updatedCount += 1;
          } else if (logSnap.exists) {
            await ensureExistingStravaLogMirroredToSupabase(
              uid,
              actId,
              existingData,
              "manualStravaSyncWithMmp"
            );
          } else {
            await ensureExistingStravaLogMirroredToSupabase(
              uid,
              actId,
              Object.assign({ activity_id: actId, source: "strava" }, existingData),
              "manualStravaSyncWithMmp"
            );
          }
          processedCount += 1;
        }
      } else {
        if (apiCallCount >= STRAVA_API_CALL_LIMIT - 1) break;
        await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
        const detailRes = await fetchStravaActivityDetail(accessToken, actId);
        apiCallCount += 1;
        if (!detailRes.success || !detailRes.activity) {
          await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
          continue;
        }
        await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
        const streamsRes = await fetchStravaStreams(accessToken, actId);
        apiCallCount += 1;
        const activity = detailRes.activity;
        const mapped = mapStravaActivityToLogSchema(activity, uid, ftp, userData.weight ?? userData.weightKg);
        const rawWatts = streamsRes.success && Array.isArray(streamsRes.watts) ? streamsRes.watts : null;
        const wattsArray = rawWatts && rawWatts.length > 0 ? smoothPowerSpikes(rawWatts) : null;
        console.log(`[manualStravaSyncWithMmp] [Activity ID: ${actId}] Watts Array Length:`, wattsArray?.length || 0);
        let max1minWatts = null;
        let max5minWatts = null;
        let max10minWatts = null;
        let max20minWatts = null;
        let max30minWatts = null;
        let max40minWatts = null;
        let max60minWatts = null;
        let maxWattsFromStream = null;
        if (wattsArray && wattsArray.length > 0) {
          max1minWatts = calculateMaxAveragePower(wattsArray, 60);
          max5minWatts = calculateMaxAveragePower(wattsArray, 300);
          max10minWatts = calculateMaxAveragePower(wattsArray, 600);
          max20minWatts = calculateMaxAveragePower(wattsArray, 1200);
          max30minWatts = calculateMaxAveragePower(wattsArray, 1800);
          max40minWatts = calculateMaxAveragePower(wattsArray, 2400);
          max60minWatts = calculateMaxAveragePower(wattsArray, 3600);
          maxWattsFromStream = calculateMaxWattsFromPowerStream(wattsArray);
          console.log(`[manualStravaSyncWithMmp] [Activity ID: ${actId}] Calculated MMP: 1m=${max1minWatts}, 5m=${max5minWatts}, 10m=${max10minWatts}, 20m=${max20minWatts}, 30m=${max30minWatts}, 40m=${max40minWatts}, 60m=${max60minWatts}, max=${maxWattsFromStream}`);
        }
        const hrPeaks = streamsRes.success && Array.isArray(streamsRes.heartrate) && streamsRes.heartrate.length > 0 ? calculateMaxHeartRatePeaks(streamsRes.heartrate) : null;
        let timeInZones = mapped.time_in_zones;
        if (streamsRes.success && (streamsRes.watts?.length > 0 || streamsRes.heartrate?.length > 0)) {
          const effectiveFtp = getFTPWithFallback(userData, streamsRes.watts || []);
          timeInZones = await calculateZoneTimesFromStreams({
            wattsArray: streamsRes.watts || [],
            hrArray: streamsRes.heartrate || [],
            ftp: effectiveFtp,
            userId: uid,
            db,
            dateStr: mapped.date || "",
          });
        }
        const tssAppliedAt = new Date().toISOString();
        const userWeight = (Number(userData.weight ?? userData.weightKg ?? 0) > 0)
          ? Number(userData.weight ?? userData.weightKg)
          : null;
        const logDoc = {
          activity_id: mapped.activity_id,
          user_id: mapped.user_id,
          source: mapped.source,
          activity_type: mapped.activity_type ?? null,
          date: mapped.date,
          title: mapped.title,
          distance_km: mapped.distance_km,
          duration_sec: mapped.duration_sec,
          time: mapped.time,
          avg_cadence: mapped.avg_cadence,
          avg_hr: mapped.avg_hr,
          max_hr: mapped.max_hr,
          avg_watts: mapped.avg_watts,
          max_watts: maxWattsFromStream ?? mapped.max_watts,
          weighted_watts: mapped.weighted_watts,
          kilojoules: mapped.kilojoules,
          elevation_gain: mapped.elevation_gain,
          avg_speed_kmh: mapped.avg_speed_kmh ?? null,
          left_right_balance: mapped.left_right_balance ?? null,
          pedal_smoothness_left: mapped.pedal_smoothness_left ?? null,
          pedal_smoothness_right: mapped.pedal_smoothness_right ?? null,
          torque_effectiveness_left: mapped.torque_effectiveness_left ?? null,
          torque_effectiveness_right: mapped.torque_effectiveness_right ?? null,
          rpe: mapped.rpe,
          ftp_at_time: mapped.ftp_at_time,
          if: mapped.if,
          tss: mapped.tss,
          efficiency_factor: mapped.efficiency_factor,
          time_in_zones: timeInZones,
          earned_points: mapped.earned_points,
          workout_id: mapped.workout_id,
          tss_applied: true,
          tss_applied_at: tssAppliedAt,
          created_at: mapped.created_at,
          max_1min_watts: max1minWatts,
          max_5min_watts: max5minWatts,
          max_10min_watts: max10minWatts,
          max_20min_watts: max20minWatts,
          max_30min_watts: max30minWatts,
          max_40min_watts: max40minWatts,
          max_60min_watts: max60minWatts,
        };
        if (userWeight != null && userWeight > 0) {
          sanitizePeakPowerWattsOnRow(logDoc, userWeight);
        }
        if (hrPeaks) {
          if (hrPeaks.max_hr_5sec != null) logDoc.max_hr_5sec = hrPeaks.max_hr_5sec;
          if (hrPeaks.max_hr_1min != null) logDoc.max_hr_1min = hrPeaks.max_hr_1min;
          if (hrPeaks.max_hr_5min != null) logDoc.max_hr_5min = hrPeaks.max_hr_5min;
          if (hrPeaks.max_hr_10min != null) logDoc.max_hr_10min = hrPeaks.max_hr_10min;
          if (hrPeaks.max_hr_20min != null) logDoc.max_hr_20min = hrPeaks.max_hr_20min;
          if (hrPeaks.max_hr_40min != null) logDoc.max_hr_40min = hrPeaks.max_hr_40min;
          if (hrPeaks.max_hr_60min != null) logDoc.max_hr_60min = hrPeaks.max_hr_60min;
          if (hrPeaks.max_hr != null) logDoc.max_hr = hrPeaks.max_hr;
        }
        if (userWeight != null) logDoc.weight = userWeight;
        const routeProfileManual = buildStravaRouteProfileFields(activity, streamsRes);
        if (routeProfileManual) {
          if (routeProfileManual.summary_polyline) logDoc.summary_polyline = routeProfileManual.summary_polyline;
          if (routeProfileManual.elevation_profile) logDoc.elevation_profile = routeProfileManual.elevation_profile;
          logDoc.route_profile_updated_at = routeProfileManual.route_profile_updated_at;
        }
        // Run/Swim/Walk/TrailRun/WeightTraining 등 비라이딩 활동은 저장하지 않음
        if (!isCyclingForMmp(mapped)) {
          console.log(`[manualStravaSyncWithMmp] 비라이딩 활동 저장 제외: uid=${uid} actId=${actId} activity_type=${mapped.activity_type}`);
          continue;
        }
        await stravaDualWrite.dualWriteStravaActivityLog(
          admin,
          uid,
          actId,
          logDoc,
          () => logDocRef.set(logDoc, { merge: true })
        );
        createdCount += 1;
        processedCount += 1;
        const dateStr = mapped.date || "";
        const activityTss = mapped.tss || 0;
        const distanceKm = mapped.distance_km || 0;
        if (isCyclingForMmp(mapped) && activityTss > 0 && distanceKm !== 0) {
          if (stelvioDates.has(dateStr)) {
            const prev = stelvioDateStravaTssAccumulator.get(dateStr) || 0;
            stelvioDateStravaTssAccumulator.set(dateStr, prev + activityTss);
          } else {
            const prev = dateOnlyStravaTss.get(dateStr) || 0;
            dateOnlyStravaTss.set(dateStr, prev + activityTss);
          }
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    for (const [dateStr, tss] of dateOnlyStravaTss) {
      if (tss < TSS_PER_DAY_CHEAT_THRESHOLD) userTss += tss;
    }
    for (const [dateStr, stravaSum] of stelvioDateStravaTssAccumulator) {
      const stelvioPoints = await getStelvioPointsForDate(db, uid, dateStr);
      const dayTotal = stelvioPoints + (stravaSum || 0);
      if (dayTotal >= TSS_PER_DAY_CHEAT_THRESHOLD) continue; // 1일 500+ TSS 치팅: 포인트 적립 제외
      const diff = Math.max(0, (stravaSum || 0) - (stelvioPoints || 0));
      if (diff > 0) userTss += diff;
    }
    if (userTss > 0) {
      try {
        await updateUserMileageInFirestore(db, uid, userTss);
      } catch (e) {
        console.warn("[manualStravaSyncWithMmp] 포인트 업데이트 실패:", e.message);
      }
    }

    const datesToMerge = new Set();
    for (const act of activitiesToProcess) {
      const rawStart = act.start_date_local || act.start_date || "";
      const ds = rawStart ? String(rawStart).slice(0, 10) : "";
      if (ds) datesToMerge.add(ds);
    }
    if (dateFromForDiagnostic && dateToForDiagnostic) {
      let dCur = new Date(`${dateFromForDiagnostic}T12:00:00+09:00`);
      const dEnd = new Date(`${dateToForDiagnostic}T12:00:00+09:00`);
      while (dCur <= dEnd) {
        datesToMerge.add(dCur.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }));
        dCur.setDate(dCur.getDate() + 1);
      }
    }
    const dailyMergeResults = [];
    for (const mergeDate of datesToMerge) {
      try {
        const daySnap = await logsRef.where("date", "==", mergeDate).where("source", "==", "strava").get();
        const mergeRes = await stravaRouteMerge.saveMergedDailyRouteProfile(
          db,
          uid,
          mergeDate,
          daySnap.docs.map((doc) => doc.data() || {})
        );
        dailyMergeResults.push({ date: mergeDate, ...mergeRes });
      } catch (mergeErr) {
        console.warn("[manualStravaSyncWithMmp] daily merge", mergeDate, mergeErr.message);
      }
    }

    globalApiCallCount = apiCallCount;
    totalProcessed += processedCount;
    totalUpdated += updatedCount;
    totalCreated += createdCount;
    if (activitiesToProcess.length > 0) {
      userResults.push({
        userId: uid,
        athleteId: userData.strava_athlete_id || null,
        status: firstPageStatus || 200,
        activitiesFound: allActivities.length,
        activitiesProcessed: activitiesToProcess.length,
        processedCount,
        updatedCount,
        createdCount,
        dailyRouteMerges: dailyMergeResults,
      });
    }
    } catch (userErr) {
      console.warn("[manualStravaSyncWithMmp] 사용자 처리 실패:", targetUid, userErr.message);
      userResults.push({
        userId: targetUid,
        status: 0,
        activitiesFound: 0,
        processedCount: 0,
        updatedCount: 0,
        createdCount: 0,
        error: userErr && userErr.message ? userErr.message : String(userErr),
      });
    }
    }

    const hasMore = globalApiCallCount >= STRAVA_API_CALL_LIMIT;
    res.status(200).json({
      success: true,
      processedCount: totalProcessed,
      updatedCount: totalUpdated,
      createdCount: totalCreated,
      hasMore,
      apiCallCount: globalApiCallCount,
      userResults,
    });
    } catch (err) {
      console.error("[manualStravaSyncWithMmp] 오류:", err);
      res.status(500).json({ success: false, error: err.message || "동기화 중 오류가 발생했습니다." });
    }
  }
);

/** 스케줄 실행 시 1000명 대비: 인원 > 100이면 청크 URL로 팬아웃, 아니면 in-process 병렬 처리 */
async function runStravaSyncWithFanOut(db, range, logPrefix, getChunkUrl) {
  const usersSnap = await db.collection("users").where("strava_refresh_token", "!=", "").get();
  const userIds = usersSnap.docs.map((d) => d.id);
  if (userIds.length === 0) {
    console.log(`${logPrefix} Strava 연결 사용자 없음`);
    return;
  }
  if (userIds.length <= STRAVA_SYNC_CHUNK_THRESHOLD) {
    await runStravaSyncForRange(db, range, logPrefix, null);
    return;
  }
  const chunkUrl = typeof getChunkUrl === "function" ? await getChunkUrl() : null;
  if (!chunkUrl) {
    console.warn(`${logPrefix} 청크 URL 미설정(appConfig/sync.runStravaSyncChunkUrl), in-process로 진행 (${userIds.length}명)`);
    await runStravaSyncForRange(db, range, logPrefix, null);
    return;
  }
  const chunks = [];
  for (let i = 0; i < userIds.length; i += STRAVA_SYNC_CHUNK_SIZE) {
    chunks.push(userIds.slice(i, i + STRAVA_SYNC_CHUNK_SIZE));
  }
  const { dateFrom, dateTo, afterUnix, beforeUnix } = range;
  const failed = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const userIdsChunk = chunks[ci];
    try {
      const res = await fetch(chunkUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": INTERNAL_SYNC_SECRET,
        },
        body: JSON.stringify({
          startStr: dateFrom,
          endStr: dateTo,
          dateFrom,
          dateTo,
          userIds: userIdsChunk,
        }),
      });
      if (!res.ok) failed.push(res.status);
    } catch (fetchErr) {
      failed.push(fetchErr && fetchErr.message ? fetchErr.message : "fetch_error");
    }
    if (ci < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, stravaSyncRetry.STRAVA_CHUNK_FANOUT_DELAY_MS));
    }
  }
  if (failed.length) {
    console.warn(`${logPrefix} 청크 실패 ${failed.length}/${chunks.length}`, failed);
  }
  console.log(`${logPrefix} 팬아웃 완료(순차)`, { chunks: chunks.length, totalUsers: userIds.length });
}

/**
 * 매일 00:10(Asia/Seoul) 갭 탐지형 Strava 동기화.
 * - A: strava_sync_retry_pending
 * - B: strava_webhook_retries 큐
 * - C: 어제~오늘 API 페이지네이션 vs Supabase diff → 사이클(rides)·Run(activities) 누락 ingest
 * (구 02:00 전체 스캔 runStravaSyncWithFanOut 대체)
 */
const stravaSyncScheduleOptions = supabaseDualWriteServer.appendServiceRoleSecret({
  schedule: "10 0 * * *",
  timeZone: "Asia/Seoul",
  timeoutSeconds: 1800,
  memory: "1GiB",
});
if (STRAVA_CLIENT_SECRET) {
  stravaSyncScheduleOptions.secrets = stravaSyncScheduleOptions.secrets || [];
  if (!stravaSyncScheduleOptions.secrets.includes(STRAVA_CLIENT_SECRET)) {
    stravaSyncScheduleOptions.secrets.push(STRAVA_CLIENT_SECRET);
  }
}

async function runStravaGapDetectPreviousDayJob(db, logPrefix) {
  const yesterday = getYesterdayAfterBefore();
  const today = getTodayAfterBefore();
  const range = stravaSyncRetry.ymdRangeToUnix({
    dateFrom: yesterday.dateFrom,
    dateTo: today.dateTo,
  });
  return stravaGapDetect.runGapDetectSyncJob(
    db,
    range,
    {
      refreshStravaTokenForUser,
      fetchStravaActivitiesPage,
      processStravaActivity,
      processOneUserStravaSync,
      supabaseDualWriteServer,
    },
    logPrefix || "[stravaSyncPreviousDay]",
    { includeGapScanAllUsers: true }
  );
}

exports.stravaSyncPreviousDay = onSchedule(
  stravaSyncScheduleOptions,
  async () => {
    const db = admin.firestore();
    await runStravaGapDetectPreviousDayJob(db, "[stravaSyncPreviousDay]");
  }
);

/**
 * 당일(서울) Strava 갭 탐지 — 웹훅·새벽 배치 누락 보완.
 * 점심·저녁에 당일 활동이 이미 올라온 뒤 누락분만 processStravaActivity.
 */
const stravaSyncTodayGapOptions = supabaseDualWriteServer.appendServiceRoleSecret({
  schedule: "0 12,20 * * *",
  timeZone: "Asia/Seoul",
  timeoutSeconds: 1800,
  memory: "1GiB",
});
if (STRAVA_CLIENT_SECRET) {
  stravaSyncTodayGapOptions.secrets = stravaSyncTodayGapOptions.secrets || [];
  if (!stravaSyncTodayGapOptions.secrets.includes(STRAVA_CLIENT_SECRET)) {
    stravaSyncTodayGapOptions.secrets.push(STRAVA_CLIENT_SECRET);
  }
}
async function runStravaGapDetectTodayJob(db, logPrefix) {
  const today = getTodayAfterBefore();
  const range = stravaSyncRetry.ymdRangeToUnix({
    dateFrom: today.dateFrom,
    dateTo: today.dateTo,
  });
  return stravaGapDetect.runGapDetectSyncJob(
    db,
    range,
    {
      refreshStravaTokenForUser,
      fetchStravaActivitiesPage,
      processStravaActivity,
      processOneUserStravaSync,
      supabaseDualWriteServer,
    },
    logPrefix || "[stravaSyncTodayGap]",
    { includeGapScanAllUsers: true }
  );
}
exports.stravaSyncTodayGap = onSchedule(
  stravaSyncTodayGapOptions,
  async () => {
    const db = admin.firestore();
    await runStravaGapDetectTodayJob(db, "[stravaSyncTodayGap]");
  }
);

/**
 * 일요일 19시(Asia/Seoul)에 당일(일요일) Strava 로그 수집. 1000명 대비 청크 팬아웃.
 */
const stravaSyncSundayOptions = supabaseDualWriteServer.appendServiceRoleSecret({
  schedule: "0 19 * * 0",
  timeZone: "Asia/Seoul",
  timeoutSeconds: 540,
});
if (STRAVA_CLIENT_SECRET) {
  stravaSyncSundayOptions.secrets = stravaSyncSundayOptions.secrets || [];
  if (!stravaSyncSundayOptions.secrets.includes(STRAVA_CLIENT_SECRET)) {
    stravaSyncSundayOptions.secrets.push(STRAVA_CLIENT_SECRET);
  }
}
exports.stravaSyncSunday = onSchedule(
  stravaSyncSundayOptions,
  async (event) => {
    const db = admin.firestore();
    const range = getTodayAfterBefore();
    const getChunkUrl = async () => {
      const snap = await db.collection("appConfig").doc("sync").get();
      return snap.exists ? snap.data().runStravaSyncChunkUrl || null : null;
    };
    await runStravaSyncWithFanOut(db, range, "[stravaSyncSunday]", getChunkUrl);
  }
);

/**
 * 수동/긴급: Asia/Seoul 기준 오늘(00:00~23:59) Strava 로그 재수집.
 * 새벽 배치·웹훅 누락 보완 시 사용. stravaSyncSunday와 동일한 기간 로직 및 청크 팬아웃.
 * 인증: X-Internal-Secret(STELVIO 내부, runStravaSyncChunk 동일) 또는 관리자(grade=1) Firebase Bearer.
 */
const manualStravaSyncTodaySeoulOptions = supabaseDualWriteServer.appendServiceRoleSecret({
  region: "asia-northeast3",
  cors: false,
  timeoutSeconds: 540,
});
if (STRAVA_CLIENT_SECRET) {
  manualStravaSyncTodaySeoulOptions.secrets =
    manualStravaSyncTodaySeoulOptions.secrets || [];
  if (!manualStravaSyncTodaySeoulOptions.secrets.includes(STRAVA_CLIENT_SECRET)) {
    manualStravaSyncTodaySeoulOptions.secrets.push(STRAVA_CLIENT_SECRET);
  }
}
/**
 * 기존 Strava 로그에 summary_polyline·고도 프로파일 백필 (수동·오늘 일지용)
 * POST { date?: "YYYY-MM-DD", userId?: "firebaseUid" } — userId 생략 시 grade=1 관리자 본인만
 */
async function backfillStravaRouteProfileForUserDate(db, userId, dateStr) {
  const userSnap = await db.collection("users").doc(userId).get();
  if (!userSnap.exists) return { updated: 0, skipped: 0, errors: ["user not found"] };
  const userData = userSnap.data() || {};
  let accessToken = userData.strava_access_token || "";
  const tokenExpiresAt = Number(userData.strava_expires_at || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!accessToken || tokenExpiresAt < nowSec + 300) {
    const tokenResult = await refreshStravaTokenForUser(db, userId);
    accessToken = tokenResult.accessToken;
  }
  const logsRef = db.collection("users").doc(userId).collection("logs");
  const snap = await logsRef.where("date", "==", dateStr).where("source", "==", "strava").get();
  let updated = 0;
  let skipped = 0;
  const errors = [];
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const actId = String(d.activity_id || doc.id || "");
    if (!actId) {
      skipped++;
      continue;
    }
    if (!stravaLogNeedsRouteProfile(d)) {
      skipped++;
      continue;
    }
    try {
      const [detailRes, streamsRes] = await Promise.all([
        fetchStravaActivityDetail(accessToken, actId),
        fetchStravaStreams(accessToken, actId),
      ]);
      if (!detailRes.success || !detailRes.activity) {
        errors.push(`${actId}: detail fail`);
        continue;
      }
      const routeUp = buildStravaRouteProfileFields(detailRes.activity, streamsRes);
      if (!routeUp) {
        skipped++;
        continue;
      }
      const updateData = {};
      if (routeUp.summary_polyline) updateData.summary_polyline = routeUp.summary_polyline;
      if (routeUp.elevation_profile) updateData.elevation_profile = routeUp.elevation_profile;
      updateData.route_profile_updated_at = routeUp.route_profile_updated_at;
      const mergedLog = { ...d, ...updateData };
      await stravaDualWrite.dualWriteStravaActivityLog(
        admin,
        userId,
        actId,
        mergedLog,
        () => doc.ref.update(updateData)
      );
      updated++;
    } catch (e) {
      errors.push(`${actId}: ${e && e.message ? e.message : String(e)}`);
    }
  }
  let dailyRouteMerge = { saved: false, reason: "no_logs" };
  try {
    const afterSnap = await logsRef.where("date", "==", dateStr).where("source", "==", "strava").get();
    dailyRouteMerge = await stravaRouteMerge.saveMergedDailyRouteProfile(
      db,
      userId,
      dateStr,
      afterSnap.docs.map((doc) => doc.data() || {})
    );
  } catch (mergeErr) {
    console.warn("[backfillStravaRouteProfileForUserDate] daily merge save:", mergeErr.message);
    dailyRouteMerge = { saved: false, error: mergeErr.message };
  }
  return { updated, skipped, errors, dailyRouteMerge };
}

const backfillStravaRouteProfileOptions = supabaseDualWriteServer.appendServiceRoleSecret({
  region: "asia-northeast3",
  cors: true,
  timeoutSeconds: 540,
});
if (STRAVA_CLIENT_SECRET) {
  backfillStravaRouteProfileOptions.secrets =
    backfillStravaRouteProfileOptions.secrets || [];
  if (!backfillStravaRouteProfileOptions.secrets.includes(STRAVA_CLIENT_SECRET)) {
    backfillStravaRouteProfileOptions.secrets.push(STRAVA_CLIENT_SECRET);
  }
}
exports.backfillStravaRouteProfileForDate = onRequest(
  backfillStravaRouteProfileOptions,
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Internal-Secret");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST only" });
      return;
    }
    try {
      const db = admin.firestore();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      const dateStr = String(body.date || req.query.date || todayStr).slice(0, 10);
      let targetUid = body.userId ? String(body.userId).trim() : "";
      const rawSecret =
        req.headers["x-internal-secret"] ||
        req.headers["X-Internal-Secret"] ||
        req.query.secret;
      if (!targetUid) {
        if (rawSecret === INTERNAL_SYNC_SECRET) {
          res.status(400).json({ success: false, error: "userId required with internal secret" });
          return;
        }
        const callerUid = await getUidFromRequest(req, res);
        if (!callerUid) return;
        targetUid = callerUid;
      } else if (rawSecret !== INTERNAL_SYNC_SECRET) {
        const callerUid = await getUidFromRequest(req, res);
        if (!callerUid) return;
        const callerSnap = await db.collection("users").doc(callerUid).get();
        const grade = callerSnap.exists ? String((callerSnap.data() || {}).grade ?? "2") : "2";
        if (grade !== "1" && callerUid !== targetUid) {
          res.status(403).json({ success: false, error: "권한 없음" });
          return;
        }
      }
      const result = await backfillStravaRouteProfileForUserDate(db, targetUid, dateStr);
      res.status(200).json({ success: true, date: dateStr, userId: targetUid, ...result });
    } catch (err) {
      console.error("[backfillStravaRouteProfileForDate]", err);
      res.status(500).json({
        success: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  }
);

/**
 * 429 등으로 실패한 Strava 동기화 재수집 (저동시성 순차).
 * POST body/query: dateFrom, dateTo (YYYY-MM-DD, 기본=오늘 서울)
 * 인증: X-Internal-Secret 또는 관리자(grade=1) Bearer
 */
const stravaSync429RetryOptions = supabaseDualWriteServer.appendServiceRoleSecret({
  region: "asia-northeast3",
  cors: false,
  timeoutSeconds: 3600,
  memory: "1GiB",
});
if (STRAVA_CLIENT_SECRET) {
  stravaSync429RetryOptions.secrets = stravaSync429RetryOptions.secrets || [];
  if (!stravaSync429RetryOptions.secrets.includes(STRAVA_CLIENT_SECRET)) {
    stravaSync429RetryOptions.secrets.push(STRAVA_CLIENT_SECRET);
  }
}

async function runStravaSyncRetryJob(db, dateFrom, dateTo, logPrefix) {
  const range = stravaSyncRetry.ymdRangeToUnix({ dateFrom, dateTo });
  const userIds = await stravaSyncRetry.listUsersNeedingStravaSyncRetry(db, {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    maxUsers: 500,
  });
  if (userIds.length === 0) {
    console.log(`${logPrefix} 재시도 대상 없음`, range);
    return { userIds: [], ok: 0, fail: 0, total: 0, results: [] };
  }
  return stravaSyncRetry.runStravaSyncRetrySequential(
    db,
    range,
    userIds,
    logPrefix,
    processOneUserStravaSync,
    processStravaActivity
  );
}

/** @deprecated stravaSync429RetryJob — runStravaSyncRetryJob 사용 */
const runStrava429RetryJob = runStravaSyncRetryJob;

exports.runStravaSync429Retry = onRequest(stravaSync429RetryOptions, async (req, res) => {
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "POST only" });
    return;
  }
  try {
    const db = admin.firestore();
    const rawSecret =
      req.headers["x-internal-secret"] ||
      req.headers["X-Internal-Secret"] ||
      req.query.secret;
    let authorized = rawSecret === INTERNAL_SYNC_SECRET;
    if (!authorized) {
      const uid = await getUidFromRequest(req, res);
      if (!uid) return;
      const callerSnap = await db.collection("users").doc(uid).get();
      const grade = callerSnap.exists ? String((callerSnap.data() || {}).grade ?? "2") : "2";
      if (grade !== "1") {
        res.status(403).json({
          success: false,
          error: "관리자(grade=1) 또는 X-Internal-Secret 헤더가 필요합니다.",
        });
        return;
      }
      authorized = true;
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const today = getTodayAfterBefore();
    const dateFrom = String(body.dateFrom || req.query.dateFrom || today.dateFrom).slice(0, 10);
    const dateTo = String(body.dateTo || req.query.dateTo || dateFrom).slice(0, 10);
    const summary = await runStravaSyncRetryJob(db, dateFrom, dateTo, "[runStravaSync429Retry]");
    res.status(200).json({
      success: true,
      dateFrom,
      dateTo,
      retriedUsers: summary.total,
      ok: summary.ok,
      fail: summary.fail,
      results: (summary.results || []).map((r) => ({
        userId: r.userId,
        newActivities: r.newActivities,
        error: r.error || null,
      })),
    });
  } catch (err) {
    console.error("[runStravaSync429Retry]", err);
    res.status(500).json({
      success: false,
      error: err && err.message ? err.message : String(err),
    });
  }
});

/** pending 재수집(429·웹훅 등) — 매일 03:30·06:30·09:30(서울), 전날+당일 구간 */
const stravaSyncRetryScheduleOptions = supabaseDualWriteServer.appendServiceRoleSecret({
  schedule: "30 3,6,9 * * *",
  timeZone: "Asia/Seoul",
  timeoutSeconds: 1800,
  memory: "1GiB",
});
if (STRAVA_CLIENT_SECRET) {
  stravaSyncRetryScheduleOptions.secrets =
    stravaSyncRetryScheduleOptions.secrets || [];
  if (!stravaSyncRetryScheduleOptions.secrets.includes(STRAVA_CLIENT_SECRET)) {
    stravaSyncRetryScheduleOptions.secrets.push(STRAVA_CLIENT_SECRET);
  }
}
exports.stravaSyncRetrySchedule = onSchedule(
  stravaSyncRetryScheduleOptions,
  async () => {
    const db = admin.firestore();
    const yesterday = getYesterdayAfterBefore();
    const today = getTodayAfterBefore();
    console.log("[stravaSyncRetrySchedule] 시작", {
      yesterday: yesterday.dateFrom,
      today: today.dateFrom,
    });
    await runStravaSyncRetryJob(db, yesterday.dateFrom, yesterday.dateTo, "[stravaSyncRetrySchedule:yesterday]");
    await runStravaSyncRetryJob(db, today.dateFrom, today.dateTo, "[stravaSyncRetrySchedule:today]");
  }
);
/** @deprecated stravaSync429RetrySchedule — stravaSyncRetrySchedule 사용 */
exports.stravaSync429RetrySchedule = exports.stravaSyncRetrySchedule;

exports.manualStravaSyncTodaySeoul = onRequest(
  manualStravaSyncTodaySeoulOptions,
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST only" });
      return;
    }
    try {
      const db = admin.firestore();
      const rawSecret =
        req.headers["x-internal-secret"] ||
        req.headers["X-Internal-Secret"] ||
        req.query.secret;
      let authorized = rawSecret === INTERNAL_SYNC_SECRET;

      if (!authorized) {
        const uid = await getUidFromRequest(req, res);
        if (!uid) return;
        const callerSnap = await db.collection("users").doc(uid).get();
        const grade = callerSnap.exists ? String((callerSnap.data() || {}).grade ?? "2") : "2";
        if (grade !== "1") {
          res.status(403).json({
            success: false,
            error: "관리자(grade=1) 또는 X-Internal-Secret 헤더가 필요합니다.",
          });
          return;
        }
        authorized = true;
      }

      const range = getTodayAfterBefore();
      const getChunkUrl = async () => {
        const snap = await db.collection("appConfig").doc("sync").get();
        return snap.exists ? snap.data().runStravaSyncChunkUrl || null : null;
      };
      await runStravaSyncWithFanOut(db, range, "[manualStravaSyncTodaySeoul]", getChunkUrl);
      res.status(200).json({
        success: true,
        message:
          "오늘(Asia/Seoul) 구간 Strava 동기화를 실행했습니다. Functions 로그 [manualStravaSyncTodaySeoul] / 청크 [stravaSyncChunk] 를 확인하세요.",
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        afterUnix: range.afterUnix,
        beforeUnix: range.beforeUnix,
      });
    } catch (err) {
      console.error("[manualStravaSyncTodaySeoul]", err);
      res.status(500).json({
        success: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  }
);

// ---------- 주간 마일리지 TOP10 랭킹 (Choose Your Path 입장 시 팝업) ----------
/** 현재 주 월요일 00:00 ~ 오늘 23:59 (Asia/Seoul) 날짜 문자열 반환. weekOffset: 0=현재주, -1=전주 */
function getWeekRangeSeoul(weekOffset = 0) {
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const [y, m, d] = todayStr.split("-").map(Number);
  const today = new Date(y, m - 1, d);
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  if (weekOffset < 0) {
    monday.setDate(monday.getDate() + weekOffset * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const pad = (n) => String(n).padStart(2, "0");
    const startStr = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
    const endStr = `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`;
    return { startStr, endStr };
  }
  const pad = (n) => String(n).padStart(2, "0");
  const startStr = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
  const endStr = `${y}-${pad(m)}-${pad(d)}`;
  return { startStr, endStr };
}

/** YYYY-MM-DD — 전일 (로컬 달력, 주간 TSS 집계 키 롤오버용) */
function previousCalendarDayStr(dateStr) {
  if (!dateStr || String(dateStr).length < 10) return null;
  const parts = String(dateStr).split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function weeklyTssBoardPayloadHasRows(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (Array.isArray(payload.entries) && payload.entries.length > 0) return true;
  const sup = payload.byCategory && payload.byCategory.Supremo;
  return Array.isArray(sup) && sup.length > 0;
}

/**
 * 주간 TSS HTTP: endStr(오늘)이 바뀌면 새 cacheKey에 집계가 없어 빈 보드가 나오는 문제 방지.
 * 1) 당일 키 fresh/stale 2) 같은 주 시작·전일 endStr 키 stale 3) null → 라이브 재집계
 */
async function readWeeklyTssRankingPayloadForHttp(db, startStr, endStr, gender) {
  const cacheKey = `peakRanking_weekly_tss_v2_${gender}_${startStr}_${endStr}`;
  const fresh = await readRankingAggregatePayloadIfFresh(db, cacheKey);
  if (fresh && weeklyTssBoardPayloadHasRows(fresh)) {
    return { payload: fresh, cacheKey, precomputed: true };
  }
  const staleExact = await readRankingAggregatePayloadAllowStale(
    db,
    cacheKey,
    RANKING_HTTP_STALE_FALLBACK_MS
  );
  if (
    staleExact &&
    weeklyTssBoardPayloadHasRows(staleExact) &&
    (!staleExact.startStr || String(staleExact.startStr) === startStr)
  ) {
    return { payload: staleExact, cacheKey, precomputed: true, staleAggregate: true };
  }
  const prevEnd = previousCalendarDayStr(endStr);
  if (prevEnd && prevEnd >= startStr) {
    const prevKey = `peakRanking_weekly_tss_v2_${gender}_${startStr}_${prevEnd}`;
    const stalePrev = await readRankingAggregatePayloadAllowStale(
      db,
      prevKey,
      RANKING_HTTP_STALE_FALLBACK_MS
    );
    if (stalePrev && weeklyTssBoardPayloadHasRows(stalePrev)) {
      return {
        payload: stalePrev,
        cacheKey: prevKey,
        precomputed: true,
        staleAggregate: true,
        dataThroughEndStr: prevEnd,
      };
    }
  }
  /** 새 주(월) 시작·이번 주 집계 없음 → 전주 확정 순위 */
  const prevRange = getWeekRangeSeoul(-1);
  if (prevRange && prevRange.startStr && prevRange.endStr) {
    const prevWeekKey = `peakRanking_weekly_tss_v2_${gender}_${prevRange.startStr}_${prevRange.endStr}`;
    let prevWeekPayload = await readRankingAggregatePayloadIfFresh(db, prevWeekKey);
    if (!prevWeekPayload || !weeklyTssBoardPayloadHasRows(prevWeekPayload)) {
      prevWeekPayload = await readRankingAggregatePayloadAllowStale(
        db,
        prevWeekKey,
        RANKING_HTTP_STALE_FALLBACK_MS
      );
    }
    if (!prevWeekPayload || !weeklyTssBoardPayloadHasRows(prevWeekPayload)) {
      const weeklyAggKey = `weekly_ranking_full_${prevRange.startStr}_${prevRange.endStr}`;
      const weeklyAgg = await readRankingAggregatePayloadAllowStale(
        db,
        weeklyAggKey,
        RANKING_HTTP_STALE_FALLBACK_MS
      );
      if (
        weeklyAgg &&
        Array.isArray(weeklyAgg.fullEntries) &&
        weeklyAgg.fullEntries.length > 0
      ) {
        prevWeekPayload = {
          byCategory: { Supremo: weeklyAgg.fullEntries.slice(), Assoluto: [], Bianco: [], Rosa: [], Infinito: [], Leggenda: [] },
          entries: weeklyAgg.fullEntries.slice(),
          startStr: prevRange.startStr,
          endStr: prevRange.endStr,
        };
      }
    }
    if (prevWeekPayload && weeklyTssBoardPayloadHasRows(prevWeekPayload)) {
      return {
        payload: prevWeekPayload,
        cacheKey: prevWeekKey,
        precomputed: true,
        staleAggregate: true,
        prevWeekFallback: true,
        displayStartStr: prevRange.startStr,
        displayEndStr: prevRange.endStr,
      };
    }
  }
  return null;
}

/** getPeakPowerRanking(tss) — readWeeklyTssRankingPayloadForHttp 결과 → HTTP JSON (TOP10·TSS 탭 동일 필드) */
async function buildPeakTssRankingResponseFromHttpHit(db, tssHit, startStr, endStr, gender, uid) {
  if (!tssHit || !tssHit.payload || !weeklyTssBoardPayloadHasRows(tssHit.payload)) return null;
  const tssPayload = tssHit.payload;
  const tssCat = tssPayload.byCategory || emptyPeakRankingByCategory();
  const tssEnt = Array.isArray(tssPayload.entries) ? tssPayload.entries : tssCat.Supremo || [];
  const outStartStr =
    tssHit.prevWeekFallback && tssHit.displayStartStr ? tssHit.displayStartStr : startStr;
  const outEndStr =
    tssHit.prevWeekFallback && tssHit.displayEndStr ? tssHit.displayEndStr : endStr;
  const outTss = {
    success: true,
    byCategory: tssCat,
    startStr: outStartStr,
    endStr: outEndStr,
    period: "weekly",
    durationType: "tss",
    gender,
    precomputed: !!tssHit.precomputed,
    staleAggregate: !!tssHit.staleAggregate,
  };
  if (tssHit.prevWeekFallback) {
    outTss.prevWeekFallback = true;
    outTss.displayStartStr = tssHit.displayStartStr || outStartStr;
    outTss.displayEndStr = tssHit.displayEndStr || outEndStr;
  }
  if (tssHit.dataThroughEndStr && tssHit.dataThroughEndStr !== endStr) {
    outTss.dataThroughEndStr = tssHit.dataThroughEndStr;
  }
  if (uid) {
    let current = null;
    let nextUser = null;
    for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
      const arr = tssCat[c] || [];
      const idx = arr.findIndex((e) => e.userId === uid);
      if (idx >= 0) {
        current = arr[idx];
        nextUser = idx > 0 ? arr[idx - 1] : null;
        break;
      }
    }
    if (current) {
      outTss.currentUser = current;
      outTss.motivationMessage = buildMotivationMessage(current, nextUser);
    }
  }
  const tssFbEntries = Array.isArray(tssEnt) && tssEnt.length ? tssEnt : outTss.byCategory.Supremo;
  await hydratePeakRankMovementOnPayload(db, outTss.byCategory, tssFbEntries, `peak_tss_weekly_${gender}`);
  if (!outTss.entries && Array.isArray(outTss.byCategory.Supremo)) {
    outTss.entries = outTss.byCategory.Supremo.slice();
  }
  return outTss;
}

/** getWeeklyRanking TOP10용 — TSS 집계 entries 배열 */
async function readWeeklyTssEntriesForTop10Http(db, startStr, endStr) {
  const hit = await readWeeklyTssRankingPayloadForHttp(db, startStr, endStr, "all");
  if (!hit || !hit.payload) return null;
  const ent = hit.payload.entries;
  if (Array.isArray(ent) && ent.length > 0) return ent;
  const sup = hit.payload.byCategory && hit.payload.byCategory.Supremo;
  if (Array.isArray(sup) && sup.length > 0) return sup;
  return null;
}

function userMatchesWeeklyTssGenderFilter(userData, genderFilter) {
  if (!genderFilter || genderFilter === "all") return true;
  const gender = String((userData && (userData.gender || userData.sex)) || "").toLowerCase();
  const want =
    genderFilter === "M" || genderFilter === "male" || genderFilter === "남" ? "male" : "female";
  const match =
    gender === "m" || gender === "male" || gender === "남"
      ? "male"
      : gender === "f" || gender === "female" || gender === "여"
        ? "female"
        : null;
  return match === want;
}

function weeklyTssEntryFromUserDoc(doc, totalTss) {
  const userId = doc.id;
  const data = doc.data() || {};
  const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
  const challenge = data.challenge || "Fitness";
  const leagueCategory = getLeagueCategory(challenge, birthYear);
  if (!leagueCategory) return null;
  return {
    userId,
    name: data.name || "(이름 없음)",
    totalTss: Math.round(totalTss * 100) / 100,
    ageCategory: leagueCategory,
    gender: String(data.gender || data.sex || "").toLowerCase(),
    is_private: privacyFlagFromFirestoreDoc(data),
    profileImageUrl: profileImageUrlFromUserData(data),
    ...rankingUserStatusFieldsFromData(data),
  };
}

function rerankWeeklyTssEntries(entries) {
  const sorted = (entries || []).slice().sort((a, b) => b.totalTss - a.totalTss);
  const withRank = sorted.map((e, i) => ({ ...e, rank: i + 1 }));
  const byCategory = { Supremo: withRank, Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
  withRank.forEach((e) => {
    if (byCategory[e.ageCategory]) byCategory[e.ageCategory].push(e);
  });
  return { entries: withRank, byCategory };
}

/** ranking_aggregates 문서 updatedAt (ms) — 없으면 null */
async function getRankingAggregateUpdatedAtMs(db, cacheKey) {
  if (!db || !cacheKey) return null;
  try {
    const snap = await db.collection(RANKING_AGGREGATES_COLLECTION).doc(cacheKey).get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    const u = d.updatedAt && (d.updatedAt.toMillis ? d.updatedAt.toMillis() : d.updatedAt);
    return u ? Number(u) : null;
  } catch (e) {
    return null;
  }
}

/** 주간 TSS all 집계가 maxAgeMs보다 오래됐는지 */
async function isWeeklyTssAllAggregateStale(db, wStart, wEnd, maxAgeMs) {
  const key = `peakRanking_weekly_tss_v2_all_${wStart}_${wEnd}`;
  const updatedAt = await getRankingAggregateUpdatedAtMs(db, key);
  if (!updatedAt) return true;
  return Date.now() - updatedAt > maxAgeMs;
}

/** 당일 ranking_day_totals 문서가 있는 userId 목록 (collectionGroup, docId=ymd) */
async function findUserIdsWithRankingDayOnDate(db, ymd) {
  if (!ymd) return [];
  const FieldPath = admin.firestore.FieldPath;
  const coll = rankingDayRollup.RANKING_DAY_TOTALS_COLL;
  try {
    const snap = await db.collectionGroup(coll).where(FieldPath.documentId(), "==", ymd).get();
    const ids = [];
    snap.forEach((docSnap) => {
      const uid = docSnap.ref.parent && docSnap.ref.parent.parent ? docSnap.ref.parent.parent.id : "";
      if (uid) ids.push(uid);
    });
    return ids;
  } catch (e) {
    console.warn("[findUserIdsWithRankingDayOnDate]", ymd, e && e.message ? e.message : e);
    return [];
  }
}

/**
 * 자정 직후: 전일 endStr 집계 + 오늘 하루 버킷만 합산 (users 전체 스캔 대체).
 * 월요일(새 주) 또는 전일 집계 없으면 전체 스캔으로 폴백.
 */
async function buildWeeklyTssBoardIncrementalFromPreviousDay(db, wStart, wEnd, genderFilter, usersSnap) {
  const prevEnd = previousCalendarDayStr(wEnd);
  if (!prevEnd || prevEnd < wStart) {
    return getWeeklyTssRankingBoardEntries(db, wStart, wEnd, genderFilter, usersSnap);
  }
  const prevKey = `peakRanking_weekly_tss_v2_${genderFilter}_${wStart}_${prevEnd}`;
  const prevPayload = await readRankingAggregatePayloadAllowStale(
    db,
    prevKey,
    RANKING_HTTP_STALE_FALLBACK_MS
  );
  if (!prevPayload || !weeklyTssBoardPayloadHasRows(prevPayload)) {
    return getWeeklyTssRankingBoardEntries(db, wStart, wEnd, genderFilter, usersSnap);
  }

  const prevRows = Array.isArray(prevPayload.entries)
    ? prevPayload.entries
    : prevPayload.byCategory?.Supremo || [];
  const userDocMap = new Map();
  if (usersSnap && usersSnap.docs) {
    usersSnap.docs.forEach((d) => userDocMap.set(d.id, d));
  }

  const merged = [];
  const seen = new Set();

  for (let i = 0; i < prevRows.length; i += WEEKLY_TSS_BATCH_SIZE) {
    const slice = prevRows.slice(i, i + WEEKLY_TSS_BATCH_SIZE);
    /* eslint-disable no-await-in-loop */
    const batchOut = await Promise.all(
      slice.map(async (row) => {
        const userId = row.userId;
        if (!userId) return null;
        let doc = userDocMap.get(userId);
        let userData = doc ? doc.data() : null;
        if (!userData) {
          const us = await db.collection("users").doc(userId).get();
          if (!us.exists) return null;
          userData = us.data();
          userDocMap.set(userId, us);
        }
        if (!userMatchesWeeklyTssGenderFilter(userData, genderFilter)) return null;
        const dayTss = await rankingDayRollup.weeklyTssSumFromDayBuckets(
          db,
          userId,
          userData,
          wEnd,
          wEnd
        );
        const newTotal = Math.round((Number(row.totalTss) + dayTss) * 100) / 100;
        if (newTotal <= 0) return null;
        const userDoc = userDocMap.get(userId);
        const fresh = userDoc ? weeklyTssEntryFromUserDoc(userDoc, newTotal) : null;
        if (!fresh) return null;
        return { ...row, ...fresh, totalTss: newTotal };
      })
    );
    /* eslint-enable no-await-in-loop */
    batchOut.forEach((r) => {
      if (r && r.userId) {
        seen.add(r.userId);
        merged.push(r);
      }
    });
  }

  const newDayUserIds = await findUserIdsWithRankingDayOnDate(db, wEnd);
  for (let ni = 0; ni < newDayUserIds.length; ni += WEEKLY_TSS_BATCH_SIZE) {
    const uidBatch = newDayUserIds.slice(ni, ni + WEEKLY_TSS_BATCH_SIZE);
    /* eslint-disable no-await-in-loop */
    const added = await Promise.all(
      uidBatch.map(async (userId) => {
        if (seen.has(userId)) return null;
        let doc = userDocMap.get(userId);
        if (!doc) {
          const us = await db.collection("users").doc(userId).get();
          if (!us.exists) return null;
          doc = us;
          userDocMap.set(userId, us);
        }
        const userData = doc.data();
        if (!userMatchesWeeklyTssGenderFilter(userData, genderFilter)) return null;
        const totalTssRaw = await getWeeklyTssForUser(db, userId, wStart, wEnd, userData);
        if (totalTssRaw <= 0) return null;
        return weeklyTssEntryFromUserDoc(doc, totalTssRaw);
      })
    );
    /* eslint-enable no-await-in-loop */
    added.forEach((r) => {
      if (r && r.userId) {
        seen.add(r.userId);
        merged.push(r);
      }
    });
  }

  return rerankWeeklyTssEntries(merged);
}

async function persistWeeklyTssBoardsAndTop10(db, wStart, wEnd, boardsByGender) {
  let entriesCurrent = null;
  for (const gender of ["all", "M", "F"]) {
    const tss = boardsByGender[gender];
    if (!tss) continue;
    if (gender === "all") {
      entriesCurrent = (tss.entries || []).map((e) => ({
        userId: e.userId,
        name: e.name,
        totalTss: e.totalTss,
        is_private: e.is_private === true,
        rankChange: e.rankChange,
        previousBoardRank: e.previousBoardRank,
      }));
    }
    const keyTss = `peakRanking_weekly_tss_v2_${gender}_${wStart}_${wEnd}`;
    await writeRankingAggregatePayload(db, keyTss, {
      byCategory: tss.byCategory,
      entries: tss.entries,
      startStr: wStart,
      endStr: wEnd,
    });
  }
  const top10Current = (entriesCurrent || []).slice(0, 10).map((e, i) => weeklyTop10RowFromEntry(e, i));
  await writeRankingAggregatePayload(db, `weekly_ranking_full_${wStart}_${wEnd}`, {
    fullEntries: entriesCurrent || [],
    ranking: top10Current,
    startStr: wStart,
    endStr: wEnd,
  });
  return { entriesCurrent, top10Current };
}

/** 23:00 마스터 집계 — running / complete / failed (헵타곤 메타와 동일 패턴) */
async function markMasterDailyRankingRebuildRunning(db, extra) {
  const dateKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  await db.collection("ranking_meta").doc(RANKING_MASTER_REBUILD_META_DOC).set(
    {
      dateKst,
      status: "running",
      runningAt: admin.firestore.FieldValue.serverTimestamp(),
      lastError: admin.firestore.FieldValue.delete(),
      failedAt: admin.firestore.FieldValue.delete(),
      ...(extra && typeof extra === "object" ? extra : {}),
    },
    { merge: true }
  );
}

async function markMasterDailyRankingRebuildComplete(db, summary) {
  const dateKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  await db.collection("ranking_meta").doc(RANKING_MASTER_REBUILD_META_DOC).set(
    {
      dateKst,
      status: "complete",
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      runningAt: admin.firestore.FieldValue.delete(),
      lastError: admin.firestore.FieldValue.delete(),
      failedAt: admin.firestore.FieldValue.delete(),
      summary: summary && typeof summary === "object" ? summary : null,
    },
    { merge: true }
  );
}

async function markMasterDailyRankingRebuildFailed(db, err, partial) {
  const dateKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const msg = err && err.message ? String(err.message) : err ? String(err) : "unknown";
  await db.collection("ranking_meta").doc(RANKING_MASTER_REBUILD_META_DOC).set(
    {
      dateKst,
      status: "failed",
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
      runningAt: admin.firestore.FieldValue.delete(),
      lastError: msg.slice(0, 2000),
      partialSummary: partial && typeof partial === "object" ? partial : null,
    },
    { merge: true }
  );
}

async function markManualRankingPhaseMeta(db, phase, status, extra) {
  const dateKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  await db.collection("ranking_meta").doc(RANKING_PHASE_REBUILD_META_DOC).set(
    {
      dateKst,
      phase: String(phase || ""),
      status: String(status || ""),
      progressAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(extra && typeof extra === "object" ? extra : {}),
    },
    { merge: true }
  );
}

/** 28일 피크 → ranking_aggregates peakRanking_v2_monthly_* (Max~60분 전체) */
async function runRankingAggregatePeakMonthly28d(db, usersSnap = null, opts) {
  const t0 = Date.now();
  const { startStr: r90s, endStr: r90e } = getRolling90DaysRangeSeoul();
  const useRollups = !(opts && opts.legacyOnePass === true);
  /** 기본 true — 553명×28버킷 선처리는 60분 타임아웃 유발. 보드 조립 시 rollup miss 만 개별 갱신 */
  const skipRollupBatch = opts && opts.skipRollupBatch === false ? false : true;
  const skipUsersFetch = useRollups && skipRollupBatch && !(opts && opts.skipUsersFetch === false);
  const allowLegacyFallback = !!(opts && opts.allowLegacyFallback);
  let snap = usersSnap;
  if (!snap && !skipUsersFetch) snap = await db.collection("users").get();
  const userCount = snap ? snap.size : 0;
  try {
    await markManualRankingPhaseMeta(db, "peak_monthly", "running", {
      r90s,
      r90e,
      userCount,
      peakBuildMode: useRollups ? "peak_28d_rollup" : "legacy_one_pass",
      skipRollupBatch,
      skipUsersFetch,
    });
    const skipRankHistory = opts && opts.skipRankHistory !== false;
    let allDur;
    let boardStats = null;
    if (useRollups) {
      const fastBuilt = await buildPeakPowerFromPeak28dRollupsFast(db, r90s, r90e, null);
      allDur = fastBuilt.boards;
      boardStats = fastBuilt.stats;
      const fastOk =
        boardStats.used > 0 &&
        allDur &&
        allDur.all &&
        allDur.all.max &&
        Array.isArray(allDur.all.max.entries) &&
        allDur.all.max.entries.length > 0;
      if (!fastOk) {
        if (!allowLegacyFallback) {
          throw new Error(
            `peak_28d fast board insufficient: rollupRows=${boardStats.rollupRows} used=${boardStats.used} skippedNoMeta=${boardStats.skippedNoMeta}. ` +
              "Supabase stelvio_ranking_metrics_backfill_chunk(pg_cron) 대기 후 재시도. allowLegacyFallback=1 은 비권장(60분+)."
          );
        }
        console.warn("[runRankingAggregatePeakMonthly28d] fast insufficient — legacy one-pass (allowLegacyFallback)");
        if (!snap) snap = await db.collection("users").get();
        allDur = await buildPeakPowerFromPeak28dRollupsOnePass(db, r90s, r90e, snap, null);
        boardStats = { mode: "legacy_one_pass_fallback", prior: boardStats };
      }
    } else {
      if (!snap) snap = await db.collection("users").get();
      allDur = await buildPeakPowerAllDurationsForRangeAllGendersOnePass(db, r90s, r90e, snap, null);
      boardStats = { mode: "legacy_one_pass" };
    }
    const writeJobs = [];
    for (const gender of ["all", "M", "F"]) {
      for (const durationType of Object.keys(DURATION_FIELDS)) {
        writeJobs.push(
          (async () => {
            const pack = allDur[gender][durationType];
            if (!skipRankHistory) {
              await applyPeakRankChanges(db, pack.byCategory, `peak_${durationType}_monthly_${gender}`);
            }
            const ckey = `peakRanking_v2_monthly_${durationType}_${gender}_${r90s}_${r90e}`;
            await writeRankingAggregatePayload(db, ckey, {
              byCategory: pack.byCategory,
              entries: pack.entries,
              startStr: r90s,
              endStr: r90e,
              cohortAvgHrBpm: pack.cohortAvgHrBpm,
            });
          })()
        );
      }
    }
    await Promise.all(writeJobs);
    const wrote = writeJobs.length;
    const ms = Date.now() - t0;
    const result = {
      phase: "peak_monthly",
      wrote,
      ms,
      startStr: r90s,
      endStr: r90e,
      userCount: snap ? snap.size : userCount,
      peakBuildMode: useRollups ? "peak_28d_rollup" : "legacy_one_pass",
      peakMethod: rankingDayRollup.PEAK_METHOD_NINETY_DAY_TOP2_DAILY,
      skipRollupBatch,
      skipUsersFetch,
      boardStats,
      skipRankHistory,
    };
    await markManualRankingPhaseMeta(db, "peak_monthly", "complete", result);
    console.log("[runRankingAggregatePeakMonthly28d] done", result);
    return result;
  } catch (ePeak) {
    const msFail = Date.now() - t0;
    console.error("[runRankingAggregatePeakMonthly28d] failed", ePeak && ePeak.message ? ePeak.message : ePeak);
    try {
      await markManualRankingPhaseMeta(db, "peak_monthly", "failed", {
        lastError: ePeak && ePeak.message ? ePeak.message : String(ePeak),
        ms: msFail,
        startStr: r90s,
        endStr: r90e,
        userCount: snap ? snap.size : userCount,
        skipRollupBatch,
      });
    } catch (_eMeta) {}
    throw ePeak;
  }
}

/** 28일 피크 단일 구간만 (max | 1min | 5min | 10min | 20min | 40min | 60min) */
async function runRankingAggregatePeakMonthlyOneDuration(db, durationType, usersSnap = null) {
  if (!DURATION_FIELDS[durationType]) {
    throw new Error(`invalid_duration:${durationType}`);
  }
  const t0 = Date.now();
  const { startStr: r90s, endStr: r90e } = getRolling90DaysRangeSeoul();
  const snap = usersSnap ?? (await db.collection("users").get());
  await markManualRankingPhaseMeta(db, "peak_duration", "running", {
    durationType,
    r90s,
    r90e,
    userCount: snap.size,
  });
  await rankingDayRollup.rebuildPeak28dRollupsBatch(db, snap.docs, r90s, r90e, { ensureMissingDays: false });
  const allDur = await buildPeakPowerFromPeak28dRollupsOnePass(db, r90s, r90e, snap, durationType);
  let wrote = 0;
  for (const gender of ["all", "M", "F"]) {
    const pack = allDur[gender][durationType];
    await applyPeakRankChanges(db, pack.byCategory, `peak_${durationType}_monthly_${gender}`);
    const ckey = `peakRanking_v2_monthly_${durationType}_${gender}_${r90s}_${r90e}`;
    await writeRankingAggregatePayload(db, ckey, {
      byCategory: pack.byCategory,
      entries: pack.entries,
      startStr: r90s,
      endStr: r90e,
      cohortAvgHrBpm: pack.cohortAvgHrBpm,
    });
    wrote++;
  }
  const ms = Date.now() - t0;
  const result = {
    phase: "peak_duration",
    durationType,
    wrote,
    ms,
    startStr: r90s,
    endStr: r90e,
    userCount: snap.size,
    cacheKeyExample: `peakRanking_v2_monthly_${durationType}_all_${r90s}_${r90e}`,
  };
  await markManualRankingPhaseMeta(db, "peak_duration", "complete", result);
  console.log("[runRankingAggregatePeakMonthlyOneDuration] done", result);
  return result;
}

/** 30일 개인 거리 랭킹 */
async function runRankingAggregatePersonalDist30d(db, usersSnap = null) {
  const t0 = Date.now();
  const { startStr: r30s, endStr: r30e } = getRolling30DaysRangeSeoul();
  const snap = usersSnap ?? (await db.collection("users").get());
  await markManualRankingPhaseMeta(db, "personal_dist", "running", { r30s, r30e, userCount: snap.size });
  let wrote = 0;
  for (const gender of ["all", "M", "F"]) {
    const dist = await getRolling30dDistanceRankingBoardEntries(db, r30s, r30e, gender, snap);
    await applyPeakRankChanges(db, dist.byCategory, `peak_personal_dist_rolling30_${gender}`);
    const keyD = `peakRanking_personal_dist_30d_${gender}_${r30s}_${r30e}`;
    await writeRankingAggregatePayload(db, keyD, {
      byCategory: dist.byCategory,
      entries: dist.entries,
      startStr: r30s,
      endStr: r30e,
    });
    wrote++;
  }
  const ms = Date.now() - t0;
  const result = { phase: "personal_dist", wrote, ms, startStr: r30s, endStr: r30e, userCount: snap.size };
  await markManualRankingPhaseMeta(db, "personal_dist", "complete", result);
  console.log("[runRankingAggregatePersonalDist30d] done", result);
  return result;
}

/** 90일 독주(항속) — 피크·GC와 동일 롤링 창·일 버킷 rollup */
function personalSpeedAggregateCacheKey(gender, startStr, endStr) {
  return `peakRanking_personal_speed_90d_${gender}_${startStr}_${endStr}`;
}

function personalSpeedRankHistoryKey(gender) {
  return `peak_personal_speed_rolling90d_${gender}`;
}

async function runRankingAggregatePersonalSpeed28d(db, usersSnap = null, opts) {
  const t0 = Date.now();
  const { startStr: r90s, endStr: r90e } = getRolling90DaysRangeSeoul();
  const snap = usersSnap ?? (await db.collection("users").get());
  const allUserDocs = snap.docs;
  await markManualRankingPhaseMeta(db, "personal_speed", "running", {
    r90s,
    r90e,
    userCount: snap.size,
    period: rankingDayRollup.PERSONAL_SPEED_PERIOD_ROLLING,
  });
  const psMetaRef = db.collection("ranking_meta").doc("personal_speed_logic");
  const psMetaSnap = await psMetaRef.get();
  const psMetaVer = psMetaSnap.exists ? Number((psMetaSnap.data() || {}).version) : 0;
  if (psMetaVer < rankingDayRollup.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION) {
    await resetPersonalSpeedRankingDerivedState(db, r90s, r90e);
    await psMetaRef.set({
      version: rankingDayRollup.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION,
      period: rankingDayRollup.PERSONAL_SPEED_PERIOD_ROLLING,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  const psRollup = await rankingDayRollup.preparePersonalSpeedRankingRebuild(db, allUserDocs, r90s, r90e, {
    ensureMissingDays: !!(opts && opts.ensureMissingDays),
    fromBucketsOnly: opts && opts.fromBucketsOnly === false ? false : true,
    skipUnchanged: opts && opts.skipUnchanged === false ? false : true,
  });
  console.log("[runRankingAggregatePersonalSpeed28d] rollup", psRollup);
  let wrote = 0;
  for (const gender of ["all", "M", "F"]) {
    const spd = await getPersonalSpeedRankingBoardEntriesFromRollups(db, r90s, r90e, gender, snap, {
      fromRollupsOnly: true,
      syncRollups: false,
    });
    spd.dashboardLogRouteEnriched = true;
    await applyPeakRankChanges(db, spd.byCategory, personalSpeedRankHistoryKey(gender));
    const keyS = personalSpeedAggregateCacheKey(gender, r90s, r90e);
    await persistPersonalSpeedRankingPack(db, keyS, spd, r90s, r90e);
    wrote++;
  }
  const ms = Date.now() - t0;
  const result = {
    phase: "personal_speed",
    wrote,
    ms,
    startStr: r90s,
    endStr: r90e,
    period: rankingDayRollup.PERSONAL_SPEED_PERIOD_ROLLING,
    psRollup,
    userCount: snap.size,
  };
  await markManualRankingPhaseMeta(db, "personal_speed", "complete", result);
  console.log("[runRankingAggregatePersonalSpeed28d] done", result);
  return result;
}

/** @deprecated 이름 호환 */ const runRankingAggregatePersonalSpeed183d = runRankingAggregatePersonalSpeed28d;

/** 장시간 구간 진행·멈춤 확인용 — Firestore만 새로고침해도 lastPhase·progressAt 갱신 */
async function markMasterDailyRankingRebuildProgress(db, lastPhase, extra) {
  const dateKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  await db.collection("ranking_meta").doc(RANKING_MASTER_REBUILD_META_DOC).set(
    {
      dateKst,
      status: "running",
      lastPhase: String(lastPhase || ""),
      progressAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(extra && typeof extra === "object" ? extra : {}),
    },
    { merge: true }
  );
}

/** GC 헵타곤 스냅샷(03:20 KST) 완료 시각 — 집계 여부 확인용 */
async function markHeptagonDailyRebuildComplete(db, resultSummary) {
  const dateKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const wrote = resultSummary && Number(resultSummary.wrote) > 0 ? Number(resultSummary.wrote) : 0;
  if (wrote < 1) {
    throw new Error(
      "heptagon_daily_rebuild_complete_rejected_zero_writes"
    );
  }
  await db.collection("ranking_meta").doc(RANKING_HEPTAGON_REBUILD_META_DOC).set(
    {
      dateKst,
      status: "complete",
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      runningAt: admin.firestore.FieldValue.delete(),
      lastError: admin.firestore.FieldValue.delete(),
      summary: resultSummary && typeof resultSummary === "object" ? resultSummary : null,
    },
    { merge: true }
  );
}

async function markHeptagonRebuildRunning(db) {
  const dateKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  await db.collection("ranking_meta").doc(RANKING_HEPTAGON_REBUILD_META_DOC).set(
    {
      dateKst,
      status: "running",
      runningAt: admin.firestore.FieldValue.serverTimestamp(),
      lastError: admin.firestore.FieldValue.delete(),
      failedAt: admin.firestore.FieldValue.delete(),
    },
    { merge: true }
  );
}

async function markHeptagonRebuildFailed(db, err) {
  const dateKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const msg = err && err.message ? err.message : String(err || "unknown");
  await db.collection("ranking_meta").doc(RANKING_HEPTAGON_REBUILD_META_DOC).set(
    {
      dateKst,
      status: "failed",
      runningAt: admin.firestore.FieldValue.delete(),
      lastError: msg,
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/** 마스터 집계 HTTP — running 고착 시 자동 해제 (헵타곤과 동일 25분) */
async function masterManualRebuildAlreadyRunning(db, opts) {
  const force = opts && opts.force === true;
  try {
    const ref = db.collection("ranking_meta").doc(RANKING_MASTER_REBUILD_META_DOC);
    const snap = await ref.get();
    if (!snap.exists) return false;
    const d = snap.data() || {};
    if (String(d.status || "") !== "running" || !d.runningAt) return false;
    const t =
      typeof d.runningAt.toMillis === "function"
        ? d.runningAt.toMillis()
        : d.runningAt instanceof Date
          ? d.runningAt.getTime()
          : 0;
    const runningMs = t > 0 ? Date.now() - t : HEPTAGON_REBUILD_RUNNING_STALE_MS + 1;
    if (force || runningMs >= HEPTAGON_REBUILD_RUNNING_STALE_MS) {
      await ref.set(
        {
          status: "failed",
          runningAt: admin.firestore.FieldValue.delete(),
          lastError: force ? "manual_force_clear_running" : "stale_running_lock_cleared",
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      console.warn("[masterManualRebuildAlreadyRunning] stale running lock cleared", {
        runningMs,
        force: !!force,
      });
      return false;
    }
    return true;
  } catch (_e) {
    return false;
  }
}

/** 수동 HTTP 중복 실행 억제 — running 고착 시 자동 해제 */
async function heptagonManualRebuildAlreadyRunning(db, opts) {
  const force = opts && opts.force === true;
  try {
    const ref = db.collection("ranking_meta").doc(RANKING_HEPTAGON_REBUILD_META_DOC);
    const snap = await ref.get();
    if (!snap.exists) return false;
    const d = snap.data() || {};
    if (String(d.status || "") !== "running" || !d.runningAt) return false;
    const t =
      typeof d.runningAt.toMillis === "function"
        ? d.runningAt.toMillis()
        : d.runningAt instanceof Date
          ? d.runningAt.getTime()
          : 0;
    const runningMs = t > 0 ? Date.now() - t : HEPTAGON_REBUILD_RUNNING_STALE_MS + 1;
    if (force || runningMs >= HEPTAGON_REBUILD_RUNNING_STALE_MS) {
      await ref.set(
        {
          status: "failed",
          runningAt: admin.firestore.FieldValue.delete(),
          lastError: force
            ? "manual_force_clear_running"
            : "stale_running_lock_cleared",
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      console.warn("[heptagonManualRebuildAlreadyRunning] stale running lock cleared", {
        runningMs,
        force: !!force,
      });
      return false;
    }
    return true;
  } catch (_e) {
    return false;
  }
}

function startHeptagonCohortRanksRebuildInBackground(db) {
  markHeptagonRebuildRunning(db)
    .then(() => runHeptagonCohortRanksRebuildJob())
    .then((r) => markHeptagonDailyRebuildComplete(db, r))
    .then(() => console.log("[heptagon background rebuild] ok"))
    .catch((e) => {
      console.error("[heptagon background rebuild]", e && e.message ? e.message : e);
      return markHeptagonRebuildFailed(db, e);
    });
}

/** 사용자 로그에서 주간 TSS 합계 (날짜별: strava 우선, 없으면 stelvio) — ranking_day_totals 일 버킹 집계 */
async function getWeeklyTssForUser(db, userId, startStr, endStr, userDataCached = null) {
  try {
    const userData = userDataCached
      ?? (await db.collection("users").doc(userId).get()).data()
      ?? {};
    return await rankingDayRollup.weeklyTssSumFromDayBuckets(db, userId, userData, startStr, endStr);
  } catch (e) {
    console.warn("[getWeeklyTssForUser]", userId, e.message);
    return 0;
  }
}

/** 사용자 로그에서 기간 내 라이딩 거리 합계(km) — ranking_day_totals 기반 */
async function getRolling30dCyclingKmForUser(db, userId, startStr, endStr, userDataCached = null) {
  try {
    const userData = userDataCached
      ?? (await db.collection("users").doc(userId).get()).data()
      ?? {};
    return await rankingDayRollup.rollingKmSumFromDayBuckets(db, userId, userData, startStr, endStr);
  } catch (e) {
    console.warn("[getRolling30dCyclingKmForUser]", userId, e.message);
    return 0;
  }
}

/** 해당 주간에 1일 500 이상 TSS가 있는지 여부 (포인트 적립 제외 판단용) */
async function hasWeeklyTssCheatDay(db, userId, startStr, endStr) {
  try {
    const us = await db.collection("users").doc(userId).get();
    const userData = us.exists ? us.data() : {};
    return await rankingDayRollup.cheatDayPresentFromBuckets(db, userId, userData, startStr, endStr);
  } catch (e) {
    console.warn("[hasWeeklyTssCheatDay]", userId, e.message);
    return false;
  }
}

const WEEKLY_RANKING_CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const WEEKLY_TSS_BATCH_SIZE = 50; // 1000명 대비: 20배치로 완료

/**
 * 주간 마일리지 TOP10 / getWeeklyRanking — TSS 랭킹보드 탭과 동일 풀·정렬
 * (리그 분류 가능 사용자만, getWeeklyTssForUser 동일, gender=all)
 */
async function getWeeklyRankingEntries(db, startStr, endStr, usersSnap = null) {
  const { entries } = await getWeeklyTssRankingBoardEntries(db, startStr, endStr, "all", usersSnap);
  return entries.map((e) => ({
    userId: e.userId,
    name: e.name,
    totalTss: e.totalTss,
    is_private: privacyFlagFromFirestoreDoc(e),
  }));
}

/** 주간 랭킹 TOP10 조회 (캐시 5분 + 병렬 50명/배치, 1000명 대비 타임아웃 9분)
 * 쿼리: week=prev → 전주 랭킹 (새 주 시작 후 현재주 순위자 없을 때 사용) */
const getWeeklyRankingOptions = supabaseDualWriteServer.appendServiceRoleSecret({
  cors: true,
  timeoutSeconds: 540,
});
exports.getWeeklyRanking = onRequest(
  getWeeklyRankingOptions,
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    try {
    const db = admin.firestore();
    const weekParam = (req.query && req.query.week) || "";
    const userIdParam = (req.query && req.query.userId) || "";
    const usePrevWeek = weekParam === "prev";
    const { startStr, endStr } = usePrevWeek ? getWeekRangeSeoul(-1) : getWeekRangeSeoul();

    const weeklyReadRoute = await rankingReadConfig.shouldReadRankingFromSupabase(
      admin,
      userIdParam
    );
    const weeklyFromSupabase = await rankingReadRouter.tryBuildWeeklyRankingFromSupabase(
      admin,
      req.query || {},
      { getWeekRangeSeoul }
    );
    if (weeklyFromSupabase) {
      const ent = weeklyFromSupabase.allEntries || [];
      delete weeklyFromSupabase.allEntries;
      if (
        weeklyFromSupabase.readSource !== "supabase" &&
        weeklyFromSupabase.readBackend !== "supabase"
      ) {
        await hydrateRankingBoardPrivacyFromUsers(db, { Supremo: ent }, ent);
        await hydrateRankingBoardProfileImages(db, { Supremo: ent }, ent);
      }
      const hasRanking =
        Array.isArray(weeklyFromSupabase.ranking) && weeklyFromSupabase.ranking.length > 0;
      const fromSupabaseRead =
        weeklyFromSupabase.readSource === "supabase" ||
        weeklyFromSupabase.readBackend === "supabase";
      if (
        fromSupabaseRead ||
        hasRanking ||
        usePrevWeek ||
        weeklyFromSupabase.pendingAggregate
      ) {
        filterWithdrawnUsersFromRankingPayload(weeklyFromSupabase);
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Cache-Control", "no-store");
        return res.status(200).json(weeklyFromSupabase);
      }
    }

    if (weeklyReadRoute.route === "supabase") {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Cache-Control", "no-store");
      return res.status(200).json({
        success: true,
        ranking: [],
        startStr,
        endStr,
        readBackend: "supabase",
        readSource: "supabase",
        pendingAggregate: true,
        supabaseReadBlockedFirebaseFallback: true,
        message: "Supabase 주간 TSS 랭킹을 불러오는 중입니다.",
      });
    }

    if (!rankingReadConfig.safeIsFirebaseRankingReadAllowed()) {
      res.set("Cache-Control", "no-store");
      return res.status(200).json({
        success: true,
        ranking: [],
        startStr,
        endStr,
        readBackend: "supabase",
        readSource: "supabase",
        pendingAggregate: true,
        message: "Firebase 주간 랭킹 Read 비활성(Supabase 전용).",
      });
    }

    const buildWeeklyRankingResponse = (entries, precomputed, weekOpts) => {
      weekOpts = weekOpts || {};
      const rs = weekOpts.startStr != null ? weekOpts.startStr : startStr;
      const re = weekOpts.endStr != null ? weekOpts.endStr : endStr;
      const top10 = entries.slice(0, 10).map((e, i) => ({
        rank: i + 1,
        userId: e.userId,
        name: e.name,
        totalTss: Math.round(e.totalTss * 100) / 100,
        rankChange: e.rankChange,
        previousBoardRank: e.previousBoardRank,
        is_private: e.is_private === true,
        profileImageUrl: e.profileImageUrl || null,
      }));
      let myRank = null;
      if (userIdParam) {
        // 전체 entries에서 내 순위를 찾아 TOP10 밖이면 myRank로 반환
        const userIdx = entries.findIndex((e) => e.userId === userIdParam);
        const e = entries[userIdx];
        if (e) {
          const r = {
            rank: userIdx + 1,
            userId: e.userId,
            name: e.name,
            totalTss: Math.round(e.totalTss * 100) / 100,
            rankChange: e.rankChange,
            previousBoardRank: e.previousBoardRank,
            is_private: e.is_private === true,
            profileImageUrl: e.profileImageUrl || null,
          };
          if (userIdx >= 10) myRank = r;  // TOP10 밖일 때만 별도 표시
        }
      }
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Cache-Control", "no-store");
      const rankBody = {
        success: true,
        ranking: top10,
        startStr: rs,
        endStr: re,
        myRank: myRank || undefined,
      };
      if (weekOpts.prevWeekFallback) rankBody.prevWeekFallback = true;
      if (precomputed === true) rankBody.precomputed = true;
      else if (precomputed === false) rankBody.liveComputed = true;
      rankBody.readBackend = "firebase";
      rankBody.readSource = "firebase";
      /* baseline 메타 동봉 → 클라이언트가 상승/보합/하락 전체 재계산.
         (Firebase 경로도 Supabase 경로와 동일하게 등락 표시) */
      const rmMeta = entries && entries._rankMovementMeta;
      if (rmMeta) {
        if (rmMeta.rankMovementPrevDayByCategory)
          rankBody.rankMovementPrevDayByCategory = rmMeta.rankMovementPrevDayByCategory;
        if (rmMeta.rankMovementCompareBaselineByCategory)
          rankBody.rankMovementCompareBaselineByCategory =
            rmMeta.rankMovementCompareBaselineByCategory;
        if (rmMeta.rankMovementSource) rankBody.rankMovementSource = rmMeta.rankMovementSource;
        if (rmMeta.rankMovementAsOfSeoul)
          rankBody.rankMovementAsOfSeoul = rmMeta.rankMovementAsOfSeoul;
        rankBody.rankMovementHydrated = rmMeta.rankMovementHydrated === true;
      }
      return res.status(200).json(rankBody);
    };

    // ── 1순위: TSS탭과 동일한 집계 문서 (peakRanking_weekly_tss_v2_all_*) ──
    // TOP10 모달과 TSS탭이 항상 동일한 데이터를 표시하도록 같은 소스 공유.
    const tssCacheKey = `peakRanking_weekly_tss_v2_all_${startStr}_${endStr}`;
    const tssAgg = await readRankingAggregatePayloadIfFresh(db, tssCacheKey);
    if (tssAgg && tssAgg.startStr === startStr && tssAgg.endStr === endStr && Array.isArray(tssAgg.entries)) {
      const entries = tssAgg.entries; // 전체 순위 배열 (rank, userId, name, totalTss, is_private, profileImageUrl 등)
      await hydrateRankingBoardPrivacyFromUsers(db, { Supremo: entries }, entries);
      await hydrateRankingBoardProfileImages(db, { Supremo: entries }, entries);
      const hydratedTss = await hydrateWeeklyRankingEntriesRankMovement(db, entries);
      return buildWeeklyRankingResponse(hydratedTss, true);
    }

    // ── 2순위: weekly_ranking_full_* (수동 집계가 직접 쓴 문서) ──
    const weeklyAggKey = `weekly_ranking_full_${startStr}_${endStr}`;
    const weeklyAgg = await readRankingAggregatePayloadIfFresh(db, weeklyAggKey);
    const aggMatchesWeek =
      weeklyAgg &&
      weeklyAgg.startStr === startStr &&
      weeklyAgg.endStr === endStr &&
      Array.isArray(weeklyAgg.fullEntries);

    if (aggMatchesWeek) {
      await hydrateRankingBoardPrivacyFromUsers(db, { Supremo: weeklyAgg.fullEntries }, weeklyAgg.fullEntries);
      await hydrateRankingBoardProfileImages(db, { Supremo: weeklyAgg.fullEntries }, weeklyAgg.fullEntries);
      const hydratedWeekly = await hydrateWeeklyRankingEntriesRankMovement(db, weeklyAgg.fullEntries);
      return buildWeeklyRankingResponse(hydratedWeekly, true);
    }

    // 구버전 cache/* 문서는 startStr/endStr가 일치할 때만 사용 (집계 주간과 불일치 시 잘못된 주차 데이터 노출 방지)
    const cacheRef = db.collection("cache").doc(usePrevWeek ? "weeklyRankingPrev" : "weeklyRanking");
    const cacheSnap = await cacheRef.get();
    const nowMs = Date.now();
    if (cacheSnap.exists) {
      const data = cacheSnap.data() || {};
      const legacyStart = data.startStr != null ? String(data.startStr) : "";
      const legacyEnd = data.endStr != null ? String(data.endStr) : "";
      const ranking = Array.isArray(data.ranking) ? data.ranking : [];
      const legacyMatches = legacyStart === startStr && legacyEnd === endStr && ranking.length > 0;
      if (legacyMatches) {
        const fullEntries = Array.isArray(data.fullEntries) ? data.fullEntries : [];
        const mergeHydrate = ranking.concat(fullEntries);
        if (mergeHydrate.length) {
          await hydrateRankingBoardPrivacyFromUsers(db, { Supremo: mergeHydrate }, null);
          await hydrateRankingBoardProfileImages(db, { Supremo: mergeHydrate }, null);
        }
        const updatedAt = data.updatedAt && (data.updatedAt.toMillis ? data.updatedAt.toMillis() : data.updatedAt);
        const ageMin = updatedAt ? Math.round((nowMs - updatedAt) / 60000) : null;
        const legacyEntries = fullEntries.length
          ? fullEntries
          : ranking.map((e, i) => ({
              userId: e.userId,
              name: e.name,
              totalTss: e.totalTss,
              rank: e.rank != null ? e.rank : i + 1,
              is_private: e.is_private === true,
              profileImageUrl: e.profileImageUrl || null,
            }));
        const hydratedLegacy = await hydrateWeeklyRankingEntriesRankMovement(db, legacyEntries);
        const rankBodyLegacy = {
          success: true,
          ranking: hydratedLegacy.slice(0, 10).map((e, i) => ({
            rank: i + 1,
            userId: e.userId,
            name: e.name,
            totalTss: Math.round((e.totalTss || 0) * 100) / 100,
            rankChange: e.rankChange,
            previousBoardRank: e.previousBoardRank,
            is_private: e.is_private === true,
            profileImageUrl: e.profileImageUrl || null,
          })),
          startStr,
          endStr,
          cached: true,
          stale: true,
          cacheAgeMin: ageMin,
          rebuilding: true,
          readBackend: "firebase",
          readSource: "firebase",
        };
        if (userIdParam) {
          const userIdx = hydratedLegacy.findIndex((e) => e.userId === userIdParam);
          if (userIdx >= 10) {
            const e = hydratedLegacy[userIdx];
            rankBodyLegacy.myRank = {
              rank: userIdx + 1,
              userId: e.userId,
              name: e.name,
              totalTss: Math.round((e.totalTss || 0) * 100) / 100,
              rankChange: e.rankChange,
              previousBoardRank: e.previousBoardRank,
              is_private: e.is_private === true,
              profileImageUrl: e.profileImageUrl || null,
            };
          }
        }
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Cache-Control", "no-store");
        return res.status(200).json(rankBodyLegacy);
      }
    }

    // 사전 집계 miss: stale(전일 endStr 키 포함) → 주간 TSS는 HTTP 라이브 재집계 허용(자정 직후 빈 목록 방지)
    if (!ALLOW_RANKING_HTTP_LIVE_REBUILD) {
      const weeklyStale = await readRankingAggregatePayloadAllowStale(db, weeklyAggKey, RANKING_HTTP_STALE_FALLBACK_MS);
      const weeklyStaleMatchesWeek =
        weeklyStale &&
        (!weeklyStale.startStr || String(weeklyStale.startStr) === startStr) &&
        (!weeklyStale.endStr || String(weeklyStale.endStr) === endStr);
      if (weeklyStaleMatchesWeek && Array.isArray(weeklyStale.fullEntries) && weeklyStale.fullEntries.length > 0) {
        const hydratedStale = await hydrateWeeklyRankingEntriesRankMovement(db, weeklyStale.fullEntries);
        return buildWeeklyRankingResponse(hydratedStale, true);
      }
      const fromTssRoll = await readWeeklyTssEntriesForTop10Http(db, startStr, endStr);
      if (fromTssRoll && fromTssRoll.length > 0) {
        const mapped = fromTssRoll.map((e) => ({
          userId: e.userId,
          name: e.name,
          totalTss: e.totalTss,
          is_private: e.is_private === true,
          profileImageUrl: e.profileImageUrl || null,
        }));
        const hydratedMapped = await hydrateWeeklyRankingEntriesRankMovement(db, mapped);
        return buildWeeklyRankingResponse(hydratedMapped, true);
      }
    }
    const weeklyLiveKey = tssCacheKey;
    const mayLiveWeekly =
      ALLOW_RANKING_HTTP_LIVE_REBUILD &&
      (await tryAcquireRankingHttpLiveRebuildLock(db, weeklyLiveKey));
    if (mayLiveWeekly) {
      try {
        const usersSnap = await db.collection("users").get();
        const tssBoard = await getWeeklyTssRankingBoardEntries(db, startStr, endStr, "all", usersSnap);
        const liveEntries = (tssBoard.entries || []).map((e) => ({
          userId: e.userId,
          name: e.name,
          totalTss: e.totalTss,
          is_private: e.is_private === true,
        }));
        if (liveEntries.length > 0) {
          try {
            await writeRankingAggregatePayload(db, weeklyAggKey, {
              fullEntries: liveEntries,
              ranking: liveEntries.slice(0, 10).map((e, i) => ({
                rank: i + 1,
                userId: e.userId,
                name: e.name,
                totalTss: Math.round(e.totalTss * 100) / 100,
                is_private: e.is_private === true,
              })),
              startStr,
              endStr,
            });
            await writeRankingAggregatePayload(db, weeklyLiveKey, {
              byCategory: tssBoard.byCategory,
              entries: tssBoard.entries,
              startStr,
              endStr,
            });
          } catch (writeErr) {
            console.warn("[getWeeklyRanking] aggregate write after live compute:", writeErr && writeErr.message ? writeErr.message : writeErr);
          }
          const hydratedLive = await hydrateWeeklyRankingEntriesRankMovement(db, liveEntries);
          return buildWeeklyRankingResponse(hydratedLive, false);
        }
      } catch (liveErr) {
        console.error("[getWeeklyRanking] live getWeeklyTssRankingBoardEntries failed:", liveErr && liveErr.message ? liveErr.message : liveErr);
      }
    }

    if (!usePrevWeek) {
      const prevRange = getWeekRangeSeoul(-1);
      const prevEntries = await readWeeklyTssEntriesForTop10Http(
        db,
        prevRange.startStr,
        prevRange.endStr
      );
      if (prevEntries && prevEntries.length > 0) {
        const hydratedPrev = await hydrateWeeklyRankingEntriesRankMovement(db, prevEntries);
        return buildWeeklyRankingResponse(hydratedPrev, true, {
          startStr: prevRange.startStr,
          endStr: prevRange.endStr,
          prevWeekFallback: true,
        });
      }
    }

    res.set("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      ranking: [],
      startStr,
      endStr,
      rebuilding: true,
      message: "랭킹 집계 준비 중입니다. 잠시 후 다시 시도해주세요.",
    });
    } catch (errWeekly) {
      console.error(
        "[getWeeklyRanking] unhandled",
        errWeekly && errWeekly.stack ? errWeekly.stack : errWeekly
      );
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Cache-Control", "no-store");
      if (!res.headersSent) {
        res.status(200).json({
          success: true,
          ranking: [],
          readBackend: "supabase",
          readSource: "supabase",
          pendingAggregate: true,
          error: "weekly_ranking_internal",
          message:
            errWeekly && errWeekly.message
              ? String(errWeekly.message)
              : "주간 랭킹 조회 중 오류가 발생했습니다.",
        });
      }
    }
  }
);

/** 일요일 21:00 Asia/Seoul 주간 랭킹 확정 및 1/2/3등 포인트 지급 (1000명 대비 타임아웃 9분)
 * 1일 500+ TSS 치팅: 합산 제외 + 포인트 적립 대상에서도 제외 (hasWeeklyTssCheatDay) */
const finalizeWeeklyOptions = {
  schedule: "0 21 * * 0",
  timeZone: "Asia/Seoul",
  timeoutSeconds: 540,
};
exports.finalizeWeeklyRanking = onSchedule(
  finalizeWeeklyOptions,
  async (event) => {
    const db = admin.firestore();
    const { startStr, endStr } = getWeekRangeSeoul();
    let entries = [];
    let weeklyFromSupabase = false;
    try {
      const sbWeekly = await supabaseRankingReader.fetchWeeklyTssRanking(admin, startStr, endStr, "all");
      entries = Array.isArray(sbWeekly && sbWeekly.entries) ? sbWeekly.entries : [];
      weeklyFromSupabase = true;
      console.log("[finalizeWeeklyRanking] Supabase weekly TSS source", {
        entries: entries.length,
        supabaseWeeklyTssSource: sbWeekly && sbWeekly.supabaseWeeklyTssSource,
      });
    } catch (eSbWeekly) {
      console.error("[finalizeWeeklyRanking] Supabase weekly TSS failed:", eSbWeekly && eSbWeekly.message ? eSbWeekly.message : eSbWeekly);
      entries = await getWeeklyRankingEntries(db, startStr, endStr); // emergency fallback only
    }
    const pointRecipients = [];
    for (const e of entries) {
      if (pointRecipients.length >= 3) break;
      const hasCheat = weeklyFromSupabase
        ? false
        : await hasWeeklyTssCheatDay(db, e.userId, startStr, endStr);
      if (!hasCheat) pointRecipients.push({ ...e, rank: pointRecipients.length + 1 });
    }
    const points = [100, 50, 30]; // 1등 100SP, 2등 50SP, 3등 30SP
    for (let i = 0; i < pointRecipients.length; i++) {
      const u = pointRecipients[i];
      const userRef = db.collection("users").doc(u.userId);
      const snap = await userRef.get();
      if (!snap.exists) continue;
      const data = snap.data();
      const add = points[i];
      const rem = Number(data.rem_points || 0) + add;
      const acc = Number(data.acc_points || 0) + add;
      await userRef.update({ rem_points: rem, acc_points: acc });
      console.log("[finalizeWeeklyRanking] 포인트 지급:", (i + 1) + "등", u.name, "+" + add + "SP → rem_points:", rem, ", acc_points:", acc);
    }
    console.log("[finalizeWeeklyRanking] 완료", { startStr, endStr, pointRecipients: pointRecipients.map((e) => e.name) });
  }
);

// ---------- STELVIO 랭킹 보드 (피크 파워 W/kg 기반) ----------
const DURATION_FIELDS = {
  "1min": "max_1min_watts",
  "5min": "max_5min_watts",
  "10min": "max_10min_watts",
  "20min": "max_20min_watts",
  "40min": "max_40min_watts",
  "60min": "max_60min_watts",
  max: "max_watts",
};

/** 구간별 심박 피크 필드 (로그 집계·코호트 평균 심박용) */
const DURATION_HR_FIELDS = {
  "1min": "max_hr_1min",
  "5min": "max_hr_5min",
  "10min": "max_hr_10min",
  "20min": "max_hr_20min",
  "40min": "max_hr_40min",
  "60min": "max_hr_60min",
};

/** Andrew Coggan World Class 한계치 - 초과 시 센서 오류(이상치)로 간주. W/kg OR 절대 W 중 하나라도 초과하면 제외 */
const PEAK_POWER_LIMITS = {
  max: { wkg: 25.0, watts: 2200 },
  "1min": { wkg: 12.0, watts: 900 },
  "5min": { wkg: 8.0, watts: 700 },
  "10min": { wkg: 7.0, watts: 600 },
  "20min": { wkg: 6.5, watts: 550 },
  "40min": { wkg: 6.0, watts: 500 },
  "60min": { wkg: 5.8, watts: 450 },
};

const POWER_SPIKE_THRESHOLD_W = 2000;
const POWER_SPIKE_JUMP_W = 1000;
const HR_MAX_BPM = 220;
/** 심박 스파이크: 1초 만에 HR_SPIKE_JUMP_BPM 이상 튀는 값 → 인접 평균으로 대체 */
const HR_SPIKE_JUMP_BPM = 25;
const DEFAULT_FTP_W = 150;
const DEFAULT_MAX_HR = 190;

/**
 * 1초 단위 Raw Data에서 2000W 초과 스파이크 및 1초 만에 1000W 이상 튀는 값을 직전 3초·직후 3초 평균으로 대체
 * @param {number[]} rawDataArray - 1초당 1개 파워 값 배열
 * @returns {number[]} 스파이크 보간된 배열 (원본 변경 없음)
 */
function smoothPowerSpikes(rawDataArray) {
  if (!rawDataArray || rawDataArray.length === 0) return rawDataArray;
  const arr = rawDataArray.map((v) => Number(v) || 0);
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    const prev = i > 0 ? arr[i - 1] : arr[i];
    const isOverThreshold = arr[i] > POWER_SPIKE_THRESHOLD_W;
    const isSpikeJump = i > 0 && Math.abs(arr[i] - prev) > POWER_SPIKE_JUMP_W;
    if (!isOverThreshold && !isSpikeJump) continue;
    const before = [];
    for (let b = 1; b <= 3; b++) {
      if (i - b >= 0) before.push(arr[i - b]);
    }
    const after = [];
    for (let a = 1; a <= 3; a++) {
      if (i + a < len) after.push(arr[i + a]);
    }
    const combined = [...before, ...after];
    arr[i] = combined.length > 0
      ? Math.round(combined.reduce((s, v) => s + v, 0) / combined.length)
      : POWER_SPIKE_THRESHOLD_W;
  }
  return arr;
}

/**
 * 심박 스트림에서 평균 대비 갑자기 튀는 값(스파이크) 제거 → 인접값 평균으로 대체
 * - 1초 만에 HR_SPIKE_JUMP_BPM(25) 이상 변동 시 스파이크로 간주
 * - 220bpm 초과도 스파이크로 간주
 * @param {number[]} rawHrArray - 1초당 1개 심박 값 배열
 * @returns {number[]} 스파이크 보간된 배열
 */
function smoothHeartRateSpikes(rawHrArray) {
  if (!rawHrArray || rawHrArray.length === 0) return rawHrArray || [];
  const arr = rawHrArray.map((v) => Number(v) || 0);
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    const prev = i > 0 ? arr[i - 1] : arr[i];
    const isOverMax = arr[i] > HR_MAX_BPM;
    const isSpikeJump = i > 0 && Math.abs(arr[i] - prev) > HR_SPIKE_JUMP_BPM;
    if (!isOverMax && !isSpikeJump) continue;
    const before = [];
    for (let b = 1; b <= 3; b++) {
      if (i - b >= 0 && arr[i - b] > 0 && arr[i - b] <= HR_MAX_BPM) before.push(arr[i - b]);
    }
    const after = [];
    for (let a = 1; a <= 3; a++) {
      if (i + a < len && arr[i + a] > 0 && arr[i + a] <= HR_MAX_BPM) after.push(arr[i + a]);
    }
    const combined = [...before, ...after];
    arr[i] = combined.length > 0
      ? Math.round(combined.reduce((s, v) => s + v, 0) / combined.length)
      : (prev > 0 && prev <= HR_MAX_BPM ? prev : 0);
  }
  return arr;
}

/**
 * users/yearly_peaks/{year}에서 max_hr 조회. 없으면 null.
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} userId
 * @param {number|string} year - 라이딩 연도 (스트림 날짜에서 파싱)
 * @returns {Promise<number|null>}
 */
async function getMaxHRForYear(db, userId, year) {
  if (!db || !userId || year == null) return null;
  try {
    const yearStr = String(year);
    const ref = db.collection("users").doc(userId).collection("yearly_peaks").doc(yearStr);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data();
    const maxHr = data && (data.max_hr != null || data.max_heartrate != null)
      ? Number(data.max_hr ?? data.max_heartrate)
      : null;
    return maxHr != null && maxHr > 0 ? maxHr : null;
  } catch (e) {
    console.warn("[getMaxHRForYear] 조회 실패:", userId, year, e.message);
    return null;
  }
}

/** Max HR from user logs in the last 365 days (server local date). */
async function getMaxHRRolling365FromLogs(db, userId) {
  if (!db || !userId) return null;
  const pad = (n) => String(n).padStart(2, "0");
  const localYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const end = new Date();
  const start = new Date(end.getTime());
  start.setDate(start.getDate() - 365);
  const startStr = localYmd(start);
  const endStr = localYmd(end);
  const coll = db.collection("users").doc(userId).collection("logs");
  const seen = new Set();
  let bestHr = 0;
  const considerLog = (d) => {
    const hr = Math.max(
      Number(d.max_hr_5sec) || 0,
      Number(d.max_hr) || 0,
      Number(d.max_heartrate) || 0
    );
    if (hr > 0 && hr <= HR_MAX_BPM && hr > bestHr) bestHr = hr;
  };
  const consider = (docSnap) => considerLog(docSnap.data() || {});

  const supabaseLogs = await tryFetchCyclingLogsFromSupabaseRidesInRange(
    userId,
    startStr,
    endStr
  );
  if (supabaseLogs) {
    supabaseLogs.forEach((d) => considerLog(d));
    return bestHr > 0 ? bestHr : null;
  }

  try {
    const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
    const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
    const snap1 = await coll
      .where("date", ">=", admin.firestore.Timestamp.fromDate(startDate))
      .where("date", "<=", admin.firestore.Timestamp.fromDate(endDate))
      .get();
    snap1.forEach((doc) => {
      seen.add(doc.id);
      consider(doc);
    });
  } catch (e) {
    console.warn("[getMaxHRRolling365FromLogs] Timestamp query:", e.message);
  }
  try {
    const snap2 = await coll.where("date", ">=", startStr).where("date", "<=", endStr).get();
    snap2.forEach((doc) => {
      if (seen.has(doc.id)) return;
      consider(doc);
    });
  } catch (e) {
    console.warn("[getMaxHRRolling365FromLogs] string query:", e.message);
  }
  return bestHr > 0 ? bestHr : null;
}

/**
 * FTP Fallback: 사용자 프로필 FTP 없으면 20분 MMP의 95% 또는 기본값 150W
 * @param {Object} userData - users 문서 데이터
 * @param {number[]} [wattsArray] - 파워 스트림 (20분 MMP 계산용)
 * @returns {number} FTP (W)
 */
function getFTPWithFallback(userData, wattsArray) {
  const ftp = Number(userData?.ftp) || 0;
  if (ftp > 0) return ftp;
  if (wattsArray && wattsArray.length >= 1200) {
    const smoothed = smoothPowerSpikes(wattsArray);
    const max20min = calculateMaxAveragePower(smoothed, 1200);
    if (max20min > 0) return Math.round(max20min * 0.95);
  }
  return DEFAULT_FTP_W;
}

/**
 * 심박 스트림 노이즈 필터: 220bpm 초과 무시 (null로 대체하여 해당 초는 HR 존 계산에서 제외)
 * @param {number[]} hrArray
 * @returns {number[]} 필터된 배열 (무효값은 -1로 표시하여 무시)
 */
function filterHRWithNoise(hrArray) {
  if (!hrArray || hrArray.length === 0) return [];
  return hrArray.map((v) => {
    const n = Number(v) || 0;
    if (n <= 0 || n > HR_MAX_BPM) return -1;
    return n;
  });
}

/**
 * Coggan 7-Zone: 파워(W) → 존 인덱스 (0=Coasting, 1~7)
 * Z0: 0W, Z1: <55%, Z2: 56-75%, Z3: 76-90%, Z4: 91-105%, Z5: 106-120%, Z6: 121-150%, Z7: >150%
 */
function getPowerZoneIndex(powerW, ftp) {
  const p = Number(powerW) || 0;
  if (p <= 0) return 0;
  if (!ftp || ftp <= 0) return 1;
  const pct = (p / ftp) * 100;
  if (pct < 55) return 1;
  if (pct <= 75) return 2;
  if (pct <= 90) return 3;
  if (pct <= 105) return 4;
  if (pct <= 120) return 5;
  if (pct <= 150) return 6;
  return 7;
}

/**
 * 심박 존: Max HR 기준 5존
 * Z1: 50-60%, Z2: 60-70%, Z3: 70-80%, Z4: 80-90%, Z5: 90-100%
 */
function getHRZoneIndex(hrBpm, maxHr) {
  const hr = Number(hrBpm) || 0;
  if (hr <= 0 || !maxHr || maxHr <= 0) return null;
  const pct = (hr / maxHr) * 100;
  if (pct < 50) return null;
  if (pct < 60) return 1;
  if (pct < 70) return 2;
  if (pct < 80) return 3;
  if (pct < 90) return 4;
  if (pct <= 100) return 5;
  return null;
}

/**
 * 파워 스트림에서 존별 누적 시간(초) 계산. 노이즈 필터 적용된 smoothPowerSpikes 결과 사용.
 */
function calculateTimeInPowerZones(wattsArray, ftp) {
  const zones = { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, z7: 0 };
  if (!wattsArray || wattsArray.length === 0 || !ftp || ftp <= 0) return zones;
  wattsArray.forEach((w) => {
    const idx = getPowerZoneIndex(w, ftp);
    zones[`z${idx}`] = (zones[`z${idx}`] || 0) + 1;
  });
  return zones;
}

/**
 * 심박 스트림에서 존별 누적 시간(초) 계산. 220bpm 초과 무시.
 */
function calculateTimeInHRZones(hrArray, maxHr) {
  const zones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  if (!hrArray || hrArray.length === 0 || !maxHr || maxHr <= 0) return zones;
  const filtered = filterHRWithNoise(hrArray);
  filtered.forEach((hr) => {
    if (hr < 0) return;
    const idx = getHRZoneIndex(hr, maxHr);
    if (idx != null) zones[`z${idx}`] = (zones[`z${idx}`] || 0) + 1;
  });
  return zones;
}

/**
 * 스트림 데이터로 Power/HR 존 시간 계산.
 * HR max: rolling 365d from user logs; current stream can raise it.
 * @param {Object} opts - { wattsArray, hrArray, ftp, userId, db, dateStr }
 * @returns {Promise<{ power: Object, hr: Object }>}
 */
async function calculateZoneTimesFromStreams(opts) {
  const { wattsArray, hrArray, ftp, userId, db } = opts;
  const powerZones = { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, z7: 0 };
  const hrZones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };

  const effectiveFtp = ftp > 0 ? ftp : DEFAULT_FTP_W;
  const smoothedWatts = wattsArray && wattsArray.length > 0 ? smoothPowerSpikes(wattsArray) : [];
  if (smoothedWatts.length > 0) {
    Object.assign(powerZones, calculateTimeInPowerZones(smoothedWatts, effectiveFtp));
  }

  let maxHr = DEFAULT_MAX_HR;
  let rollingHr = 0;
  if (userId && db) {
    const fromRolling = await getMaxHRRolling365FromLogs(db, userId);
    if (fromRolling != null && fromRolling > 0) rollingHr = fromRolling;
  }
  if (rollingHr > 0) maxHr = rollingHr;
  if (hrArray && hrArray.length > 0) {
    const fromStream = Math.max(...hrArray.map((v) => Number(v) || 0).filter((v) => v > 0 && v <= HR_MAX_BPM));
    if (fromStream > maxHr) maxHr = fromStream;
  }
  if (hrArray && hrArray.length > 0) {
    Object.assign(hrZones, calculateTimeInHRZones(hrArray, maxHr));
  }

  return { power: powerZones, hr: hrZones };
}

/**
 * 피크 파워 기록 검증 (World Class 한계치 초과 시 false)
 * @param {string} durationType - "5min"|"10min"|"20min"|"40min"|"60min"|"max"
 * @param {number} watts - 절대 파워 (W)
 * @param {number} weightKg - 체중 (kg), Floor 45 적용 후
 * @returns {boolean} true=유효, false=이상치
 */
function validatePeakPowerRecord(durationType, watts, weightKg) {
  const limit = PEAK_POWER_LIMITS[durationType];
  if (!limit || !weightKg || weightKg <= 0) return true;
  const wkg = watts / weightKg;
  if (wkg > limit.wkg) return false;
  if (watts > limit.watts) return false;
  return true;
}

/** 의심 기록을 suspicious_power_records에 Pending으로 저장 */
async function saveSuspiciousPowerRecord(db, { userId, year, date, durationType, watts, wkg, weightKg, source, activityId, logId, activityType }) {
  try {
    await db.collection("suspicious_power_records").add({
      userId,
      year,
      date: date || null,
      durationType,
      watts,
      wkg,
      weightKg,
      source: source || "unknown",
      activity_type: activityType ?? null, // 로그분석 시 다른 데이터 유입 확인용
      activity_id: activityId || null,
      log_id: logId || null,
      status: "pending",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn("[saveSuspiciousPowerRecord] 저장 실패:", e.message);
  }
}

/** 로그의 피크 파워를 검증 후 연간 최고 기록에 업서트. 무효 시 suspicious_power_records에 Pending 저장
 * weight: log.weight 우선, 없으면 userData.weight 사용 (W/kg 산출 정확도) */
async function upsertYearlyPeakFromLog(db, userId, userData, logData, logId) {
  if (!isCyclingForMmp(logData)) return; // Run 등 비사이클링 Strava 로그는 MMP 제외
  const rawWeight = Number(logData.weight || userData.weight || userData.weightKg || 0);
  if (rawWeight <= 0) return;
  const weightKg = Math.max(rawWeight, 45);
  const dateStr = logData.date || "";
  const year = dateStr ? parseInt(dateStr.substring(0, 4), 10) : new Date().getFullYear();
  if (isNaN(year)) return;
  const source = String(logData.source || "stelvio").toLowerCase();

  const validRecords = {};
  for (const [durationType, field] of Object.entries(DURATION_FIELDS)) {
    const watts = Number(logData[field]) || 0;
    if (watts <= 0) continue;
    const valid = validatePeakPowerRecord(durationType, watts, weightKg);
    if (!valid) {
      const wkg = Math.round((watts / weightKg) * 100) / 100;
      await saveSuspiciousPowerRecord(db, {
        userId,
        year,
        date: dateStr,
        durationType,
        watts,
        wkg,
        weightKg,
        source,
        activityId: logData.activity_id || null,
        logId,
        activityType: logData.activity_type ?? (source === "strava" ? "Unknown" : "Stelvio"),
      });
      continue;
    }
    const wkg = Math.round((watts / weightKg) * 100) / 100;
    validRecords[field] = { watts, wkg };
  }

  const activityTypeForMmp = String(logData.activity_type || (source === "strava" ? "Unknown" : "Stelvio")).trim() || null;

  const yearlyRef = db.collection("users").doc(userId).collection("yearly_peaks").doc(String(year));
  const snap = await yearlyRef.get();
  const current = snap.exists ? snap.data() : {};
  const merged = {
    year,
    weight_kg: weightKg,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    activity_type: activityTypeForMmp, // 로그분석 시 다른 데이터 유입 확인용
  };
  let changed = false;
  for (const [field, { watts, wkg }] of Object.entries(validRecords)) {
    const prevWatts = Number(current[field]) || 0;
    if (watts > prevWatts) {
      merged[field] = watts;
      merged[field.replace("_watts", "_wkg")] = wkg;
      changed = true;
    }
  }
  // max_hr: 5초 평균 최대 우선(max_hr_5sec), 없으면 max_hr/max_heartrate (프로필 화면 표시용)
  // max_hr_date: 해당 max_hr 달성일
  const logMaxHr = Number(logData.max_hr_5sec ?? logData.max_hr ?? logData.max_heartrate) || 0;
  if (logMaxHr > 0) {
    const prevMaxHr = Number(current.max_hr) || 0;
    if (logMaxHr > prevMaxHr) {
      merged.max_hr = logMaxHr;
      merged.max_hr_date = dateStr || null;
      changed = true;
    }
  }
  if (changed) await yearlyRef.set(merged, { merge: true });
}

/** Asia/Seoul 기준 월간 구간 (YYYY-MM-DD) */
function getMonthRangeSeoul(year, month) {
  const y = year != null ? year : new Date().getFullYear();
  const m = month != null ? month : new Date().getMonth() + 1;
  const pad = (n) => String(n).padStart(2, "0");
  const startStr = `${y}-${pad(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const endStr = `${y}-${pad(m)}-${pad(lastDay)}`;
  return { startStr, endStr };
}

/** Asia/Seoul 기준 연간 구간 (YYYY-MM-DD) */
function getYearRangeSeoul(year) {
  const y = year != null ? year : new Date().getFullYear();
  const pad = (n) => String(n).padStart(2, "0");
  return { startStr: `${y}-01-01`, endStr: `${y}-12-31` };
}

/**
 * 서울 달력 YYYY-MM-DD에 delta일 가감 (Asia/Seoul 고정, 한국 DST 없음).
 * Cloud Functions 런타임 타임존과 무관하게 start/end 와 listInclusiveYmdsSeoul 일수를 맞춤.
 */
function addDaysSeoulYmd(ymdStr, deltaDays) {
  const msPerDay = 86400000;
  const t = new Date(`${ymdStr}T12:00:00+09:00`).getTime() + deltaDays * msPerDay;
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** Asia/Seoul 달력 기준 오늘 포함 역산 최근 30일 (YYYY-MM-DD). 거리 등 비피크 랭킹용. */
function getRolling30DaysRangeSeoul() {
  const endStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const startStr = addDaysSeoulYmd(endStr, -29);
  return { startStr, endStr };
}

/** Asia/Seoul 달력 기준 오늘 포함 역산 최근 28일(7×4주). legacy·기타 용도 — 독주·CYCLE 피크는 getRolling90DaysRangeSeoul. */
function getRolling28DaysRangeSeoul() {
  const endStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const startStr = addDaysSeoulYmd(endStr, -27);
  return { startStr, endStr };
}

/** CYCLE 피크·GC·헵타곤 rollup — 오늘 포함 최근 90일 */
function getRolling90DaysRangeSeoul() {
  const endStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const startStr = addDaysSeoulYmd(endStr, -89);
  return { startStr, endStr };
}

/** Asia/Seoul 달력 기준 오늘 포함 역산 최근 약 6개월(183일, YYYY-MM-DD). 1시간 항속·맞춤 필터 60분 피크와 동일. */
function getRolling183DaysRangeSeoul() {
  const endStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const startStr = addDaysSeoulYmd(endStr, -182);
  return { startStr, endStr };
}

/** 03:20 KST 헵타곤 배치 직후부터 요구되는 최소 asOfSeoul (YYYY-MM-DD) */
function getMinHeptagonSnapshotAsOfSeoulYmd() {
  const now = Date.now();
  const kstNow = new Date(now + 9 * 3600000);
  const todayHept = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate(),
    18,
    20,
    0
  );
  const lastHept = todayHept <= now ? todayHept : todayHept - 86400000;
  return new Date(lastHept).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** 대시보드·오픈라이딩과 동일 — 평지 항속(km/h) 역산 */
function calculateSpeedOnFlat(power, weight) {
  const P = Number(power);
  const m = Number(weight);
  if (!Number.isFinite(P) || P <= 0 || !Number.isFinite(m) || m <= 0) return 0;
  const rho = 1.225;
  const g = 9.81;
  const Crr = 0.0045;
  let CdA = 0.328 + (m - 70) * 0.0012;
  if (CdA < 0.22) CdA = 0.22;
  if (CdA > 0.42) CdA = 0.42;
  const powerAtV = (vMs) => 0.5 * rho * CdA * vMs * vMs * vMs + Crr * m * g * vMs;
  let lo = 0.1;
  let hi = 40;
  for (let i = 0; i < 55; i++) {
    const mid = (lo + hi) / 2;
    if (powerAtV(mid) < P) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 3.6;
}

/**
 * 대시보드 「나의 1시간 항속 능력」과 동일 (rankingDayRollup 공용 산식).
 */
function computeOneHourSustainedSpeedKmhFromBuckets(userData, bucketSnaps, startStr, endStr) {
  let peak60 = 0;
  const rawW =
    Number(
      userData &&
        (userData.weight != null
          ? userData.weight
          : userData.weightKg != null
            ? userData.weightKg
            : userData.weight_kg)
    ) || 0;
  const weightKgFall = rawW > 0 ? Math.max(rawW, 45) : 70;
  (bucketSnaps || []).forEach((snap) => {
    if (!snap || !snap.exists) return;
    const row = snap.data() || {};
    const ymd = row.ymd || snap.id || "";
    if (!ymd || ymd < startStr || ymd > endStr) return;
    const wRaw = Number(row.max_60min_watts) || 0;
    const w = rankingDayRollup.peak60minWattsFromLogValidated(
      { max_60min_watts: wRaw, max_40min_watts: row.max_40min_watts, max_20min_watts: row.max_20min_watts, max_10min_watts: row.max_10min_watts },
      weightKgFall
    );
    if (w > peak60) peak60 = w;
  });
  const m = rankingDayRollup.buildPersonalSpeedMetricsFromUserAndPeak60(userData, peak60, "");
  if (!m) return { speedKmh: 0, referenceWatts: 0, weightKg: 0 };
  return { speedKmh: m.speedKmh, referenceWatts: m.referenceWatts, weightKg: m.weightKg };
}

/** @deprecated 랭킹 명예의 전당(365d 롤링 피크) 집계 폐지. HR 등 레거시 참조용만 유지. */
function getRolling365DaysRangeSeoul() {
  const endStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const startStr = addDaysSeoulYmd(endStr, -364);
  return { startStr, endStr };
}

/** 생년월일 기준 연령대: Bianco(≤39), Rosa(40~49), Infinito(50~59), Leggenda(≥60) - 일반부용 */
function getAgeCategory(birthYear) {
  if (birthYear == null || birthYear === "") return null;
  const y = Number(birthYear);
  if (isNaN(y)) return null;
  const thisYear = new Date().getFullYear();
  const age = thisYear - y;
  if (age <= 39) return "Bianco";
  if (age <= 49) return "Rosa";
  if (age <= 59) return "Infinito";
  return "Leggenda";
}

/** challenge 기준 리그 분류: Elite/PRO → Assoluto(선수부), Fitness/GranFondo/Racing → Bianco/Rosa/Infinito/Leggenda(일반부) */
function getLeagueCategory(challenge, birthYear) {
  const ch = String(challenge || "").trim();
  if (ch === "Elite" || ch === "PRO") return "Assoluto";
  const ageCat = getAgeCategory(birthYear);
  return ageCat; // Bianco, Rosa, Infinito, Leggenda
}

/** 연간 구간 여부 (YYYY-01-01 ~ YYYY-12-31) */
function isYearlyRange(startStr, endStr) {
  if (!startStr || !endStr) return false;
  const m = startStr.match(/^(\d{4})-01-01$/);
  const m2 = endStr.match(/^(\d{4})-12-31$/);
  return m && m2 && m[1] === m2[1];
}

/** 사용자별 해당 기간 내 최고 피크 파워(W) 및 W/kg. Weight Floor 45kg, validatePeakPowerRecord 적용.
 *  연간(명예의 전당)일 때는 yearly_peaks에서 조회(사전 집계 데이터, 서버 부하 최소화)
 *  보안: 현재 연도는 yearly_peaks와 logs를 재검증하여 yearly_peaks 누락 시 logs 최대치 반영 */
async function getPeakPowerForUser(db, userId, userData, startStr, endStr, durationType) {
  const field = DURATION_FIELDS[durationType];
  if (!field) return null;
  const rawWeight = Number(userData.weight || userData.weightKg || 0);
  if (rawWeight <= 0) return null;
  const weightKg = Math.max(rawWeight, 45);

  if (isYearlyRange(startStr, endStr)) {
    const year = startStr.substring(0, 4);
    const yearlyRef = db.collection("users").doc(userId).collection("yearly_peaks").doc(year);
    const yearlySnap = await yearlyRef.get();
    let watts = 0;
    let wkgVal = 0;
    if (yearlySnap.exists) {
      const d = yearlySnap.data();
      watts = Number(d[field]) || 0;
      wkgVal = Number(d[field.replace("_watts", "_wkg")]) || (watts > 0 ? Math.round((watts / weightKg) * 100) / 100 : 0);
    }
    // 보안: 현재 연도는 logs와 재검증 (onUserLogWritten 누락·트리거 배포 전 로그 등 방지)
    const isCurrentYear = year === String(new Date().getFullYear());
    if (isCurrentYear) {
      const logs = await fetchCyclingLogsInDateRangeRouted(db, userId, startStr, endStr);
      let maxWattsFromLogs = 0;
      let maxHrFromLogs = 0;
      let maxHrDateFromLogs = null;
      let contributingActivityType = null;
      logs.forEach((d) => {
        if (!isCyclingForMmp(d)) return;
        const w = Number(d[field]) || 0;
        if (w > 0 && validatePeakPowerRecord(durationType, w, weightKg) && w > maxWattsFromLogs) {
          maxWattsFromLogs = w;
          contributingActivityType = d.activity_type ?? (String(d.source || "").toLowerCase() === "strava" ? "Unknown" : "Stelvio");
        }
        const hr = Number(d.max_hr_5sec ?? d.max_hr ?? d.max_heartrate) || 0;
        if (hr > 0 && hr > maxHrFromLogs) {
          maxHrFromLogs = hr;
          maxHrDateFromLogs = (d.date && String(d.date).trim()) || null;
        }
      });
      const currentMaxHr = yearlySnap.exists ? Number(yearlySnap.data().max_hr) || 0 : 0;
      const shouldUpdateMaxHr = maxHrFromLogs > currentMaxHr;
      const powerNeedsCorrection = maxWattsFromLogs > watts;
      if (powerNeedsCorrection) {
        watts = maxWattsFromLogs;
        wkgVal = Math.round((maxWattsFromLogs / weightKg) * 100) / 100;
      }
      if (powerNeedsCorrection || shouldUpdateMaxHr) {
        // yearly_peaks 보정 (향후 조회 시 로그 스캔 불필요, max_hr 포함)
        try {
          const wkgField = field.replace("_watts", "_wkg");
          const updateData = {
            year: parseInt(year, 10),
            [field]: watts,
            [wkgField]: wkgVal,
            weight_kg: weightKg,
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
            activity_type: contributingActivityType ?? null,
          };
          if (shouldUpdateMaxHr) {
            updateData.max_hr = maxHrFromLogs;
            if (maxHrDateFromLogs) updateData.max_hr_date = maxHrDateFromLogs;
          }
          await yearlyRef.set(updateData, { merge: true });
        } catch (e) {
          console.warn("[getPeakPowerForUser] yearly_peaks 보정 실패:", userId, year, e.message);
        }
      }
    }
    if (watts <= 0 || wkgVal <= 0) return null;
    return { watts, wkg: wkgVal, weightKg };
  }

  const logs = await fetchCyclingLogsInDateRangeRouted(db, userId, startStr, endStr);

  let maxWatts = 0;
  logs.forEach((d) => {
    if (!isCyclingForMmp(d)) return;
    const watts = Number(d[field]) || 0;
    if (watts <= 0) return;
    if (!validatePeakPowerRecord(durationType, watts, weightKg)) return;
    if (watts > maxWatts) maxWatts = watts;
  });
  if (maxWatts <= 0) return null;
  const wkg = Math.round((maxWatts / weightKg) * 100) / 100;
  return { watts: maxWatts, wkg, weightKg };
}

const PEAK_POWER_BATCH_SIZE = 50;

/** 기간 내 싸이클링 로그에서 duration별 최고 심박(bpm) */
async function getPeakHrForUser(db, userId, startStr, endStr, durationType) {
  const field = DURATION_HR_FIELDS[durationType];
  if (!field) return null;
  const logs = await fetchCyclingLogsInDateRangeRouted(db, userId, startStr, endStr);
  let maxHr = 0;
  logs.forEach((d) => {
    if (!isCyclingForMmp(d)) return;
    const dateStr = normalizeLogDateToSeoulYmd(d.date);
    if (!dateStr || dateStr < startStr || dateStr > endStr) return;
    const hr = Number(d[field]) || 0;
    if (hr < 40 || hr > HR_MAX_BPM) return;
    if (hr > maxHr) maxHr = hr;
  });
  if (maxHr <= 0) return null;
  return { hr: maxHr };
}

/** 전체 사용자 대상 duration별 피크 심박 산술평균 (랭킹과 동일 성별·리그 필터)
 * [비용절감] usersSnap을 외부에서 주입받아 중복 users.get() 방지 */
async function getCohortAvgPeakHrBpm(db, startStr, endStr, durationType, genderFilter, usersSnap = null) {
  if (!DURATION_HR_FIELDS[durationType]) return null;
  const snap = usersSnap ?? await db.collection("users").get();
  const docs = snap.docs;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < docs.length; i += PEAK_POWER_BATCH_SIZE) {
    const batch = docs.slice(i, i + PEAK_POWER_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (doc) => {
        const userId = doc.id;
        const data = doc.data();
        const gender = String(data.gender || data.sex || "").toLowerCase();
        if (genderFilter && genderFilter !== "all") {
          const g = genderFilter === "M" || genderFilter === "male" || genderFilter === "남" ? "male" : "female";
          const match = gender === "m" || gender === "male" || gender === "남" ? "male" : (gender === "f" || gender === "female" || gender === "여" ? "female" : null);
          if (match !== g) return null;
        }
        const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
        const challenge = data.challenge || "Fitness";
        const leagueCategory = getLeagueCategory(challenge, birthYear);
        if (!leagueCategory) return null;
        const peak = await getPeakHrForUser(db, userId, startStr, endStr, durationType);
        if (!peak || peak.hr <= 0) return null;
        return peak.hr;
      })
    );
    results.forEach((h) => { if (h != null) { sum += h; n++; } });
  }
  if (n === 0) return null;
  return Math.round((sum / n) * 10) / 10;
}

/** 현재 사용자 조회 순서: 연령·선수부 리그 우선(동기부여·추월은 부문 내 상대), Supremo(전체)는 폴백 */
const PEAK_RANKING_USER_LOOKUP_ORDER = ["Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda", "Supremo"];

/** 피크 파워 랭킹 엔트리 (기간·종목·성별·연령대별)
 * [비용절감] usersSnap을 외부에서 주입받아 중복 users.get() 방지 */
async function getPeakPowerRankingEntries(db, startStr, endStr, durationType, genderFilter, usersSnap = null) {
  const snap = usersSnap ?? await db.collection("users").get();
  const docs = snap.docs;
  const entries = [];
  for (let i = 0; i < docs.length; i += PEAK_POWER_BATCH_SIZE) {
    const batch = docs.slice(i, i + PEAK_POWER_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (doc) => {
        const userId = doc.id;
        const data = doc.data();
        if (!isRankingEligibleUserData(data)) return null;
        const name = data.name || "(이름 없음)";
        const gender = String(data.gender || data.sex || "").toLowerCase();
        if (genderFilter && genderFilter !== "all") {
          const g = genderFilter === "M" || genderFilter === "male" || genderFilter === "남" ? "male" : "female";
          const match = gender === "m" || gender === "male" || gender === "남" ? "male" : (gender === "f" || gender === "female" || gender === "여" ? "female" : null);
          if (match !== g) return null;
        }
        const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
        const challenge = data.challenge || "Fitness";
        const leagueCategory = getLeagueCategory(challenge, birthYear);
        if (!leagueCategory) return null;
        const peak = await getPeakPowerForUser(db, userId, data, startStr, endStr, durationType);
        if (!peak || peak.wkg <= 0) return null;
        return {
          userId,
          name,
          wkg: peak.wkg,
          watts: peak.watts,
          weightKg: peak.weightKg,
          ageCategory: leagueCategory,
          gender,
          is_private: privacyFlagFromFirestoreDoc(data),
          profileImageUrl: profileImageUrlFromUserData(data),
          ...rankingUserStatusFieldsFromData(data),
        };
      })
    );
    results.forEach((r) => { if (r) entries.push(r); });
  }
  entries.sort((a, b) => b.wkg - a.wkg);
  const withRank = entries.map((e, i) => ({ ...e, rank: i + 1 }));
  const byCategory = { Supremo: withRank, Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
  withRank.forEach((e) => {
    if (byCategory[e.ageCategory]) byCategory[e.ageCategory].push(e);
  });
  return { entries: withRank, byCategory };
}

/** 주간 TSS 랭킹 보드: 주간 마일리지 TOP10과 동일한 TSS 합산 규칙(getWeeklyTssForUser), 성별·리그 분류는 피크 파워와 동일
 * [비용절감] usersSnap을 외부에서 주입받아 중복 users.get() 방지 */
async function getWeeklyTssRankingBoardEntries(db, startStr, endStr, genderFilter, usersSnap = null) {
  return weeklyTssRankingBuilder.buildWeeklyTssRankingBoardEntries(
    db,
    startStr,
    endStr,
    genderFilter,
    usersSnap
  );
}

/** 개인: 최근 30일(서울) 라이딩 거리 합 — 성별·리그 분류는 주간 TSS 랭킹과 동일
 * [비용절감] usersSnap을 외부에서 주입받아 중복 users.get() 방지 */
async function getRolling30dDistanceRankingBoardEntries(db, startStr, endStr, genderFilter, usersSnap = null) {
  const snap = usersSnap ?? await db.collection("users").get();
  const docs = snap.docs;
  const entries = [];
  for (let i = 0; i < docs.length; i += WEEKLY_TSS_BATCH_SIZE) {
    const batch = docs.slice(i, i + WEEKLY_TSS_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (doc) => {
        const userId = doc.id;
        const data = doc.data();
        if (!isRankingEligibleUserData(data)) return null;
        const name = data.name || "(이름 없음)";
        const gender = String(data.gender || data.sex || "").toLowerCase();
        if (genderFilter && genderFilter !== "all") {
          const g = genderFilter === "M" || genderFilter === "male" || genderFilter === "남" ? "male" : "female";
          const match = gender === "m" || gender === "male" || gender === "남" ? "male" : (gender === "f" || gender === "female" || gender === "여" ? "female" : null);
          if (match !== g) return null;
        }
        const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
        const challenge = data.challenge || "Fitness";
        const leagueCategory = getLeagueCategory(challenge, birthYear);
        if (!leagueCategory) return null;
        const totalKmRaw = await getRolling30dCyclingKmForUser(db, userId, startStr, endStr, data);
        if (totalKmRaw <= 0) return null;
        const totalKm = Math.round(totalKmRaw * 100) / 100;
        return {
          userId,
          name,
          totalKm,
          ageCategory: leagueCategory,
          gender,
          is_private: privacyFlagFromFirestoreDoc(data),
          profileImageUrl: profileImageUrlFromUserData(data),
          ...rankingUserStatusFieldsFromData(data),
        };
      })
    );
    results.forEach((r) => { if (r) entries.push(r); });
  }
  entries.sort((a, b) => b.totalKm - a.totalKm);
  const withRank = entries.map((e, i) => ({ ...e, rank: i + 1 }));
  const byCategory = { Supremo: withRank, Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
  withRank.forEach((e) => {
    if (byCategory[e.ageCategory]) byCategory[e.ageCategory].push(e);
  });
  return { entries: withRank, byCategory };
}

/**
 * 항속 보드: 대시보드와 동일(getUserTrainingLogs 400건·6개월·max_60min_watts) 로그 루트로 일괄 산출.
 * @param {{ maxUsers?: number, logBatchSize?: number, syncRollups?: boolean }} [opts]
 */
async function getPersonalSpeedRankingBoardEntriesFromRollups(db, startStr, endStr, genderFilter, usersSnap = null, opts = {}) {
  const snap = usersSnap ?? await db.collection("users").get();
  const docs = snap.docs;
  if (opts && opts.fromRollupsOnly) {
    const rollupMap = await rankingDayRollup.fetchPersonalSpeed6mRollupMap(
      db,
      docs.map((d) => d.id)
    );
    const entries = [];
    for (let di = 0; di < docs.length; di++) {
      const doc = docs[di];
      const userId = doc.id;
      const data = doc.data() || {};
      if (!isRankingEligibleUserData(data)) continue;
      if (!rankingDayRollup.userHasWeightForPersonalSpeed(data)) continue;
      const rollup = rollupMap.get(userId);
      if (
        !rollup ||
        rollup.windowStart !== startStr ||
        rollup.windowEnd !== endStr ||
        !(Number(rollup.speedKmh) > 0)
      ) {
        continue;
      }
      const gender = String(data.gender || data.sex || "").toLowerCase();
      if (genderFilter && genderFilter !== "all") {
        const g = genderFilter === "M" || genderFilter === "male" || genderFilter === "남" ? "male" : "female";
        const match =
          gender === "m" || gender === "male" || gender === "남"
            ? "male"
            : gender === "f" || gender === "female" || gender === "여"
              ? "female"
              : null;
        if (match !== g) continue;
      }
      const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
      const challenge = data.challenge || "Fitness";
      const leagueCategory = getLeagueCategory(challenge, birthYear);
      if (!leagueCategory) continue;
      entries.push({
        userId,
        name: data.name || "(이름 없음)",
        speedKmh: Number(rollup.speedKmh),
        peak60minWatts: Number(rollup.peak60minWatts) || 0,
        referenceWatts: Number(rollup.referenceWatts) || Number(rollup.peak60minWatts) || 0,
        weightKg: Number(rollup.weightKg) || 0,
        ageCategory: leagueCategory,
        gender,
        is_private: privacyFlagFromFirestoreDoc(data),
        profileImageUrl: profileImageUrlFromUserData(data),
        ...rankingUserStatusFieldsFromData(data),
      });
    }
    entries.sort((a, b) => b.speedKmh - a.speedKmh);
    const withRank = entries.map((e, i) => ({ ...e, rank: i + 1 }));
    const byCategory = {
      Supremo: withRank,
      Bianco: [],
      Rosa: [],
      Infinito: [],
      Leggenda: [],
      Assoluto: [],
    };
    withRank.forEach((e) => {
      if (byCategory[e.ageCategory]) byCategory[e.ageCategory].push(e);
    });
    return { entries: withRank, byCategory };
  }
  const logBatchSize =
    opts && opts.logBatchSize != null && Number.isFinite(Number(opts.logBatchSize))
      ? Math.max(1, Math.floor(Number(opts.logBatchSize)))
      : 25;
  const maxUsers =
    opts && opts.maxUsers != null && Number.isFinite(Number(opts.maxUsers))
      ? Math.max(0, Math.floor(Number(opts.maxUsers)))
      : 0;
  const syncRollups = !opts || opts.syncRollups !== false;

  const candidates = [];
  for (let di = 0; di < docs.length; di++) {
    const doc = docs[di];
    const data = doc.data() || {};
    if (!isRankingEligibleUserData(data)) continue;
    if (!rankingDayRollup.userHasWeightForPersonalSpeed(data)) continue;
    const gender = String(data.gender || data.sex || "").toLowerCase();
    if (genderFilter && genderFilter !== "all") {
      const g = genderFilter === "M" || genderFilter === "male" || genderFilter === "남" ? "male" : "female";
      const match =
        gender === "m" || gender === "male" || gender === "남"
          ? "male"
          : gender === "f" || gender === "female" || gender === "여"
            ? "female"
            : null;
      if (match !== g) continue;
    }
    const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
    const challenge = data.challenge || "Fitness";
    const leagueCategory = getLeagueCategory(challenge, birthYear);
    if (!leagueCategory) continue;
    candidates.push({ doc, data, leagueCategory, gender });
    if (maxUsers > 0 && candidates.length >= maxUsers) break;
  }

  const entries = [];
  for (let ci = 0; ci < candidates.length; ci += logBatchSize) {
    const batch = candidates.slice(ci, ci + logBatchSize);
    /* eslint-disable no-await-in-loop */
    await Promise.all(
      batch.map(async ({ doc, data, leagueCategory, gender }) => {
        const userId = doc.id;
        try {
          const metrics = await rankingDayRollup.computePersonalSpeedMetricsFromLogsDashboardRoute(
            db,
            userId,
            data,
            startStr,
            endStr
          );
          if (!metrics || !(metrics.peak60minWatts > 0) || !(metrics.speedKmh > 0)) return;
          if (syncRollups) {
            await rankingDayRollup.writePersonalSpeed6mRollupDoc(
              db,
              userId,
              data,
              startStr,
              endStr,
              metrics
            );
          }
          entries.push({
            userId,
            name: data.name || "(이름 없음)",
            speedKmh: metrics.speedKmh,
            peak60minWatts: metrics.peak60minWatts,
            referenceWatts: metrics.referenceWatts,
            weightKg: metrics.weightKg,
            ageCategory: leagueCategory,
            gender,
            is_private: privacyFlagFromFirestoreDoc(data),
            profileImageUrl: profileImageUrlFromUserData(data),
            ...rankingUserStatusFieldsFromData(data),
          });
        } catch (ePs) {
          console.warn("[personal_speed] log-route metrics 실패:", userId, ePs.message);
        }
      })
    );
    /* eslint-enable no-await-in-loop */
  }
  entries.sort((a, b) => b.speedKmh - a.speedKmh);
  const withRank = entries.map((e, i) => ({ ...e, rank: i + 1 }));
  const byCategory = { Supremo: withRank, Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
  withRank.forEach((e) => {
    if (byCategory[e.ageCategory]) byCategory[e.ageCategory].push(e);
  });
  return { entries: withRank, byCategory };
}

/** rides.date → 서울 YYYY-MM-DD */
function rideDocDateToSeoulYmd(rideDate) {
  if (!rideDate) return "";
  try {
    let d;
    if (typeof rideDate.toDate === "function") d = rideDate.toDate();
    else if (rideDate instanceof admin.firestore.Timestamp) d = rideDate.toDate();
    else if (rideDate instanceof Date) d = rideDate;
    else if (typeof rideDate === "string") return String(rideDate).slice(0, 10);
    else return "";
    if (!d || isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  } catch (_e) {
    return "";
  }
}

/** users/{uid}/logs 문서 date를 서울 YYYY-MM-DD로 정규화 */
function normalizeLogDateToSeoulYmd(logDate) {
  if (!logDate) return "";
  try {
    if (typeof logDate === "string") {
      const s = String(logDate).trim();
      const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!m) return s.slice(0, 10);
      return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
    }
    let d = null;
    if (typeof logDate.toDate === "function") d = logDate.toDate();
    else if (logDate instanceof admin.firestore.Timestamp) d = logDate.toDate();
    else if (logDate instanceof Date) d = logDate;
    if (!d || isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  } catch (_e) {
    return "";
  }
}

/** 로그 거리 km 추출 (legacy distance meters 가능성 보정) */
function extractLogDistanceKm(logData) {
  const km = Number(logData && logData.distance_km);
  if (Number.isFinite(km) && km > 0) return km;
  const raw = Number(logData && logData.distance);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  // legacy 필드가 m 단위인 경우를 보정
  if (raw >= 300) return Math.round((raw / 1000) * 100) / 100;
  return raw;
}

function pickHostRepresentativeDistanceKm(logs, plannedKm) {
  const p = Number(plannedKm) || 0;
  if (!(p > 0)) {
    let maxKm = 0;
    for (const l of logs) {
      const d = extractLogDistanceKm(l);
      if (d > maxKm) maxKm = d;
    }
    return maxKm;
  }
  const lo = p * 0.9;
  const hi = p * 1.1;
  const cands = [];
  for (const l of logs) {
    const d = extractLogDistanceKm(l);
    if (d <= 0) continue;
    if ((d >= lo && d <= hi) || d > p) cands.push(d);
  }
  if (cands.length === 0) return 0;
  cands.sort((a, b) => Math.abs(a - p) - Math.abs(b - p));
  return cands[0] || 0;
}

async function getUserStravaDistanceKmForRideDate(db, userId, ymd, rideData) {
  const logsSnap = await db.collection("users").doc(String(userId).trim()).collection("logs")
    .where("date", "==", ymd)
    .where("source", "==", "strava")
    .get();
  if (logsSnap.empty) return 0;
  const logs = [];
  logsSnap.docs.forEach((doc) => {
    const d = doc.data() || {};
    if (!isCyclingForMmp(d)) return;
    const km = extractLogDistanceKm(d);
    if (km > 0) logs.push(d);
  });
  if (logs.length === 0) return 0;

  const hostUid = String(rideData && rideData.hostUserId ? rideData.hostUserId : "").trim();
  const uid = String(userId).trim();
  if (hostUid && uid === hostUid) {
    return pickHostRepresentativeDistanceKm(logs, Number(rideData && rideData.distance) || 0);
  }

  let sum = 0;
  logs.forEach((l) => {
    sum += extractLogDistanceKm(l);
  });
  return Math.round(sum * 100) / 100;
}

/**
 * onUserLogWritten 오픈라이딩 Strava 거리 sync — Phase 1 기본 OFF (rides 복합 인덱스 오류·Supabase 이관 전).
 * 활성화: OPEN_RIDING_PARTICIPANT_STRAVA_SYNC_ENABLED=1
 */
function isOpenRidingParticipantStravaSyncEnabled() {
  const raw = process.env.OPEN_RIDING_PARTICIPANT_STRAVA_SYNC_ENABLED;
  if (raw == null || String(raw).trim() === "") return false;
  const s = String(raw).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/**
 * users/{uid}/logs 쓰기 시 오픈 라이딩 합산용 participantStravaReview 자동 동기화.
 * 앱 로그인/상세 진입 여부와 무관하게 서버(Admin SDK)에서 반영.
 */
async function syncOpenRidingParticipantDistanceByLog(db, userId, logData) {
  const source = String(logData && logData.source ? logData.source : "").toLowerCase();
  if (source !== "strava") return;
  if (!isCyclingForMmp(logData || {})) return;
  const ymd = normalizeLogDateToSeoulYmd(logData && logData.date);
  if (!ymd) return;
  const startTs = admin.firestore.Timestamp.fromDate(new Date(`${ymd}T00:00:00+09:00`));
  const endTs = admin.firestore.Timestamp.fromDate(new Date(`${ymd}T23:59:59.999+09:00`));
  const ridesSnap = await db.collection("rides")
    .where("participants", "array-contains", String(userId))
    .where("date", ">=", startTs)
    .where("date", "<=", endTs)
    .get();
  if (ridesSnap.empty) return;

  let batch = db.batch();
  let writes = 0;
  for (const rideDoc of ridesSnap.docs) {
    const ride = rideDoc.data() || {};
    if (String(ride.rideStatus || "active") === "cancelled") continue;
    const rideYmd = rideDocDateToSeoulYmd(ride.date);
    if (!rideYmd || rideYmd !== ymd) continue;
    const participants = Array.isArray(ride.participants) ? ride.participants : [];
    const hasUser = participants.some((p) => String(p || "").trim() === String(userId).trim());
    if (!hasUser) continue;
    const distKm = await getUserStravaDistanceKmForRideDate(db, userId, ymd, ride);
    if (!(distKm > 0)) continue;
    const partRef = db.collection("rides").doc(rideDoc.id).collection("participantStravaReview").doc(String(userId).trim());
    batch.set(partRef, {
      rideDateYmd: ymd,
      distanceKm: distKm,
      source: "strava",
      syncedBy: "functions_onUserLogWritten",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    writes++;
    if (writes % 450 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (writes % 450 !== 0) {
    await batch.commit();
  }
}

/**
 * 과거 오픈 라이딩 participantStravaReview 백필.
 * GET/POST ?secret=INTERNAL_SYNC_SECRET&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&rideId=선택&dryRun=1&cleanMissing=1&limit=300
 */
exports.backfillOpenRidingParticipantStravaReview = onRequest(
  { cors: true, timeoutSeconds: 540 },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    res.set("Access-Control-Allow-Origin", "*");
    const secret = req.query.secret || req.body?.secret || "";
    if (secret !== INTERNAL_SYNC_SECRET) {
      return res.status(403).json({ success: false, error: "인증 필요" });
    }

    const rideId = String(req.query.rideId || req.body?.rideId || "").trim();
    const dryRun = String(req.query.dryRun || req.body?.dryRun || "0") === "1";
    const cleanMissing = String(req.query.cleanMissing || req.body?.cleanMissing || "0") === "1";
    const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit || req.body?.limit || "300", 10) || 300));
    const startDate = String(req.query.startDate || req.body?.startDate || "").trim();
    const endDate = String(req.query.endDate || req.body?.endDate || "").trim();
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;

    const db = admin.firestore();
    /** @type {admin.firestore.QuerySnapshot<admin.firestore.DocumentData>} */
    let ridesSnap;
    if (rideId) {
      const one = await db.collection("rides").doc(rideId).get();
      ridesSnap = {
        docs: one.exists ? [one] : [],
        size: one.exists ? 1 : 0,
        empty: !one.exists,
      };
    } else {
      let s = startDate;
      let e = endDate;
      if (!dateRe.test(s) || !dateRe.test(e)) {
        const now = new Date();
        const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
        const d = new Date(`${today}T00:00:00+09:00`);
        const past = new Date(d.getTime() - (120 * 24 * 60 * 60 * 1000));
        const pad = (n) => String(n).padStart(2, "0");
        s = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}`;
        e = today;
      }
      const tsStart = admin.firestore.Timestamp.fromDate(new Date(`${s}T00:00:00+09:00`));
      const tsEnd = admin.firestore.Timestamp.fromDate(new Date(`${e}T23:59:59.999+09:00`));
      ridesSnap = await db.collection("rides")
        .where("date", ">=", tsStart)
        .where("date", "<=", tsEnd)
        .limit(limit)
        .get();
    }

    let scannedRides = 0;
    let processedRides = 0;
    let participantScans = 0;
    let writtenDocs = 0;
    let deletedDocs = 0;
    let skippedCancelled = 0;
    let errors = 0;
    let batch = db.batch();
    let batchOps = 0;

    for (const rideDoc of ridesSnap.docs) {
      scannedRides++;
      const ride = rideDoc.data() || {};
      if (String(ride.rideStatus || "active") === "cancelled") {
        skippedCancelled++;
        continue;
      }
      const rideYmd = rideDocDateToSeoulYmd(ride.date);
      if (!rideYmd) continue;
      const participants = Array.isArray(ride.participants) ? ride.participants : [];
      const uniqParticipants = [...new Set(participants.map((x) => String(x || "").trim()).filter(Boolean))];
      if (uniqParticipants.length === 0) continue;
      processedRides++;

      for (const uid of uniqParticipants) {
        participantScans++;
        try {
          const km = await getUserStravaDistanceKmForRideDate(db, uid, rideYmd, ride);
          const partRef = db.collection("rides").doc(rideDoc.id).collection("participantStravaReview").doc(uid);
          if (km > 0) {
            if (!dryRun) {
              batch.set(partRef, {
                rideDateYmd: rideYmd,
                distanceKm: km,
                source: "strava",
                syncedBy: "functions_backfillOpenRidingParticipantStravaReview",
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              }, { merge: true });
              batchOps++;
            }
            writtenDocs++;
          } else if (cleanMissing) {
            if (!dryRun) {
              batch.delete(partRef);
              batchOps++;
            }
            deletedDocs++;
          }
        } catch (e) {
          errors++;
          console.warn("[backfillOpenRidingParticipantStravaReview] participant 처리 실패:", rideDoc.id, uid, e.message);
        }

        if (!dryRun && batchOps >= 450) {
          await batch.commit();
          batch = db.batch();
          batchOps = 0;
        }
      }
    }

    if (!dryRun && batchOps > 0) {
      await batch.commit();
    }

    return res.status(200).json({
      success: true,
      dryRun,
      cleanMissing,
      rideId: rideId || null,
      scannedRides,
      processedRides,
      participantScans,
      writtenDocs,
      deletedDocs,
      skippedCancelled,
      errors,
    });
  }
);

/**
 * 그룹: 최근 30일 내 오픈 라이딩을 방장(hostUserId)별로 합산.
 * 각 일정의 점수 = 해당 일정일에 확정 참가자 각각의 라이딩 거리(일별 규칙 동일) 합.
 */
async function getRolling30dGroupDistanceByHostEntries(db, startStr, endStr, viewerUid, genderFilter) {
  const memo = new Map();
  async function dailyKmCached(uid, ymd) {
    const key = `${uid}|${ymd}`;
    if (memo.has(key)) return memo.get(key);
    const v = await getRolling30dCyclingKmForUser(db, uid, ymd, ymd);
    memo.set(key, v);
    return v;
  }
  const tsStart = admin.firestore.Timestamp.fromDate(new Date(`${startStr}T00:00:00+09:00`));
  const tsEnd = admin.firestore.Timestamp.fromDate(new Date(`${endStr}T23:59:59.999+09:00`));
  const ridesSnap = await db.collection("rides")
    .where("date", ">=", tsStart)
    .where("date", "<=", tsEnd)
    .get();
  const byHost = new Map();
  const viewer = viewerUid ? String(viewerUid).trim() : "";
  for (const doc of ridesSnap.docs) {
    const r = doc.data();
    if (String(r.rideStatus || "active") === "cancelled") continue;
    const hostKey = String(r.hostUserId || "").trim();
    if (!hostKey) continue;
    const ymd = rideDocDateToSeoulYmd(r.date);
    if (!ymd || ymd < startStr || ymd > endStr) continue;
    const partsRaw = Array.isArray(r.participants) ? r.participants : [];
    const parts = [...new Set(partsRaw.map((x) => String(x).trim()).filter(Boolean))];
    let rideScore = 0;
    for (const pUid of parts) {
      rideScore += await dailyKmCached(pUid, ymd);
    }
    if (rideScore <= 0) continue;
    if (!byHost.has(hostKey)) {
      byHost.set(hostKey, {
        hostUserId: hostKey,
        name: String(r.hostName || "(이름 없음)").trim().slice(0, 80) || "(이름 없음)",
        totalKm: 0,
        participated: false,
      });
    }
    const agg = byHost.get(hostKey);
    agg.totalKm += rideScore;
    if (viewer && parts.includes(viewer)) agg.participated = true;
  }
  const entries = [];
  const hostKeys = Array.from(byHost.keys());
  const profileSnaps = await Promise.all(
    hostKeys.map((hid) => db.collection("users").doc(hid).get().catch(() => null)),
  );
  const urlByHostId = new Map();
  const profileByHostId = new Map();
  hostKeys.forEach((hid, i) => {
    const sn = profileSnaps[i];
    if (sn && sn.exists) {
      const ud = sn.data();
      urlByHostId.set(hid, profileImageUrlFromUserData(ud));
      profileByHostId.set(hid, ud);
    } else {
      urlByHostId.set(hid, null);
      profileByHostId.set(hid, null);
    }
  });
  for (const [, v] of byHost) {
    const ud = profileByHostId.get(v.hostUserId);
    if (!userMatchesWeeklyTssGenderFilter(ud, genderFilter)) continue;
    const genderRaw = ud ? String(ud.gender || ud.sex || "").toLowerCase() : "";
    entries.push({
      userId: v.hostUserId,
      hostUserId: v.hostUserId,
      name: v.name,
      totalKm: Math.round(v.totalKm * 100) / 100,
      ageCategory: "Supremo",
      gender: genderRaw,
      is_private: false,
      rankingKind: "group",
      currentUserParticipated: !!v.participated,
      profileImageUrl: urlByHostId.get(v.hostUserId) || null,
    });
  }
  entries.sort((a, b) => b.totalKm - a.totalKm);
  const withRank = entries.map((e, i) => ({ ...e, rank: i + 1 }));
  const byCategory = { Supremo: withRank, Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
  return { entries: withRank, byCategory };
}

// ---------- 랭킹 사전 집계 (스케줄러) + ranking_aggregates (HTTP 빠른 읽기) ----------
const RANKING_AGGREGATES_COLLECTION = "ranking_aggregates";
/** ranking_aggregates 읽기 허용 최대 경과 시간. 집계 cron 간격보다 길게 두어 사용자 요청 시 전체 재스캔 빈도를 줄임 */
const RANKING_AGG_MAX_STALE_MS = 26 * 60 * 60 * 1000; // 26시간 (하루 1회 23:00 기준 최대 24h 공백 + 여유)
/** 헵타곤 재집계: 마스터 23:00 타임아웃·수동 재시도 시에도 ranking_aggregates 피크 보드 읽기 허용 */
const HEPTAGON_AGG_STALE_MS = 8 * 24 * 60 * 60 * 1000;
const HEPTAGON_REBUILD_RUNNING_STALE_MS = 25 * 60 * 1000;
/** HTTP에서 users×logs 전체 재집계 허용(기본 false — 사전집계·stale만 반환, 과금 폭탄 방지) */
const ALLOW_RANKING_HTTP_LIVE_REBUILD = process.env.ALLOW_RANKING_HTTP_LIVE_REBUILD === "1";
const RANKING_HTTP_STALE_FALLBACK_MS = 14 * 24 * 60 * 60 * 1000;
/** 동일 cacheKey HTTP 라이브 재집계 동시 실행 방지(23~01시 접속 폭주 시 users 전체 스캔 중복 억제) */
const RANKING_HTTP_LIVE_REBUILD_LOCK_MS = 10 * 60 * 1000;
/** (레거시) stale 판정용 — 일 2회(03:40·09:00) 집계로 대체, 수동 호출 시에만 사용 */
const RANKING_HOURLY_TSS_REFRESH_MIN_AGE_MS = 90 * 60 * 1000;
/** KST 09:00 — 주간 마일리지 TOP10·TSS 보드 낮 1회 전체 재집계 */
const WEEKLY_MILEAGE_TOP10_DAYTIME_CRON = "0 9 * * *";
const RANKING_MASTER_REBUILD_META_DOC = "master_daily_rebuild";
/** 수동 부분 집계(피크·독주·거리) 진행 상태 */
const RANKING_PHASE_REBUILD_META_DOC = "manual_ranking_phase_rebuild";
const RANKING_HEPTAGON_REBUILD_META_DOC = "heptagon_daily_rebuild";

function emptyPeakRankingByCategory() {
  return { Supremo: [], Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
}

function rankingBoardPayloadHasRows(payload) {
  return weeklyTssBoardPayloadHasRows(payload);
}

/** peakRanking_* / weekly_tss_* 등 집계 docId 끝의 start_end 추출 */
function parseRankingAggregateDateRangeFromCacheKey(cacheKey) {
  const m = String(cacheKey || "").match(/_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
  if (!m) return null;
  return { startStr: m[1], endStr: m[2] };
}

/**
 * 사전집계 miss 시 stale(전일 endStr 키 포함) 반환.
 * 없으면 null → 호출부에서 라이브 재집계(빈 pending 응답으로 UI가 비는 문제 방지).
 * @returns {Promise<object|null>}
 */
async function tryAcquireRankingHttpLiveRebuildLock(db, cacheKey) {
  if (!db || !cacheKey) return true;
  const safeId = String(cacheKey).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  const ref = db.collection("ranking_meta").doc(`http_live_${safeId}`);
  const now = Date.now();
  try {
    const snap = await ref.get();
    if (snap.exists) {
      const untilMs = Number((snap.data() || {}).untilMs) || 0;
      if (untilMs > now) return false;
    }
    await ref.set({
      cacheKey,
      untilMs: now + RANKING_HTTP_LIVE_REBUILD_LOCK_MS,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  } catch (eLock) {
    console.warn("[tryAcquireRankingHttpLiveRebuildLock]", cacheKey, eLock && eLock.message);
    return true;
  }
}

async function tryPeakRankingHttpStaleOrPending(db, cacheKey) {
  const tryStaleKey = async (key) => {
    const aggStale = await readRankingAggregatePayloadAllowStale(db, key, RANKING_HTTP_STALE_FALLBACK_MS);
    if (aggStale && rankingBoardPayloadHasRows(aggStale)) {
      return { payload: aggStale, staleAggregate: true, precomputed: true };
    }
    return null;
  };

  let hit = await tryStaleKey(cacheKey);
  if (hit) return hit;

  const range = parseRankingAggregateDateRangeFromCacheKey(cacheKey);
  if (range) {
    const prevEnd = previousCalendarDayStr(range.endStr);
    if (prevEnd && prevEnd >= range.startStr) {
      const prevKey = cacheKey.replace(
        `_${range.startStr}_${range.endStr}`,
        `_${range.startStr}_${prevEnd}`
      );
      hit = await tryStaleKey(prevKey);
      if (hit) {
        hit.dataThroughEndStr = prevEnd;
        return hit;
      }
    }
  }

  return null;
}
/** KST 03:40 — 03:20 헵타곤(최대 9분) 완료 후 마스터. 피크·헵타곤 complete 게이트. */
const RANKING_REBUILD_CRON = "40 3 * * *";
const RANKING_AGGREGATION_CONTROL_DOC = {
  collection: "appConfig",
  doc: "ranking_aggregation_control",
};
/** 클라이언트 캐시 롤오버(KST 04:00) — 마스터 TOP10 반영 여유 */
const RANKING_MASTER_ROLLOVER_UTC_HOUR = 19;
const RANKING_MASTER_ROLLOVER_UTC_MIN = 0;
const RANKING_ONE_PASS_BATCH = 50;

/** 비-GC 탭(Max/1분/5분/…/거리/TSS) 순위 등락 스냅샷 컬렉션 */
const PEAK_RANK_HISTORY_COL = "peak_rank_history";

/** GC 헵타곤 cohort 와 동일: 부문별 보드 순위 기준 등락 (전체 Supremo 순위와 분리) */
const PEAK_RANK_BOARD_CATEGORIES = ["Supremo", "Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda"];
const peakRankMovementCore = require("./rankingPeakMovement");
const {
  normalizePeakRankHistoryDoc,
  computePeakRankMovementFields,
  payloadHasRankMovement,
} = peakRankMovementCore;

function parseRankingAggregationBool(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  const s = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on", "firebase", "enabled"].includes(s)) return true;
  if (["0", "false", "no", "off", "supabase", "disabled"].includes(s)) return false;
  return fallback;
}

/**
 * Firebase 표시용 랭킹 사전집계 스케줄 게이트.
 * 기본값은 Supabase 모드(비활성). 긴급 복구는 Firestore
 * appConfig/ranking_aggregation_control 또는 관리자 HTTP로 즉시 전환한다.
 */
async function shouldRunFirebaseRankingScheduledJob(db, jobName) {
  const defaultEnabled = parseRankingAggregationBool(
    process.env.FIREBASE_RANKING_SCHEDULED_ENABLED,
    false
  );
  let cfg = {};
  try {
    const snap = await db
      .collection(RANKING_AGGREGATION_CONTROL_DOC.collection)
      .doc(RANKING_AGGREGATION_CONTROL_DOC.doc)
      .get();
    if (snap.exists) cfg = snap.data() || {};
  } catch (eCfg) {
    console.warn(
      "[rankingAggregationControl] config read failed; using env/default",
      eCfg && eCfg.message ? eCfg.message : eCfg
    );
  }

  const mode = String(cfg.mode || "").trim().toLowerCase();
  let enabled =
    cfg.firebaseScheduledEnabled === true ||
    mode === "firebase" ||
    defaultEnabled === true;

  if (cfg.firebaseScheduledEnabled === false || mode === "supabase") {
    enabled = false;
  }
  if (cfg.enabledJobs && cfg.enabledJobs[jobName] === true) {
    enabled = true;
  }
  if (cfg.disabledJobs && cfg.disabledJobs[jobName] === true) {
    enabled = false;
  }

  if (!enabled) {
    console.log("[rankingAggregationControl] Firebase scheduled aggregation skipped", {
      jobName,
      mode: mode || "supabase(default)",
      firebaseScheduledEnabled: cfg.firebaseScheduledEnabled,
    });
  }
  return enabled;
}

/** Supabase 주간 TSS parity 스케줄 — Firebase 집계 비활성(supabase 모드)에서도 기본 ON */
function shouldRunSupabaseWeeklyTssParitySchedule() {
  const raw = process.env.SUPABASE_WEEKLY_TSS_PARITY_SCHEDULE_ENABLED;
  if (raw != null && String(raw).trim() !== "") {
    return parseRankingAggregationBool(raw, true);
  }
  return true;
}

/**
 * Supabase pg_cron 주간 TSS 마스터 집계 — parity 동기화 후 RPC 호출.
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ forceReconcile?: boolean, logPrefix?: string }} [opts]
 */
async function runSupabaseWeeklyTssMasterPipeline(db, opts) {
  opts = opts || {};
  const logPrefix = opts.logPrefix || "[runSupabaseWeeklyTssMasterPipeline]";
  const rankingBuildMetaSupabase = require("./rankingBuildMetaSupabase");
  const { startStr: wStart, endStr: wEnd } = getWeekRangeSeoul();
  const t0 = Date.now();

  if (opts.forceReconcile) {
    const sharedUsersSnap = await db.collection("users").get();
    const { startStr: wPrevS, endStr: wPrevE } = getWeekRangeSeoul(-1);
    const allUserDocs = sharedUsersSnap.docs;
    const RECONCILE_BATCH = 10;
    for (let i = 0; i < allUserDocs.length; i += RECONCILE_BATCH) {
      const batch = allUserDocs.slice(i, i + RECONCILE_BATCH);
      await Promise.all(
        batch.map(async (userDoc) => {
          const uid = userDoc.id;
          const udata = userDoc.data() || {};
          try {
            await rankingDayRollup.ensureRankingBucketsFilledForRange(db, uid, udata, wStart, wEnd, true);
            await rankingDayRollup.ensureRankingBucketsFilledForRange(db, uid, udata, wPrevS, wPrevE, true);
          } catch (eRec) {
            console.warn(logPrefix, "bucket reconcile failed:", uid, eRec && eRec.message);
          }
        })
      );
    }
  }

  try {
    const parityResult = await supabaseDualWriteServer.runWeeklyTssSupabaseParityForActiveUsers(
      db,
      admin,
      wStart,
      wEnd
    );
    console.log(logPrefix, "parity done", parityResult);
  } catch (parityErr) {
    console.warn(
      logPrefix,
      "parity warn:",
      parityErr && parityErr.message ? parityErr.message : parityErr
    );
  }

  const rpcResult = await rankingBuildMetaSupabase.runMasterDailyRebuildWeeklyTss();
  if (!rpcResult.ok) {
    throw new Error(rpcResult.error || "fn_master_daily_rebuild_weekly_tss failed");
  }
  return { mode: "supabase_master", ms: Date.now() - t0, wStart, wEnd };
}

/**
 * Supabase pg_cron 09:00 낮 갱신 — parity 후 RPC (pg_cron 실패 시 Functions 백업).
 */
async function runSupabaseWeeklyTssDaytimePipeline(db, logPrefix) {
  const prefix = logPrefix || "[runSupabaseWeeklyTssDaytimePipeline]";
  const rankingBuildMetaSupabase = require("./rankingBuildMetaSupabase");
  const { startStr: wStart, endStr: wEnd } = getWeekRangeSeoul();
  const t0 = Date.now();
  try {
    await supabaseDualWriteServer.runWeeklyTssSupabaseParityForActiveUsers(db, admin, wStart, wEnd);
  } catch (parityErr) {
    console.warn(prefix, "parity warn:", parityErr && parityErr.message ? parityErr.message : parityErr);
  }
  const rpcResult = await rankingBuildMetaSupabase.runWeeklyTssDaytimeRefresh();
  if (!rpcResult.ok) {
    throw new Error(rpcResult.error || "fn_weekly_tss_daytime_refresh failed");
  }
  return { mode: "supabase_daytime", ms: Date.now() - t0 };
}

/**
 * 이번 주 활동 사용자 전원 Firestore → Supabase 주간 TSS parity (rides + daily_summaries).
 */
async function runWeeklyTssSupabaseParityScheduledJob(db, logPrefix) {
  const prefix = logPrefix || "[scheduledWeeklyTssSupabaseParity]";
  const { startStr, endStr } = getWeekRangeSeoul();
  const t0 = Date.now();
  const result = await supabaseDualWriteServer.runWeeklyTssSupabaseParityForActiveUsers(
    db,
    admin,
    startStr,
    endStr
  );
  let runningGap = { users: 0, ingested: 0, failed: 0, missing: 0, apiCalls: 0 };
  try {
    const stravaUserIds = await stravaGapDetect.listStravaConnectedUserIds(db);
    const range = stravaSyncRetry.ymdRangeToUnix({ dateFrom: startStr, dateTo: endStr });
    runningGap = await stravaGapDetect.syncUsersRunningActivitiesGapParity(
      db,
      stravaUserIds,
      range,
      {
        refreshStravaTokenForUser,
        fetchStravaActivitiesPage,
        supabaseDualWriteServer,
      }
    );
  } catch (runParityErr) {
    console.warn(
      prefix,
      "RUN activities gap parity warn:",
      runParityErr && runParityErr.message ? runParityErr.message : runParityErr
    );
  }
  console.log(prefix, "done", {
    startStr,
    endStr,
    ms: Date.now() - t0,
    ...result,
    runningGap,
  });
  return { startStr, endStr, ...result, runningGap };
}

/** GC rebuildHeptagonCohortRanks 와 동일: 집계 순위 맵이 실제로 바뀌었는지 */
function peakBoardRankMapsEqual(a, b) {
  if (!a || typeof a !== "object") a = {};
  if (!b || typeof b !== "object") b = {};
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const k = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (Math.floor(Number(a[k])) !== Math.floor(Number(b[k]))) return false;
  }
  return true;
}

function peakRankChangesAllZero(chMap) {
  if (!chMap || typeof chMap !== "object") return false;
  const vals = Object.values(chMap);
  if (!vals.length) return false;
  return vals.every((v) => Number(v) === 0);
}

async function readPeakRankHistoryNorm(db, historyKey) {
  let prevNorm = normalizePeakRankHistoryDoc(null);
  if (!db || !historyKey) return prevNorm;
  const peakMovement = require("./rankingPeakMovement");

  function normHasPrevDayBaseline(norm) {
    norm = normalizePeakRankHistoryDoc(norm);
    const prevDay = norm.prevDayRanksByCategory || {};
    for (let i = 0; i < PEAK_RANK_BOARD_CATEGORIES.length; i++) {
      const cat = PEAK_RANK_BOARD_CATEGORIES[i];
      const m = prevDay[cat];
      if (m && typeof m === "object" && Object.keys(m).length > 0) return true;
    }
    return false;
  }

  try {
    const snap = await db.collection(PEAK_RANK_HISTORY_COL).doc(historyKey).get();
    if (snap.exists) prevNorm = normalizePeakRankHistoryDoc(snap.data());
  } catch (eRead) {
    console.warn("[readPeakRankHistoryNorm] 실패:", historyKey, eRead && eRead.message);
  }
  const legacyKey =
    typeof peakMovement.resolveLegacyPeakRankHistoryKey === "function"
      ? peakMovement.resolveLegacyPeakRankHistoryKey(historyKey)
      : null;
  if (legacyKey && !normHasPrevDayBaseline(prevNorm)) {
    try {
      const legacySnap = await db.collection(PEAK_RANK_HISTORY_COL).doc(legacyKey).get();
      if (legacySnap.exists) {
        const legacyNorm = normalizePeakRankHistoryDoc(legacySnap.data());
        if (normHasPrevDayBaseline(legacyNorm)) {
          prevNorm = {
            ...prevNorm,
            prevDayRanksByCategory: legacyNorm.prevDayRanksByCategory,
          };
        } else if (legacyNorm.ranksByCategory && Object.keys(legacyNorm.ranksByCategory).length) {
          const prevDay = {};
          for (const cat of PEAK_RANK_BOARD_CATEGORIES) {
            const m = legacyNorm.ranksByCategory[cat];
            if (m && typeof m === "object" && Object.keys(m).length) prevDay[cat] = m;
          }
          if (Object.keys(prevDay).length) {
            prevNorm = { ...prevNorm, prevDayRanksByCategory: prevDay };
          }
        }
      }
    } catch (eLegacy) {
      console.warn("[readPeakRankHistoryNorm] legacy baseline 실패:", legacyKey, eLegacy && eLegacy.message);
    }
  }
  return prevNorm;
}

/**
 * HTTP 응답용 — peak_rank_history 읽기만 하고 행에 등락 주입(쓰기 없음).
 */
async function hydratePeakRankMovementFromHistory(db, byCategory, historyKey) {
  if (!db || !historyKey || !byCategory || typeof byCategory !== "object") return null;
  try {
    const route = await rankingReadConfig.shouldReadRankingFromSupabase(admin, null);
    if (route.route === "supabase") {
      const peakMovementSupabase = require("./rankingPeakMovementSupabase");
      /* wrap.byCategory === byCategory(동일 참조) → 행 등락 주입 + baseline 메타를 wrap 에서 회수 */
      const wrap = { byCategory };
      await peakMovementSupabase.hydratePeakRankMovementOnPayload(wrap, historyKey, {
        admin,
        persistSnapshot: false,
      });
      return {
        rankMovementPrevDayByCategory: wrap.rankMovementPrevDayByCategory || {},
        rankMovementCompareBaselineByCategory: wrap.rankMovementCompareBaselineByCategory || {},
        rankMovementSource: wrap.rankMovementSource,
        rankMovementHistoryKey: wrap.rankMovementHistoryKey || historyKey,
        rankMovementAsOfSeoul: wrap.rankMovementAsOfSeoul,
        rankMovementHydrated: wrap.rankMovementHydrated === true,
      };
    }
  } catch (eSbHydr) {
    console.warn(
      "[hydratePeakRankMovementFromHistory] Supabase hydrate skipped:",
      eSbHydr && eSbHydr.message ? eSbHydr.message : eSbHydr
    );
  }
  const todayYmd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const prevNorm = await readPeakRankHistoryNorm(db, historyKey);
  const snap = computePeakRankMovementFields(byCategory, prevNorm, todayYmd, {
    tssWeeklyAbsolute: String(historyKey || "").startsWith("peak_tss_weekly_"),
  });
  return {
    rankMovementPrevDayByCategory: (snap && snap.newPrevDayRanksByCategory) || {},
    rankMovementCompareBaselineByCategory: (snap && snap.compareBaselineByCategory) || {},
    rankMovementHistoryKey: historyKey,
    rankMovementAsOfSeoul: (snap && snap.asOfSeoul) || todayYmd,
    rankMovementHydrated: payloadHasRankMovement({ byCategory }),
  };
}

/** 주간 마일리지 TOP10 — peak_rank_history 기준 전날 마지막 순위 대비 등락 재계산 */
async function hydrateWeeklyRankingEntriesRankMovement(db, entries) {
  if (!db || !Array.isArray(entries) || entries.length === 0) return entries;
  const supremo = entries.map((e, i) => ({
    userId: e.userId,
    name: e.name,
    totalTss: e.totalTss,
    rank: e.rank != null ? e.rank : i + 1,
    ageCategory: e.ageCategory || "Supremo",
    is_private: e.is_private === true,
    profileImageUrl: e.profileImageUrl || null,
  }));
  const byCategory = {
    Supremo: supremo,
    Assoluto: [],
    Bianco: [],
    Rosa: [],
    Infinito: [],
    Leggenda: [],
  };
  const rankMovementMeta = await hydratePeakRankMovementFromHistory(
    db,
    byCategory,
    "peak_tss_weekly_all"
  );
  /* TOP10 응답에 baseline 메타 동봉 → 클라이언트가 전체(상승/보합/하락) 재계산 가능.
     배열 참조에 비열거형 속성으로 부착(기존 호출부 영향 없음). */
  try {
    Object.defineProperty(supremo, "_rankMovementMeta", {
      value: rankMovementMeta || null,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  } catch (eDefMeta) {
    supremo._rankMovementMeta = rankMovementMeta || null;
  }
  return supremo;
}

/**
 * 03:00(마스터 03:40) 공식 집계·수동 full 집계 후 peak_rank_history 저장.
 * 당일 중간 집계는 ranksByCategory만 갱신하고 prevDayRanksByCategory(전일 03:00 공식 순위)는 유지.
 */
async function applyPeakRankChanges(db, byCategory, historyKey) {
  if (!db || !historyKey || !byCategory || typeof byCategory !== "object") return;
  const todayYmd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const prevNorm = await readPeakRankHistoryNorm(db, historyKey);
  let eligibleByCategory = byCategory;
  try {
    const rankingEligibility = require("./rankingEligibility");
    if (typeof rankingEligibility.filterEligibleByCategory === "function") {
      eligibleByCategory = rankingEligibility.filterEligibleByCategory(byCategory);
    }
  } catch (_eElig) {}
  const snapFields = computePeakRankMovementFields(eligibleByCategory, prevNorm, todayYmd, {
    tssWeeklyAbsolute: String(historyKey || "").startsWith("peak_tss_weekly_"),
  });

  try {
    await db.collection(PEAK_RANK_HISTORY_COL).doc(historyKey).set({
      asOfSeoul: todayYmd,
      ranksByCategory: snapFields.newRanksByCategory,
      rankChangesByCategory: snapFields.newRankChangesByCategory,
      previousRanksByCategory: snapFields.newPreviousRanksByCategory,
      prevDayRanksByCategory: snapFields.newPrevDayRanksByCategory,
      officialBaselineLabel: "prev_day_03h_kst",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (eWrite) {
    console.warn("[applyPeakRankChanges] 스냅샷 저장 실패:", historyKey, eWrite && eWrite.message);
  }
  try {
    const { applyPeakRankChangesSupabase } = require("./rankingPeakMovementSupabase");
    await applyPeakRankChangesSupabase(byCategory, historyKey, { admin });
  } catch (eSb) {
    console.warn(
      "[applyPeakRankChanges] Supabase 스냅샷 저장 실패:",
      historyKey,
      eSb && eSb.message ? eSb.message : eSb
    );
  }
}

/** @deprecated 전체(Supremo) 등락을 부문에 복사하지 않음 — applyPeakRankChanges 가 부문별 처리 */
function propagatePeakRankMovementAcrossCategories() {}

/**
 * 집계/캐시 응답에 peak_rank_history 기준 전날 대비 등락 주입 (TSS·거리·피크 공통).
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {Record<string, any[]>|null|undefined} byCategory
 * @param {any[]|null|undefined} entries
 * @param {string} historyKey
 */
async function hydratePeakRankMovementOnPayload(db, byCategory, entries, historyKey) {
  if (!db || !historyKey || !byCategory) return;
  const hasAny = PEAK_RANK_BOARD_CATEGORIES.some(
    (cat) => Array.isArray(byCategory[cat]) && byCategory[cat].length > 0
  );
  if (!hasAny) return;
  await hydratePeakRankMovementFromHistory(db, byCategory, historyKey);
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} cacheKey
 * @returns {Promise<object|null>} payload
 */
async function readRankingAggregatePayloadIfFresh(db, cacheKey) {
  if (!db || !cacheKey) return null;
  try {
    const ref = db.collection(RANKING_AGGREGATES_COLLECTION).doc(cacheKey);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    const updatedAt = d.updatedAt && (d.updatedAt.toMillis ? d.updatedAt.toMillis() : d.updatedAt);
    if (!updatedAt || (Date.now() - updatedAt > RANKING_AGG_MAX_STALE_MS)) return null;
    return d.payload && typeof d.payload === "object" ? d.payload : null;
  } catch (e) {
    console.warn("[readRankingAggregatePayloadIfFresh]", cacheKey, e.message);
    return null;
  }
}

/** 집계 직후·HTTP 폴백용 — 만료된 사전 집계도 허용 (전체 재스캔 방지) */
async function readRankingAggregatePayloadAllowStale(db, cacheKey, maxStaleMs) {
  if (!db || !cacheKey) return null;
  try {
    const ref = db.collection(RANKING_AGGREGATES_COLLECTION).doc(cacheKey);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    const updatedAt = d.updatedAt && (d.updatedAt.toMillis ? d.updatedAt.toMillis() : d.updatedAt);
    if (maxStaleMs > 0 && updatedAt && Date.now() - updatedAt > maxStaleMs) return null;
    return d.payload && typeof d.payload === "object" ? d.payload : null;
  } catch (e) {
    console.warn("[readRankingAggregatePayloadAllowStale]", cacheKey, e.message);
    return null;
  }
}

const PERSONAL_SPEED_STALE_AGG_MS = 14 * 24 * 60 * 60 * 1000;

function personalSpeedAggregateHasPeak60Entries(payload) {
  const lists = [];
  if (Array.isArray(payload.entries)) lists.push(payload.entries);
  const bc = payload.byCategory;
  if (bc && typeof bc === "object") {
    for (const cat of PEAK_RANK_BOARD_CATEGORIES) {
      if (Array.isArray(bc[cat])) lists.push(bc[cat]);
    }
  }
  for (let li = 0; li < lists.length; li++) {
    const arr = lists[li];
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      if (e && Number(e.peak60minWatts) > 0 && Number(e.speedKmh) > 0) return true;
    }
  }
  return false;
}

/** 60분 피크 없이 speed만 있는 구 행이 섞이면 false */
function personalSpeedPackRowsAllHaveLogPeak(payload) {
  const lists = [];
  if (Array.isArray(payload.entries)) lists.push(payload.entries);
  const bc = payload.byCategory;
  if (bc && typeof bc === "object") {
    for (const cat of PEAK_RANK_BOARD_CATEGORIES) {
      if (Array.isArray(bc[cat])) lists.push(bc[cat]);
    }
  }
  for (let li = 0; li < lists.length; li++) {
    const arr = lists[li];
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      if (!e) continue;
      if (Number(e.speedKmh) > 0 && !(Number(e.peak60minWatts) > 0)) return false;
    }
  }
  return true;
}

function personalSpeedAggregateLogicOk(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (Number(payload.personalSpeedLogicVersion) < rankingDayRollup.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION) {
    return false;
  }
  if (payload.peakDataSource !== rankingDayRollup.PERSONAL_SPEED_PEAK_DATA_SOURCE) {
    return false;
  }
  if (!personalSpeedPackRowsAllHaveLogPeak(payload)) return false;
  return personalSpeedAggregateHasPeak60Entries(payload);
}

/** 23:00·수동 집계로 저장된 pack — HTTP에서 전원 로그 재조회(enrich) 생략 가능 */
function personalSpeedPrecomputedTrustworthy(payload) {
  return personalSpeedAggregateLogicOk(payload) && payload.dashboardLogRouteEnriched === true;
}

/**
 * 항속 보드: 60분 MMP·speed 둘 다 있는 행만 유지 후 재정렬(대시보드 rankingStrict와 동일 대상).
 */
function sanitizePersonalSpeedRankingPack(pack) {
  const emptyCats = { Supremo: [], Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
  if (!pack || !pack.byCategory) {
    return { byCategory: emptyCats, entries: [] };
  }
  const keep = (row) =>
    row &&
    row.userId &&
    Number(row.peak60minWatts) > 0 &&
    Number(row.speedKmh) > 0;
  const byCategory = { ...emptyCats };
  const merged = [];
  for (const cat of PEAK_RANK_BOARD_CATEGORIES) {
    const arr = Array.isArray(pack.byCategory[cat]) ? pack.byCategory[cat] : [];
    const next = arr.filter(keep).sort((a, b) => b.speedKmh - a.speedKmh);
    byCategory[cat] = next.map((e, i) => ({ ...e, rank: i + 1 }));
    next.forEach((r) => merged.push(r));
  }
  merged.sort((a, b) => b.speedKmh - a.speedKmh);
  const seen = new Set();
  const entries = [];
  merged.forEach((e) => {
    const id = String(e.userId);
    if (seen.has(id)) return;
    seen.add(id);
    entries.push(e);
  });
  entries.forEach((e, i) => {
    e.rank = i + 1;
  });
  if (!byCategory.Supremo.length && entries.length) {
    byCategory.Supremo = entries.map((e, i) => ({ ...e, rank: i + 1 }));
  }
  return { byCategory, entries };
}

/**
 * 6개월 항속 사전집계 — ranking_aggregates + cache 동시 기록(클라이언트·HTTP 빠른 조회).
 */
async function persistPersonalSpeedRankingPack(db, cacheKey, pack, startStr, endStr) {
  const sanitized = sanitizePersonalSpeedRankingPack(pack);
  const payload = {
    ...sanitized,
    startStr,
    endStr,
    personalSpeedLogicVersion: rankingDayRollup.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION,
    peakDataSource: rankingDayRollup.PERSONAL_SPEED_PEAK_DATA_SOURCE,
    ...(pack && pack.dashboardLogRouteEnriched === true ? { dashboardLogRouteEnriched: true } : {}),
  };
  await writeRankingAggregatePayload(db, cacheKey, payload);
  await db
    .collection("cache")
    .doc(cacheKey)
    .set({
      ...payload,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  return payload;
}

/**
 * 사전집계·캐시 응답: 대시보드와 동일 로그 루트로 60분 피크·속도 재산출(구 rollup/FTP 잔여 보정).
 */
async function enrichPersonalSpeedPackFromLogs(db, pack, startStr, endStr) {
  if (!pack || !pack.byCategory || !db) return pack;
  const userIds = new Set();
  for (const cat of PEAK_RANK_BOARD_CATEGORIES) {
    const arr = pack.byCategory[cat];
    if (!Array.isArray(arr)) continue;
    arr.forEach((e) => {
      if (e && e.userId) userIds.add(String(e.userId));
    });
  }
  if (!userIds.size) return pack;
  const userRefs = [...userIds].map((uid) => db.collection("users").doc(uid));
  const userSnaps = [];
  for (let ri = 0; ri < userRefs.length; ri += 300) {
    const chunk = userRefs.slice(ri, ri + 300);
    /* eslint-disable no-await-in-loop */
    const part = chunk.length ? await db.getAll(...chunk) : [];
    /* eslint-enable no-await-in-loop */
    part.forEach((snap) => userSnaps.push(snap));
  }
  const userById = new Map();
  userSnaps.forEach((snap) => {
    if (snap.exists) userById.set(snap.id, snap.data() || {});
  });

  const remapRow = async (row) => {
    if (!row || !row.userId) return null;
    const data = userById.get(String(row.userId));
    if (!data) return null;
    const metrics = await rankingDayRollup.computePersonalSpeedMetricsFromLogsDashboardRoute(
      db,
      String(row.userId),
      data,
      startStr,
      endStr
    );
    if (!metrics || !(metrics.peak60minWatts > 0) || !(metrics.speedKmh > 0)) return null;
    return {
      ...row,
      speedKmh: metrics.speedKmh,
      peak60minWatts: metrics.peak60minWatts,
      referenceWatts: metrics.referenceWatts,
      weightKg: metrics.weightKg,
    };
  };

  const allRows = [];
  const ENRICH_BATCH = 40;
  for (const cat of PEAK_RANK_BOARD_CATEGORIES) {
    const arr = pack.byCategory[cat];
    if (!Array.isArray(arr)) {
      pack.byCategory[cat] = [];
      continue;
    }
    const next = [];
    for (let bi = 0; bi < arr.length; bi += ENRICH_BATCH) {
      const batch = arr.slice(bi, bi + ENRICH_BATCH);
      /* eslint-disable no-await-in-loop */
      const mapped = await Promise.all(batch.map((row) => remapRow(row)));
      /* eslint-enable no-await-in-loop */
      mapped.forEach((r) => {
        if (r) next.push(r);
      });
    }
    next.sort((a, b) => b.speedKmh - a.speedKmh);
    pack.byCategory[cat] = next.map((e, i) => ({ ...e, rank: i + 1 }));
    if (cat === "Supremo") {
      next.forEach((r) => allRows.push(r));
    }
  }
  pack.peakDataSource = rankingDayRollup.PERSONAL_SPEED_PEAK_DATA_SOURCE;
  pack.personalSpeedLogicVersion = rankingDayRollup.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION;
  if (!allRows.length) {
    for (const cat of PEAK_RANK_BOARD_CATEGORIES) {
      (pack.byCategory[cat] || []).forEach((r) => allRows.push(r));
    }
  }
  const seen = new Set();
  const merged = [];
  allRows.sort((a, b) => b.speedKmh - a.speedKmh);
  allRows.forEach((e) => {
    const id = String(e.userId || "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    merged.push(e);
  });
  pack.entries = merged.map((e, i) => ({ ...e, rank: i + 1 }));
  pack.dashboardLogRouteEnriched = true;
  return pack;
}

/** 항속 탭 순위 등락·사전집계·cache 초기화 (FTP 폴백 제거·산식 변경 시) */
async function resetPersonalSpeedRankingDerivedState(db, startStr, endStr) {
  if (!db) return { historyDeleted: 0, cachesDeleted: 0 };
  let historyDeleted = 0;
  let cachesDeleted = 0;
  const genders = ["all", "M", "F"];
  for (let gi = 0; gi < genders.length; gi++) {
    const gender = genders[gi];
    const historyKey = personalSpeedRankHistoryKey(gender);
    try {
      await db.collection(PEAK_RANK_HISTORY_COL).doc(historyKey).delete();
      historyDeleted += 1;
    } catch (_eH) {}
    const cacheKey = personalSpeedAggregateCacheKey(gender, startStr, endStr);
    try {
      await db.collection(RANKING_AGGREGATES_COLLECTION).doc(cacheKey).delete();
      cachesDeleted += 1;
    } catch (_eA) {}
    try {
      await db.collection("cache").doc(cacheKey).delete();
      cachesDeleted += 1;
    } catch (_eC) {}
  }
  return { historyDeleted, cachesDeleted };
}

/**
 * 월간(28일) 60분 피크 사전 집계 → 항속(km/h) 보드로 변환 (6개월 집계 miss 시 빠른 폴백)
 */
function transformPeakBoardToPersonalSpeed(byCategory) {
  if (!byCategory || typeof byCategory !== "object") return null;
  const out = { Supremo: [], Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
  let hasAny = false;
  for (const cat of PEAK_RANK_BOARD_CATEGORIES) {
    const rows = Array.isArray(byCategory[cat]) ? byCategory[cat] : [];
    const mapped = [];
    for (let i = 0; i < rows.length; i++) {
      const e = rows[i];
      if (!e || !e.userId) continue;
      const weightKg = Number(e.weightKg) > 0 ? Number(e.weightKg) : 0;
      let watts = Number(e.watts) || 0;
      if (!(watts > 0) && e.wkg != null && weightKg > 0) {
        watts = Number(e.wkg) * weightKg;
      }
      if (!(watts > 0) || !(weightKg > 0)) continue;
      const referenceWatts = Math.round(watts * 10) / 10;
      const speedKmh = Math.round(calculateSpeedOnFlat(referenceWatts, weightKg) * 10) / 10;
      if (!(speedKmh > 0)) continue;
      const peak60minWatts = Math.round(watts * 10) / 10;
      mapped.push({
        userId: e.userId,
        name: e.name || "(이름 없음)",
        speedKmh,
        peak60minWatts,
        referenceWatts: peak60minWatts,
        weightKg,
        ageCategory: e.ageCategory || cat,
        gender: e.gender,
        is_private: e.is_private === true,
        profileImageUrl: e.profileImageUrl || null,
        rankChange: e.rankChange,
        previousBoardRank: e.previousBoardRank,
      });
      hasAny = true;
    }
    mapped.sort((a, b) => b.speedKmh - a.speedKmh);
    out[cat] = mapped.map((row, idx) => ({ ...row, rank: idx + 1 }));
  }
  if (!hasAny) return null;
  const entries = (out.Supremo || []).slice();
  return { byCategory: out, entries };
}

async function getPersonalSpeedRankingFromMonthly60minFallback(db, gender) {
  const { startStr, endStr } = getRolling90DaysRangeSeoul();
  const cacheKey = `peakRanking_v2_monthly_60min_${gender}_${startStr}_${endStr}`;
  let agg =
    (await readRankingAggregatePayloadIfFresh(db, cacheKey)) ||
    (await readRankingAggregatePayloadAllowStale(db, cacheKey, PERSONAL_SPEED_STALE_AGG_MS));
  if (!agg || !agg.byCategory) {
    const cacheRef = db.collection("cache").doc(cacheKey);
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
      const data = cacheSnap.data() || {};
      if (data.byCategory) agg = data;
    }
  }
  if (!agg || !agg.byCategory) return null;
  const pack = transformPeakBoardToPersonalSpeed(agg.byCategory);
  if (!pack) return null;
  const r90 = getRolling90DaysRangeSeoul();
  return {
    ...pack,
    startStr: r90.startStr,
    endStr: r90.endStr,
    approximate: true,
    approximateSource: "monthly_60min_peak",
  };
}

/**
 * HTTP 폴백·수동 집계와 동일 — 6개월 로그에서 60분 MMP → km/h (rollup.speedKmh 캐시 미신뢰).
 */
async function getPersonalSpeedRankingBoardFromRollupsCG(db, startStr, endStr, genderFilter) {
  try {
    const usersSnap = await db.collection("users").get();
    return await getPersonalSpeedRankingBoardEntriesFromRollups(db, startStr, endStr, genderFilter, usersSnap, {
      logBatchSize: 25,
      syncRollups: false,
    });
  } catch (eCg) {
    console.warn("[getPersonalSpeedRankingBoardFromRollupsCG]", eCg && eCg.message ? eCg.message : eCg);
    return null;
  }
}

/** 독주 API·캐시: 요청 사용자 본인 행만 대시보드 「1시간 항속」과 동일 로그 루트로 덮어씀 */
async function patchPersonalSpeedViewerFromDashboardRoute(db, out, viewerUid, startStr, endStr) {
  if (!db || !viewerUid || !out || !out.byCategory) return;
  let userData = null;
  try {
    const userSnap = await db.collection("users").doc(String(viewerUid)).get();
    if (!userSnap.exists) return;
    userData = userSnap.data() || {};
  } catch (_eUs) {
    return;
  }
  let metrics = null;
  try {
    metrics = await rankingDayRollup.computePersonalSpeedMetricsFromLogsDashboardRoute(
      db,
      String(viewerUid),
      userData,
      startStr,
      endStr
    );
  } catch (eMet) {
    console.warn("[patchPersonalSpeedViewerFromDashboardRoute]", viewerUid, eMet && eMet.message);
    return;
  }
  if (!metrics || !(metrics.speedKmh > 0) || !(metrics.peak60minWatts > 0)) return;

  function patchRow(row) {
    if (!row || String(row.userId) !== String(viewerUid)) return;
    row.speedKmh = metrics.speedKmh;
    row.peak60minWatts = metrics.peak60minWatts;
    row.referenceWatts = metrics.referenceWatts;
    row.weightKg = metrics.weightKg;
  }

  for (const c of PEAK_RANK_BOARD_CATEGORIES) {
    const arr = out.byCategory[c];
    if (Array.isArray(arr)) arr.forEach(patchRow);
  }
  if (Array.isArray(out.entries)) out.entries.forEach(patchRow);
  if (out.currentUser) patchRow(out.currentUser);
  if (out.myRankSupremo) patchRow(out.myRankSupremo);
  out.viewerSpeedFromDashboardLogs = true;
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} cacheKey
 * @param {object} payload
 */
async function writeRankingAggregatePayload(db, cacheKey, payload) {
  if (!db || !cacheKey || !payload) return;
  const ref = db.collection(RANKING_AGGREGATES_COLLECTION).doc(cacheKey);
  await ref.set({
    payload,
    version: 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * 기간·로그 스냅샷에서 구간별 최고 W(동시 계산) — getPeakPowerForUser(로그 경로)와 동일 규칙
 * @param {string} startStr
 * @param {string} endStr
 */
function computeUserPeaksAllDurationsFromSnapshot(userData, snapshot, startStr, endStr) {
  const rawWeight = Number(userData.weight || userData.weightKg || 0);
  if (rawWeight <= 0) return null;
  const weightKg = Math.max(rawWeight, 45);
  const maxW = {};
  for (const dt of Object.keys(DURATION_FIELDS)) maxW[dt] = 0;
  snapshot.docs.forEach((doc) => {
    const d = doc.data();
    if (!isCyclingForMmp(d)) return;
    const dateStr = normalizeLogDateToSeoulYmd(d.date);
    if (!dateStr || dateStr < startStr || dateStr > endStr) return;
    for (const dt of Object.keys(DURATION_FIELDS)) {
      const field = DURATION_FIELDS[dt];
      const watts = Number(d[field]) || 0;
      if (watts <= 0) continue;
      if (!validatePeakPowerRecord(dt, watts, weightKg)) continue;
      if (watts > maxW[dt]) maxW[dt] = watts;
    }
  });
  const peaks = {};
  for (const dt of Object.keys(DURATION_FIELDS)) {
    const mw = maxW[dt];
    if (mw > 0) {
      peaks[dt] = { watts: mw, wkg: Math.round((mw / weightKg) * 100) / 100, weightKg };
    }
  }
  return Object.keys(peaks).length ? { weightKg, peaks } : null;
}

/** 코호트 평균 심박(구간별): 동일 기간·로그에서 HR 필드 최댓값 */
function maxHrByDurationFromSnapshot(snapshot, startStr, endStr) {
  const out = {};
  for (const dt of Object.keys(DURATION_HR_FIELDS)) out[dt] = 0;
  snapshot.docs.forEach((doc) => {
    const d = doc.data();
    if (!isCyclingForMmp(d)) return;
    const dateStr = normalizeLogDateToSeoulYmd(d.date);
    if (!dateStr || dateStr < startStr || dateStr > endStr) return;
    for (const dt of Object.keys(DURATION_HR_FIELDS)) {
      const field = DURATION_HR_FIELDS[dt];
      const hr = Number(d[field]) || 0;
      if (hr < 40 || hr > HR_MAX_BPM) continue;
      if (hr > out[dt]) out[dt] = hr;
    }
  });
  return out;
}

function genderKeyFromUserData(data) {
  const gender = String(data.gender || data.sex || "").toLowerCase();
  return gender === "m" || gender === "male" || gender === "남" ? "M" : (gender === "f" || gender === "female" || gender === "여" ? "F" : null);
}

/**
 * 성별 3종(all, M, F) 동시·로그 1회/사용자 (스케줄러 부하 절감)
 * @returns {Promise<Record<string, Record<string, { entries: any[], byCategory: object, cohortAvgHrBpm: number|null }>>>}
 *         outer: gender "all"|"M"|"F", inner: durationType
 */
/**
 * collectionGroup(peak_28d) 1~2회 조회 + 메모리 정렬 — users×rollup·인라인 28버킷 재빌드 없음.
 * @param {string|null} [onlyDuration]
 */
async function buildPeakPowerFromPeak28dRollupsFast(db, startStr, endStr, onlyDuration = null) {
  const t0 = Date.now();
  let rows = await peakBoardFast.fetchPeak28dRollupsForWindow(db, startStr, endStr);
  let built = peakBoardFast.buildPeakBoardsFromRollupRows(rows, startStr, endStr, {
    getLeagueCategory,
    privacyFlagFromFirestoreDoc,
    profileImageUrlFromUserData,
    rankingUserStatusFieldsFromData,
    DURATION_FIELDS,
    DURATION_HR_FIELDS,
  });
  if (built.stats.skippedNoMeta > 0 && built.stats.rollupRows > 0) {
    rows = await peakBoardFast.enrichRollupRowsMissingUserMeta(db, rows, getLeagueCategory);
    built = peakBoardFast.buildPeakBoardsFromRollupRows(rows, startStr, endStr, {
      getLeagueCategory,
      privacyFlagFromFirestoreDoc,
      profileImageUrlFromUserData,
      rankingUserStatusFieldsFromData,
      DURATION_FIELDS,
      DURATION_HR_FIELDS,
    });
    built.stats.enriched = true;
  }
  const ms = Date.now() - t0;
  built.stats.ms = ms;
  console.log("[buildPeakPowerFromPeak28dRollupsFast]", built.stats);
  if (!onlyDuration) return built;
  const out = { all: {}, M: {}, F: {} };
  ["all", "M", "F"].forEach((g) => {
    out[g] = {};
    if (built.boards[g] && built.boards[g][onlyDuration]) {
      out[g][onlyDuration] = built.boards[g][onlyDuration];
    }
  });
  return { boards: out, stats: built.stats };
}

/**
 * peak_28d rollup 1 read/사용자 — 일 버킷 28회×전체 users 스캔 대신 보드 조립 (4주 1피크 규칙).
 * @param {string|null} [onlyDuration] max|1min|… 단일 구간
 */
async function buildPeakPowerFromPeak28dRollupsOnePass(db, startStr, endStr, usersSnap = null, onlyDuration = null) {
  const genders = ["all", "M", "F"];
  const durKeys =
    onlyDuration && DURATION_FIELDS[onlyDuration]
      ? [onlyDuration]
      : Object.keys(DURATION_FIELDS);
  const byGenderDur = {};
  genders.forEach((g) => {
    byGenderDur[g] = {};
    for (const dt of durKeys) {
      byGenderDur[g][dt] = { raw: [] };
    }
  });
  const cohortSum = { all: {}, M: {}, F: {} };
  const cohortN = { all: {}, M: {}, F: {} };
  genders.forEach((g) => {
    for (const dt of Object.keys(DURATION_HR_FIELDS)) {
      cohortSum[g][dt] = 0;
      cohortN[g][dt] = 0;
    }
  });

  const snap = usersSnap ?? (await db.collection("users").get());
  const docs = snap.docs;
  let rollupMiss = 0;

  for (let i = 0; i < docs.length; i += RANKING_ONE_PASS_BATCH) {
    const batch = docs.slice(i, i + RANKING_ONE_PASS_BATCH);
    const batchIds = batch.map((d) => d.id);
    const rollupMap = await rankingDayRollup.fetchPeak28dRollupMap(db, batchIds, startStr, endStr);
    await Promise.all(
      batch.map(async (udoc) => {
        const userId = udoc.id;
        const data = udoc.data();
        const name = data.name || "(이름 없음)";
        const gKey = genderKeyFromUserData(data);
        const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
        const challenge = data.challenge || "Fitness";
        const leagueCategory = getLeagueCategory(challenge, birthYear);
        if (!leagueCategory) return;

        let hit = rollupMap.get(userId);
        if (!hit || !hit.peakMap) {
          rollupMiss++;
          const rebuilt = await rankingDayRollup.rebuildPeak28dRollupFromBuckets(
            db,
            userId,
            data,
            startStr,
            endStr,
            { ensureMissingDays: false, getLeagueCategory }
          );
          hit = { peakMap: rebuilt.peakMap, hrMax: rebuilt.hrMax || {} };
        }
        const peakMap = hit.peakMap;
        const hrMax = hit.hrMax || {};
        for (const slot of genders) {
          if (slot === "M" && gKey !== "M") continue;
          if (slot === "F" && gKey !== "F") continue;
          for (const dth of Object.keys(DURATION_HR_FIELDS)) {
            if (hrMax[dth] > 0) {
              cohortSum[slot][dth] += hrMax[dth];
              cohortN[slot][dth] += 1;
            }
          }
        }
        if (!peakMap || !peakMap.peaks) return;
        for (const dt of Object.keys(peakMap.peaks)) {
          const p = peakMap.peaks[dt];
          if (!p || p.wkg <= 0) continue;
          const row = {
            userId,
            name,
            wkg: p.wkg,
            watts: p.watts,
            weightKg: p.weightKg,
            ageCategory: leagueCategory,
            gender: String(data.gender || data.sex || "").toLowerCase(),
            is_private: privacyFlagFromFirestoreDoc(data),
            profileImageUrl: profileImageUrlFromUserData(data),
            ...rankingUserStatusFieldsFromData(data),
          };
          for (const slot of genders) {
            if (slot === "M" && gKey !== "M") continue;
            if (slot === "F" && gKey !== "F") continue;
            byGenderDur[slot][dt].raw.push({ ...row });
          }
        }
      })
    );
  }

  console.log("[buildPeakPowerFromPeak28dRollupsOnePass] rollupMiss", rollupMiss, "users", docs.length);

  const out = { all: {}, M: {}, F: {} };
  genders.forEach((g) => {
    for (const dt of durKeys) {
      const raw = byGenderDur[g][dt].raw;
      raw.sort((a, b) => b.wkg - a.wkg);
      const withRank = raw.map((e, j) => ({ ...e, rank: j + 1 }));
      const byCategory = { Supremo: withRank, Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
      withRank.forEach((e) => {
        if (byCategory[e.ageCategory]) byCategory[e.ageCategory].push(e);
      });
      let cohortAvgHrBpm = null;
      if (DURATION_HR_FIELDS[dt] && cohortN[g][dt] > 0) {
        cohortAvgHrBpm = Math.round((cohortSum[g][dt] / cohortN[g][dt]) * 10) / 10;
      }
      out[g][dt] = {
        entries: withRank,
        byCategory,
        cohortAvgHrBpm: cohortAvgHrBpm != null && !isNaN(cohortAvgHrBpm) ? cohortAvgHrBpm : null,
      };
    }
  });
  return out;
}

/** [비용절감] usersSnap을 외부에서 주입받아 중복 users.get() 방지
 * @param {string|null} [onlyDuration] max|1min|… 지정 시 해당 구간만 집계·반환(수동 1구간 재실행용) */
async function buildPeakPowerAllDurationsForRangeAllGendersOnePass(db, startStr, endStr, usersSnap = null, onlyDuration = null) {
  const genders = ["all", "M", "F"];
  const durKeys =
    onlyDuration && DURATION_FIELDS[onlyDuration]
      ? [onlyDuration]
      : Object.keys(DURATION_FIELDS);
  const byGenderDur = {};
  genders.forEach((g) => {
    byGenderDur[g] = {};
    for (const dt of durKeys) {
      byGenderDur[g][dt] = { raw: [] };
    }
  });
  const cohortSum = { all: {}, M: {}, F: {} };
  const cohortN = { all: {}, M: {}, F: {} };
  genders.forEach((g) => {
    for (const dt of Object.keys(DURATION_HR_FIELDS)) {
      cohortSum[g][dt] = 0;
      cohortN[g][dt] = 0;
    }
  });

  const snap = usersSnap ?? await db.collection("users").get();
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += RANKING_ONE_PASS_BATCH) {
    const batch = docs.slice(i, i + RANKING_ONE_PASS_BATCH);
    await Promise.all(
      batch.map(async (udoc) => {
        const userId = udoc.id;
        const data = udoc.data();
        const name = data.name || "(이름 없음)";
        const gKey = genderKeyFromUserData(data);
        const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
        const challenge = data.challenge || "Fitness";
        const leagueCategory = getLeagueCategory(challenge, birthYear);
        if (!leagueCategory) return;

        await rankingDayRollup.ensureRankingBucketsFilledForRange(db, userId, data, startStr, endStr);
        const dates = rankingDayRollup.listInclusiveYmdsSeoul(startStr, endStr);
        const refs = dates.map((ymd) => rankingDayRollup.bucketRef(db, userId, ymd));
        const bucketSnaps = await rankingDayRollup.chunkedGetAll(db, refs, 30);
        const peakMap = rankingDayRollup.computeFourWeekGcStylePeaksFromBucketSnaps(
          data,
          bucketSnaps,
          startStr,
          endStr
        );
        const hrMax = rankingDayRollup.maxHrByDurationFromBucketSnaps(bucketSnaps, startStr, endStr);
        for (const slot of genders) {
          if (slot === "M" && gKey !== "M") continue;
          if (slot === "F" && gKey !== "F") continue;
          for (const dth of Object.keys(DURATION_HR_FIELDS)) {
            if (hrMax[dth] > 0) {
              cohortSum[slot][dth] += hrMax[dth];
              cohortN[slot][dth] += 1;
            }
          }
        }
        if (!peakMap) return;
        for (const dt of Object.keys(peakMap.peaks)) {
          const p = peakMap.peaks[dt];
          if (!p || p.wkg <= 0) continue;
          const row = {
            userId,
            name,
            wkg: p.wkg,
            watts: p.watts,
            weightKg: p.weightKg,
            ageCategory: leagueCategory,
            gender: String(data.gender || data.sex || "").toLowerCase(),
            is_private: privacyFlagFromFirestoreDoc(data),
            profileImageUrl: profileImageUrlFromUserData(data),
            ...rankingUserStatusFieldsFromData(data),
          };
          for (const slot of genders) {
            if (slot === "M" && gKey !== "M") continue;
            if (slot === "F" && gKey !== "F") continue;
            byGenderDur[slot][dt].raw.push({ ...row });
          }
        }
      })
    );
  }

  const out = { all: {}, M: {}, F: {} };
  genders.forEach((g) => {
    for (const dt of durKeys) {
      const raw = byGenderDur[g][dt].raw;
      raw.sort((a, b) => b.wkg - a.wkg);
      const withRank = raw.map((e, j) => ({ ...e, rank: j + 1 }));
      const byCategory = { Supremo: withRank, Bianco: [], Rosa: [], Infinito: [], Leggenda: [], Assoluto: [] };
      withRank.forEach((e) => {
        if (byCategory[e.ageCategory]) byCategory[e.ageCategory].push(e);
      });
      let cohortAvgHrBpm = null;
      if (DURATION_HR_FIELDS[dt] && cohortN[g][dt] > 0) {
        cohortAvgHrBpm = Math.round((cohortSum[g][dt] / cohortN[g][dt]) * 10) / 10;
      }
      out[g][dt] = { entries: withRank, byCategory, cohortAvgHrBpm: cohortAvgHrBpm != null && !isNaN(cohortAvgHrBpm) ? cohortAvgHrBpm : null };
    }
  });
  return out;
}

/**
 * uid가 참가한 방장 id 집합(최근 30일·서울, rides 스캔 1회)
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} uid
 */
async function getHostUserIdsForOpenRidesParticipation(db, uid, startStr, endStr) {
  const out = new Set();
  if (!uid) return out;
  const tsStart = admin.firestore.Timestamp.fromDate(new Date(`${startStr}T00:00:00+09:00`));
  const tsEnd = admin.firestore.Timestamp.fromDate(new Date(`${endStr}T23:59:59.999+09:00`));
  const uidStr = String(uid).trim();
  const ridesSnap = await db.collection("rides")
    .where("date", ">=", tsStart)
    .where("date", "<=", tsEnd)
    .get();
  ridesSnap.forEach((rdoc) => {
    const r = rdoc.data() || {};
    if (String(r.rideStatus || "active") === "cancelled") return;
    const ymd = rideDocDateToSeoulYmd(r.date);
    if (!ymd || ymd < startStr || ymd > endStr) return;
    const parts = Array.isArray(r.participants) ? r.participants : [];
    if (!parts.some((p) => String(p || "").trim() === uidStr)) return;
    const h = String(r.hostUserId || "").trim();
    if (h) out.add(h);
  });
  return out;
}

/**
 * 그룹 랭킹 응답(집계본)에 참가 여부·랭크만 뷰어에 맞게 덮어쓰기
 * @param {string|null} uid
 */
async function applyGroupRankingParticipationForViewer(db, byCategory, entries, startStr, endStr, uid) {
  if (!byCategory || !Array.isArray(entries)) return;
  const hostSet = await getHostUserIdsForOpenRidesParticipation(db, uid, startStr, endStr);
  const sup = byCategory.Supremo;
  if (Array.isArray(sup)) {
    for (const row of sup) {
      if (row && row.userId) {
        row.currentUserParticipated = hostSet.has(String(row.userId).trim());
      }
    }
  }
  for (const row of entries) {
    if (row && row.userId) {
      row.currentUserParticipated = hostSet.has(String(row.userId).trim());
    }
  }
}

/**
 * 주간 TSS·TOP10 전체 스캔 집계 (수동·마스터 03:40·09:00 스케줄).
 * @param {FirebaseFirestore.Firestore} db
 */
async function refreshWeeklyMileageTop10AggregatesOnly(db) {
  const t0 = Date.now();
  const writeFirebaseWeekly =
    await shouldRunFirebaseRankingScheduledJob(db, "scheduledWeeklyTop10PeakRefresh");
  if (!writeFirebaseWeekly) {
    const r = await runSupabaseWeeklyTssDaytimePipeline(
      db,
      "[refreshWeeklyMileageTop10AggregatesOnly]"
    );
    console.log("[refreshWeeklyMileageTop10AggregatesOnly] supabase daytime (Firebase write skipped)", r);
    return r;
  }
  const { startStr: wStart, endStr: wEnd } = getWeekRangeSeoul();
  const { startStr: wPrevS, endStr: wPrevE } = getWeekRangeSeoul(-1);
  const sharedUsersSnap = await db.collection("users").get();
  console.log("[refreshWeeklyMileageTop10AggregatesOnly] start", {
    userCount: sharedUsersSnap.size,
    wStart,
    wEnd,
    wPrevS,
    wPrevE,
  });

  try {
    const parityResult = await supabaseDualWriteServer.runWeeklyTssSupabaseParityForActiveUsers(
      db,
      admin,
      wStart,
      wEnd
    );
    console.log("[refreshWeeklyMileageTop10AggregatesOnly] supabase weekly TSS parity sync", {
      wStart,
      wEnd,
      ...parityResult,
    });
  } catch (syncErr) {
    console.warn(
      "[refreshWeeklyMileageTop10AggregatesOnly] supabase parity warn:",
      syncErr && syncErr.message ? syncErr.message : syncErr
    );
  }

  const boardsByGender = {};
  for (const gender of ["all", "M", "F"]) {
    const tssPayload = await supabaseRankingReader.fetchWeeklyTssRanking(
      admin,
      wStart,
      wEnd,
      gender
    );
    boardsByGender[gender] = {
      entries: (tssPayload && tssPayload.entries) || [],
      byCategory: (tssPayload && tssPayload.byCategory) || {},
    };
    const tssBoard = boardsByGender[gender];
    if (tssBoard && tssBoard.byCategory) {
      await applyPeakRankChanges(db, tssBoard.byCategory, `peak_tss_weekly_${gender}`);
    }
  }
  await persistWeeklyTssBoardsAndTop10(db, wStart, wEnd, boardsByGender);

  const entriesPrev = await getWeeklyRankingEntries(db, wPrevS, wPrevE, sharedUsersSnap);
  const top10Prev = entriesPrev.slice(0, 10).map((e, i) => weeklyTop10RowFromEntry(e, i));
  await writeRankingAggregatePayload(db, `weekly_ranking_full_${wPrevS}_${wPrevE}`, {
    fullEntries: entriesPrev,
    ranking: top10Prev,
    startStr: wPrevS,
    endStr: wPrevE,
  });

  console.log("[refreshWeeklyMileageTop10AggregatesOnly] done", { ms: Date.now() - t0 });
  return { mode: "full", ms: Date.now() - t0 };
}

/**
 * A안 00:05 — 전일 집계 + 오늘 1일 버킷 증분 (users 전체 스캔 없음).
 */
async function refreshWeeklyTssMidnightIncremental(db) {
  const t0 = Date.now();
  const { startStr: wStart, endStr: wEnd } = getWeekRangeSeoul();
  const prevEnd = previousCalendarDayStr(wEnd);
  const sharedUsersSnap = await db.collection("users").get();
  console.log("[refreshWeeklyTssMidnightIncremental] start", {
    wStart,
    wEnd,
    prevEnd,
    userCount: sharedUsersSnap.size,
  });

  const boardsByGender = {};
  for (const gender of ["all", "M", "F"]) {
    boardsByGender[gender] = await buildWeeklyTssBoardIncrementalFromPreviousDay(
      db,
      wStart,
      wEnd,
      gender,
      sharedUsersSnap
    );
  }
  await persistWeeklyTssBoardsAndTop10(db, wStart, wEnd, boardsByGender);
  console.log("[refreshWeeklyTssMidnightIncremental] done", { ms: Date.now() - t0 });
  return { mode: "incremental", ms: Date.now() - t0 };
}

/**
 * (레거시) 집계가 minAgeMs 이상 지났을 때만 전체 TSS 스캔 — 일 2회 스케줄로 대체됨.
 */
async function refreshWeeklyMileageTop10IfStale(db, minAgeMs) {
  const maxAge = minAgeMs != null ? minAgeMs : RANKING_HOURLY_TSS_REFRESH_MIN_AGE_MS;
  const { startStr: wStart, endStr: wEnd } = getWeekRangeSeoul();
  const stale = await isWeeklyTssAllAggregateStale(db, wStart, wEnd, maxAge);
  if (!stale) {
    console.log("[refreshWeeklyMileageTop10IfStale] skip (fresh aggregate)", { wStart, wEnd, maxAgeMs: maxAge });
    return { skipped: true, reason: "fresh" };
  }
  return refreshWeeklyMileageTop10AggregatesOnly(db);
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {boolean} [forceReconcile=false] true이면 집계 전 모든 사용자의 현재·이전 주 일 버킷을 logs에서 강제 재계산.
 * @param {{ skipPersonalSpeed?: boolean }} [opts] skipPersonalSpeed=true면 183일 독주 구간 생략(수동 긴급 완료용).
 */
async function runRebuildRankingAggregatesCore(db, forceReconcile, opts) {
  const t0 = Date.now();
  let wrote = 0;
  let lastPhase = "init";
  const { startStr: wStart, endStr: wEnd } = getWeekRangeSeoul();
  const { startStr: wPrevS, endStr: wPrevE } = getWeekRangeSeoul(-1);
  const { startStr: r90s, endStr: r90e } = getRolling90DaysRangeSeoul();
  const { startStr: r30s, endStr: r30e } = getRolling30DaysRangeSeoul();
  const skipPersonalSpeed = !!(opts && opts.skipPersonalSpeed);
  try {
    await markMasterDailyRankingRebuildRunning(db, {
      forceReconcile: !!forceReconcile,
      skipPersonalSpeed,
      timeoutLimitSec: 3600,
    });
    lastPhase = "users_fetch";
  // [비용절감] users 컬렉션을 단 1회만 읽어 모든 랭킹 함수에 공유 주입 (기존 10회 → 1회)
  const sharedUsersSnap = await db.collection("users").get();
  console.log("[runRebuildRankingAggregatesCore] users snapshot fetched once, docs:", sharedUsersSnap.size,
    { forceReconcile: !!forceReconcile, skipPersonalSpeed, wStart, wEnd });
  await markMasterDailyRankingRebuildProgress(db, "users_fetch_done", {
    userCount: sharedUsersSnap.size,
    elapsedMs: Date.now() - t0,
  });

  // ── 0. 버킷 강제 재계산 (수동 집계 시에만 실행) ──
  // 사용자 루프를 집계 루프와 분리하지 않고 여기서 일괄 처리함으로써 Firestore 읽기 중복을 줄임.
  const allUserDocs = sharedUsersSnap.docs;
  if (forceReconcile) {
    const RECONCILE_BATCH = 10; // 동시 처리 사용자 수 (타임아웃 방지)
    for (let i = 0; i < allUserDocs.length; i += RECONCILE_BATCH) {
      const batch = allUserDocs.slice(i, i + RECONCILE_BATCH);
      await Promise.all(batch.map(async (userDoc) => {
        const uid = userDoc.id;
        const udata = userDoc.data() || {};
        try {
          await rankingDayRollup.ensureRankingBucketsFilledForRange(db, uid, udata, wStart, wEnd, true);
          await rankingDayRollup.ensureRankingBucketsFilledForRange(db, uid, udata, wPrevS, wPrevE, true);
        } catch (e) {
          console.warn("[runRebuildRankingAggregatesCore] bucket reconcile 실패:", uid, e && e.message);
        }
      }));
    }
    console.log("[runRebuildRankingAggregatesCore] 버킷 강제 재계산 완료, ms:", Date.now() - t0);
  }

  lastPhase = "supabase_weekly_tss_parity";
  if (!(opts && opts.skipSupabaseParity)) {
  try {
    const parityEarly = await supabaseDualWriteServer.runWeeklyTssSupabaseParityForActiveUsers(
      db,
      admin,
      wStart,
      wEnd
    );
    console.log("[runRebuildRankingAggregatesCore] supabase weekly TSS parity", parityEarly);
    await markMasterDailyRankingRebuildProgress(db, "supabase_weekly_tss_parity_done", {
      ...parityEarly,
      elapsedMs: Date.now() - t0,
    });
  } catch (parityErr) {
    console.warn(
      "[runRebuildRankingAggregatesCore] supabase weekly TSS parity warn:",
      parityErr && parityErr.message ? parityErr.message : parityErr
    );
  }
  }

  const writeFirebaseWeeklyTss = await shouldRunFirebaseRankingScheduledJob(
    db,
    "rebuildRankingAggregates"
  );

  // ── 1. 주간 TSS 집계 (gender=all,M,F) — Supabase pg_cron 03:40 대체 시 Firebase Write 생략 ──
  let weeklyRankingFullCurrent = null;
  if (writeFirebaseWeeklyTss) {
  for (const gender of ["all", "M", "F"]) {
    const tss = await getWeeklyTssRankingBoardEntries(db, wStart, wEnd, gender, sharedUsersSnap);
    await applyPeakRankChanges(db, tss.byCategory, `peak_tss_weekly_${gender}`);
    if (gender === "all") {
      weeklyRankingFullCurrent = tss.entries.map((e) => ({
        userId: e.userId,
        name: e.name,
        totalTss: e.totalTss,
        is_private: e.is_private === true,
        rankChange: e.rankChange,
        previousBoardRank: e.previousBoardRank,
      }));
    }
    const keyTss = `peakRanking_weekly_tss_v2_${gender}_${wStart}_${wEnd}`;
    await writeRankingAggregatePayload(db, keyTss, {
      byCategory: tss.byCategory,
      entries: tss.entries,
      startStr: wStart,
      endStr: wEnd,
    });
    wrote++;
  }

  // ── 2. weekly_ranking_full_* 을 가장 먼저 기록 ──
  const entriesCurrent = weeklyRankingFullCurrent || [];
  const top10Current = entriesCurrent.slice(0, 10).map((e, i) => weeklyTop10RowFromEntry(e, i));
  const weeklyKey = `weekly_ranking_full_${wStart}_${wEnd}`;
  await writeRankingAggregatePayload(db, weeklyKey, {
    fullEntries: entriesCurrent,
    ranking: top10Current,
    startStr: wStart,
    endStr: wEnd,
  });
  wrote++;
  console.log("[runRebuildRankingAggregatesCore] weekly_ranking_full 저장 완료", { wStart, wEnd, entries: entriesCurrent.length });
  await markMasterDailyRankingRebuildProgress(db, "weekly_tss_top10_done", { wrote, elapsedMs: Date.now() - t0 });

  // ── 3. 이전 주 TOP10 ──
  const entriesPrevEarly = await getWeeklyRankingEntries(db, wPrevS, wPrevE, sharedUsersSnap);
  const top10PrevEarly = entriesPrevEarly.slice(0, 10).map((e, i) => weeklyTop10RowFromEntry(e, i));
  const weeklyKeyPrevEarly = `weekly_ranking_full_${wPrevS}_${wPrevE}`;
  await writeRankingAggregatePayload(db, weeklyKeyPrevEarly, {
    fullEntries: entriesPrevEarly,
    ranking: top10PrevEarly,
    startStr: wPrevS,
    endStr: wPrevE,
  });
  wrote++;
  } else {
    console.log(
      "[runRebuildRankingAggregatesCore] weekly TSS/TOP10 Firebase aggregate skipped (Supabase pg_cron primary)"
    );
    await markMasterDailyRankingRebuildProgress(db, "weekly_tss_supabase_primary", {
      wrote,
      elapsedMs: Date.now() - t0,
    });
  }

  // 28일 피크·헵타곤 — 02:50·03:20 선행 완료 후 본 마스터(03:40)가 TSS·TOP10 등 갱신
  lastPhase = "after_peak_0250_heptagon_0320";
  await markMasterDailyRankingRebuildProgress(db, lastPhase, {
    wrote,
    elapsedMs: Date.now() - t0,
    peakSchedule: "scheduledPeak28dBoardAndHeptagon 02:50 KST",
    heptagonSchedule: "scheduledPeak28dHeptagonOnly 03:20 KST",
    masterSchedule: "fn_master_daily_rebuild_weekly_tss pg_cron 03:40 KST",
  });
  /** 주간 TSS·TOP10 완료 시점 — 이후 독주(28d) 구간 타임아웃 시에도 마스터 메타 확인 가능 */
  try {
    await markMasterDailyRankingRebuildComplete(db, {
      wrote,
      ms: Date.now() - t0,
      phase: "weekly_core",
      partial: true,
      r90s,
      r90e,
    });
  } catch (ePartialMeta) {
    console.warn("[runRebuildRankingAggregatesCore] weekly_core partial meta failed:", ePartialMeta && ePartialMeta.message);
  }

  // ── 4. 30일 거리 랭킹 ──
  lastPhase = "rolling30_dist";
  await markMasterDailyRankingRebuildProgress(db, lastPhase, { wrote, elapsedMs: Date.now() - t0 });
  const distRes = await runRankingAggregatePersonalDist30d(db, sharedUsersSnap);
  wrote += distRes.wrote;

  // ── 4-1. 90일 항속(독주) — 일 버킷 rollup
  if (!skipPersonalSpeed) {
    const psRes = await runRankingAggregatePersonalSpeed28d(db, sharedUsersSnap, {
      fromBucketsOnly: true,
      skipUnchanged: true,
    });
    wrote += psRes.wrote;
    await markMasterDailyRankingRebuildProgress(db, "personal_speed_done", {
      wrote,
      elapsedMs: Date.now() - t0,
      psRollup: psRes.psRollup,
    });
  } else {
    console.log("[runRebuildRankingAggregatesCore] personal_speed skipped (skipPersonalSpeed=1)");
    await markMasterDailyRankingRebuildProgress(db, "personal_speed_skipped", {
      wrote,
      elapsedMs: Date.now() - t0,
    });
  }

  lastPhase = "group_dist";
  await markMasterDailyRankingRebuildProgress(db, lastPhase, { wrote, elapsedMs: Date.now() - t0 });
  for (const gender of ["all", "M", "F"]) {
    const group = await getRolling30dGroupDistanceByHostEntries(db, r30s, r30e, null, gender);
    await applyPeakRankChanges(db, group.byCategory, `peak_group_dist_rolling30_${gender}`);
    const keyG = `peakRanking_group_dist_30d_${gender}_${r30s}_${r30e}`;
    await writeRankingAggregatePayload(db, keyG, {
      byCategory: group.byCategory,
      entries: group.entries,
      startStr: r30s,
      endStr: r30e,
      gender,
    });
    wrote++;
  }

  const ms = Date.now() - t0;
  lastPhase = "done";
  console.log("[runRebuildRankingAggregatesCore] done", { wrote, ms });
  await markMasterDailyRankingRebuildComplete(db, { wrote, ms, phase: "full", partial: false });
  return { wrote, ms };
  } catch (eCore) {
    const msFail = Date.now() - t0;
    console.error("[runRebuildRankingAggregatesCore] failed", lastPhase, eCore && eCore.message ? eCore.message : eCore);
    try {
      await markMasterDailyRankingRebuildFailed(db, eCore, { wrote, ms: msFail, lastPhase });
    } catch (eMetaFail) {
      console.warn("[runRebuildRankingAggregatesCore] failed meta write:", eMetaFail && eMetaFail.message);
    }
    throw eCore;
  }
}

/**
 * 스케줄 마스터 선행 조건: 당일 02:50 피크 보드·03:20 헵타곤 완료.
 * @param {boolean} [opts.skipGate]
 */
async function assertPeakHeptagonCompleteBeforeMaster(db, opts) {
  if (opts && opts.skipGate) return;
  const todayKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const peakSnap = await db.collection("ranking_meta").doc("peak_28d_board_refresh").get();
  const peak = peakSnap.exists ? peakSnap.data() || {} : {};
  if (String(peak.dateKst || "") !== todayKst || String(peak.status || "") !== "complete") {
    throw new Error(
      `peak_28d_board_refresh not ready (${peak.status || "missing"}, dateKst=${peak.dateKst || ""}, need=${todayKst})`
    );
  }
  const heptSnap = await db.collection("ranking_meta").doc(RANKING_HEPTAGON_REBUILD_META_DOC).get();
  const hept = heptSnap.exists ? heptSnap.data() || {} : {};
  if (String(hept.dateKst || "") !== todayKst || String(hept.status || "") !== "complete") {
    throw new Error(
      `heptagon_daily_rebuild not ready (${hept.status || "missing"}, dateKst=${hept.dateKst || ""}, need=${todayKst})`
    );
  }
}

/** KST 03:38 — pg_cron 03:40 마스터 직전 Firestore→Supabase 주간 TSS parity (Supabase 집계 모드 전용) */
const scheduledPreMasterWeeklyTssParityOptions = supabaseDualWriteServer.appendServiceRoleSecret({
  schedule: "38 3 * * *",
  timeZone: "Asia/Seoul",
  memory: "1GiB",
  timeoutSeconds: 1800,
});
exports.scheduledPreMasterWeeklyTssParity = onSchedule(
  scheduledPreMasterWeeklyTssParityOptions,
  async () => {
    if (await shouldRunFirebaseRankingScheduledJob(admin.firestore(), "rebuildRankingAggregates")) {
      return;
    }
    if (!shouldRunSupabaseWeeklyTssParitySchedule()) return;
    const db = admin.firestore();
    try {
      await runWeeklyTssSupabaseParityScheduledJob(db, "[scheduledPreMasterWeeklyTssParity]");
    } catch (e) {
      console.error("[scheduledPreMasterWeeklyTssParity]", e && e.message ? e.message : e);
      throw e;
    }
  }
);

/** KST 03:40 — 마스터 집계 (주간 TSS·TOP10·거리·항속). 02:50 피크·03:20 헵타곤 complete 후만 실행. */
exports.rebuildRankingAggregates = onSchedule(
  {
    schedule: RANKING_REBUILD_CRON,
    timeZone: "Asia/Seoul",
    memory: "2GiB",
    /** Cloud Scheduler(onSchedule) 상한 1800s — 초과 시 deploy 실패 */
    timeoutSeconds: 1800,
  },
  async () => {
    const db = admin.firestore();
    try {
      if (!(await shouldRunFirebaseRankingScheduledJob(db, "rebuildRankingAggregates"))) {
        console.log(
          "[rebuildRankingAggregates] Supabase pg_cron 03:40 KST handles weekly aggregate (Firebase write disabled)"
        );
        return;
      }
      await assertPeakHeptagonCompleteBeforeMaster(db);
      const r = await runRebuildRankingAggregatesCore(db);
      console.log("[rebuildRankingAggregates] master ok", r);
    } catch (e) {
      console.error("[rebuildRankingAggregates]", e && e.message ? e.message : e);
      try {
        await markMasterDailyRankingRebuildFailed(db, e, { source: "rebuildRankingAggregates" });
      } catch (eMeta) {
        console.warn("[rebuildRankingAggregates] failed meta write:", eMeta && eMeta.message);
      }
      throw e;
    }
  }
);

/**
 * 수동: `rebuildRankingAggregates`(03:40 마스터)와 동일. ?skipPeakHeptagonGate=1 선행 게이트 생략.
 * (구버전: TOP10만 먼저 응답 후 백그라운드 — 9분 제한에 피크·독주가 거의 항상 중단됨)
 * GET/POST ?secret=stelvio-internal-sync-v1
 * 선택: ?forceReconcile=true — TSS 일 버킷 logs 강제 재계산
 * 예: Invoke-RestMethod -Uri "https://us-central1-stelvio-ai.cloudfunctions.net/manualRebuildWeeklyRanking?secret=stelvio-internal-sync-v1"
 */
exports.manualRebuildWeeklyRanking = onRequest(
  { cors: true, timeoutSeconds: 3600, memory: "2GiB" },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Internal-Secret");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const rawSecret = req.query.secret || req.headers["x-internal-secret"] || req.headers["X-Internal-Secret"];
    let authorized = rawSecret === INTERNAL_SYNC_SECRET;

    const db = admin.firestore();
    if (!authorized) {
      const uid = await getUidFromRequest(req, res);
      if (!uid) return;
      const callerSnap = await db.collection("users").doc(uid).get();
      const grade = callerSnap.exists ? String((callerSnap.data() || {}).grade ?? "2") : "2";
      if (grade !== "1") {
        res.status(403).json({ success: false, error: "관리자(grade=1) 권한이 필요합니다." });
        return;
      }
      authorized = true;
    }

    const forceReconcile =
      String(req.query?.forceReconcile || req.body?.forceReconcile || "").toLowerCase() === "true" ||
      String(req.query?.forceReconcile || req.body?.forceReconcile || "") === "1";
    const skipPersonalSpeed =
      String(req.query?.skipPersonalSpeed || req.body?.skipPersonalSpeed || "").toLowerCase() === "true" ||
      String(req.query?.skipPersonalSpeed || req.body?.skipPersonalSpeed || "") === "1";
    const forceRun =
      String(req.query?.force || req.body?.force || "").toLowerCase() === "true" ||
      String(req.query?.force || req.body?.force || "") === "1";
    const skipPeakHeptagonGate =
      String(req.query?.skipPeakHeptagonGate || req.body?.skipPeakHeptagonGate || "").toLowerCase() === "true" ||
      String(req.query?.skipPeakHeptagonGate || req.body?.skipPeakHeptagonGate || "") === "1";
    const startedAt = new Date().toISOString();

    if (await masterManualRebuildAlreadyRunning(db, { force: forceRun })) {
      res.status(409).json({
        success: false,
        error:
          "마스터 랭킹 집계가 이미 실행 중입니다. 25분 후 재시도하거나 ?force=1 로 고착 running 을 해제하세요.",
        checkMetaDoc: `ranking_meta/${RANKING_MASTER_REBUILD_META_DOC}`,
      });
      return;
    }

    res.status(202).json({
      success: true,
      accepted: true,
      startedAt,
      forceReconcile,
      skipPersonalSpeed,
      message:
        "전체 랭킹 집계를 시작했습니다. Firestore ranking_meta/master_daily_rebuild 의 lastPhase·progressAt 으로 진행을 확인하세요. 60분 타임아웃.",
      logKeywords: [
        "[runRebuildRankingAggregatesCore] weekly_ranking_full 저장 완료",
        "[runRebuildRankingAggregatesCore] done",
        "[manualRebuildWeeklyRanking] 완료",
      ],
      checkMetaDoc: `ranking_meta/${RANKING_MASTER_REBUILD_META_DOC}`,
      progressFields: ["lastPhase", "progressAt", "elapsedMs"],
    });

    try {
      await assertPeakHeptagonCompleteBeforeMaster(db, { skipGate: skipPeakHeptagonGate });
      const useFirebaseWeekly = await shouldRunFirebaseRankingScheduledJob(
        db,
        "rebuildRankingAggregates"
      );
      let r;
      if (!useFirebaseWeekly) {
        const sbMaster = await runSupabaseWeeklyTssMasterPipeline(db, {
          forceReconcile,
          logPrefix: "[manualRebuildWeeklyRanking]",
        });
        r = await runRebuildRankingAggregatesCore(db, forceReconcile, {
          skipPersonalSpeed,
          skipSupabaseParity: true,
        });
        r = { ...r, supabaseWeeklyMaster: sbMaster };
      } else {
        r = await runRebuildRankingAggregatesCore(db, forceReconcile, { skipPersonalSpeed });
      }
      console.log("[manualRebuildWeeklyRanking] 완료", JSON.stringify({ ...r, startedAt, forceReconcile }));
    } catch (e) {
      console.error("[manualRebuildWeeklyRanking] full 집계 오류:", e && e.message ? e.message : e);
      try {
        await markMasterDailyRankingRebuildFailed(db, e, { startedAt, forceReconcile, source: "manualRebuildWeeklyRanking" });
      } catch (eMeta) {
        console.warn("[manualRebuildWeeklyRanking] failed meta write:", eMeta && eMeta.message);
      }
    }
  }
);

/**
 * 수동 부분 집계 — TSS·TOP10 없이 피크·독주·거리만 따로 실행.
 * GET ?secret=stelvio-internal-sync-v1&phase=...
 *
 * phase:
 *   peak_monthly     — Max~60분 28일 전체 (21문서: 7구간×3성별)
 *   peak_duration    — 28일 단일 구간 (+ duration=max|1min|5min|10min|20min|40min|60min)
 *   personal_speed   — 독주 90일
 *   personal_dist    — 개인 거리 30일
 *
 * 진행: ranking_meta/manual_ranking_phase_rebuild
 */
exports.manualRebuildRankingPhase = onRequest(
  { cors: true, timeoutSeconds: 3600, memory: "2GiB" },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Internal-Secret");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const rawSecret = req.query.secret || req.headers["x-internal-secret"] || req.headers["X-Internal-Secret"];
    let authorized = rawSecret === INTERNAL_SYNC_SECRET;
    const db = admin.firestore();
    if (!authorized) {
      const uid = await getUidFromRequest(req, res);
      if (!uid) return;
      const callerSnap = await db.collection("users").doc(uid).get();
      const grade = callerSnap.exists ? String((callerSnap.data() || {}).grade ?? "2") : "2";
      if (grade !== "1") {
        res.status(403).json({ success: false, error: "관리자(grade=1) 권한이 필요합니다." });
        return;
      }
      authorized = true;
    }

    const phase = String(req.query.phase || req.body?.phase || "")
      .trim()
      .toLowerCase();
    const duration = String(req.query.duration || req.body?.duration || "").trim();
    const validPhases = ["peak_monthly", "peak_duration", "personal_speed", "personal_dist"];
    if (!validPhases.includes(phase)) {
      res.status(400).json({
        success: false,
        error: "phase 필수: peak_monthly | peak_duration | personal_speed | personal_dist",
        durations: Object.keys(DURATION_FIELDS),
      });
      return;
    }
    if (phase === "peak_duration" && !DURATION_FIELDS[duration]) {
      res.status(400).json({
        success: false,
        error: "peak_duration 은 duration 필수",
        durations: Object.keys(DURATION_FIELDS),
      });
      return;
    }

    const startedAt = new Date().toISOString();
    const r90 = getRolling90DaysRangeSeoul();
    res.status(202).json({
      success: true,
      accepted: true,
      startedAt,
      phase,
      duration: phase === "peak_duration" ? duration : null,
      rolling90: r90,
      checkMetaDoc: `ranking_meta/${RANKING_PHASE_REBUILD_META_DOC}`,
      message: "부분 집계 시작. Firestore manual_ranking_phase_rebuild 의 status·progressAt 확인.",
    });

    try {
      let r;
      if (phase === "peak_monthly") {
        r = await runRankingAggregatePeakMonthly28d(db, null, {
          skipRollupBatch: true,
          skipUsersFetch: true,
          allowLegacyFallback: false,
        });
      } else if (phase === "peak_duration") {
        r = await runRankingAggregatePeakMonthlyOneDuration(db, duration);
      } else if (phase === "personal_speed") {
        r = await runRankingAggregatePersonalSpeed28d(db, null, { fromBucketsOnly: true });
      } else {
        r = await runRankingAggregatePersonalDist30d(db);
      }
      console.log("[manualRebuildRankingPhase] 완료", JSON.stringify({ startedAt, ...r }));
    } catch (e) {
      console.error("[manualRebuildRankingPhase]", phase, e && e.message ? e.message : e);
      try {
        await markManualRankingPhaseMeta(db, phase, "failed", {
          lastError: e && e.message ? e.message : String(e),
          duration: phase === "peak_duration" ? duration : null,
        });
      } catch (eMeta) {
        console.warn("[manualRebuildRankingPhase] failed meta write:", eMeta && eMeta.message);
      }
    }
  }
);

/** KST 09:00 — 주간 마일리지 TOP10·TSS 보드 전체 재집계 (낮 1회, 03:40 마스터와 별도) */
exports.scheduledWeeklyTop10PeakRefresh = onSchedule(
  {
    schedule: WEEKLY_MILEAGE_TOP10_DAYTIME_CRON,
    timeZone: "Asia/Seoul",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  async () => {
    const db = admin.firestore();
    try {
      if (!(await shouldRunFirebaseRankingScheduledJob(db, "scheduledWeeklyTop10PeakRefresh"))) {
        console.log(
          "[scheduledWeeklyTop10PeakRefresh] Supabase pg_cron 09:00 KST primary — Functions RPC fallback"
        );
        const r = await runSupabaseWeeklyTssDaytimePipeline(
          db,
          "[scheduledWeeklyTop10PeakRefresh-supabase]"
        );
        console.log("[scheduledWeeklyTop10PeakRefresh] supabase daytime ok", r);
        return;
      }
      const r = await refreshWeeklyMileageTop10AggregatesOnly(db);
      console.log("[scheduledWeeklyTop10PeakRefresh] 09:00 KST TOP10 refresh", r);
    } catch (e) {
      console.error("[scheduledWeeklyTop10PeakRefresh]", e && e.message ? e.message : e);
      throw e;
    }
  }
);

/** @deprecated KST 00:05 증분 스케줄 제거 — TOP10은 03:40 마스터 + 09:00 2회만 갱신. refreshWeeklyTssMidnightIncremental()은 수동용 유지 */

/** KST 04:45·21:45 — 이번 주 활동 사용자 전원 Supabase 주간 TSS parity (Strava 지연 수집 보정) */
const scheduledWeeklyTssSupabaseParityOptions = supabaseDualWriteServer.appendServiceRoleSecret({
  schedule: "45 4,21 * * *",
  timeZone: "Asia/Seoul",
  memory: "1GiB",
  timeoutSeconds: 1800,
});
exports.scheduledWeeklyTssSupabaseParity = onSchedule(
  scheduledWeeklyTssSupabaseParityOptions,
  async () => {
    if (!shouldRunSupabaseWeeklyTssParitySchedule()) {
      console.log("[scheduledWeeklyTssSupabaseParity] skipped (env disabled)");
      return;
    }
    const db = admin.firestore();
    try {
      await runWeeklyTssSupabaseParityScheduledJob(db, "[scheduledWeeklyTssSupabaseParity]");
    } catch (e) {
      console.error("[scheduledWeeklyTssSupabaseParity]", e && e.message ? e.message : e);
      throw e;
    }
  }
);

/**
 * KST 02:50 — Strava 00:10 갭 탐지 직후 peak_28d rollup → 피크 보드(21) → 헵타곤 GC.
 * 23:00 마스터 타임아웃·고착 시에도 Max~60분·7축이 당일 갱신되도록 분리.
 */
/** KST 02:50 — 28일 피크 보드만 (헵타곤은 03:20 별도 스케줄, 9분 한도 회피) */
exports.scheduledPeak28dBoardAndHeptagon = onSchedule(
  {
    schedule: "50 2 * * *",
    timeZone: "Asia/Seoul",
    memory: "2GiB",
    timeoutSeconds: 1800,
  },
  async () => {
    const db = admin.firestore();
    const dateKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    try {
      if (!(await shouldRunFirebaseRankingScheduledJob(db, "scheduledPeak28dBoardAndHeptagon"))) return;
      await db.collection("ranking_meta").doc("peak_28d_board_refresh").set(
        {
          dateKst,
          status: "running",
          runningAt: admin.firestore.FieldValue.serverTimestamp(),
          step: "peak_only",
        },
        { merge: true }
      );
      const peakRes = await runRankingAggregatePeakMonthly28d(db, null, {
        ensureMissingDays: false,
        skipRollupBatch: true,
        skipUsersFetch: true,
        allowLegacyFallback: false,
      });
      console.log("[scheduledPeak28dBoardAndHeptagon] peak boards", peakRes);
      await db.collection("ranking_meta").doc("peak_28d_board_refresh").set(
        {
          dateKst,
          status: "complete",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          runningAt: admin.firestore.FieldValue.delete(),
          peakSummary: peakRes,
          note: "heptagon_scheduled_at_0320",
        },
        { merge: true }
      );
      console.log("[scheduledPeak28dBoardAndHeptagon] peak ok (heptagon → scheduledPeak28dHeptagonOnly)", peakRes);
    } catch (e) {
      console.error("[scheduledPeak28dBoardAndHeptagon]", e && e.message ? e.message : e);
      try {
        await db.collection("ranking_meta").doc("peak_28d_board_refresh").set(
          {
            dateKst,
            status: "failed",
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            runningAt: admin.firestore.FieldValue.delete(),
            lastError: e && e.message ? String(e.message).slice(0, 2000) : String(e),
          },
          { merge: true }
        );
      } catch (_eM) {}
      throw e;
    }
  }
);

/** peak_28d rollup 청크 백필 — Supabase pg_cron stelvio_ranking_metrics_backfill_chunk 로 이관 (2026-06-28). */

/** KST 03:20 — 02:50 피크 보드 이후 헵타곤 GC (단독 9분) */
exports.scheduledPeak28dHeptagonOnly = onSchedule(
  {
    schedule: "20 3 * * *",
    timeZone: "Asia/Seoul",
    memory: "2GiB",
    timeoutSeconds: 540,
  },
  async () => {
    const db = admin.firestore();
    try {
      if (!(await shouldRunFirebaseRankingScheduledJob(db, "scheduledPeak28dHeptagonOnly"))) return;
      await markHeptagonRebuildRunning(db);
      const heptRes = await runHeptagonCohortRanksRebuildJob();
      await markHeptagonDailyRebuildComplete(db, heptRes);
      console.log("[scheduledPeak28dHeptagonOnly] ok", heptRes);
    } catch (e) {
      console.error("[scheduledPeak28dHeptagonOnly]", e && e.message ? e.message : e);
      try {
        await markHeptagonRebuildFailed(db, e);
      } catch (_eH) {}
      throw e;
    }
  }
);

/**
 * KST 03:40 — Strava 00:10·Supabase 03:15 집계 후 Firebase vs Supabase 랭킹 정합성 리포트.
 * ranking_meta/supabase_parity_audit 에 저장 (네이버 결제·Strava 스케줄 본체는 변경 없음).
 */
const scheduledRankingParityAuditOptions =
  supabaseDualWriteServer.appendServiceRoleSecret({
    schedule: "40 3 * * *",
    timeZone: "Asia/Seoul",
    memory: "512MiB",
    timeoutSeconds: 300,
  });
/**
 * 관리자(grade=1): 랭킹·집계 Read DB 전환 — appConfig/supabase_read_routing
 * GET: 현재 readSource(firebase|supabase) · POST/JSON body: { readSource: "firebase"|"supabase" }
 */
exports.adminSupabaseReadRouting = onRequest(
  { cors: true, timeoutSeconds: 30 },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).json({ success: false, error: "GET 또는 POST만 지원합니다." });
      return;
    }

    const uid = await getUidFromRequest(req, res);
    if (!uid) return;

    try {
      await rankingReadRoutingAdmin.assertAdminGrade1(admin, uid);
      const payload = await rankingReadRoutingAdmin.handleAdminSupabaseReadRouting(
        admin,
        req,
        req.method,
        uid
      );
      res.status(200).json(payload);
    } catch (e) {
      const status = e.status || 500;
      console.warn("[adminSupabaseReadRouting]", e.message || e);
      res.status(status).json({
        success: false,
        error: e.message || String(e),
      });
    }
  }
);

/**
 * 관리자(grade=1): Firebase 표시용 랭킹 사전집계 스케줄 ON/OFF.
 * 기본은 Supabase 모드(OFF). POST { mode:"firebase", firebaseScheduledEnabled:true } 로 긴급 활성화.
 */
exports.adminRankingAggregationControl = onRequest(
  { cors: true, timeoutSeconds: 30 },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).json({ success: false, error: "GET 또는 POST만 지원합니다." });
      return;
    }

    const uid = await getUidFromRequest(req, res);
    if (!uid) return;

    try {
      await rankingReadRoutingAdmin.assertAdminGrade1(admin, uid);
      const db = admin.firestore();
      const ref = db
        .collection(RANKING_AGGREGATION_CONTROL_DOC.collection)
        .doc(RANKING_AGGREGATION_CONTROL_DOC.doc);

      if (req.method === "POST") {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const modeRaw = String(body.mode || req.query.mode || "").trim().toLowerCase();
        const mode = modeRaw === "firebase" ? "firebase" : "supabase";
        const firebaseScheduledEnabled =
          body.firebaseScheduledEnabled != null
            ? body.firebaseScheduledEnabled === true || String(body.firebaseScheduledEnabled).toLowerCase() === "true"
            : mode === "firebase";
        const next = {
          mode,
          firebaseScheduledEnabled,
          disabledJobs: body.disabledJobs && typeof body.disabledJobs === "object" ? body.disabledJobs : {},
          enabledJobs: body.enabledJobs && typeof body.enabledJobs === "object" ? body.enabledJobs : {},
          updatedBy: uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await ref.set(next, { merge: true });
      }

      const snap = await ref.get();
      res.status(200).json({
        success: true,
        docPath: `${RANKING_AGGREGATION_CONTROL_DOC.collection}/${RANKING_AGGREGATION_CONTROL_DOC.doc}`,
        defaultMode: "supabase",
        control: snap.exists ? snap.data() : { mode: "supabase", firebaseScheduledEnabled: false },
        emergencyEnableExample: {
          mode: "firebase",
          firebaseScheduledEnabled: true,
          disabledJobs: {},
          enabledJobs: {},
        },
      });
    } catch (e) {
      const status = e.status || 500;
      console.warn("[adminRankingAggregationControl]", e.message || e);
      res.status(status).json({
        success: false,
        error: e.message || String(e),
      });
    }
  }
);

/**
 * 관리자(grade=1): Supabase public.users.firebase_uid 역매핑 1회/보정 동기화.
 * 랭킹 조회·스냅샷 생성이 Firestore users 전체 스캔 없이 Supabase만으로 동작하게 한다.
 */
exports.adminSyncSupabaseFirebaseUidMap = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 540, memory: "1GiB" }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST만 지원합니다." });
      return;
    }

    const uid = await getUidFromRequest(req, res);
    if (!uid) return;

    try {
      await rankingReadRoutingAdmin.assertAdminGrade1(admin, uid);
      const db = admin.firestore();
      const snap = await db.collection("users").select().get();
      const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
      const uidConfig = {
        uidNamespace: supabaseDualWriteServer.uidNamespaceParam.value(),
        uidMode: supabaseDualWriteServer.uidModeParam.value() === "literal" ? "literal" : "v5",
      };
      const rows = snap.docs
        .map((doc) => {
          const supabaseId = supabaseDualWriteServer.resolveUserUuid(
            doc.id,
            uidConfig.uidNamespace,
            uidConfig.uidMode
          );
          return supabaseId ? { id: supabaseId, firebase_uid: doc.id } : null;
        })
        .filter(Boolean);

      let updated = 0;
      for (let i = 0; i < rows.length; i += 25) {
        const chunk = rows.slice(i, i + 25);
        await Promise.all(chunk.map(async (row) => {
          const { error } = await supabase
            .from("users")
            .update({ firebase_uid: row.firebase_uid })
            .eq("id", row.id);
          if (error) throw error;
          updated += 1;
        }));
      }

      res.status(200).json({
        success: true,
        scanned: snap.size,
        updated,
        message: "Supabase users.firebase_uid 역매핑 동기화 완료",
      });
    } catch (e) {
      const status = e.status || 500;
      console.warn("[adminSyncSupabaseFirebaseUidMap]", e.message || e);
      res.status(status).json({
        success: false,
        error: e.message || String(e),
      });
    }
  }
);

/**
 * 관리자(grade=1): Firestore users/{uid}/logs 의 Strava 로그를 Supabase rides로 재전송.
 * dual_write_status와 무관하게 STRAVA ingest 백필은 강제 실행한다.
 */
exports.adminBackfillStravaLogsToSupabase = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 3600, memory: "1GiB" }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST만 지원합니다." });
      return;
    }

    const callerUid = await getUidFromRequest(req, res);
    if (!callerUid) return;

    try {
      await rankingReadRoutingAdmin.assertAdminGrade1(admin, callerUid);
      const db = admin.firestore();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const targetUsers = String(body.targetUsers || req.query.targetUsers || "").trim().toLowerCase();
      const requestedUid = String(body.uid || body.userId || req.query.uid || req.query.userId || "").trim();
      const startDate = String(body.startDate || req.query.startDate || "").trim();
      const endDate = String(body.endDate || req.query.endDate || "").trim();
      const startAfterUid = String(body.startAfterUid || req.query.startAfterUid || "").trim();
      const dryRun = String(body.dryRun ?? req.query.dryRun ?? "false").toLowerCase() === "true";
      const maxUsers = Math.max(1, Math.min(300, Number(body.maxUsers || req.query.maxUsers || 50) || 50));
      const maxLogsPerUser = Math.max(
        1,
        Math.min(3000, Number(body.maxLogsPerUser || req.query.maxLogsPerUser || 1000) || 1000)
      );

      let userDocs = [];
      if (targetUsers === "all") {
        let usersQuery = db
          .collection("users")
          .orderBy(admin.firestore.FieldPath.documentId())
          .limit(maxUsers);
        if (startAfterUid) usersQuery = usersQuery.startAfter(startAfterUid);
        const usersSnap = await usersQuery.get();
        userDocs = usersSnap.docs;
      } else {
        const uid = requestedUid || callerUid;
        const userSnap = await db.collection("users").doc(uid).get();
        if (!userSnap.exists) {
          res.status(404).json({ success: false, error: "대상 사용자를 찾을 수 없습니다." });
          return;
        }
        userDocs = [userSnap];
      }

      let scannedUsers = 0;
      let provisionedUsers = 0;
      let scannedLogs = 0;
      let migratedLogs = 0;
      let skippedLogs = 0;
      let failedLogs = 0;
      let truncatedUsers = 0;
      const errors = [];

      for (const userDoc of userDocs) {
        const userId = userDoc.id;
        scannedUsers += 1;
        if (!dryRun) {
          try {
            await supabaseUserProvision.provisionSupabaseUserAfterProfile(admin, userId);
            provisionedUsers += 1;
          } catch (e) {
            errors.push({
              userId,
              phase: "provision",
              message: e && e.message ? e.message : String(e),
            });
          }
        }

        const logsSnap = await db
          .collection("users")
          .doc(userId)
          .collection("logs")
          .where("source", "==", "strava")
          .limit(maxLogsPerUser)
          .get();
        if (logsSnap.size >= maxLogsPerUser) truncatedUsers += 1;

        for (const logDoc of logsSnap.docs) {
          const log = logDoc.data() || {};
          const dateStr = rankingDayRollup.normalizeLogDateToSeoulYmd(log.date);
          if (startDate && dateStr && dateStr < startDate) {
            skippedLogs += 1;
            continue;
          }
          if (endDate && dateStr && dateStr > endDate) {
            skippedLogs += 1;
            continue;
          }
          scannedLogs += 1;
          if (dryRun) continue;
          try {
            const result = await supabaseDualWriteServer.runSecondaryAfterStravaLogSave(
              admin,
              userId,
              logDoc.id,
              log,
              { force: true }
            );
            if (result && result.skipped) skippedLogs += 1;
            else migratedLogs += 1;
          } catch (e) {
            failedLogs += 1;
            if (errors.length < 30) {
              errors.push({
                userId,
                logId: logDoc.id,
                activityId: log.activity_id || null,
                date: log.date || null,
                message: e && e.message ? e.message : String(e),
              });
            }
          }
        }
      }

      let parityUsers = 0;
      let parityRidesSynced = 0;
      let parityBucketsSynced = 0;
      if (!dryRun && startDate && endDate) {
        const parityUserIds = userDocs.map((d) => d.id);
        try {
          const parity = await supabaseDualWriteServer.syncUsersWeeklyTssParityToSupabase(
            db,
            admin,
            parityUserIds,
            startDate,
            endDate
          );
          parityUsers = parityUserIds.length;
          parityRidesSynced = parity.ridesSynced;
          parityBucketsSynced = parity.bucketsSynced;
        } catch (parityErr) {
          errors.push({
            phase: "weekly_tss_parity",
            message: parityErr && parityErr.message ? parityErr.message : String(parityErr),
          });
        }
      }

      const lastUser = userDocs[userDocs.length - 1];
      res.status(200).json({
        success: true,
        dryRun,
        scannedUsers,
        provisionedUsers,
        scannedLogs,
        migratedLogs,
        skippedLogs,
        failedLogs,
        truncatedUsers,
        parityUsers,
        parityRidesSynced,
        parityBucketsSynced,
        nextStartAfterUid:
          targetUsers === "all" && userDocs.length === maxUsers && lastUser ? lastUser.id : null,
        errors,
      });
    } catch (e) {
      const status = e.status || 500;
      console.warn("[adminBackfillStravaLogsToSupabase]", e.message || e);
      res.status(status).json({
        success: false,
        error: e.message || String(e),
      });
    }
  }
);

/**
 * 관리자(grade=1): 이번 주(또는 지정 구간) ranking_day_totals 활동 사용자 전원
 * Firestore → Supabase 주간 TSS parity (rides + daily_summaries).
 * POST { startDate?, endDate?, offset?, limit?, dryRun? }
 */
exports.adminBackfillWeeklyTssSupabaseParity = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({
    cors: true,
    timeoutSeconds: 3600,
    memory: "1GiB",
  }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST만 지원합니다." });
      return;
    }

    const callerUid = await getUidFromRequest(req, res);
    if (!callerUid) return;

    try {
      await rankingReadRoutingAdmin.assertAdminGrade1(admin, callerUid);
      const db = admin.firestore();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const weekDefault = getWeekRangeSeoul();
      const startStr = String(body.startDate || req.query.startDate || weekDefault.startStr).slice(
        0,
        10
      );
      const endStr = String(body.endDate || req.query.endDate || weekDefault.endStr).slice(0, 10);
      const offset = Math.max(0, Number(body.offset || req.query.offset || 0) || 0);
      const limit = Math.max(1, Math.min(200, Number(body.limit || req.query.limit || 50) || 50));
      const dryRun = String(body.dryRun ?? req.query.dryRun ?? "false").toLowerCase() === "true";

      const activeUserIds = (
        await rankingDayRollup.findUserIdsWithRankingDayTotalsInRange(db, startStr, endStr)
      )
        .slice()
        .sort();
      const batch = activeUserIds.slice(offset, offset + limit);

      if (dryRun) {
        res.status(200).json({
          success: true,
          dryRun: true,
          startStr,
          endStr,
          totalActiveUsers: activeUserIds.length,
          batchSize: batch.length,
          offset,
          nextOffset: offset + batch.length < activeUserIds.length ? offset + batch.length : null,
        });
        return;
      }

      let ridesSynced = 0;
      let bucketsSynced = 0;
      if (batch.length > 0) {
        const parity = await supabaseDualWriteServer.syncUsersWeeklyTssParityToSupabase(
          db,
          admin,
          batch,
          startStr,
          endStr
        );
        ridesSynced = parity.ridesSynced;
        bucketsSynced = parity.bucketsSynced;
      }

      res.status(200).json({
        success: true,
        startStr,
        endStr,
        totalActiveUsers: activeUserIds.length,
        processedUsers: batch.length,
        offset,
        nextOffset: offset + batch.length < activeUserIds.length ? offset + batch.length : null,
        ridesSynced,
        bucketsSynced,
      });
    } catch (e) {
      const status = e.status || 500;
      console.warn("[adminBackfillWeeklyTssSupabaseParity]", e.message || e);
      res.status(status).json({
        success: false,
        error: e.message || String(e),
      });
    }
  }
);

/** 관리자(grade=1): Supabase 비-GC 랭킹 등락 스냅샷 즉시 재생성. */
exports.adminRebuildSupabaseRankSnapshots = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 300, memory: "512MiB" }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST만 지원합니다." });
      return;
    }

    const uid = await getUidFromRequest(req, res);
    if (!uid) return;

    try {
      await rankingReadRoutingAdmin.assertAdminGrade1(admin, uid);
      const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
      const { error } = await supabase.rpc("fn_rebuild_peak_rank_board_snapshots");
      if (error) throw error;
      res.status(200).json({
        success: true,
        message: "Supabase peak_rank_board_snapshots 재생성 완료",
      });
    } catch (e) {
      const status = e.status || 500;
      console.warn("[adminRebuildSupabaseRankSnapshots]", e.message || e);
      res.status(status).json({
        success: false,
        error: e.message || String(e),
      });
    }
  }
);

/**
 * 전 사용자 — 랭킹 Read DB (Firebase vs Supabase) 공개 조회.
 * 클라이언트 IndexedDB·API 캐시 네임스페이스 분리용.
 */
exports.getRankingReadRoutingPublic = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 15 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Cache-Control", "public, max-age=60, s-maxage=60");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }
    try {
      const payload = await rankingReadRoutingPublic.getPublicRankingReadRouting(admin);
      res.status(200).json(payload);
    } catch (e) {
      console.warn("[getRankingReadRoutingPublic]", e.message || e);
      res.status(500).json({
        success: false,
        error: e.message || String(e),
      });
    }
  }
);

/** Supabase pg_cron ranking_build_meta — IndexedDB 무효화·프리페치용 (Firestore ranking_meta 대체) */
exports.getRankingBuildMetaPublic = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 15 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Cache-Control", "public, max-age=30, s-maxage=30");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }
    try {
      const rankingBuildMetaSupabase = require("./rankingBuildMetaSupabase");
      const buildMeta = await rankingBuildMetaSupabase.fetchRankingBuildMetaFromSupabase();
      res.status(200).json({
        success: true,
        buildMetaSource: "supabase",
        buildMeta: {
          master: buildMeta.master,
          heptagon: buildMeta.heptagon,
          personalSpeed: buildMeta.personalSpeed,
          peak28d: buildMeta.peak28d,
          rankingMetricsLive: buildMeta.rankingMetricsLive,
        },
        buildMetaFingerprint: buildMeta.fingerprint || "",
        error: buildMeta.error || undefined,
      });
    } catch (e) {
      console.warn("[getRankingBuildMetaPublic]", e.message || e);
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * 러닝 랭킹보드 — Supabase RPC thin gateway (연산 없음).
 *
 * [사이클 영향 검토 — 2026-06-10]
 * - getWeeklyRanking / getPeakPowerRanking / rankingReadRouter: 미수정
 * - Firestore users/logs·rides·랭킹 집계: 미접촉
 * - Supabase public.rides·daily_summaries·MV: 미접촉
 * - supabase.rpc('get_running_leaderboard_published') — 일 1회(23:00 KST) 스냅샷 우선
 */
exports.getRunningLeaderboard = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 60 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }
    try {
      await supabaseDualWriteServer.refreshDualRunFromRemoteConfig(admin, true);
      const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
      const runningRankingMovement = require("./runningRankingMovement");
      const peakMovement = require("./rankingPeakMovement");
      const [lbRes, snapRes] = await Promise.all([
        supabase.rpc("get_running_leaderboard_published"),
        runningRankingMovement.fetchAllRunRankSnapshots(),
      ]);
      let { data, error } = lbRes;
      if (error) {
        console.error("[getRunningLeaderboard]", error);
        return res.status(500).json({ success: false, error: error.message });
      }
      let published =
        data && typeof data === "object" && !Array.isArray(data) ? data : {};
      let leaderboard = Array.isArray(published.leaderboard)
        ? published.leaderboard
        : Array.isArray(data)
          ? data
          : [];
      let leaderboardAsOfSeoul = published.as_of_seoul
        ? String(published.as_of_seoul).trim().slice(0, 10)
        : "";
      const todayKst = peakMovement.seoulTodayYmd();
      if (
        (published.source === "snapshot" || !published.source) &&
        leaderboardAsOfSeoul &&
        leaderboardAsOfSeoul < todayKst
      ) {
        const liveRes = await supabase.rpc("get_running_leaderboard");
        if (!liveRes.error && Array.isArray(liveRes.data)) {
          leaderboard = liveRes.data;
          leaderboardAsOfSeoul = todayKst;
          published = {
            source: "live",
            aggregated_at: new Date().toISOString(),
          };
        }
      }
      // 요청 URL 이 일자(d)·비공개버전(pv)로 캐시가 무효화되므로 장기 캐시로 함수 호출을 최소화.
      // - 매일(KST 날짜 변경) 1회 자동 갱신, 비공개 토글 시 pv 증가로 즉시 갱신.
      // - 라이브 폴백 응답은 좀 더 짧게 유지.
      const cacheMaxAge = published.source === "live" ? 300 : 86400;
      res.set("Cache-Control", `public, max-age=${cacheMaxAge}, s-maxage=${cacheMaxAge}`);
      return res.status(200).json({
        success: true,
        leaderboard,
        leaderboardSource: published.source || "snapshot",
        leaderboardAsOfSeoul,
        leaderboardAggregatedAt: published.aggregated_at || "",
        rankMovementSource: "supabase",
        rankMovementAsOfSeoul: snapRes.asOfSeoul || leaderboardAsOfSeoul || "",
        rankMovementByKey: snapRes.byKey || {},
      });
    } catch (e) {
      console.error("[getRunningLeaderboard]", e);
      return res.status(500).json({
        success: false,
        error: e && e.message ? e.message : String(e),
      });
    }
  }
);

/**
 * Phase 6 — 훈련 로그 Read DB (Firebase logs vs Supabase rides) 공개 조회.
 */
exports.getLogsReadRoutingPublic = onRequest(
  { cors: true, timeoutSeconds: 15 },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Cache-Control", "public, max-age=60, s-maxage=60");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }
    try {
      const payload = await logsReadRoutingPublic.getPublicLogsReadRouting(admin);
      res.status(200).json(payload);
    } catch (e) {
      console.warn("[getLogsReadRoutingPublic]", e.message || e);
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * 전 사용자 — 라이딩 모임 Read DB (Firebase vs Supabase) 공개 조회.
 */
exports.getGroupsReadRoutingPublic = onRequest(
  { cors: true, timeoutSeconds: 15 },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Cache-Control", "public, max-age=60, s-maxage=60");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }
    try {
      const payload = await groupReadRoutingPublic.getPublicGroupsReadRouting(admin);
      res.status(200).json(payload);
    } catch (e) {
      console.warn("[getGroupsReadRoutingPublic]", e.message || e);
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * 오픈 라이딩 단건 Read — Supabase Canary → Firebase 폴백 (Firestore JSON 형태).
 */
exports.getOpenRideForRead = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 30 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }
    const db = admin.firestore();
    const rideId = String(req.query.rideId || req.query.id || "").trim();
    if (!rideId) {
      res.status(400).json({ success: false, error: "rideId 필요" });
      return;
    }
    try {
      const fromSb = await groupReadRouter.tryFetchOpenRideFromSupabase(admin, db, req.query);
      if (fromSb) {
        res.status(200).json(fromSb);
        return;
      }
      const fromFb = await groupReadRouter.fetchOpenRideFromFirebase(db, rideId);
      if (fromFb) {
        res.status(200).json(fromFb);
        return;
      }
      res.status(404).json({ success: false, error: "not_found" });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * 기간 내 오픈 라이딩 목록 Read — Supabase Canary → Firebase 폴백.
 */
exports.getOpenRidesInDateRangeForRead = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 45 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }
    const db = admin.firestore();
    const startStr = String(req.query.startStr || req.query.start || "").trim();
    const endStr = String(req.query.endStr || req.query.end || "").trim();
    if (!startStr || !endStr) {
      res.status(400).json({ success: false, error: "startStr, endStr 필요 (YYYY-MM-DD)" });
      return;
    }
    try {
      const fromSb = await groupReadRouter.tryFetchOpenRidesRangeFromSupabase(
        admin,
        db,
        req.query
      );
      if (fromSb) {
        res.status(200).json(fromSb);
        return;
      }
      const from = admin.firestore.Timestamp.fromDate(new Date(startStr + "T00:00:00+09:00"));
      const to = admin.firestore.Timestamp.fromDate(new Date(endStr + "T23:59:59+09:00"));
      const snap = await db
        .collection("rides")
        .where("date", ">=", from)
        .where("date", "<=", to)
        .orderBy("date", "asc")
        .get();
      const rides = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        readBackend: "firebase",
      }));
      res.status(200).json({
        success: true,
        rides,
        startStr,
        endStr,
        readBackend: "firebase",
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * 훈련일지 달력 Read — Supabase rides (Service Role relay, Auth Bridge 불필요).
 * GET ?uid=&limit=200  또는  ?uid=&year=&month=
 */
exports.getTrainingLogsForRead = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 30 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }

    const requestedUid = String(req.query.uid || req.query.userId || "").trim();
    if (!requestedUid) {
      res.status(400).json({ success: false, error: "uid 필요" });
      return;
    }

    const callerUid = await getUidFromRequest(req, res);
    if (!callerUid) return;
    if (String(callerUid).trim() !== requestedUid) {
      res.status(403).json({ success: false, error: "본인 라이딩 로그만 조회할 수 있습니다." });
      return;
    }

    const yearRaw = req.query.year;
    const monthRaw = req.query.month;
    const hasMonth =
      yearRaw != null &&
      String(yearRaw).trim() !== "" &&
      monthRaw != null &&
      String(monthRaw).trim() !== "";

    try {
      let logs;
      if (hasMonth) {
        logs = await supabaseGroupReader.fetchUserRideLogsForMonth(
          requestedUid,
          Number(yearRaw),
          Number(monthRaw)
        );
      } else {
        const limit = Number(req.query.limit) || 200;
        logs = await supabaseGroupReader.fetchUserRideLogsRecent(requestedUid, limit);
      }
      res.status(200).json({
        success: true,
        logs,
        readBackend: "supabase",
        readSource: "supabase",
        via: "service_role_relay",
      });
    } catch (e) {
      console.warn("[getTrainingLogsForRead]", e.message || e);
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * RUN 구간 피크 Read — Supabase run_activity_efforts (Service Role relay).
 * GET ?uid=&limit=400
 */
exports.getRunEffortsForRead = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 30 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }

    const requestedUid = String(req.query.uid || req.query.userId || "").trim();
    if (!requestedUid) {
      res.status(400).json({ success: false, error: "uid 필요" });
      return;
    }

    const callerUid = await getUidFromRequest(req, res);
    if (!callerUid) return;
    if (String(callerUid).trim() !== requestedUid) {
      res.status(403).json({ success: false, error: "본인 러닝 구간 기록만 조회할 수 있습니다." });
      return;
    }

    try {
      const limit = Number(req.query.limit) || 400;
      const efforts = await supabaseGroupReader.fetchUserRunEffortsRecent(requestedUid, limit);
      res.status(200).json({
        success: true,
        efforts,
        readBackend: "supabase",
        readSource: "supabase",
        via: "service_role_relay",
      });
    } catch (e) {
      console.warn("[getRunEffortsForRead]", e.message || e);
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * RUN 훈련 로그 Read — Supabase activities (Service Role relay).
 * GET ?uid=&limit=400
 */
exports.getRunActivitiesForRead = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 30 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }

    const requestedUid = String(req.query.uid || req.query.userId || "").trim();
    if (!requestedUid) {
      res.status(400).json({ success: false, error: "uid 필요" });
      return;
    }

    const callerUid = await getUidFromRequest(req, res);
    if (!callerUid) return;
    if (String(callerUid).trim() !== requestedUid) {
      res.status(403).json({ success: false, error: "본인 러닝 활동만 조회할 수 있습니다." });
      return;
    }

    try {
      const limit = Number(req.query.limit) || 400;
      const logs = await supabaseGroupReader.fetchUserRunActivitiesRecent(requestedUid, limit);
      res.status(200).json({
        success: true,
        logs,
        readBackend: "supabase",
        readSource: "supabase",
        via: "service_role_relay",
      });
    } catch (e) {
      console.warn("[getRunActivitiesForRead]", e.message || e);
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * RUN 주간 TSS Read — Supabase activities.tss (오늘 포함 최근 7일)
 * GET ?uid=
 */
exports.getRunWeeklyTssForRead = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 30 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }

    const requestedUid = String(req.query.uid || req.query.userId || "").trim();
    if (!requestedUid) {
      res.status(400).json({ success: false, error: "uid 필요" });
      return;
    }

    const callerUid = await getUidFromRequest(req, res);
    if (!callerUid) return;
    if (String(callerUid).trim() !== requestedUid) {
      res.status(403).json({ success: false, error: "본인 러닝 TSS만 조회할 수 있습니다." });
      return;
    }

    try {
      const weekly = await supabaseGroupReader.fetchUserRunWeeklyTss(requestedUid);
      res.status(200).json({
        success: true,
        weeklyTss: weekly.totalTss,
        fromYmd: weekly.fromYmd,
        toYmd: weekly.toYmd,
        activityCount: weekly.activityCount,
        readBackend: "supabase",
        via: "service_role_relay",
      });
    } catch (e) {
      console.warn("[getRunWeeklyTssForRead]", e.message || e);
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * PR 표시용 yearly_peaks Read — Supabase (Service Role relay).
 * GET ?uid=&year=2026
 */
exports.getYearlyPeaksForRead = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 30 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }

    const requestedUid = String(req.query.uid || req.query.userId || "").trim();
    const yearRaw = req.query.year;
    const yearNum = Number(yearRaw);
    if (!requestedUid || !Number.isFinite(yearNum)) {
      res.status(400).json({ success: false, error: "uid, year 필요" });
      return;
    }

    const callerUid = await getUidFromRequest(req, res);
    if (!callerUid) return;
    if (String(callerUid).trim() !== requestedUid) {
      res.status(403).json({ success: false, error: "본인 yearly_peaks만 조회할 수 있습니다." });
      return;
    }

    try {
      const peaks = await supabaseGroupReader.fetchYearlyPeaksForYear(requestedUid, yearNum);
      res.status(200).json({
        success: true,
        year: yearNum,
        peaks: peaks || null,
        readBackend: "supabase",
        via: "service_role_relay",
      });
    } catch (e) {
      console.warn("[getYearlyPeaksForRead]", e.message || e);
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * Firestore users/logs → Supabase rides 백필 (Dual-Write 누락 보정).
 * POST { userId?, date?: "YYYY-MM-DD" } — userId 생략 시 호출자 본인, date 생략 시 오늘(서울)
 */
exports.backfillFirestoreRidesToSupabase = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 120 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST only" });
      return;
    }

    const callerUid = await getUidFromRequest(req, res);
    if (!callerUid) return;

    const db = admin.firestore();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const today = getTodayAfterBefore();
    const targetUid = String(body.userId || callerUid).trim();
    const dateYmd = String(body.date || today.dateFrom).slice(0, 10);

    if (targetUid !== String(callerUid).trim()) {
      const callerSnap = await db.collection("users").doc(callerUid).get();
      const grade = callerSnap.exists ? String((callerSnap.data() || {}).grade ?? "2") : "2";
      if (grade !== "1") {
        res.status(403).json({ success: false, error: "다른 사용자 백필은 관리자(grade=1)만 가능합니다." });
        return;
      }
    }

    try {
      try {
        const provision = require("./supabaseUserProvision");
        await provision.provisionSupabaseUserAfterProfile(admin, targetUid);
      } catch (provErr) {
        console.warn("[backfillFirestoreRidesToSupabase] provision skip:", provErr.message || provErr);
      }

      const logsSnap = await db
        .collection("users")
        .doc(targetUid)
        .collection("logs")
        .where("date", "==", dateYmd)
        .where("source", "==", "strava")
        .get();

      const results = [];
      for (const doc of logsSnap.docs) {
        const data = doc.data() || {};
        const actType = String(data.activity_type || "").trim().toLowerCase();
        if (["run", "swim", "walk", "trailrun", "weighttraining"].includes(actType)) {
          results.push({ id: doc.id, skipped: true, reason: "non_cycling" });
          continue;
        }
        try {
          const r = await supabaseDualWriteServer.runSecondaryAfterStravaLogSave(
            admin,
            targetUid,
            doc.id,
            data,
            { force: true }
          );
          results.push({ id: doc.id, ok: true, result: r });
        } catch (e) {
          results.push({ id: doc.id, ok: false, error: e.message || String(e) });
        }
      }

      res.status(200).json({
        success: true,
        userId: targetUid,
        date: dateYmd,
        processed: results.length,
        results,
      });
    } catch (e) {
      console.warn("[backfillFirestoreRidesToSupabase]", e.message || e);
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * 후기 전용 월별 라이딩 로그 Read — Firestore 훈련일지 반영 지연 시 Supabase rides에서 보강.
 * 요청자는 본인 로그만 조회 가능.
 */
exports.getOpenRideReviewLogsForRead = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 30 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }

    const requestedUid = String(req.query.uid || req.query.userId || "").trim();
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!requestedUid || !Number.isFinite(year) || !Number.isFinite(month)) {
      res.status(400).json({ success: false, error: "uid, year, month 필요" });
      return;
    }

    const callerUid = await getUidFromRequest(req, res);
    if (!callerUid) return;
    if (String(callerUid).trim() !== requestedUid) {
      res.status(403).json({ success: false, error: "본인 라이딩 로그만 조회할 수 있습니다." });
      return;
    }

    try {
      const logs = await supabaseGroupReader.fetchUserRideLogsForMonth(
        requestedUid,
        year,
        month
      );
      res.status(200).json({
        success: true,
        logs,
        readBackend: "supabase",
        readSource: "supabase",
      });
    } catch (e) {
      console.warn("[getOpenRideReviewLogsForRead]", e.message || e);
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * 소모임 단건 Read — Supabase Canary → Firebase 폴백 (Firestore JSON 형태).
 */
exports.getRidingGroupForRead = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 30 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }
    const db = admin.firestore();
    const groupId = String(req.query.groupId || req.query.id || "").trim();
    if (!groupId) {
      res.status(400).json({ success: false, error: "groupId 필요" });
      return;
    }
    const includeJoinRequests =
      req.query.includeJoinRequests === "1" || req.query.includeJoinRequests === "true";
    try {
      const fromSb = await groupReadRouter.tryFetchRidingGroupFromSupabase(admin, db, req.query);
      if (fromSb) {
        res.status(200).json(fromSb);
        return;
      }
      const fromFb = await groupReadRouter.fetchRidingGroupFromFirebase(db, groupId, {
        includeMembers: true,
        includeJoinRequests,
      });
      if (fromFb) {
        res.status(200).json(fromFb);
        return;
      }
      res.status(404).json({ success: false, error: "not_found" });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * 승인된 소모임 목록 Read — Supabase Canary → Firebase 폴백.
 */
exports.getApprovedRidingGroupsForRead = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 45 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }
    const db = admin.firestore();
    try {
      const fromSb = await groupReadRouter.tryFetchApprovedRidingGroupsFromSupabase(
        admin,
        db,
        req.query
      );
      if (fromSb) {
        res.status(200).json(fromSb);
        return;
      }
      const snap = await db
        .collection("stelvio_riding_groups")
        .where("status", "==", "APPROVED")
        .orderBy("createdAt", "desc")
        .limit(Math.min(Number(req.query.limit) || 200, 500))
        .get();
      const groups = snap.docs.map((d) => ({ id: d.id, ...d.data(), readBackend: "firebase" }));
      res.status(200).json({ success: true, groups, readBackend: "firebase" });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * 내 소mo임 목록 Read — Supabase 우선(Canary 무관) → Firebase 1회 배치 폴백.
 * Firestore U×G onSnapshot 대체.
 */
exports.getMyRidingGroupsForRead = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 45 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }
    const db = admin.firestore();
    const uid = String(req.query.uid || req.query.userId || "").trim();
    if (!uid) {
      res.status(400).json({ success: false, error: "uid 필요" });
      return;
    }
    try {
      const fromSb = await groupReadRouter.tryFetchMyRidingGroupsFromSupabase(admin, req.query);
      if (fromSb) {
        res.status(200).json(fromSb);
        return;
      }
      const groups = await groupReadRouter.fetchMyRidingGroupsFromFirebase(db, uid);
      res.status(200).json({
        success: true,
        groups,
        readBackend: "firebase",
        readSource: "firebase",
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * 클럽 UI — 보이는 그룹 중 내 멤버십 ID Set.
 */
exports.getMyGroupMembershipsForRead = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 30 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }
    const db = admin.firestore();
    const uid = String(req.query.uid || req.query.userId || "").trim();
    const rawIds = req.query.groupIds || req.query.ids || "";
    const groupIds = String(rawIds)
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!uid || !groupIds.length) {
      res.status(400).json({ success: false, error: "uid, groupIds 필요" });
      return;
    }
    try {
      const fromSb = await groupReadRouter.tryFetchMyGroupMembershipsFromSupabase(admin, req.query);
      if (fromSb) {
        res.status(200).json(fromSb);
        return;
      }
      const memberGroupIds = await groupReadRouter.fetchMyGroupMembershipsFromFirebase(
        db,
        uid,
        groupIds
      );
      res.status(200).json({
        success: true,
        memberGroupIds,
        readBackend: "firebase",
        readSource: "firebase",
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/**
 * 랭킹 소셜 — 내 소mo임 멤버 UID·프로필 맵 (M×K getDocs 대체).
 */
exports.getMyGroupContactSetForRead = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 45 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "GET") {
      res.status(405).json({ success: false, error: "GET만 지원합니다." });
      return;
    }
    const db = admin.firestore();
    const uid = String(req.query.uid || req.query.userId || "").trim();
    const rawIds = req.query.groupIds || req.query.ids || "";
    const groupIds = String(rawIds)
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!uid || !groupIds.length) {
      res.status(400).json({ success: false, error: "uid, groupIds 필요" });
      return;
    }
    try {
      const fromSb = await groupReadRouter.tryFetchMyGroupContactSetFromSupabase(admin, req.query);
      if (fromSb) {
        res.status(200).json(fromSb);
        return;
      }
      const payload = await groupReadRouter.fetchMyGroupContactSetFromFirebase(db, groupIds);
      res.status(200).json({
        success: true,
        uids: payload.uids,
        map: payload.map,
        readBackend: "firebase",
        readSource: "firebase",
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/** 클라이언트 Secondary relay — Firestore Primary 성공 후 open_rides upsert */
exports.ingestOpenRideDualWriteRelay = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 30 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST만 지원" });
      return;
    }
    try {
      const body = req.body || {};
      const firestoreDocId = String(body.firestoreDocId || "").trim();
      const rideData = body.rideData;
      const actorUid = String(body.actorUid || rideData?.hostUserId || "").trim();
      if (!firestoreDocId || !rideData) {
        res.status(400).json({ success: false, error: "firestoreDocId, rideData 필요" });
        return;
      }
      const result = await supabaseGroupDualWrite.runSecondaryAfterOpenRideWrite(
        admin,
        firestoreDocId,
        rideData,
        actorUid
      );
      res.status(200).json({ success: true, ...result });
    } catch (e) {
      console.warn("[ingestOpenRideDualWriteRelay]", e.message || e);
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

/** 클라이언트 Secondary relay — riding_groups upsert */
exports.ingestRidingGroupDualWriteRelay = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 30 }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST만 지원" });
      return;
    }
    try {
      const body = req.body || {};
      const firestoreDocId = String(body.firestoreDocId || "").trim();
      const groupData = body.groupData;
      const actorUid = String(body.actorUid || groupData?.createdBy || "").trim();
      if (!firestoreDocId || !groupData) {
        res.status(400).json({ success: false, error: "firestoreDocId, groupData 필요" });
        return;
      }
      const result = await supabaseGroupDualWrite.runSecondaryAfterRidingGroupWrite(
        admin,
        firestoreDocId,
        groupData,
        actorUid,
        {
          syncMembersFromFirestore: !!body.syncMembers,
          syncJoinRequestsFromFirestore: !!body.syncJoinRequests,
        }
      );
      res.status(200).json({ success: true, ...result });
    } catch (e) {
      console.warn("[ingestRidingGroupDualWriteRelay]", e.message || e);
      res.status(500).json({ success: false, error: e.message || String(e) });
    }
  }
);

Object.assign(exports, groupDualWriteTriggers);

exports.scheduledRankingParityAudit = onSchedule(
  scheduledRankingParityAuditOptions,
  async () => {
    const db = admin.firestore();
    try {
      await rankingParity.runNightlyParityAudit(admin, db, {
        getWeekRangeSeoul,
        getRolling28DaysRangeSeoul,
        getRolling90DaysRangeSeoul,
      });
    } catch (e) {
      console.error(
        "[scheduledRankingParityAudit]",
        e && e.message ? e.message : e
      );
      throw e;
    }
  }
);

// ---------- STELVIO 헵타곤·GC 랭킹: heptagon_cohort_ranks (일 1회 03:20 KST — scheduledPeak28dHeptagonOnly) ----------
const heptagonCohortRanks = require("./heptagonCohortRanks");

/** 스케줄·수동 배치 공통 — `scheduledPeak28dHeptagonOnly` / `manualRebuildHeptagonCohortRanks` */
async function runHeptagonCohortRanksRebuildJob() {
  const db = admin.firestore();
  const readAllowStaleForHeptagon = async (dbRef, cacheKey) =>
    readRankingAggregatePayloadAllowStale(dbRef, cacheKey, HEPTAGON_AGG_STALE_MS);
  return heptagonCohortRanks.runRebuildHeptagonCohortRanks(db, {
    getPeakPowerRankingEntries,
    getLeagueCategory,
    getRolling90DaysRangeSeoul,
    admin,
    readRankingAggregatePayloadIfFresh,
    readRankingAggregatePayloadAllowStale: readAllowStaleForHeptagon,
    buildPeakPowerAllDurationsForRangeAllGendersOnePass: buildPeakPowerFromPeak28dRollupsOnePass,
  });
}

/**
 * 수동: 28일 피크 보드(21) + 헵타곤 GC — step 분리 권장(553명·DEADLINE 방지).
 * GET/POST ?secret=... [&force=1] [&step=peak|heptagon|both]  기본 both(순차·60분)
 */
exports.manualPeak28dBoardAndHeptagon = onRequest(
  { cors: true, timeoutSeconds: 3600, memory: "2GiB" },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Internal-Secret");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    const rawSecret = req.query.secret || req.headers["x-internal-secret"] || req.headers["X-Internal-Secret"];
    if (rawSecret !== INTERNAL_SYNC_SECRET) {
      res.status(403).json({ success: false, error: "secret required" });
      return;
    }
    const forceRun =
      String(req.query?.force || req.body?.force || "").toLowerCase() === "true" ||
      String(req.query?.force || req.body?.force || "") === "1";
    const stepRaw = String(req.query?.step || req.body?.step || "both")
      .trim()
      .toLowerCase();
    const step = stepRaw === "peak" || stepRaw === "heptagon" ? stepRaw : "both";
    const db = admin.firestore();
    if (step !== "peak" && (await heptagonManualRebuildAlreadyRunning(db, { force: forceRun }))) {
      res.status(409).json({
        success: false,
        error: "헵타곤 running — ?force=1 후 재시도",
        checkMetaDoc: `ranking_meta/${RANKING_HEPTAGON_REBUILD_META_DOC}`,
      });
      return;
    }
    const dateKst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    let peakRes = null;
    let heptRes = null;
    try {
      if (step === "peak" || step === "both") {
        await db.collection("ranking_meta").doc("peak_28d_board_refresh").set(
          { dateKst, status: "running", runningAt: admin.firestore.FieldValue.serverTimestamp(), step },
          { merge: true }
        );
        peakRes = await runRankingAggregatePeakMonthly28d(db, null, {
          ensureMissingDays: false,
          skipRollupBatch: true,
          skipUsersFetch: true,
          allowLegacyFallback: false,
        });
        await db.collection("ranking_meta").doc("peak_28d_board_refresh").set(
          {
            dateKst,
            status: "complete",
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            runningAt: admin.firestore.FieldValue.delete(),
            peakSummary: peakRes,
            step,
          },
          { merge: true }
        );
        console.log("[manualPeak28dBoardAndHeptagon] peak done", peakRes);
      }
      if (step === "heptagon" || step === "both") {
        await markHeptagonRebuildRunning(db);
        heptRes = await runHeptagonCohortRanksRebuildJob();
        await markHeptagonDailyRebuildComplete(db, heptRes);
        console.log("[manualPeak28dBoardAndHeptagon] heptagon done", heptRes);
      }
      if (step === "both" && peakRes && heptRes) {
        await db.collection("ranking_meta").doc("peak_28d_board_refresh").set(
          { heptagonSummary: heptRes, source: "manualPeak28dBoardAndHeptagon" },
          { merge: true }
        );
      }
      res.status(200).json({
        success: true,
        step,
        peakRes,
        heptRes,
        message:
          step === "peak"
            ? "28일 피크 보드(21) 완료. 헵타곤은 step=heptagon 으로 실행."
            : step === "heptagon"
              ? "헵타곤 완료."
              : "피크·헵타곤 완료.",
        checkMetaDocs: ["ranking_meta/peak_28d_board_refresh", `ranking_meta/${RANKING_HEPTAGON_REBUILD_META_DOC}`],
      });
    } catch (e) {
      console.error("[manualPeak28dBoardAndHeptagon]", e && e.message ? e.message : e);
      const msg = e && e.message ? String(e.message).slice(0, 2000) : String(e);
      try {
        if (step === "peak" || step === "both") {
          await db.collection("ranking_meta").doc("peak_28d_board_refresh").set(
            {
              dateKst,
              status: "failed",
              failedAt: admin.firestore.FieldValue.serverTimestamp(),
              lastError: msg,
            },
            { merge: true }
          );
        }
        if (step === "heptagon" || step === "both") {
          await markHeptagonRebuildFailed(db, e);
        }
      } catch (_eMeta) {}
      res.status(500).json({ success: false, error: msg, step });
    }
  }
);

/** @deprecated 23:35 스케줄 제거 — `scheduledPeak28dHeptagonOnly`(03:20 KST) 로 대체. 수동은 manualRebuildHeptagonCohortRanks. */

/**
 * 수동: 헵타곤 코호트 스냅샷 + GC 랭킹용 `heptagon_cohort_ranks` 재빌드 (스케줄 본과 동일).
 * 인증:
 * - POST: `X-Internal-Secret`(INTERNAL_SYNC_SECRET) 또는 `?secret=` 또는 grade=1 Firebase Bearer.
 * - GET: `?secret=INTERNAL_SYNC_SECRET` 만 허용 (주소창·즐겨찾기용 — 시크릿이 URL/이력에 남음).
 * GET/POST https://<region>-stelvio-ai.cloudfunctions.net/manualRebuildHeptagonCohortRanks
 */
exports.manualRebuildHeptagonCohortRanks = onRequest(
  {
    cors: false,
    timeoutSeconds: 540,
    memory: "2GiB",
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const forceRun =
      String(req.query?.force || req.body?.force || "").toLowerCase() === "true" ||
      String(req.query?.force || req.body?.force || "") === "1";

    const runAccepted = async (db) => {
      if (await heptagonManualRebuildAlreadyRunning(db, { force: forceRun })) {
        res.status(409).json({
          success: false,
          error:
            "헵타곤 재집계가 이미 실행 중입니다. 25분 후 재시도하거나 ?force=1 로 고착 running 을 해제하세요.",
          checkMetaDoc: `ranking_meta/${RANKING_HEPTAGON_REBUILD_META_DOC}`,
        });
        return;
      }
      const startedAt = new Date().toISOString();
      res.status(202).json({
        success: true,
        accepted: true,
        startedAt,
        message:
          "헵타곤(GC) 재집계를 시작했습니다. 약 2~9분 후 ranking_meta/heptagon_daily_rebuild status=complete·heptagon_cohort_ranks asOfSeoul(오늘)을 확인하세요.",
        checkMetaDoc: `ranking_meta/${RANKING_HEPTAGON_REBUILD_META_DOC}`,
        logKeyword: "[runRebuildHeptagonCohortRanks] done",
      });
      try {
        await markHeptagonRebuildRunning(db);
        const r = await runHeptagonCohortRanksRebuildJob();
        await markHeptagonDailyRebuildComplete(db, r);
        console.log("[manualRebuildHeptagonCohortRanks] 완료", JSON.stringify({ ...r, startedAt }));
      } catch (err) {
        console.error("[manualRebuildHeptagonCohortRanks]", err && err.message ? err.message : err);
        await markHeptagonRebuildFailed(db, err);
      }
    };

    if (req.method === "GET") {
      if (req.query.secret !== INTERNAL_SYNC_SECRET) {
        res.status(403).json({
          success: false,
          error:
            "주소창은 GET 요청만 보냅니다. 내부용 시크릿이 필요합니다: URL에 ?secret=(INTERNAL_SYNC_SECRET과 동일 값) 추가, 또는 POST로 X-Internal-Secret 헤더를 보내세요.",
        });
        return;
      }
      try {
        const db = admin.firestore();
        await runAccepted(db);
      } catch (err) {
        console.error("[manualRebuildHeptagonCohortRanks]", err);
        res.status(500).json({
          success: false,
          error: err && err.message ? err.message : String(err),
        });
      }
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({
        success: false,
        error: "GET(?secret=) 또는 POST 로 호출하세요. Bearer 관리자는 POST 전용입니다.",
      });
      return;
    }
    try {
      const db = admin.firestore();
      const rawSecret =
        req.headers["x-internal-secret"] ||
        req.headers["X-Internal-Secret"] ||
        req.query.secret;
      let authorized = rawSecret === INTERNAL_SYNC_SECRET;

      if (!authorized) {
        const uid = await getUidFromRequest(req, res);
        if (!uid) return;
        const callerSnap = await db.collection("users").doc(uid).get();
        const grade = callerSnap.exists ? String((callerSnap.data() || {}).grade ?? "2") : "2";
        if (grade !== "1") {
          res.status(403).json({
            success: false,
            error: "관리자(grade=1) 또는 X-Internal-Secret 헤더가 필요합니다.",
          });
          return;
        }
        authorized = true;
      }

      await runAccepted(db);
    } catch (err) {
      console.error("[manualRebuildHeptagonCohortRanks]", err);
      res.status(500).json({
        success: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  }
);

/**
 * [1회성 검증] 순위 등락 미리보기 — 읽기 전용, Firestore 쓰기 없음.
 *
 * 현재 `heptagon_cohort_ranks` 의 sumPositionScores 로 새 순위를 재계산해
 * "rebuildHeptagonCohortRanks 실행 시 어떤 rankChange 가 기록될지" 미리 확인합니다.
 *
 * GET https://<region>-stelvio-ai.cloudfunctions.net/previewHeptagonRankChanges
 *   ?secret=stelvio-internal-sync-v1
 *   &gender=all          (all|M|F, 기본 all)
 *   &category=Supremo    (Supremo|Assoluto|Bianco|Rosa|Infinito|Leggenda, 기본 Supremo)
 *   &limit=50            (최대 200, 기본 50)
 */
exports.previewHeptagonRankChanges = onRequest(
  { cors: false, timeoutSeconds: 120, memory: "512MiB" },
  async (req, res) => {
    const secret = req.query.secret || req.headers["x-internal-secret"] || req.headers["X-Internal-Secret"];
    if (secret !== INTERNAL_SYNC_SECRET) {
      res.status(403).json({ success: false, error: "?secret= 값이 올바르지 않습니다." });
      return;
    }

    const todayYmd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    const monthKey = heptagonCohortRanks.getMonthKeyKstNow();
    const filterGender = req.query.gender || "all";
    const filterCategory = req.query.category || "Supremo";
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    try {
      const db = admin.firestore();

      const snap = await db
        .collection(heptagonCohortRanks.HEPTAGON_COHORT_COL)
        .where("monthKey", "==", monthKey)
        .where("filterGender", "==", filterGender)
        .where("filterCategory", "==", filterCategory)
        .get();

      if (snap.empty) {
        res.status(200).json({
          success: true,
          message: "해당 조건의 문서가 없습니다.",
          monthKey, filterGender, filterCategory,
        });
        return;
      }

      // sumPositionScores 기준 재정렬 → 신규 순위 계산 (rebuildHeptagonCohortRanks 와 동일 정렬)
      const rows = snap.docs.map((doc) => {
        const d = doc.data();
        return {
          docId: doc.id,
          userId: d.userId || "",
          displayName: (d.displayName || "(이름없음)").toString().trim(),
          boardRank: d.boardRank != null && isFinite(Number(d.boardRank)) ? Math.floor(Number(d.boardRank)) : null,
          sumPositionScores: d.sumPositionScores != null && isFinite(Number(d.sumPositionScores)) ? Number(d.sumPositionScores) : 0,
          asOfSeoul: d.asOfSeoul || "",
          yesterdayOfficialBoardRank:
            d.yesterdayOfficialBoardRank != null && isFinite(Number(d.yesterdayOfficialBoardRank))
              ? Math.floor(Number(d.yesterdayOfficialBoardRank))
              : null,
          storedPreviousBoardRank: d.previousBoardRank != null ? Number(d.previousBoardRank) : null,
          storedRankChange: d.rankChange != null ? Number(d.rankChange) : null,
        };
      });

      rows.sort((a, b) => {
        if (b.sumPositionScores !== a.sumPositionScores) return b.sumPositionScores - a.sumPositionScores;
        return String(a.userId).localeCompare(String(b.userId));
      });

      const docsAsOf = rows.length > 0 ? rows[0].asOfSeoul : null;
      const isNewDay = docsAsOf !== todayYmd;

      const samples = rows.slice(0, limit).map((r, i) => {
        const newRank = i + 1;
        let yesterdayOfficial = null;
        if (r.asOfSeoul && r.asOfSeoul !== todayYmd && r.boardRank != null) {
          yesterdayOfficial = r.boardRank;
        } else if (r.yesterdayOfficialBoardRank != null) {
          yesterdayOfficial = r.yesterdayOfficialBoardRank;
        }
        const prevRank = yesterdayOfficial;
        const change = prevRank != null ? prevRank - newRank : null;
        return {
          newRank,
          prevRank,
          rankChange: change,
          direction: change == null ? "신규" : change > 0 ? `↑${change}` : change < 0 ? `↓${Math.abs(change)}` : "-",
          userId: r.userId,
          displayName: r.displayName,
          sumPositionScores: Number(r.sumPositionScores.toFixed(2)),
          asOfSeoul: r.asOfSeoul,
          storedPreviousBoardRank: r.storedPreviousBoardRank,
          storedRankChange: r.storedRankChange,
        };
      });

      const summary = {
        total: rows.length,
        shown: samples.length,
        isNewDay,
        todayYmd,
        docsAsOf,
        improved: samples.filter((r) => r.rankChange != null && r.rankChange > 0).length,
        declined: samples.filter((r) => r.rankChange != null && r.rankChange < 0).length,
        same: samples.filter((r) => r.rankChange === 0).length,
        newEntry: samples.filter((r) => r.rankChange == null).length,
      };

      res.status(200).json({
        success: true,
        monthKey,
        filterGender,
        filterCategory,
        note: isNewDay
          ? "✅ 문서가 어제 기준입니다. 아래 samples 의 rankChange 가 실제 갱신 시 저장될 값입니다. manualApplyRankChanges 로 지금 바로 적용할 수 있습니다."
          : "ℹ️ 오늘 이미 갱신된 문서입니다. 등락은 yesterdayOfficialBoardRank(전일 03:20 정규 집계) 기준으로 계산됩니다.",
        summary,
        samples,
      });
    } catch (err) {
      console.error("[previewHeptagonRankChanges]", err);
      res.status(500).json({ success: false, error: err && err.message ? err.message : String(err) });
    }
  }
);

/**
 * [1회성 수동 적용] 순위 등락(rankChange / previousBoardRank) 을 지금 즉시 계산·저장.
 * — 스케줄 본(`scheduledPeak28dHeptagonOnly` 03:20) 과 동일한 코드 경로 실행.
 * — 먼저 `previewHeptagonRankChanges` 로 예상 변동을 확인한 뒤 실행 권장.
 *
 * GET  https://<region>-stelvio-ai.cloudfunctions.net/manualApplyRankChanges?secret=stelvio-internal-sync-v1
 * POST X-Internal-Secret: stelvio-internal-sync-v1
 *
 * 응답: { success, monthKey, startStr, endStr, wrote, ms, peakSource }
 */
exports.manualApplyRankChanges = onRequest(
  { cors: false, timeoutSeconds: 540, memory: "2GiB" },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const secret =
      req.query.secret ||
      req.headers["x-internal-secret"] ||
      req.headers["X-Internal-Secret"];

    if (secret !== INTERNAL_SYNC_SECRET) {
      res.status(403).json({
        success: false,
        error: "인증 실패 — GET: ?secret=stelvio-internal-sync-v1 / POST: X-Internal-Secret 헤더 사용",
      });
      return;
    }

    // 프록시 타임아웃 대응: 202 를 먼저 응답하고 Cloud Run 인스턴스가 백그라운드에서 작업을 계속 실행.
    // Cloud Run(Firebase Functions v2)은 res.json() 이후에도 timeoutSeconds(540s)까지 핸들러가 실행됨.
    const startedAt = new Date().toISOString();
    console.log("[manualApplyRankChanges] 수동 1회 실행 시작", startedAt);
    res.status(202).json({
      success: true,
      status: "started",
      message:
        "작업이 시작되었습니다. 약 2~4분 후 Firebase Console → Functions → 로그에서 " +
        "'[manualApplyRankChanges] 완료' 메시지를 확인하세요.",
      startedAt,
      logKeyword: "[manualApplyRankChanges] 완료",
    });

    // 응답 후 실행 — 프록시가 연결을 끊어도 Cloud Run 인스턴스는 계속 동작
    try {
      const r = await runHeptagonCohortRanksRebuildJob();
      console.log("[manualApplyRankChanges] 완료", JSON.stringify({ ...r, startedAt }));
    } catch (err) {
      console.error("[manualApplyRankChanges] 오류", err && err.message ? err.message : String(err));
    }
  }
);

/** 동기부여 메시지 (주간 TSS 랭킹) */
function buildMotivationMessageTss(currentUser, nextUser) {
  if (!currentUser || !nextUser || currentUser.rank >= nextUser.rank) return null;
  const diffTss = Number(nextUser.totalTss) - Number(currentUser.totalTss);
  if (diffTss <= 0) return null;
  const need = Math.ceil(diffTss);
  return `${currentUser.name}님 현재 ${currentUser.rank}위! 앞선 사용자와의 차이는 ${diffTss.toFixed(1)} TSS입니다. 주간 합계를 ${need} TSS 이상 더 올리면 추월할 수 있습니다. 도전해 보세요!`;
}

/** 동기부여 메시지 (30일 거리 랭킹 — 개인·그룹 공통) */
function buildMotivationMessageKm(currentUser, nextUser) {
  if (!currentUser || !nextUser || currentUser.rank >= nextUser.rank) return null;
  const diffKm = Number(nextUser.totalKm) - Number(currentUser.totalKm);
  if (diffKm <= 0) return null;
  const need = Math.ceil(diffKm * 10) / 10;
  return `${currentUser.name}님 현재 ${currentUser.rank}위! 앞선 사용자와의 차이는 ${diffKm.toFixed(1)} km입니다. ${need.toFixed(1)} km 이상 더 올리면 추월할 수 있습니다. 도전해 보세요!`;
}

/** 동기부여 메시지 (6개월 1시간 항속 km/h 랭킹) */
function buildMotivationMessageSpeed(currentUser, nextUser) {
  if (!currentUser || !nextUser || currentUser.rank >= nextUser.rank) return null;
  const diff = Number(nextUser.speedKmh) - Number(currentUser.speedKmh);
  if (diff <= 0) return null;
  const need = Math.ceil(diff * 10) / 10;
  return `${currentUser.name}님 현재 ${currentUser.rank}위! 앞선 사용자와의 차이는 ${diff.toFixed(1)} km/h입니다. ${need.toFixed(1)} km/h 이상 올리면 추월할 수 있습니다. 도전해 보세요!`;
}

/** 훈련일지 5주차 구간 (오늘-6일 ~ 오늘, Asia/Seoul) — Weekly TSS Load와 동일 */
function getWeek5RangeSeoul(todayStr) {
  const pad = (n) => String(n).padStart(2, "0");
  let y, m, d;
  if (todayStr && /^\d{4}-\d{2}-\d{2}$/.test(todayStr)) {
    const parts = todayStr.split("-").map(Number);
    y = parts[0]; m = parts[1]; d = parts[2];
  } else {
    const now = new Date();
    const koreaStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    [y, m, d] = koreaStr.split("-").map(Number);
  }
  const today = new Date(y, m - 1, d);
  const start = new Date(today);
  start.setDate(today.getDate() - 6);
  const startStr = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const endStr = `${y}-${pad(m)}-${pad(d)}`;
  return { startStr, endStr };
}

/** 추월하기 분석: TSS 차이 및 목표 파워(W) 향상치 계산 (시스템 계산, AI 의존 없음) */
function computeOvertakeMetrics(myData, rivalData, myWeightKg) {
  const myWkg = Number(myData?.wkg) || 0;
  const rivalWkg = Number(rivalData?.wkg) || 0;
  const myTSS = Number(myData?.weeklyTss) ?? 0;
  const rivalTSS = Number(rivalData?.weeklyTss) ?? 0;
  const weightKg = Math.max(Number(myWeightKg) || 0, 45);
  const diffWkg = Math.max(0, rivalWkg - myWkg);
  const targetPowerIncrease = Math.ceil(diffWkg * weightKg);
  const tssDiff = rivalTSS - myTSS;
  return {
    myPower: Number(myData?.watts) || 0,
    rivalPower: Number(rivalData?.watts) || 0,
    myWkg,
    rivalWkg,
    myTSS,
    rivalTSS,
    tssDiff,
    targetPowerIncrease,
  };
}

/** 동기부여 메시지 생성 */
function buildMotivationMessage(currentUser, nextUser) {
  if (!currentUser || !nextUser || currentUser.rank >= nextUser.rank) return null;
  if (currentUser.gcScore != null && nextUser.gcScore != null) {
    const diff = Number(nextUser.gcScore) - Number(currentUser.gcScore);
    if (!(diff > 0)) return null;
    return `${currentUser.name}님 현재 ${currentUser.rank}위! 바로 앞 순위와의 환산 점수 차는 약 ${diff.toFixed(1)}점입니다.`;
  }
  if (currentUser.speedKmh != null && nextUser.speedKmh != null) {
    return buildMotivationMessageSpeed(currentUser, nextUser);
  }
  if (currentUser.totalKm != null && nextUser.totalKm != null) {
    return buildMotivationMessageKm(currentUser, nextUser);
  }
  if (currentUser.totalTss != null && nextUser.totalTss != null) {
    return buildMotivationMessageTss(currentUser, nextUser);
  }
  const diffWkg = nextUser.wkg - currentUser.wkg;
  if (diffWkg <= 0) return null;
  const weightKg = Number(currentUser.weightKg) || 0;
  if (weightKg <= 0) return null;
  const requiredWatts = Math.ceil(diffWkg * weightKg);
  const targetWatts = (currentUser.watts || 0) + requiredWatts;
  return `${currentUser.name}님 현재 ${currentUser.rank}위! 앞선 사용자와의 차이는 ${diffWkg.toFixed(2)} W/kg로, ${requiredWatts}W 향상 시키면(목표 파워: ${targetWatts}W) 추월할 수 있습니다. 도전해 보세요!`;
}

/** GC 헵타곤: 부문·성별별 최대 포함 행(단일 Firestore 조회 한도 초과분은 페이지로 이어받음). */
const GC_RANKING_MAX_ROWS_PER_CATEGORY = 10000;
/** 한 번 페이지 조회 크기(Firestore 1 라운드트립당 문서 상한을 완만히 둠). */
const GC_RANKING_FETCH_PAGE_SIZE = 2500;

/**
 * GC(헵타곤 환산): `heptagon_cohort_ranks` 읽기.
 * 표시 순위는 헵타곤 공식 `boardRank`를 우선 사용해 GC와 헵타곤 카드 순위를 동기화한다.
 */
async function buildStelvioGcRankingPayload(db, monthKey, filterGender) {
  const col = db.collection(heptagonCohortRanks.HEPTAGON_COHORT_COL);
  const categories = heptagonCohortRanks.HEPTAGON_CATEGORIES;
  const byCategory = { Supremo: [], Assoluto: [], Bianco: [], Rosa: [], Infinito: [], Leggenda: [] };

  let snapshotRangeStart = "";
  let snapshotRangeEnd = "";
  let snapshotAsOfSeoul = "";
  /** 여러 문서 중 가장 최신 asOfSeoul·range 메타 사용(첫 페이지만 보면 구 스냅샷으로 오판하는 문제 방지) */
  function captureSnapshotMeta(d) {
    if (!d) return;
    if (d.rangeStart == null || String(d.rangeStart).trim() === "") return;
    const rs = String(d.rangeStart).trim();
    const re = d.rangeEnd != null ? String(d.rangeEnd).trim() : "";
    const asOf = d.asOfSeoul != null ? String(d.asOfSeoul).trim().slice(0, 10) : "";
    if (!snapshotRangeStart) {
      snapshotRangeStart = rs;
      snapshotRangeEnd = re;
    }
    if (asOf && (!snapshotAsOfSeoul || asOf > snapshotAsOfSeoul)) {
      snapshotAsOfSeoul = asOf;
    }
  }

  const categoryRowsLists = await Promise.all(
    categories.map(async (cat) => {
      const rawDocs = [];
      let cursor = null;
      while (rawDocs.length < GC_RANKING_MAX_ROWS_PER_CATEGORY) {
        const room = GC_RANKING_MAX_ROWS_PER_CATEGORY - rawDocs.length;
        let q = col
          .where("monthKey", "==", monthKey)
          .where("filterCategory", "==", cat)
          .where("filterGender", "==", filterGender)
          .orderBy("sumPositionScores", "desc")
          .limit(Math.min(GC_RANKING_FETCH_PAGE_SIZE, room));
        if (cursor) q = q.startAfter(cursor);
        const snap = await q.get();
        if (!snap || snap.empty || !snap.docs.length) break;
        for (let di = 0; di < snap.docs.length; di++) {
          const d = snap.docs[di].data();
          if (d && d.userId) rawDocs.push(d);
        }
        const got = snap.docs.length;
        if (got < Math.min(GC_RANKING_FETCH_PAGE_SIZE, room)) break;
        cursor = snap.docs[snap.docs.length - 1];
        if (!cursor) break;
      }
      return { cat, rawDocs };
    })
  );

  const prevMonthKey = heptagonCohortRanks.getPreviousMonthKeyKst(monthKey);
  let prevCategoryRowsLists = [];
  if (prevMonthKey) {
    prevCategoryRowsLists = await Promise.all(
      categories.map(async (cat) => {
        const rawDocs = [];
        let cursor = null;
        while (rawDocs.length < GC_RANKING_MAX_ROWS_PER_CATEGORY) {
          const room = GC_RANKING_MAX_ROWS_PER_CATEGORY - rawDocs.length;
          let q = col
            .where("monthKey", "==", prevMonthKey)
            .where("filterCategory", "==", cat)
            .where("filterGender", "==", filterGender)
            .orderBy("sumPositionScores", "desc")
            .limit(Math.min(GC_RANKING_FETCH_PAGE_SIZE, room));
          if (cursor) q = q.startAfter(cursor);
          const snap = await q.get();
          if (!snap || snap.empty || !snap.docs.length) break;
          for (let di = 0; di < snap.docs.length; di++) {
            const d = snap.docs[di].data();
            if (d && d.userId) rawDocs.push(d);
          }
          const got = snap.docs.length;
          if (got < Math.min(GC_RANKING_FETCH_PAGE_SIZE, room)) break;
          cursor = snap.docs[snap.docs.length - 1];
          if (!cursor) break;
        }
        return { cat, rawDocs };
      })
    );
  }

  const prevByCat = {};
  for (let pi = 0; pi < prevCategoryRowsLists.length; pi++) {
    prevByCat[prevCategoryRowsLists[pi].cat] = prevCategoryRowsLists[pi].rawDocs;
  }

  for (let cri = 0; cri < categoryRowsLists.length; cri++) {
    const pr = categoryRowsLists[cri];
    const cat = pr.cat;
    let mergedRaw = pr.rawDocs || [];
    if (prevByCat[cat] && prevByCat[cat].length) {
      mergedRaw = mergedRaw.concat(prevByCat[cat]);
    }
    const latestDocs = heptagonCohortRanks.filterLatestGcDocsWithRankMovement(mergedRaw);
    const rows = [];
    for (let di = 0; di < latestDocs.length; di++) {
        const d = latestDocs[di];
        captureSnapshotMeta(d);
        const uid = String(d.userId);
        const gcScore = d.sumPositionScores != null && isFinite(Number(d.sumPositionScores)) ? Number(d.sumPositionScores) : 0;
        const g =
          filterGender === "F"
            ? "female"
            : filterGender === "M"
              ? "male"
              : "";
        rows.push({
          userId: uid,
          name: (d.displayName && String(d.displayName).trim()) || "(이름 없음)",
          ageCategory: d.ageCategory != null ? String(d.ageCategory) : "",
          gender: g,
          is_private: privacyFlagFromFirestoreDoc(d),
          rank: d.boardRank != null && isFinite(Number(d.boardRank)) ? Math.floor(Number(d.boardRank)) : di + 1,
          gcScore,
          rankChange: (function () {
            const raw =
              d.rankChange != null
                ? d.rankChange
                : d.rank_change != null
                  ? d.rank_change
                  : null;
            return raw != null && isFinite(Number(raw)) ? Math.round(Number(raw)) : null;
          })(),
          previousBoardRank: (function () {
            const raw =
              d.previousBoardRank != null
                ? d.previousBoardRank
                : d.previous_board_rank != null
                  ? d.previous_board_rank
                  : d.yesterdayOfficialBoardRank != null
                    ? d.yesterdayOfficialBoardRank
                    : d.yesterday_official_board_rank != null
                      ? d.yesterday_official_board_rank
                      : null;
            return raw != null && isFinite(Number(raw)) ? Math.floor(Number(raw)) : null;
          })(),
        });
    }
    byCategory[cat] = heptagonCohortRanks.rerankGcBoardRows(rows);
  }
  await hydrateRankingBoardProfileImages(db, byCategory);
  const entries = (byCategory.Supremo || []).slice();
  await hydrateRankingBoardPrivacyFromUsers(db, byCategory, entries);
  try {
    const rankingEligibility = require("./rankingEligibility");
    if (typeof rankingEligibility.filterEligibleByCategory === "function") {
      const filtered = rankingEligibility.filterEligibleByCategory(byCategory);
      for (const cat of Object.keys(filtered)) {
        byCategory[cat] = filtered[cat];
      }
      const filteredEntries = rankingEligibility.filterEligibleRankingRows(entries).map((r, i) => ({
        ...r,
        rank: i + 1,
      }));
      entries.length = 0;
      filteredEntries.forEach((r) => entries.push(r));
    }
  } catch (eGcFilter) {
    console.warn(
      "[buildStelvioGcRankingPayload] withdrawn filter skipped:",
      eGcFilter && eGcFilter.message ? eGcFilter.message : eGcFilter
    );
  }
  return { byCategory, entries, snapshotRangeStart, snapshotRangeEnd, snapshotAsOfSeoul };
}

const PEAK_RANKING_CACHE_TTL_MS = 5 * 60 * 1000;

const getPeakPowerRankingOptions = supabaseDualWriteServer.appendServiceRoleSecret({
  cors: true,
  timeoutSeconds: 540,
});
/** 피크 파워 랭킹 API */
exports.getPeakPowerRanking = onRequest(
  getPeakPowerRankingOptions,
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    const durationTypeEarly = req.query.duration || "5min";
    if (durationTypeEarly === "tss") {
      res.set("Cache-Control", "no-store");
    } else {
      res.set("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=60");
    }
    const origJsonPeak = res.json.bind(res);
    res.json = (payload) => {
      if (payload && typeof payload === "object" && payload.success && !payload.readBackend) {
        const fbReadLegacy = rankingReadConfig.safeIsFirebaseRankingReadAllowed();
        payload.readBackend = fbReadLegacy ? "firebase" : "supabase";
        payload.readSource = payload.readBackend;
      }
      if (payload && typeof payload === "object" && (payload.byCategory || payload.entries || payload.ranking)) {
        filterWithdrawnUsersFromRankingPayload(payload);
      }
      return origJsonPeak(payload);
    };
    try {
    let period = req.query.period || "monthly";
    if (period === "yearly") period = "monthly";
    const durationType = req.query.duration || "5min";
    const gender = req.query.gender || "all";
    const uid = req.query.uid || null;
    const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month, 10) : new Date().getMonth() + 1;

    const db = admin.firestore();
    /** 집계/캐시 행은 스냅샷 시점의 is_private일 수 있음 → 응답 직전 users 기준 비공개·프로필 URL 보강 */
    const finalizeRankingProfileUrls = async (payload) => {
      if (!payload || !payload.byCategory) return;
      if (
        payload.readSource === "supabase" ||
        payload.readBackend === "supabase" ||
        payload.supabaseReadBlockedFirebaseFallback === true
      ) {
        return;
      }
      await hydrateRankingBoardPrivacyFromUsers(db, payload.byCategory, payload.entries);
      await hydrateRankingBoardProfileImages(db, payload.byCategory, payload.entries);
    };

    const rankingReadRoute = await rankingReadConfig.shouldReadRankingFromSupabase(admin, uid);
    const supabasePeakPayload =
      await rankingReadRouter.tryBuildPeakPowerRankingFromSupabase(
        admin,
        req.query || {},
        {
          db,
          getWeekRangeSeoul,
          getRolling28DaysRangeSeoul,
          getRolling90DaysRangeSeoul,
          getRolling30DaysRangeSeoul,
          getMinHeptagonSnapshotAsOfSeoulYmd,
          RANKING_HEPTAGON_REBUILD_META_DOC,
          buildMotivationMessage,
          applyGroupRankingParticipationForViewer,
          hydratePeakRankMovementOnPayload,
        }
      );
    if (supabasePeakPayload) {
      await finalizeRankingProfileUrls(supabasePeakPayload);
      if (req.query.parity !== "1" && req.query.parity !== "true") {
        delete supabasePeakPayload.rankingParity;
      }
      return res.status(200).json(supabasePeakPayload);
    }

    if (rankingReadRoute.route === "supabase") {
      console.warn("[getPeakPowerRanking] Supabase read-only — Firebase ranking path skipped", {
        durationType,
        gender,
      });
      const buildPending =
        typeof rankingReadRouter.buildSupabaseRankingPendingPayload === "function"
          ? rankingReadRouter.buildSupabaseRankingPendingPayload.bind(rankingReadRouter)
          : null;
      const pendingOnly = buildPending
        ? buildPending(durationType, gender, "router_null", {
            getWeekRangeSeoul,
            getRolling28DaysRangeSeoul,
            getRolling30DaysRangeSeoul,
          })
        : {
            success: true,
            byCategory: rankingReadRouter.emptyPeakRankingByCategory
              ? rankingReadRouter.emptyPeakRankingByCategory()
              : {
                  Supremo: [],
                  Assoluto: [],
                  Bianco: [],
                  Rosa: [],
                  Infinito: [],
                  Leggenda: [],
                },
            entries: [],
            durationType,
            gender,
            pendingAggregate: true,
            readBackend: "supabase",
            readSource: "supabase",
            message: "Supabase 랭킹 집계 준비 중입니다.",
          };
      return res.status(200).json(pendingOnly);
    }

    if (!rankingReadConfig.safeIsFirebaseRankingReadAllowed()) {
      console.error("[getPeakPowerRanking] Firebase ranking read/aggregate disabled (Supabase cutover)");
      return res.status(200).json(
        rankingReadRouter.buildSupabaseRankingPendingPayload(durationType, gender, "firebase_read_disabled", {
          getWeekRangeSeoul,
          getRolling28DaysRangeSeoul,
          getRolling90DaysRangeSeoul,
          getRolling30DaysRangeSeoul,
        })
      );
    }

    const forceRankMv = req.query.rankMv === "1" || req.query.rankMv === "true";

    /** 주간 TSS 랭킹 탭: getWeeklyRanking·TOP10과 동일 readWeeklyTssRankingPayloadForHttp 경로 */
    if (durationType === "tss") {
      const { startStr, endStr } = getWeekRangeSeoul();
      const cacheKey = `peakRanking_weekly_tss_v2_${gender}_${startStr}_${endStr}`;
      const cacheRef = db.collection("cache").doc(cacheKey);

      if (!forceRankMv) {
        const tssHit = await readWeeklyTssRankingPayloadForHttp(db, startStr, endStr, gender);
        const outFromHit = await buildPeakTssRankingResponseFromHttpHit(
          db,
          tssHit,
          startStr,
          endStr,
          gender,
          uid
        );
        if (outFromHit) {
          await finalizeRankingProfileUrls(outFromHit);
          return res.status(200).json(outFromHit);
        }
      }

      if (!(await tryAcquireRankingHttpLiveRebuildLock(db, cacheKey))) {
        const waitHit = await readWeeklyTssRankingPayloadForHttp(db, startStr, endStr, gender);
        const outWait = await buildPeakTssRankingResponseFromHttpHit(
          db,
          waitHit,
          startStr,
          endStr,
          gender,
          uid
        );
        if (outWait) {
          await finalizeRankingProfileUrls(outWait);
          return res.status(200).json(outWait);
        }
        return res.status(200).json({
          success: true,
          byCategory: emptyPeakRankingByCategory(),
          startStr,
          endStr,
          period: "weekly",
          durationType: "tss",
          gender,
          pendingAggregate: true,
          message: "랭킹 집계 준비 중입니다. 잠시 후 다시 시도해주세요.",
        });
      }

      const usersSnapTss = await db.collection("users").get();
      const { entries, byCategory } = await getWeeklyTssRankingBoardEntries(
        db,
        startStr,
        endStr,
        gender,
        usersSnapTss
      );
      await applyPeakRankChanges(db, byCategory, `peak_tss_weekly_${gender}`);
      await writeRankingAggregatePayload(db, cacheKey, { byCategory, entries, startStr, endStr });
      await hydrateRankingBoardProfileImages(db, byCategory, entries);
      await cacheRef.set({
        byCategory,
        entries,
        startStr,
        endStr,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      let out = { success: true, byCategory, startStr, endStr, period: "weekly", durationType: "tss", gender };
      if (uid) {
        let current = null; let nextUser = null;
        for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
          const arr = byCategory[c] || [];
          const idx = arr.findIndex((e) => e.userId === uid);
          if (idx >= 0) {
            current = arr[idx];
            nextUser = idx > 0 ? arr[idx - 1] : null;
            break;
          }
        }
        if (current) {
          out.currentUser = current;
          out.motivationMessage = buildMotivationMessage(current, nextUser);
        }
      }
      const tssEntries = Array.isArray(entries) ? entries : byCategory.Supremo || [];
      await hydratePeakRankMovementOnPayload(db, byCategory, tssEntries, `peak_tss_weekly_${gender}`);
      out.byCategory = byCategory;
      if (!out.entries && Array.isArray(byCategory.Supremo)) {
        out.entries = byCategory.Supremo.slice();
      }
      await finalizeRankingProfileUrls(out);
      return res.status(200).json(out);
    }

    /** 개인: 최근 30일(서울) 라이딩 거리(km) 랭킹 */
    if (durationType === "personal_dist") {
      const { startStr, endStr } = getRolling30DaysRangeSeoul();
      const cacheKey = `peakRanking_personal_dist_30d_${gender}_${startStr}_${endStr}`;
      const aggPd = forceRankMv ? null : await readRankingAggregatePayloadIfFresh(db, cacheKey);
      if (aggPd && aggPd.byCategory) {
        let out = {
          success: true,
          byCategory: aggPd.byCategory,
          entries: Array.isArray(aggPd.entries) ? aggPd.entries : [],
          startStr,
          endStr,
          period: "rolling30",
          durationType: "personal_dist",
          gender,
          precomputed: true,
        };
        if (uid) {
          const cat = aggPd.byCategory;
          let current = null; let nextUser = null;
          for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
            const arr = cat?.[c] || [];
            const idx = arr.findIndex((e) => e.userId === uid);
            if (idx >= 0) {
              current = arr[idx];
              nextUser = idx > 0 ? arr[idx - 1] : null;
              break;
            }
          }
          if (current) {
            out.currentUser = current;
            out.motivationMessage = buildMotivationMessage(current, nextUser);
          }
        }
        const pdAggEntries = Array.isArray(aggPd.entries) ? aggPd.entries : out.byCategory.Supremo;
        await hydratePeakRankMovementOnPayload(
          db,
          out.byCategory,
          pdAggEntries,
          `peak_personal_dist_rolling30_${gender}`
        );
        if (!out.entries && Array.isArray(out.byCategory.Supremo)) {
          out.entries = out.byCategory.Supremo.slice();
        }
        await finalizeRankingProfileUrls(out);
        return res.status(200).json(out);
      }
      const cacheRef = db.collection("cache").doc(cacheKey);
      const cacheSnap = forceRankMv ? null : await cacheRef.get();
      const nowMs = Date.now();
      if (cacheSnap && cacheSnap.exists) {
        const data = cacheSnap.data();
        const updatedAt = data.updatedAt && (data.updatedAt.toMillis ? data.updatedAt.toMillis() : data.updatedAt);
        if (updatedAt && nowMs - updatedAt < PEAK_RANKING_CACHE_TTL_MS) {
          const out = {
            success: true,
            byCategory: data.byCategory,
            entries: Array.isArray(data.entries) ? data.entries : [],
            startStr,
            endStr,
            period: "rolling30",
            durationType: "personal_dist",
            gender,
            cached: true,
          };
          if (uid) {
            let current = null; let nextUser = null;
            const cat = data.byCategory;
            for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
              const arr = cat?.[c] || [];
              const idx = arr.findIndex((e) => e.userId === uid);
              if (idx >= 0) {
                current = arr[idx];
                nextUser = idx > 0 ? arr[idx - 1] : null;
                break;
              }
            }
            if (current) {
              out.currentUser = current;
              out.motivationMessage = buildMotivationMessage(current, nextUser);
            }
          }
          const pdCacheEntries = out.entries.length ? out.entries : (out.byCategory.Supremo || []);
          await hydratePeakRankMovementOnPayload(
            db,
            out.byCategory,
            pdCacheEntries,
            `peak_personal_dist_rolling30_${gender}`
          );
          if (!out.entries.length && Array.isArray(out.byCategory.Supremo)) {
            out.entries = out.byCategory.Supremo.slice();
          }
          await finalizeRankingProfileUrls(out);
          return res.status(200).json(out);
        }
      }

      const distFallback = await tryPeakRankingHttpStaleOrPending(db, cacheKey);
      if (distFallback && distFallback.payload && rankingBoardPayloadHasRows(distFallback.payload)) {
        const { entries: distEnt, byCategory: distCat } = distFallback.payload;
        const outDist = {
          success: true,
          byCategory: distCat,
          entries: Array.isArray(distEnt) ? distEnt : [],
          startStr,
          endStr,
          period: "rolling30",
          durationType: "personal_dist",
          gender,
          precomputed: !!distFallback.precomputed,
          staleAggregate: !!distFallback.staleAggregate,
        };
        if (distFallback.dataThroughEndStr && distFallback.dataThroughEndStr !== endStr) {
          outDist.dataThroughEndStr = distFallback.dataThroughEndStr;
        }
        if (uid) {
          let current = null;
          let nextUser = null;
          for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
            const arr = distCat[c] || [];
            const idx = arr.findIndex((e) => e.userId === uid);
            if (idx >= 0) {
              current = arr[idx];
              nextUser = idx > 0 ? arr[idx - 1] : null;
              break;
            }
          }
          if (current) {
            outDist.currentUser = current;
            outDist.motivationMessage = buildMotivationMessage(current, nextUser);
          }
        }
        const pdFbEntries = outDist.entries.length ? outDist.entries : outDist.byCategory.Supremo;
        await hydratePeakRankMovementOnPayload(
          db,
          outDist.byCategory,
          pdFbEntries,
          `peak_personal_dist_rolling30_${gender}`
        );
        if (!outDist.entries.length && Array.isArray(outDist.byCategory.Supremo)) {
          outDist.entries = outDist.byCategory.Supremo.slice();
        }
        await finalizeRankingProfileUrls(outDist);
        return res.status(200).json(outDist);
      }

      const { entries, byCategory } = await getRolling30dDistanceRankingBoardEntries(db, startStr, endStr, gender);
      await applyPeakRankChanges(db, byCategory, `peak_personal_dist_rolling30_${gender}`);
      await writeRankingAggregatePayload(db, cacheKey, { byCategory, entries, startStr, endStr });
      await hydrateRankingBoardProfileImages(db, byCategory, entries);
      await cacheRef.set({
        byCategory,
        entries,
        startStr,
        endStr,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const out = { success: true, byCategory, entries, startStr, endStr, period: "rolling30", durationType: "personal_dist", gender };
      if (uid) {
        let current = null; let nextUser = null;
        for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
          const arr = byCategory[c] || [];
          const idx = arr.findIndex((e) => e.userId === uid);
          if (idx >= 0) {
            current = arr[idx];
            nextUser = idx > 0 ? arr[idx - 1] : null;
            break;
          }
        }
        if (current) {
          out.currentUser = current;
          out.motivationMessage = buildMotivationMessage(current, nextUser);
        }
      }
      await finalizeRankingProfileUrls(out);
      return res.status(200).json(out);
    }

    /** 개인: 최근 90일 1시간 항속능력(km/h) 랭킹 */
    if (durationType === "personal_speed") {
      const { startStr, endStr } = getRolling90DaysRangeSeoul();
      const cacheKey = personalSpeedAggregateCacheKey(gender, startStr, endStr);

      async function buildPersonalSpeedOutFromPack(pack, meta) {
        const byCategory = pack.byCategory;
        const entries = Array.isArray(pack.entries) ? pack.entries : (byCategory.Supremo || []).slice();
        const outStart = pack.startStr || startStr;
        const outEnd = pack.endStr || endStr;
        let out = {
          success: true,
          byCategory,
          entries,
          startStr: outStart,
          endStr: outEnd,
          period: rankingDayRollup.PERSONAL_SPEED_PERIOD_ROLLING,
          durationType: "personal_speed",
          gender,
          personalSpeedLogicVersion: rankingDayRollup.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION,
          ...(meta || {}),
        };
        if (uid) {
          let current = null;
          let nextUser = null;
          for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
            const arr = byCategory?.[c] || [];
            const idx = arr.findIndex((e) => e.userId === uid);
            if (idx >= 0) {
              current = arr[idx];
              nextUser = idx > 0 ? arr[idx - 1] : null;
              break;
            }
          }
          if (current) {
            out.currentUser = current;
            out.motivationMessage = buildMotivationMessage(current, nextUser);
          }
        }
        const psEntries = entries.length ? entries : (byCategory.Supremo || []);
        const fastPrecomputed = meta && meta.fastPrecomputed === true;
        if (!forceRankMv && !fastPrecomputed) {
          await hydratePeakRankMovementOnPayload(
            db,
            out.byCategory,
            psEntries,
            personalSpeedRankHistoryKey(gender)
          );
        }
        if (!out.entries.length && Array.isArray(out.byCategory.Supremo)) {
          out.entries = out.byCategory.Supremo.slice();
        }
        if (uid && !forceRankMv && !fastPrecomputed) {
          await patchPersonalSpeedViewerFromDashboardRoute(db, out, uid, outStart, outEnd);
        }
        await finalizeRankingProfileUrls(out);
        return out;
      }

      const cacheRef = db.collection("cache").doc(cacheKey);

      if (!forceRankMv) {
        const aggVersionProbe = await readRankingAggregatePayloadAllowStale(
          db,
          cacheKey,
          PERSONAL_SPEED_STALE_AGG_MS
        );
        if (aggVersionProbe && !personalSpeedAggregateLogicOk(aggVersionProbe)) {
          console.warn(
            "[getPeakPowerRanking personal_speed] 구버전 집계 — HTTP에서 삭제·전체 재집계 생략(23:00 배치 대기)",
            cacheKey
          );
        }
      }

      /**
       * 사전집계 hit: 23:00·수동 집계 pack(dashboardLogRouteEnriched)은 즉시 반환.
       * 구버전·미검증 pack만 enrich(전원 로그 재산출).
       */
      const tryReturnPrecomputed = async (aggPayload, meta) => {
        if (!aggPayload || !aggPayload.byCategory) return null;
        const fastTrust = personalSpeedPrecomputedTrustworthy(aggPayload);
        let working = aggPayload;
        if (!fastTrust) {
          try {
            working = await enrichPersonalSpeedPackFromLogs(
              db,
              JSON.parse(JSON.stringify(aggPayload)),
              startStr,
              endStr
            );
          } catch (eEnrichPs) {
            console.warn("[getPeakPowerRanking personal_speed] enrich failed:", eEnrichPs && eEnrichPs.message);
            working = aggPayload;
          }
        }
        const logicOk = personalSpeedAggregateLogicOk(working);
        const sanitized = sanitizePersonalSpeedRankingPack(
          fastTrust ? JSON.parse(JSON.stringify(working)) : working
        );
        if (!(sanitized.entries || []).length && !(sanitized.byCategory.Supremo || []).length) {
          return null;
        }
        sanitized.peakDataSource =
          working.peakDataSource || rankingDayRollup.PERSONAL_SPEED_PEAK_DATA_SOURCE;
        sanitized.personalSpeedLogicVersion =
          working.personalSpeedLogicVersion != null
            ? working.personalSpeedLogicVersion
            : rankingDayRollup.PERSONAL_SPEED_ROLLUP_LOGIC_VERSION;
        sanitized.dashboardLogRouteEnriched =
          fastTrust || working.dashboardLogRouteEnriched === true;
        if (!fastTrust) {
          await hydrateRankingBoardProfileImages(db, sanitized.byCategory, sanitized.entries);
        }
        const outMeta = {
          precomputed: true,
          dashboardLogRouteEnriched: sanitized.dashboardLogRouteEnriched === true,
          fastPrecomputed: fastTrust,
          peakDataSource: sanitized.peakDataSource,
          ...(meta || {}),
        };
        if (!logicOk) {
          outMeta.staleAggregate = true;
        }
        return res.status(200).json(
          await buildPersonalSpeedOutFromPack({ ...sanitized, startStr, endStr }, outMeta)
        );
      };

      if (!forceRankMv) {
        const aggFresh = await readRankingAggregatePayloadIfFresh(db, cacheKey);
        const freshOut = await tryReturnPrecomputed(aggFresh, { source: "ranking_aggregates_fresh" });
        if (freshOut) return freshOut;

        const aggStale = await readRankingAggregatePayloadAllowStale(db, cacheKey, PERSONAL_SPEED_STALE_AGG_MS);
        const staleOut = await tryReturnPrecomputed(aggStale, {
          source: "ranking_aggregates_stale",
          staleAggregate: true,
        });
        if (staleOut) return staleOut;

        const cacheSnap = await cacheRef.get();
        if (cacheSnap && cacheSnap.exists) {
          const data = cacheSnap.data() || {};
          const cacheOut = await tryReturnPrecomputed(data, { source: "cache_doc" });
          if (cacheOut) return cacheOut;
        }
      }

      /** 2) 사전집계 miss: 전일 키·rollup CG·월간 60분 임시 → pending */
      async function tryPersonalSpeedHttpFallbackBoard() {
        const psFallback = await tryPeakRankingHttpStaleOrPending(db, cacheKey);
        if (psFallback && psFallback.payload) {
          const psStaleOut = await tryReturnPrecomputed(psFallback.payload, {
            source: "ranking_aggregates_stale_rollover",
            staleAggregate: true,
          });
          if (psStaleOut) return psStaleOut;
        }
        const psAnyStale = await readRankingAggregatePayloadAllowStale(
          db,
          cacheKey,
          PERSONAL_SPEED_STALE_AGG_MS
        );
        const psAnyOut = await tryReturnPrecomputed(psAnyStale, {
          source: "ranking_aggregates_any_stale",
          staleAggregate: true,
        });
        if (psAnyOut) return psAnyOut;

        const rollupLockKey = `http_ps_rollup_${cacheKey}`;
        if (await tryAcquireRankingHttpLiveRebuildLock(db, rollupLockKey)) {
          const boardFromRollup = await getPersonalSpeedRankingBoardFromRollupsCG(
            db,
            startStr,
            endStr,
            gender
          );
          if (boardFromRollup && rankingBoardPayloadHasRows(boardFromRollup)) {
            boardFromRollup.dashboardLogRouteEnriched = true;
            const psPayload = await persistPersonalSpeedRankingPack(
              db,
              cacheKey,
              boardFromRollup,
              startStr,
              endStr
            );
            const rollupOut = await tryReturnPrecomputed(psPayload, {
              precomputed: true,
              rebuiltOnDemand: true,
              fromUserRollups: true,
              source: "rollup_collection_group",
            });
            if (rollupOut) return rollupOut;
          }
        }
        return null;
      }

      if (!ALLOW_RANKING_HTTP_LIVE_REBUILD) {
        const fallbackOut = await tryPersonalSpeedHttpFallbackBoard();
        if (fallbackOut) return fallbackOut;

        const emptyBoard = emptyPeakRankingByCategory();
        return res.status(200).json(
          await buildPersonalSpeedOutFromPack(
            { byCategory: emptyBoard, entries: [], startStr, endStr },
            {
              pendingAggregate: true,
              message: "랭킹 집계 준비 중입니다. 잠시 후 다시 시도해주세요.",
            }
          )
        );
      }
      const fallbackBeforeLive = await tryPersonalSpeedHttpFallbackBoard();
      if (fallbackBeforeLive) return fallbackBeforeLive;
      const usersSnapPs = await db.collection("users").get();
      const boardLive = await getPersonalSpeedRankingBoardEntriesFromRollups(
        db,
        startStr,
        endStr,
        gender,
        usersSnapPs,
        {
          logBatchSize: 25,
          syncRollups: true,
        }
      );
      await applyPeakRankChanges(db, boardLive.byCategory, personalSpeedRankHistoryKey(gender));
      boardLive.dashboardLogRouteEnriched = true;
      const psPayload = await persistPersonalSpeedRankingPack(db, cacheKey, boardLive, startStr, endStr);
      const liveEnrichedOut = await tryReturnPrecomputed(psPayload, {
        rebuiltOnDemand: true,
        fromUserRollups: true,
        source: "live_rollup_build",
      });
      if (liveEnrichedOut) return liveEnrichedOut;
      const emptyBoard = emptyPeakRankingByCategory();
      return res.status(200).json(
        await buildPersonalSpeedOutFromPack(
          { byCategory: emptyBoard, entries: [], startStr, endStr },
          { pendingAggregate: true }
        )
      );
    }

    /** 그룹: 방장별 최근 30일 오픈 라이딩 합산(일정당 참가자 당일 라이딩 거리 합) */
    if (durationType === "group_dist") {
      const { startStr, endStr } = getRolling30DaysRangeSeoul();
      const fgGroup = gender === "M" || gender === "F" ? gender : "all";
      const cacheKey = `peakRanking_group_dist_30d_${fgGroup}_${startStr}_${endStr}`;
      const groupRankHistoryKey = `peak_group_dist_rolling30_${fgGroup}`;
      const aggG = forceRankMv ? null : await readRankingAggregatePayloadIfFresh(db, cacheKey);
      if (aggG && aggG.byCategory) {
        const byCategory = JSON.parse(JSON.stringify(aggG.byCategory));
        const entries = JSON.parse(JSON.stringify(Array.isArray(aggG.entries) ? aggG.entries : []));
        await applyGroupRankingParticipationForViewer(db, byCategory, entries, startStr, endStr, uid);
        const arrAll = byCategory?.Supremo || [];
        const out = {
          success: true,
          byCategory,
          entries,
          startStr,
          endStr,
          period: "rolling30",
          durationType: "group_dist",
          gender: fgGroup,
          precomputed: true,
        };
        if (uid) {
          const participated = arrAll.filter((e) => e.currentUserParticipated || e.userId === uid);
          let current = null;
          if (participated.length) {
            current = participated.reduce((best, e) => (!best || e.rank < best.rank ? e : best));
          }
          let nextUser = null;
          if (current && current.rank > 1) {
            nextUser = arrAll.find((e) => e.rank === current.rank - 1) || null;
          }
          if (current) {
            out.currentUser = current;
            out.motivationMessage = buildMotivationMessage(current, nextUser);
          }
        }
        const gdAggEntries = Array.isArray(out.entries) ? out.entries : out.byCategory.Supremo || [];
        await hydratePeakRankMovementOnPayload(db, out.byCategory, gdAggEntries, groupRankHistoryKey);
        if (!out.entries && Array.isArray(out.byCategory.Supremo)) {
          out.entries = out.byCategory.Supremo.slice();
        }
        await finalizeRankingProfileUrls(out);
        return res.status(200).json(out);
      }
      const cacheRef = db.collection("cache").doc(cacheKey);
      const cacheSnap = forceRankMv ? null : await cacheRef.get();
      const nowMs = Date.now();
      if (cacheSnap && cacheSnap.exists) {
        const data = cacheSnap.data();
        const updatedAt = data.updatedAt && (data.updatedAt.toMillis ? data.updatedAt.toMillis() : data.updatedAt);
        if (updatedAt && nowMs - updatedAt < PEAK_RANKING_CACHE_TTL_MS) {
          const byCategory = JSON.parse(JSON.stringify(data.byCategory || {}));
          const entries = JSON.parse(JSON.stringify(Array.isArray(data.entries) ? data.entries : []));
          await applyGroupRankingParticipationForViewer(db, byCategory, entries, startStr, endStr, uid);
          const arrAll = byCategory?.Supremo || [];
          const out = {
            success: true,
            byCategory,
            entries,
            startStr,
            endStr,
            period: "rolling30",
            durationType: "group_dist",
            gender: fgGroup,
            cached: true,
          };
          if (uid) {
            const participated = arrAll.filter((e) => e.currentUserParticipated || e.userId === uid);
            let current = null;
            if (participated.length) {
              current = participated.reduce((best, e) => (!best || e.rank < best.rank ? e : best));
            }
            let nextUser = null;
            if (current && current.rank > 1) {
              nextUser = arrAll.find((e) => e.rank === current.rank - 1) || null;
            }
            if (current) {
              out.currentUser = current;
              out.motivationMessage = buildMotivationMessage(current, nextUser);
            }
          }
          const gdCacheEntries = entries.length ? entries : out.byCategory.Supremo || [];
          await hydratePeakRankMovementOnPayload(db, out.byCategory, gdCacheEntries, groupRankHistoryKey);
          if (!out.entries.length && Array.isArray(out.byCategory.Supremo)) {
            out.entries = out.byCategory.Supremo.slice();
          }
          await finalizeRankingProfileUrls(out);
          return res.status(200).json(out);
        }
      }

      const { entries, byCategory } = await getRolling30dGroupDistanceByHostEntries(
        db,
        startStr,
        endStr,
        null,
        fgGroup
      );
      const byCategoryAgg = JSON.parse(JSON.stringify(byCategory));
      const entriesAgg = JSON.parse(JSON.stringify(entries));
      await applyGroupRankingParticipationForViewer(db, byCategoryAgg, entriesAgg, startStr, endStr, null);
      await writeRankingAggregatePayload(db, cacheKey, {
        byCategory: byCategoryAgg,
        entries: entriesAgg,
        startStr,
        endStr,
        gender: fgGroup,
      });
      await hydrateRankingBoardProfileImages(db, byCategory, entries);
      await cacheRef.set({
        byCategory,
        entries,
        startStr,
        endStr,
        gender: fgGroup,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const byCatOut = JSON.parse(JSON.stringify(byCategory));
      const entriesOut = JSON.parse(JSON.stringify(entries));
      await applyGroupRankingParticipationForViewer(db, byCatOut, entriesOut, startStr, endStr, uid);
      await applyPeakRankChanges(db, byCatOut, groupRankHistoryKey);
      const out = {
        success: true,
        byCategory: byCatOut,
        entries: entriesOut,
        startStr,
        endStr,
        period: "rolling30",
        durationType: "group_dist",
        gender: fgGroup,
        precomputed: false,
      };
      if (uid) {
        const arrAll = byCatOut.Supremo || [];
        const participated = arrAll.filter((e) => e.currentUserParticipated || e.userId === uid);
        let current = null;
        if (participated.length) {
          current = participated.reduce((best, e) => (!best || e.rank < best.rank ? e : best));
        }
        let nextUser = null;
        if (current && current.rank > 1) {
          nextUser = arrAll.find((e) => e.rank === current.rank - 1) || null;
        }
        if (current) {
          out.currentUser = current;
          out.motivationMessage = buildMotivationMessage(current, nextUser);
        }
      }
      await finalizeRankingProfileUrls(out);
      return res.status(200).json(out);
    }

    /** GC: 헵타곤 7축 — `heptagon_cohort_ranks` 스냅샷(03:20 KST). 피크 보드는 02:50·23:00 TSS 마스터. */
    if (durationType === "gc") {
      const monthKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).slice(0, 7);
      const fg = gender === "M" || gender === "F" ? gender : "all";
      let byCategory;
      let entries;
      let snap;
      let heptagonMeta = null;
      try {
        const metaSnap = await db.collection("ranking_meta").doc(RANKING_HEPTAGON_REBUILD_META_DOC).get();
        if (metaSnap.exists) heptagonMeta = metaSnap.data() || null;
      } catch (_eHm) {}
      try {
        snap = await buildStelvioGcRankingPayload(db, monthKey, fg);
        byCategory = snap.byCategory;
        entries = snap.entries;
      } catch (eGc) {
        console.warn("[getPeakPowerRanking gc]", eGc && eGc.message ? eGc.message : eGc);
        return res.status(500).json({ success: false, error: "gc_ranking_failed" });
      }
      const rollingFallback = getRolling90DaysRangeSeoul();
      const minGcAsOf = getMinHeptagonSnapshotAsOfSeoulYmd();
      let gcAsOf = snap.snapshotAsOfSeoul ? String(snap.snapshotAsOfSeoul).trim().slice(0, 10) : "";
      let gcStaleVsMin = !!(gcAsOf && minGcAsOf && gcAsOf < minGcAsOf);
      if (!entries.length || gcStaleVsMin) {
        try {
          const live = await heptagonCohortRanks.buildLiveGcRankingPayload(db, fg, {
            getPeakPowerRankingEntries,
            getLeagueCategory,
            getRolling28DaysRangeSeoul: getRolling90DaysRangeSeoul,
            readRankingAggregatePayloadIfFresh,
            buildPeakPowerAllDurationsForRangeAllGendersOnePass,
          });
          if (live && live.byCategory) {
            if (entries.length) {
              const merged = heptagonCohortRanks.mergeGcRankingSnapshotWithLive(
                {
                  byCategory,
                  entries,
                  snapshotRangeStart: snap.snapshotRangeStart,
                  snapshotRangeEnd: snap.snapshotRangeEnd,
                  snapshotAsOfSeoul: gcAsOf,
                },
                live,
                fg
              );
              byCategory = merged.byCategory;
              entries = merged.entries;
            } else {
              byCategory = live.byCategory;
              entries = live.entries || (live.byCategory.Supremo || []).slice();
              if (live.startStr) snap.snapshotRangeStart = live.startStr;
              if (live.endStr) snap.snapshotRangeEnd = live.endStr;
            }
            gcAsOf = gcAsOf || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
            gcStaleVsMin = !!(gcAsOf && minGcAsOf && gcAsOf < minGcAsOf);
          }
        } catch (eLiveGc) {
          console.warn(
            "[getPeakPowerRanking gc] live fallback:",
            eLiveGc && eLiveGc.message ? eLiveGc.message : eLiveGc
          );
        }
      }
      const heptMetaDateKst =
        heptagonMeta && heptagonMeta.dateKst ? String(heptagonMeta.dateKst).trim().slice(0, 10) : "";
      const heptMetaComplete = heptagonMeta && String(heptagonMeta.status || "") === "complete";
      gcStaleVsMin = !!(gcAsOf && minGcAsOf && gcAsOf < minGcAsOf);
      /** 메타는 오늘 집계 완료인데 cohort asOf가 더 오래됨 → 배치 미반영·부분 실패 */
      const gcStaleVsMeta = !!(
        heptMetaComplete &&
        heptMetaDateKst &&
        gcAsOf &&
        heptMetaDateKst > gcAsOf
      );
      const out = {
        success: true,
        byCategory,
        entries,
        startStr: snap.snapshotRangeStart || rollingFallback.startStr,
        endStr: snap.snapshotRangeEnd || rollingFallback.endStr,
        period: "monthly",
        durationType: "gc",
        gender: fg,
        gcMonthKey: monthKey,
        gcSnapshotAsOf: gcAsOf || null,
        gcSnapshotDaily: true,
        gcMinSnapshotAsOf: minGcAsOf,
        gcSnapshotStale: gcStaleVsMin || gcStaleVsMeta,
        gcHeptagonRebuildDateKst: heptMetaDateKst || null,
        gcHeptagonRebuildStatus: heptagonMeta && heptagonMeta.status ? String(heptagonMeta.status) : null,
        gcHeptagonPeakSource: heptagonMeta && heptagonMeta.summary && heptagonMeta.summary.peakSource
          ? String(heptagonMeta.summary.peakSource)
          : null,
      };
      if (uid) {
        let current = null;
        let nextUser = null;
        for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
          const arr = byCategory[c] || [];
          const idx = arr.findIndex((e) => e && String(e.userId) === String(uid));
          if (idx >= 0) {
            current = arr[idx];
            nextUser = idx > 0 ? arr[idx - 1] : null;
            break;
          }
        }
        if (current) {
          out.currentUser = current;
          out.motivationMessage = buildMotivationMessage(current, nextUser);
        }
      }
      return res.status(200).json(out);
    }

    let startStr, endStr;
    if (period === "rolling28" || period === "rolling28d" || period === "rolling90" || period === "rolling90d" || period === "rolling6m" || period === "rolling183" || period === "rolling30" || period === "monthly") {
      const r = getRolling90DaysRangeSeoul();
      startStr = r.startStr;
      endStr = r.endStr;
    } else {
      const r = getMonthRangeSeoul(year, month);
      startStr = r.startStr;
      endStr = r.endStr;
    }

    const cacheKey = `peakRanking_v2_${period}_${durationType}_${gender}_${startStr}_${endStr}`;
    /**
     * Max·구간 피크 탭: 사전 집계/메모리 캐시 응답에도 `peak_rank_history` 기준 등락을 매 요청 보강.
     * (집계 문서가 옛날 포맷이거나 필드 누락이어도 GC 탭과 동일하게 UI에 반영되도록)
     */
    async function hydratePeakPowerRankMovementIfNeeded(payload) {
      if (!payload || !payload.byCategory || !DURATION_FIELDS[durationType]) return;
      await hydratePeakRankMovementOnPayload(
        db,
        payload.byCategory,
        payload.entries,
        `peak_${durationType}_${period}_${gender}`
      );
    }
    const aggPeak =
      forceRankMv ? null : await readRankingAggregatePayloadIfFresh(db, cacheKey);
    if (aggPeak && aggPeak.byCategory) {
      let out = {
        success: true,
        byCategory: aggPeak.byCategory,
        startStr,
        endStr,
        period,
        durationType,
        gender,
        precomputed: true,
      };
      if (aggPeak.cohortAvgHrBpm != null && !isNaN(Number(aggPeak.cohortAvgHrBpm))) {
        out.cohortAvgHrBpm = Number(aggPeak.cohortAvgHrBpm);
      }
      await hydratePeakPowerRankMovementIfNeeded(out);
      if (uid) {
        const cat = aggPeak.byCategory;
        let current = null, nextUser = null;
        for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
          const arr = cat?.[c] || [];
          const idx = arr.findIndex((e) => e.userId === uid);
          if (idx >= 0) {
            current = arr[idx];
            nextUser = idx > 0 ? arr[idx - 1] : null;
            break;
          }
        }
        if (current) {
          out.currentUser = current;
          out.motivationMessage = buildMotivationMessage(current, nextUser);
        }
      }
      await finalizeRankingProfileUrls(out);
      if (Array.isArray(out.byCategory.Supremo)) {
        out.entries = out.byCategory.Supremo.slice();
      }
      return res.status(200).json(out);
    }
    const cacheRef = db.collection("cache").doc(cacheKey);
    const cacheSnap = forceRankMv ? null : await cacheRef.get();
    const nowMs = Date.now();
    if (cacheSnap && cacheSnap.exists) {
      const data = cacheSnap.data();
      const updatedAt = data.updatedAt && (data.updatedAt.toMillis ? data.updatedAt.toMillis() : data.updatedAt);
      if (updatedAt && nowMs - updatedAt < PEAK_RANKING_CACHE_TTL_MS) {
        let out = { success: true, byCategory: data.byCategory, startStr, endStr, period, durationType, gender, cached: true };
        if (data.cohortAvgHrBpm != null && !isNaN(Number(data.cohortAvgHrBpm))) {
          out.cohortAvgHrBpm = Number(data.cohortAvgHrBpm);
        }
        await hydratePeakPowerRankMovementIfNeeded(out);
        if (uid) {
          const cat = data.byCategory;
          let current = null, nextUser = null;
          for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
            const arr = cat?.[c] || [];
            const idx = arr.findIndex((e) => e.userId === uid);
            if (idx >= 0) {
              current = arr[idx];
              nextUser = idx > 0 ? arr[idx - 1] : null;
              break;
            }
          }
          if (current) {
            out.currentUser = current;
            out.motivationMessage = buildMotivationMessage(current, nextUser);
          }
        }
        await finalizeRankingProfileUrls(out);
        if (Array.isArray(out.byCategory.Supremo)) {
          out.entries = out.byCategory.Supremo.slice();
        }
        return res.status(200).json(out);
      }
    }

    const peakFallback = await tryPeakRankingHttpStaleOrPending(db, cacheKey);
    if (peakFallback && peakFallback.payload && rankingBoardPayloadHasRows(peakFallback.payload)) {
      const { entries: peakEnt, byCategory: peakCat, cohortAvgHrBpm: peakCohortHr } = peakFallback.payload;
      let outPeak = {
        success: true,
        byCategory: peakCat,
        startStr,
        endStr,
        period,
        durationType,
        gender,
        precomputed: !!peakFallback.precomputed,
        staleAggregate: !!peakFallback.staleAggregate,
      };
      if (peakFallback.dataThroughEndStr && peakFallback.dataThroughEndStr !== endStr) {
        outPeak.dataThroughEndStr = peakFallback.dataThroughEndStr;
      }
      if (peakCohortHr != null && !isNaN(Number(peakCohortHr))) {
        outPeak.cohortAvgHrBpm = Number(peakCohortHr);
      }
      if (uid) {
        let current = null;
        let nextUser = null;
        for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
          const arr = peakCat[c] || [];
          const idx = arr.findIndex((e) => e.userId === uid);
          if (idx >= 0) {
            current = arr[idx];
            nextUser = idx > 0 ? arr[idx - 1] : null;
            break;
          }
        }
        if (current) {
          outPeak.currentUser = current;
          outPeak.motivationMessage = buildMotivationMessage(current, nextUser);
        }
      }
      await hydratePeakPowerRankMovementIfNeeded(outPeak);
      await finalizeRankingProfileUrls(outPeak);
      if (Array.isArray(outPeak.byCategory.Supremo)) {
        outPeak.entries = Array.isArray(peakEnt) ? peakEnt : outPeak.byCategory.Supremo.slice();
      }
      return res.status(200).json(outPeak);
    }

    if (!(await tryAcquireRankingHttpLiveRebuildLock(db, cacheKey))) {
      const retryFb = await tryPeakRankingHttpStaleOrPending(db, cacheKey);
      if (retryFb && retryFb.payload && rankingBoardPayloadHasRows(retryFb.payload)) {
        const { entries: peakEnt2, byCategory: peakCat2 } = retryFb.payload;
        let outRetry = {
          success: true,
          byCategory: peakCat2,
          startStr,
          endStr,
          period,
          durationType,
          gender,
          precomputed: true,
          staleAggregate: true,
        };
        if (Array.isArray(outRetry.byCategory.Supremo)) {
          outRetry.entries = Array.isArray(peakEnt2) ? peakEnt2 : outRetry.byCategory.Supremo.slice();
        }
        await finalizeRankingProfileUrls(outRetry);
        return res.status(200).json(outRetry);
      }
    }

    const { entries, byCategory } = await getPeakPowerRankingEntries(db, startStr, endStr, durationType, gender);
    await applyPeakRankChanges(db, byCategory, `peak_${durationType}_${period}_${gender}`);
    let cohortAvgHrBpm = null;
    if (
      (period === "rolling30" ||
        period === "monthly" ||
        period === "rolling28" ||
        period === "rolling28d" ||
        period === "rolling90" ||
        period === "rolling90d" ||
        period === "rolling6m" ||
        period === "rolling183") &&
      DURATION_HR_FIELDS[durationType]
    ) {
      cohortAvgHrBpm = await getCohortAvgPeakHrBpm(db, startStr, endStr, durationType, gender);
    }
    await writeRankingAggregatePayload(db, cacheKey, {
      byCategory,
      entries,
      startStr,
      endStr,
      cohortAvgHrBpm: cohortAvgHrBpm != null ? cohortAvgHrBpm : null,
    });
    await hydrateRankingBoardProfileImages(db, byCategory, entries);
    await cacheRef.set({
      byCategory,
      entries,
      startStr,
      endStr,
      cohortAvgHrBpm: cohortAvgHrBpm != null ? cohortAvgHrBpm : null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    let out = { success: true, byCategory, startStr, endStr, period, durationType, gender, cohortAvgHrBpm };
    if (uid) {
      let current = null, nextUser = null;
      for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
        const arr = byCategory[c] || [];
        const idx = arr.findIndex((e) => e.userId === uid);
        if (idx >= 0) {
          current = arr[idx];
          nextUser = idx > 0 ? arr[idx - 1] : null;
          break;
        }
      }
      if (current) {
        out.currentUser = current;
        out.motivationMessage = buildMotivationMessage(current, nextUser);
      }
    }
    if (Array.isArray(byCategory.Supremo)) {
      out.entries = byCategory.Supremo.slice();
    }
    await finalizeRankingProfileUrls(out);
    res.status(200).json(out);
    } catch (errPeak) {
      console.error("[getPeakPowerRanking] unhandled", errPeak && errPeak.stack ? errPeak.stack : errPeak);
      res.set("Access-Control-Allow-Origin", "*");
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "peak_ranking_internal",
          message: errPeak && errPeak.message ? String(errPeak.message) : String(errPeak),
        });
      }
    }
  }
);

const DURATION_LABELS = {
  "1min": "1분",
  "5min": "5분",
  "10min": "10분",
  "20min": "20분",
  "40min": "40분",
  "60min": "60분",
  max: "Max",
};

/** 추월하기 분석 API: 바로 앞 순위자와 TSS·W/kg 비교, 목표 파워(W) 향상치 산출 */
exports.getOvertakeAnalysis = onRequest(
  { cors: true, timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    const uid = req.query.uid || req.body?.uid || null;
    let period = req.query.period || req.body?.period || "monthly";
    if (period === "yearly") period = "monthly";
    const gender = req.query.gender || req.body?.gender || "all";

    if (!uid) {
      return res.status(400).json({ success: false, error: "uid 필수" });
    }

    const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month, 10) : new Date().getMonth() + 1;
    const r90 = getRolling90DaysRangeSeoul();
    const startStr = r90.startStr;
    const endStr = r90.endStr;

    const db = admin.firestore();
    const todayStr = req.query.today || req.body?.today || null;
    const { startStr: week5StartStr, endStr: week5EndStr } = getWeek5RangeSeoul(todayStr);

    const results = [];
    const overtakePeriodKey = "monthly";

    for (const durationType of Object.keys(DURATION_FIELDS)) {
      const cacheKey = `peakRanking_v2_${overtakePeriodKey}_${durationType}_${gender}_${startStr}_${endStr}`;
      const aggOvertake = await readRankingAggregatePayloadAllowStale(db, cacheKey, RANKING_HTTP_STALE_FALLBACK_MS);
      const byCategory =
        aggOvertake && aggOvertake.byCategory ? aggOvertake.byCategory : emptyPeakRankingByCategory();
      if (!aggOvertake || !aggOvertake.byCategory) {
        console.warn("[getOvertakeAnalysis] 집계 miss — 빈 부문 반환(전체 users 스캔 생략)", cacheKey);
      }
      let current = null;
      let rival = null;
      for (const c of PEAK_RANKING_USER_LOOKUP_ORDER) {
        const arr = byCategory[c] || [];
        const idx = arr.findIndex((e) => e.userId === uid);
        if (idx >= 0) {
          current = arr[idx];
          rival = idx > 0 ? arr[idx - 1] : null;
          break;
        }
      }

      if (!current) {
        results.push({
          category: durationType,
          categoryLabel: DURATION_LABELS[durationType] || durationType,
          hasRival: false,
          myPower: 0,
          rivalPower: 0,
          myWkg: 0,
          rivalWkg: 0,
          myTSS: 0,
          rivalTSS: 0,
          tssDiff: 0,
          targetPowerIncrease: 0,
        });
        continue;
      }

      const myWeeklyTss = Math.round(await getWeeklyTssForUser(db, uid, week5StartStr, week5EndStr));
      const rivalWeeklyTss = rival ? Math.round(await getWeeklyTssForUser(db, rival.userId, week5StartStr, week5EndStr)) : 0;

      const myData = { ...current, weeklyTss: myWeeklyTss };
      const rivalData = rival ? { ...rival, weeklyTss: rivalWeeklyTss } : null;

      let metrics;
      if (rivalData) {
        metrics = computeOvertakeMetrics(myData, rivalData, current.weightKg);
      } else {
        const myPower = current.watts || 0;
        const myWkg = current.wkg || 0;
        const myTSS = myWeeklyTss;
        const targetPower3Pct = Math.ceil(myPower * 0.03);
        const targetPower = myPower + targetPower3Pct;
        const targetWkg3Pct = Math.round(myWkg * 1.03 * 100) / 100;
        const targetTSS3Pct = Math.ceil(myTSS * 1.03);
        const tssIncrease3Pct = targetTSS3Pct - myTSS;
        metrics = {
          myPower,
          rivalPower: 0,
          myWkg,
          rivalWkg: 0,
          myTSS,
          rivalTSS: 0,
          tssDiff: 0,
          targetPowerIncrease: targetPower3Pct,
          selfImprovement3Pct: true,
          targetPower,
          targetWkg3Pct,
          targetTSS3Pct,
          tssIncrease3Pct,
        };
      }

      results.push({
        category: durationType,
        categoryLabel: DURATION_LABELS[durationType] || durationType,
        hasRival: !!rival,
        rivalName: rival ? rival.name : null,
        ...metrics,
      });
    }

    res.status(200).json({
      success: true,
      period,
      startStr,
      endStr,
      week5TssRange: { startStr: week5StartStr, endStr: week5EndStr },
      items: results,
    });
  }
);

/** Phase 4-1: onUserLogWritten 비활성화 (기본). 롤백: ON_USER_LOG_WRITTEN_ENABLED=true 재배포.
 *  onIndoorLogCreatedReward(Phase 5)는 별도 트리거로 유지. */
const onUserLogWrittenHandler = async (change, context) => {
    const userId = context.params.userId;
    const logId = context.params.logId;
    if (!userId || !logId) return;
    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists) return;
    const userData = userSnap.data();

    const affectsRanking = rankingDayRollup.userLogWriteAffectsRankingAggregates(change);

    let bypassFirebaseIncrementalRollup = false;
    if (affectsRanking) {
      bypassFirebaseIncrementalRollup =
        await rankingReadConfig.shouldBypassFirebaseIncrementalRankingRollup(admin, userId);
    }

    if (affectsRanking && !bypassFirebaseIncrementalRollup) {
      try {
        await rankingDayRollup.reconcileRankingDayTotalsOnLogWrite(db, userId, userData, change);
      } catch (e) {
        console.warn("[onUserLogWritten] ranking_day_totals 버킹 실패:", userId, logId, e.message);
      }
    }

    const snap = change.after;
    if (!snap || !snap.exists) return;
    const logData = snap.data();

    await supabaseDualWriteServer.refreshDualRunFromRemoteConfig(admin, false);
    const skipFirebaseLogSideEffects =
      supabaseDualWriteServer.shouldSkipFirebaseLogSideEffects(userId);

    if (affectsRanking && isCyclingForMmp(logData)) {
      try {
        await supabaseDualWriteServer.runSecondaryAfterLogSave(
          admin,
          userId,
          logId,
          logData,
          { force: true }
        );
      } catch (e) {
        console.warn("[onUserLogWritten] Supabase rides 동기화 실패:", userId, logId, e.message);
      }
      if (!bypassFirebaseIncrementalRollup) {
        const activityDateYmd = rankingDayRollup.normalizeLogDateToSeoulYmd(logData.date);
        if (activityDateYmd) {
          try {
            await supabaseDualWriteServer.syncRankingDayBucketsToSupabaseForUser(
              db,
              userId,
              activityDateYmd,
              activityDateYmd
            );
          } catch (bucketErr) {
            console.warn(
              "[onUserLogWritten] daily_summary bucket parity:",
              userId,
              activityDateYmd,
              bucketErr && bucketErr.message ? bucketErr.message : bucketErr
            );
          }
        }
      }
    }

    if (affectsRanking && !skipFirebaseLogSideEffects) {
      try {
        await upsertYearlyPeakFromLog(db, userId, userData, logData, logId);
      } catch (e) {
        console.warn("[onUserLogWritten] upsertYearlyPeakFromLog 실패:", userId, logId, e.message);
      }
    }

    if (
      !skipFirebaseLogSideEffects &&
      isOpenRidingParticipantStravaSyncEnabled() &&
      affectsRanking &&
      String(logData.source || "").toLowerCase() === "strava" &&
      isCyclingForMmp(logData)
    ) {
      try {
        await syncOpenRidingParticipantDistanceByLog(db, userId, logData);
      } catch (e) {
        console.warn("[onUserLogWritten] syncOpenRidingParticipantDistanceByLog 실패:", userId, logId, e.message);
      }
    }
};

if (supabaseDualWriteServer.isOnUserLogWrittenEnabled()) {
  // Gen2(Cloud Run)로 전환 — App Engine(Gen1) 인프라 비용 제거 + 인스턴스 동시성으로 인스턴스 수↓.
  // 기존 핸들러는 Gen1 시그니처(change, context)를 유지하고, Gen2 event를 동일 형태로 매핑해 넘긴다.
  // (event.data 는 Change<DocumentSnapshot> 으로 .before/.after 가 Gen1과 동일하게 동작)
  exports.onUserLogWritten = onDocumentWritten(
    {
      document: "users/{userId}/logs/{logId}",
      timeoutSeconds: 120,
      secrets: ["SUPABASE_SERVICE_ROLE_KEY"],
    },
    (event) => {
      if (!event || !event.data) return null;
      return onUserLogWrittenHandler(event.data, { params: event.params || {} });
    }
  );
} else {
  console.log(
    "[index] Phase 4: onUserLogWritten export skipped — rollback: ON_USER_LOG_WRITTEN_ENABLED=true"
  );
}

/** 기존 로그에 사용자 현재 몸무게(weight) 일괄 적용. weight 필드가 없거나 사용자 몸무게로 갱신 */
exports.backfillWeightToLogs = onRequest(
  { cors: true, timeoutSeconds: 540 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    const db = admin.firestore();
    const usersSnap = await db.collection("users").get();
    let processedUsers = 0;
    let updatedLogs = 0;
    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      const userWeight = Number(userData.weight ?? userData.weightKg ?? 0);
      if (userWeight <= 0) continue;
      processedUsers++;
      const logsSnap = await db.collection("users").doc(userId).collection("logs").get();
      let batch = db.batch();
      let batchCount = 0;
      for (const logDoc of logsSnap.docs) {
        batch.update(logDoc.ref, { weight: userWeight });
        batchCount++;
        updatedLogs++;
        if (batchCount >= 500) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
      if (batchCount > 0) await batch.commit();
    }
    res.status(200).json({ success: true, processedUsers, updatedLogs });
  }
);

/** yearly_peaks 재계산 (Run/Swim/Walk/TrailRun 제외). 기존 데이터 삭제 후 사이클링 로그만으로 재계산
 *  ?year=2026&secret=INTERNAL_SYNC_SECRET (year 없으면 현재 연도)
 *  ?all=1&secret=... → 2020~현재 연도 전체 실행 */
exports.migrateYearlyPeaksExcludeRunSwimWalk = onRequest(
  { cors: true, timeoutSeconds: 540 },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    res.set("Access-Control-Allow-Origin", "*");
    const secret = req.query.secret || req.body?.secret || "";
    if (secret !== INTERNAL_SYNC_SECRET) {
      return res.status(403).json({ success: false, error: "인증 필요" });
    }
    const runAll = req.query.all === "1" || req.query.all === "true";
    const currentYear = new Date().getFullYear();
    const years = runAll
      ? Array.from({ length: currentYear - 2020 + 1 }, (_, i) => 2020 + i)
      : [req.query.year ? parseInt(req.query.year, 10) : currentYear];
    if (!runAll && (isNaN(years[0]) || years[0] < 2020 || years[0] > 2100)) {
      return res.status(400).json({ success: false, error: "year 파라미터 필요 (2020~2100)" });
    }
    const db = admin.firestore();
    const usersSnap = await db.collection("users").get();
    const results = {};
    for (const year of years) {
      const { startStr, endStr } = getYearRangeSeoul(year);
      let usersUpdated = 0;
      let usersDeleted = 0;
      for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;
        const userData = userDoc.data();
        const rawWeight = Number(userData.weight ?? userData.weightKg ?? 0);
        if (rawWeight <= 0) continue;
        const weightKg = Math.max(rawWeight, 45);
        const logsSnap = await db.collection("users").doc(userId).collection("logs")
          .where("date", ">=", startStr)
          .where("date", "<=", endStr)
          .get();
        const cyclingLogs = logsSnap.docs.filter((d) => isCyclingForMmp(d.data()));
        const maxByField = {};
        let maxHr = 0;
        let maxHrDate = null;
        let contributingActivityType = null;
        for (const logDoc of cyclingLogs) {
          const d = logDoc.data();
          const logWeight = Number(d.weight || userData.weight || userData.weightKg || 0);
          const w = logWeight > 0 ? Math.max(logWeight, 45) : weightKg;
          for (const [durationType, field] of Object.entries(DURATION_FIELDS)) {
            const watts = Number(d[field]) || 0;
            if (watts <= 0) continue;
            if (!validatePeakPowerRecord(durationType, watts, w)) continue;
            const prev = maxByField[field] || 0;
            if (watts > prev) {
              maxByField[field] = watts;
              contributingActivityType = d.activity_type ?? (String(d.source || "").toLowerCase() === "strava" ? "Unknown" : "Stelvio");
            }
          }
          const hr = Number(d.max_hr_5sec ?? d.max_hr ?? d.max_heartrate) || 0;
          if (hr > maxHr) {
            maxHr = hr;
            maxHrDate = (d.date && String(d.date).trim()) || null;
          }
        }
        const yearlyRef = db.collection("users").doc(userId).collection("yearly_peaks").doc(String(year));
        if (Object.keys(maxByField).length === 0 && maxHr <= 0) {
          await yearlyRef.delete();
          usersDeleted++;
          continue;
        }
        const merged = { year, weight_kg: weightKg, updated_at: admin.firestore.FieldValue.serverTimestamp(), activity_type: contributingActivityType ?? null };
        for (const [field, watts] of Object.entries(maxByField)) {
          merged[field] = watts;
          merged[field.replace("_watts", "_wkg")] = Math.round((watts / weightKg) * 100) / 100;
        }
        if (maxHr > 0) {
          merged.max_hr = maxHr;
          if (maxHrDate) merged.max_hr_date = maxHrDate;
        }
        await yearlyRef.set(merged, { merge: true });
        usersUpdated++;
      }
      results[year] = { usersUpdated, usersDeleted };
    }
    res.status(200).json({ success: true, years, results });
  }
);

/** 기존 로그 기반 연간 최고 기록 백필 (관리자 수동 호출).
 *  ?year=2026 - 대상 연도
 *  ?userId=xxx - 특정 사용자만 처리 (선택)
 *  ?rebuildMaxHr=1 - userId와 함께 사용 시, yearly_peaks의 max_hr를 로그 기반으로 재계산하여 덮어씀 (5초평균 우선, 날짜 포함)
 *  ?userLimit=30 - 요청당 처리 사용자 수 (기본 30, userId 없을 때만)
 *  ?startAfterUserId=xxx - 이전 응답의 lastUserId로 이어서 실행 (배치 연속 처리) */
exports.backfillYearlyPeaks = onRequest(
  { cors: true, timeoutSeconds: 540 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
    if (isNaN(year) || year < 2020 || year > 2100) {
      return res.status(400).json({ success: false, error: "year 파라미터 필요 (2020~2100)" });
    }
    const userIdFilter = (req.query.userId || "").trim() || null;
    const rebuildMaxHr = req.query.rebuildMaxHr === "1" || req.query.rebuildMaxHr === "true";
    const userLimit = Math.min(100, Math.max(1, parseInt(req.query.userLimit || "30", 10) || 30));
    const startAfterUserId = (req.query.startAfterUserId || "").trim() || null;
    const { startStr, endStr } = getYearRangeSeoul(year);
    const db = admin.firestore();

    const doRebuildMaxHrForUser = async (uid) => {
      const logsSnap = await db.collection("users").doc(uid).collection("logs")
        .where("date", ">=", startStr)
        .where("date", "<=", endStr)
        .get();
      let bestMaxHr = 0;
      let bestDate = null;
      logsSnap.docs.forEach((doc) => {
        const d = doc.data();
        if (!isCyclingForMmp(d)) return;
        const hr = Number(d.max_hr_5sec ?? d.max_hr ?? d.max_heartrate) || 0;
        if (hr > bestMaxHr) {
          bestMaxHr = hr;
          bestDate = (d.date && String(d.date).trim()) || null;
        }
      });
      if (bestMaxHr > 0) {
        const yearlyRef = db.collection("users").doc(uid).collection("yearly_peaks").doc(String(year));
        await yearlyRef.set({
          max_hr: bestMaxHr,
          max_hr_date: bestDate || null,
          year: parseInt(String(year), 10),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return { bestMaxHr, bestDate, logsScanned: logsSnap.size };
    };

    if (userIdFilter && rebuildMaxHr) {
      const result = await doRebuildMaxHrForUser(userIdFilter);
      return res.status(200).json({
        success: true,
        mode: "rebuildMaxHr",
        year,
        userId: userIdFilter,
        max_hr: result.bestMaxHr,
        max_hr_date: result.bestDate,
        logsScanned: result.logsScanned,
      });
    }

    let usersSnap;
    if (userIdFilter) {
      const userDoc = await db.collection("users").doc(userIdFilter).get();
      usersSnap = userDoc.exists ? { docs: [userDoc] } : { docs: [] };
    } else {
      let usersQuery = db.collection("users").orderBy(admin.firestore.FieldPath.documentId()).limit(userLimit);
      if (startAfterUserId) {
        const startDoc = await db.collection("users").doc(startAfterUserId).get();
        if (startDoc.exists) usersQuery = usersQuery.startAfter(startDoc);
      }
      usersSnap = await usersQuery.get();
    }
    let processed = 0;
    let updated = 0;
    let lastUserId = null;
    if (rebuildMaxHr && !userIdFilter) {
      for (const userDoc of usersSnap.docs) {
        lastUserId = userDoc.id;
        try {
          const r = await doRebuildMaxHrForUser(lastUserId);
          processed++;
          if (r.bestMaxHr > 0) updated++;
        } catch (e) {
          console.warn("[backfillYearlyPeaks] rebuildMaxHr", lastUserId, e.message);
        }
      }
    } else {
      for (const userDoc of usersSnap.docs) {
        lastUserId = userDoc.id;
        const userData = userDoc.data();
        const logsSnap = await db.collection("users").doc(lastUserId).collection("logs")
          .where("date", ">=", startStr)
          .where("date", "<=", endStr)
          .get();
        for (const logDoc of logsSnap.docs) {
          processed++;
          try {
            await upsertYearlyPeakFromLog(db, lastUserId, userData, logDoc.data(), logDoc.id);
            updated++;
          } catch (e) {
            console.warn("[backfillYearlyPeaks]", lastUserId, logDoc.id, e.message);
          }
        }
      }
    }
    const hasMore = usersSnap.docs.length >= userLimit;
    let nextUrl = null;
    if (hasMore && lastUserId) {
      nextUrl = `?year=${year}&userLimit=${userLimit}&startAfterUserId=${encodeURIComponent(lastUserId)}`;
      if (rebuildMaxHr && !userIdFilter) nextUrl += "&rebuildMaxHr=1";
    }
    res.status(200).json({
      success: true,
      ...(rebuildMaxHr && !userIdFilter && { mode: "rebuildMaxHr" }),
      year, startStr, endStr, processed, updated,
      lastUserId, hasMore,
      nextUrl,
    });
  }
);

/** 의심 기록(Pending) 승인 → yearly_peaks에 반영. recordId: suspicious_power_records 문서 ID */
exports.approveSuspiciousPowerRecord = onRequest(
  { cors: true, timeoutSeconds: 60 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    const recordId = req.query.recordId || req.body?.recordId;
    if (!recordId) {
      return res.status(400).json({ success: false, error: "recordId 필요" });
    }
    const db = admin.firestore();
    const recRef = db.collection("suspicious_power_records").doc(recordId);
    const recSnap = await recRef.get();
    if (!recSnap.exists) {
      return res.status(404).json({ success: false, error: "기록 없음" });
    }
    const rec = recSnap.data();
    if (rec.status !== "pending") {
      return res.status(400).json({ success: false, error: "이미 처리됨" });
    }
    const { userId, year, durationType, watts, wkg, weightKg } = rec;
    const field = DURATION_FIELDS[durationType];
    if (!field) {
      return res.status(400).json({ success: false, error: "잘못된 durationType" });
    }
    const yearlyRef = db.collection("users").doc(userId).collection("yearly_peaks").doc(String(year));
    const yearlySnap = await yearlyRef.get();
    const current = yearlySnap.exists ? yearlySnap.data() : {};
    const prevWatts = Number(current[field]) || 0;
    if (watts <= prevWatts) {
      await recRef.update({ status: "rejected", updated_at: admin.firestore.FieldValue.serverTimestamp() });
      return res.status(200).json({ success: true, message: "기존 기록이 더 높아 반영하지 않음" });
    }
    await yearlyRef.set({
      [field]: watts,
      [field.replace("_watts", "_wkg")]: wkg,
      year,
      weight_kg: weightKg,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await recRef.update({ status: "approved", updated_at: admin.firestore.FieldValue.serverTimestamp() });
    res.status(200).json({ success: true, message: "승인 완료" });
  }
);

/** 월간 랭킹 확정 (매월 말일 23:00 Asia/Seoul) - Cloud Scheduler는 L(말일) 미지원 → 매일 23시 실행 후 말일만 처리 */
const finalizeMonthlyPeakOptions = {
  schedule: "0 23 * * *",
  timeZone: "Asia/Seoul",
  timeoutSeconds: 540,
};
exports.finalizeMonthlyPeakRanking = onSchedule(
  finalizeMonthlyPeakOptions,
  async (event) => {
    const now = new Date();
    const seoulDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const today = seoulDate.getDate();
    const lastDay = new Date(seoulDate.getFullYear(), seoulDate.getMonth() + 1, 0).getDate();
    if (today !== lastDay) {
      console.log("[finalizeMonthlyPeakRanking] 오늘은 말일이 아님, 스킵", { today, lastDay });
      return;
    }
    const db = admin.firestore();
    const { startStr, endStr } = getMonthRangeSeoul(seoulDate.getFullYear(), seoulDate.getMonth() + 1);
    const points = [100, 50, 30];
    for (const durationType of Object.keys(DURATION_FIELDS)) {
      for (const gender of ["all", "M", "F"]) {
        let byCategory;
        try {
          const sbPeak = await supabaseRankingReader.fetchPeakRewardRanking(
            admin,
            startStr,
            endStr,
            durationType,
            gender
          );
          byCategory = sbPeak && sbPeak.byCategory;
        } catch (eSbPeak) {
          console.error("[finalizeMonthlyPeakRanking] Supabase peak reward failed:", durationType, gender, eSbPeak && eSbPeak.message ? eSbPeak.message : eSbPeak);
          ({ byCategory } = await getPeakPowerRankingEntries(db, startStr, endStr, durationType, gender));
        }
        for (const cat of ["Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda"]) {
          const arr = (byCategory && byCategory[cat]) || [];
          const top3 = arr.slice(0, 3);
          for (let i = 0; i < top3.length; i++) {
            const u = top3[i];
            const userRef = db.collection("users").doc(u.userId);
            const snap = await userRef.get();
            if (!snap.exists) continue;
            const data = snap.data();
            const add = points[i];
            const rem = Number(data.rem_points || 0) + add;
            const acc = Number(data.acc_points || 0) + add;
            await userRef.update({ rem_points: rem, acc_points: acc });
            console.log("[finalizeMonthlyPeakRanking]", durationType, gender, cat, (i + 1) + "등", u.name, "+" + add + "SP");
          }
        }
      }
    }
    console.log("[finalizeMonthlyPeakRanking] 완료", { startStr, endStr });
  }
);

/** 연간 랭킹 확정 (매년 12월 31일 23:00 Asia/Seoul) */
const finalizeYearlyPeakOptions = {
  schedule: "0 23 31 12 *",
  timeZone: "Asia/Seoul",
  timeoutSeconds: 540,
};
exports.finalizeYearlyPeakRanking = onSchedule(
  finalizeYearlyPeakOptions,
  async (event) => {
    const db = admin.firestore();
    const year = new Date().getFullYear();
    const { startStr, endStr } = getYearRangeSeoul(year);
    const points = [100, 50, 30];
    for (const durationType of Object.keys(DURATION_FIELDS)) {
      for (const gender of ["all", "M", "F"]) {
        let byCategory;
        try {
          const sbPeak = await supabaseRankingReader.fetchPeakRewardRanking(
            admin,
            startStr,
            endStr,
            durationType,
            gender
          );
          byCategory = sbPeak && sbPeak.byCategory;
        } catch (eSbPeak) {
          console.error("[finalizeYearlyPeakRanking] Supabase peak reward failed:", durationType, gender, eSbPeak && eSbPeak.message ? eSbPeak.message : eSbPeak);
          ({ byCategory } = await getPeakPowerRankingEntries(db, startStr, endStr, durationType, gender));
        }
        for (const cat of ["Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda"]) {
          const arr = (byCategory && byCategory[cat]) || [];
          const top3 = arr.slice(0, 3);
          for (let i = 0; i < top3.length; i++) {
            const u = top3[i];
            const userRef = db.collection("users").doc(u.userId);
            const snap = await userRef.get();
            if (!snap.exists) continue;
            const data = snap.data();
            const add = points[i];
            const rem = Number(data.rem_points || 0) + add;
            const acc = Number(data.acc_points || 0) + add;
            await userRef.update({ rem_points: rem, acc_points: acc });
            console.log("[finalizeYearlyPeakRanking]", durationType, gender, cat, (i + 1) + "등", u.name, "+" + add + "SP");
          }
        }
      }
    }
    console.log("[finalizeYearlyPeakRanking] 완료", { startStr, endStr });
  }
);

// ---------- STELVIO AI 사용자 선택형 FTP 갱신: 제안 API (계산만, DB 미수정) ----------
/** Firebase ID 토큰 검증 헬퍼 */
async function getUidFromRequest(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: { code: "unauthenticated", message: "Authorization Bearer 토큰이 필요합니다." } });
    return null;
  }
  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid;
  } catch (e) {
    res.status(401).json({ error: { code: "unauthenticated", message: "유효하지 않거나 만료된 토큰입니다." } });
    return null;
  }
}

/** 최근 N일 날짜 문자열 (로컬 YYYY-MM-DD, Asia/Seoul 기준) */
function getDateStrDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** FTP 제안 계산: 로그·CTL 기반. DB 수정 없음. */
exports.getFtpSuggestion = onRequest(
  { cors: true, timeoutSeconds: 60 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.set("Access-Control-Max-Age", "3600");
      res.status(204).send("");
      return;
    }
    const origin = req.headers.origin;
    if (origin && CORS_ORIGINS.some((o) => (typeof o === "string" ? origin === o : o.test(origin)))) {
      res.set("Access-Control-Allow-Origin", origin);
    }
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    const uid = await getUidFromRequest(req, res);
    if (!uid) return;

    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      res.status(404).json({ error: { code: "not-found", message: "사용자를 찾을 수 없습니다." } });
      return;
    }
    const userData = userSnap.data() || {};
    const previousFtp = Math.round(Number(userData.ftp) || 200);
    const userName = (userData.name && String(userData.name).trim()) || "사용자";

    const todayStr = getDateStrDaysAgo(0);
    const start42Str = getDateStrDaysAgo(42);
    const start30Str = getDateStrDaysAgo(30);
    const start14Str = getDateStrDaysAgo(14);

    const logsSnap = await db.collection("users").doc(uid).collection("logs")
      .where("date", ">=", start42Str)
      .where("date", "<=", todayStr)
      .get();

    const byDate = {};
    logsSnap.docs.forEach((doc) => {
      const d = doc.data();
      if (!isCyclingForMmp(d)) return; // Run 등 비사이클링 Strava 로그는 FTP 제안에서 제외
      const dateStr = normalizeLogDateToSeoulYmd(d.date);
      if (!dateStr) return;
      const tss = Number(d.tss) || 0;
      const np = Number(d.np) || Number(d.avg_power) || Number(d.weighted_watts) || 0;
      const durationMin = Number(d.duration_min) || Math.round(Number(d.duration_sec || 0) / 60) || 0;
      const max30minWatts = Number(d.max_30min_watts) || 0;
      const isStrava = String(d.source || "").toLowerCase() === "strava";
      if (!byDate[dateStr]) byDate[dateStr] = { tss: 0, np: 0, durationMin: 0, max_30min_watts: 0, isStrava: false };
      const row = byDate[dateStr];
      row.max_30min_watts = Math.max(row.max_30min_watts || 0, max30minWatts);
      if (isStrava && row.tss === 0) {
        row.tss = tss;
        row.np = np;
        row.durationMin = durationMin;
        row.isStrava = true;
      } else if (!row.isStrava) {
        row.tss = tss;
        row.np = np;
        row.durationMin = durationMin;
      }
    });

    const sortedDates = Object.keys(byDate).sort();
    let last7Tss = 0;
    let last14Tss = 0;
    let last30Tss = 0;
    let last42Tss = 0;
    let lastTrainingDateStr = null;
    let bestMmp30ForFtp = 0;
    let bestNpForFtp = 0;

    sortedDates.forEach((dateStr) => {
      const row = byDate[dateStr];
      const tss = row.tss || 0;
      if (dateStr >= start14Str) last14Tss += tss;
      if (dateStr >= start30Str) last30Tss += tss;
      last42Tss += tss;
      if (dateStr >= start42Str) {
        const daysAgo = Math.floor((new Date(todayStr) - new Date(dateStr)) / 86400000);
        if (daysAgo <= 7) last7Tss += tss;
      }
      if (tss > 0) lastTrainingDateStr = dateStr;
      if (dateStr >= start30Str) {
        const mmp30 = Number(row.max_30min_watts) || 0;
        if (mmp30 > bestMmp30ForFtp) bestMmp30ForFtp = mmp30;
      }
      if (row.durationMin >= 15 && row.np > 0 && dateStr >= start30Str) {
        const estimatedFtp = Math.round(row.np * 0.95);
        if (estimatedFtp > bestNpForFtp) bestNpForFtp = estimatedFtp;
      }
    });

    const candidateFtp = Math.round(Math.max(bestMmp30ForFtp, bestNpForFtp));
    const upgradeSource = bestMmp30ForFtp >= bestNpForFtp ? "MMP30" : "NP";

    const daysSinceLastTraining = lastTrainingDateStr
      ? Math.floor((new Date(todayStr) - new Date(lastTrainingDateStr)) / 86400000)
      : 999;

    let hasSuggestion = false;
    let suggestionType = null;
    let suggestedFtp = previousFtp;
    let message = "제안 없음";
    let upgradeSourceOut = undefined;

    if (candidateFtp >= previousFtp * 1.02 && candidateFtp > previousFtp) {
      hasSuggestion = true;
      suggestionType = "UPGRADE";
      suggestedFtp = Math.min(candidateFtp, previousFtp + 30);
      suggestedFtp = Math.round(suggestedFtp);
      upgradeSourceOut = upgradeSource;
      message = upgradeSource === "MMP30"
        ? "최근 고강도 훈련(30분 MMP 기반)으로 상승 제안"
        : "최근 고강도 훈련(NP 기반)으로 상승 제안";
    } else if (daysSinceLastTraining >= 14 || (last7Tss < 20 && last42Tss < 150)) {
      const decayed = Math.round(previousFtp * 0.9);
      if (decayed < previousFtp && decayed >= 100) {
        hasSuggestion = true;
        suggestionType = "DECAY";
        suggestedFtp = Math.round(decayed / 5) * 5;
        message = "휴식/저부하 기간으로 보수적 하락 제안";
      }
    }

    const json = {
      hasSuggestion: !!hasSuggestion,
      suggestionType: suggestionType || undefined,
      previousFtp,
      suggestedFtp,
      message,
      userName,
    };
    if (upgradeSourceOut) json.upgradeSource = upgradeSourceOut;
    res.status(200).json(json);
  }
);

/** 사용자 FTP 승인 반영 API (POST). '예' 선택 시에만 호출. current_ftp 및 ftp_updated_at 갱신 */
exports.confirmFtp = onRequest(
  { cors: true, timeoutSeconds: 30 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.set("Access-Control-Max-Age", "3600");
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: { code: "method-not-allowed", message: "POST만 허용됩니다." } });
      return;
    }
    const origin = req.headers.origin;
    if (origin && CORS_ORIGINS.some((o) => (typeof o === "string" ? origin === o : o.test(origin)))) {
      res.set("Access-Control-Allow-Origin", origin);
    }
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    const uid = await getUidFromRequest(req, res);
    if (!uid) return;

    let body = {};
    try {
      body = typeof req.body === "object" && req.body !== null ? req.body : {};
    } catch (e) {
      res.status(400).json({ error: { code: "invalid-argument", message: "요청 본문이 올바르지 않습니다." } });
      return;
    }
    const suggestedFtp = Math.round(Number(body.suggestedFtp) || 0);
    if (suggestedFtp < 100 || suggestedFtp > 500) {
      res.status(400).json({ error: { code: "invalid-argument", message: "suggestedFtp는 100~500 범위여야 합니다." } });
      return;
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      res.status(404).json({ error: { code: "not-found", message: "사용자를 찾을 수 없습니다." } });
      return;
    }

    await userRef.update({
      ftp: suggestedFtp,
      ftp_updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({ success: true, ftp: suggestedFtp });
  }
);

// ---------- Strava activity_type 마이그레이션 (기존 로그에 activity_type 채우기) ----------
/** Strava Rate Limit: 100 req/15min, 1000/day. 호출 간 1초 딜레이 */
const MIGRATION_API_DELAY_MS = 1000;
/** 배치당 로그 수. hasMore 시 자동으로 다음 배치 호출(체이닝) */
const MIGRATION_BATCH_SIZE = 30;

/** 기존 Strava 로그에 activity_type 필드 채우기.
 *  한 번 호출하면 hasMore일 때 자동으로 다음 배치를 호출해 전체 마이그레이션 완료.
 *  GET/POST ?secret=INTERNAL_SYNC_SECRET&userId=선택&noChain=1 (체이닝 비활성화) */
exports.migrateStravaActivityType = onRequest(
  { cors: true, timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    const secret = req.query.secret || req.body?.secret || "";
    if (secret !== INTERNAL_SYNC_SECRET) {
      return res.status(403).json({ success: false, error: "인증 필요" });
    }
    const targetUserId = (req.query.userId || req.body?.userId || "").trim() || null;
    const noChain = req.query.noChain === "1" || req.body?.noChain === "1";
    const limitParam = parseInt(req.query.limit || req.body?.limit || String(MIGRATION_BATCH_SIZE), 10);
    const limit = isNaN(limitParam) || limitParam < 1 ? MIGRATION_BATCH_SIZE : Math.min(limitParam, 100);

    const db = admin.firestore();
    const userQuery = db.collection("users").where("strava_refresh_token", ">", "");
    const usersSnap = await (targetUserId
      ? db.collection("users").doc(targetUserId).get().then((s) => ({ docs: s.exists ? [s] : [] }))
      : userQuery.get());

    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      let accessToken = userData.strava_access_token || "";
      const expiresAt = Number(userData.strava_expires_at || 0);
      const now = Math.floor(Date.now() / 1000);
      if (!accessToken || expiresAt < now + 300) {
        try {
          const { accessToken: token } = await refreshStravaTokenForUser(db, userId);
          accessToken = token;
        } catch (e) {
          console.warn("[migrateStravaActivityType] 토큰 갱신 실패:", userId, e.message);
          totalErrors++;
          continue;
        }
      }

      const logsSnap = await db.collection("users").doc(userId).collection("logs")
        .where("source", "==", "strava")
        .get();

      const toUpdate = logsSnap.docs.filter((d) => {
        const t = String(d.data().activity_type || "").trim();
        return !t;
      });

      for (const logDoc of toUpdate) {
        if (totalUpdated >= limit) break; // limit 도달 시 조기 종료
        const data = logDoc.data();
        let activityId = data.activity_id ? String(data.activity_id) : null;
        if (!activityId) activityId = String(logDoc.id);
        if (!activityId) {
          totalSkipped++;
          continue;
        }
        if (totalUpdated + totalErrors > 0 && MIGRATION_API_DELAY_MS > 0) {
          await new Promise((r) => setTimeout(r, MIGRATION_API_DELAY_MS));
        }
        let result = await fetchStravaActivityDetail(accessToken, activityId);
        if (!result.success && data.activity_id !== logDoc.id && String(logDoc.id).match(/^\d+$/)) {
          result = await fetchStravaActivityDetail(accessToken, String(logDoc.id));
          if (result.success) activityId = String(logDoc.id);
        }
        let activityType;
        if (!result.success || !result.activity) {
          console.warn("[migrateStravaActivityType] API 실패:", userId, activityId, result.error);
          totalErrors++;
          activityType = "Unknown"; // 재시도 방지: 실패한 로그도 표시해 다음 실행에서 제외
        } else {
          activityType = String(result.activity.sport_type || result.activity.type || "").trim() || null;
        }
        await db.collection("users").doc(userId).collection("logs").doc(logDoc.id).update({
          activity_type: activityType,
        });
        totalUpdated++;
      }
      if (totalUpdated >= limit) break; // 사용자 루프도 종료
    }

    const hasMore = totalUpdated >= limit;
    const payload = {
      success: true,
      updated: totalUpdated,
      skipped: totalSkipped,
      errors: totalErrors,
      hasMore,
      chained: false,
    };

    // hasMore일 때 자동으로 다음 배치 호출 (체이닝)
    if (hasMore && !noChain) {
      try {
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = req.headers.host || req.get?.("host");
        const path = (req.url && req.url.split("?")[0]) || "/migrateStravaActivityType";
        const params = new URLSearchParams({ secret, limit: String(limit) });
        if (targetUserId) params.set("userId", targetUserId);
        const nextUrl = `${protocol}://${host}${path}?${params.toString()}`;
        fetch(nextUrl).catch((e) => console.warn("[migrateStravaActivityType] 체이닝 호출 실패:", e.message));
        payload.chained = true;
      } catch (e) {
        console.warn("[migrateStravaActivityType] 체이닝 URL 생성 실패:", e.message);
      }
    }

    res.status(200).json(payload);
  }
);

/** 전체 사용자 로그에 activity_type 채우기 (Strava+Stelvio 통합).
 *  Strava: 토큰 있으면 API 조회, 없으면 Unknown. Stelvio: Stelvio.
 *  ?secret=INTERNAL_SYNC_SECRET (선택: userId, limit, noChain) */
exports.migrateAllLogsActivityType = onRequest(
  { cors: true, timeoutSeconds: 300 },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    res.set("Access-Control-Allow-Origin", "*");
    const secret = req.query.secret || req.body?.secret || "";
    if (secret !== INTERNAL_SYNC_SECRET) {
      return res.status(403).json({ success: false, error: "인증 필요" });
    }
    const targetUserId = (req.query.userId || req.body?.userId || "").trim() || null;
    const limitParam = parseInt(req.query.limit || req.body?.limit || "100", 10);
    const limit = isNaN(limitParam) || limitParam < 1 ? 100 : Math.min(limitParam, 500);
    const noChain = req.query.noChain === "1" || req.body?.noChain === "1";

    const db = admin.firestore();
    const usersSnap = targetUserId
      ? await db.collection("users").doc(targetUserId).get().then((s) => ({ docs: s.exists ? [s] : [] }))
      : await db.collection("users").get();

    let stravaUpdated = 0;
    let stelvioUpdated = 0;
    let stravaErrors = 0;

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      const logsSnap = await db.collection("users").doc(userId).collection("logs").get();
      const toUpdate = logsSnap.docs.filter((d) => !String(d.data().activity_type || "").trim());
      if (toUpdate.length === 0) continue;

      const hasStravaToken = !!(userData.strava_refresh_token && String(userData.strava_refresh_token).trim());
      let accessToken = null;
      if (hasStravaToken) {
        try {
          const { accessToken: token } = await refreshStravaTokenForUser(db, userId);
          accessToken = token;
        } catch (e) {
          console.warn("[migrateAllLogsActivityType] 토큰 갱신 실패:", userId, e.message);
        }
      }

      for (const logDoc of toUpdate) {
        if (stravaUpdated + stelvioUpdated >= limit) break;
        const d = logDoc.data();
        const src = String(d.source || "").toLowerCase();
        let activityType;

        if (src === "strava") {
          let activityId = d.activity_id ? String(d.activity_id) : String(logDoc.id);
          if (accessToken && activityId) {
            if (stravaUpdated + stravaErrors > 0 && MIGRATION_API_DELAY_MS > 0) {
              await new Promise((r) => setTimeout(r, MIGRATION_API_DELAY_MS));
            }
            let result = await fetchStravaActivityDetail(accessToken, activityId);
            if (!result.success && d.activity_id !== logDoc.id && String(logDoc.id).match(/^\d+$/)) {
              result = await fetchStravaActivityDetail(accessToken, String(logDoc.id));
            }
            if (result.success && result.activity) {
              activityType = String(result.activity.sport_type || result.activity.type || "").trim() || null;
            }
            if (!activityType) {
              stravaErrors++;
              activityType = "Unknown";
            }
          } else {
            activityType = "Unknown";
          }
          await logDoc.ref.update({ activity_type: activityType });
          stravaUpdated++;
        } else {
          activityType = d.activity_type || "Stelvio";
          await logDoc.ref.update({ source: src || "stelvio", activity_type: activityType });
          stelvioUpdated++;
        }
      }
      if (stravaUpdated + stelvioUpdated >= limit) break;
    }

    const hasMore = stravaUpdated + stelvioUpdated >= limit;
    const payload = { success: true, stravaUpdated, stelvioUpdated, stravaErrors, hasMore, chained: false };

    if (hasMore && !noChain) {
      try {
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = req.headers.host || req.get?.("host");
        const params = new URLSearchParams({ secret, limit: String(limit) });
        if (targetUserId) params.set("userId", targetUserId);
        const nextUrl = `${protocol}://${host}/?${params.toString()}`;
        fetch(nextUrl).catch((e) => console.warn("[migrateAllLogsActivityType] 체이닝 실패:", e.message));
        payload.chained = true;
      } catch (e) { /* ignore */ }
    }
    res.status(200).json(payload);
  }
);

/** 기존 Stelvio 로그에 source, activity_type 추가. ?secret=INTERNAL_SYNC_SECRET */
exports.migrateStelvioLogActivityType = onRequest(
  { cors: true, timeoutSeconds: 300 },
  async (req, res) => {
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    res.set("Access-Control-Allow-Origin", "*");
    const secret = req.query.secret || req.body?.secret || "";
    if (secret !== INTERNAL_SYNC_SECRET) {
      return res.status(403).json({ success: false, error: "인증 필요" });
    }
    const db = admin.firestore();
    const usersSnap = await db.collection("users").get();
    let updated = 0;
    let batch = db.batch();
    let batchCount = 0;
    for (const userDoc of usersSnap.docs) {
      const logsSnap = await db.collection("users").doc(userDoc.id).collection("logs").get();
      for (const logDoc of logsSnap.docs) {
        const d = logDoc.data();
        const src = String(d.source || "").toLowerCase();
        if (src === "strava") continue; // Strava는 migrateStravaActivityType에서 처리
        const hasType = String(d.activity_type || "").trim();
        if (hasType && src) continue; // 이미 있으면 스킵
        batch.update(logDoc.ref, {
          source: src || "stelvio",
          activity_type: d.activity_type || "Stelvio",
        });
        updated++;
        batchCount++;
        if (batchCount >= 500) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }
    if (batchCount > 0) await batch.commit();
    res.status(200).json({ success: true, updated });
  }
);

// ---------- Strava Webhook 비동기 처리 (processStravaActivity는 lib에서 호출) ----------
exports.processStravaActivity = processStravaActivity;
exports.processOneUserStravaSync = processOneUserStravaSync;
exports.runStravaSyncForRange = runStravaSyncForRange;
/** 러닝 Webhook 라우팅·processRunningActivity 전용 — 사이클 함수 본문 변경 없음 */
exports.refreshStravaTokenForUser = refreshStravaTokenForUser;
exports.fetchStravaActivityDetail = fetchStravaActivityDetail;

// ---------- VO₂max 연령·성별 Stelvio 실제 평균 집계 (샘플 기여 → 일별 롤링 통계) ----------
const { rebuildVo2StelvioRollingStats } = require("./vo2DemographicStats");
exports.rebuildVo2StelvioRollingStats = onSchedule(
  {
    schedule: "0 4 * * *",
    timeZone: "Asia/Seoul",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    const db = admin.firestore();
    try {
      const r = await rebuildVo2StelvioRollingStats(db);
      console.log("[rebuildVo2StelvioRollingStats] ok", r);
    } catch (e) {
      console.error("[rebuildVo2StelvioRollingStats]", e && e.message ? e.message : e);
      throw e;
    }
  }
);

// ---------- 훈련 트렌드 Fitness(Fitness) 전 사용자 평균 (샘플 → stats_fitness_stelvio_rolling) ----------
const { rebuildFitnessStelvioRollingStats, rebuildRunFitnessStelvioRollingStats } = require("./fitnessDemographicStats");
exports.rebuildFitnessStelvioRollingStats = onSchedule(
  {
    schedule: "30 4 * * *",
    timeZone: "Asia/Seoul",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    const db = admin.firestore();
    try {
      const r = await rebuildFitnessStelvioRollingStats(db);
      console.log("[rebuildFitnessStelvioRollingStats] ok", r);
      const rRun = await rebuildRunFitnessStelvioRollingStats(db);
      console.log("[rebuildRunFitnessStelvioRollingStats] ok", rRun);
    } catch (e) {
      console.error("[rebuildFitnessStelvioRollingStats]", e && e.message ? e.message : e);
      throw e;
    }
  }
);

// ---------- 주간 TSS(30주 창) 전 사용자 평균 (샘플 → stats_weekly_tss_stelvio_rolling) ----------
const { rebuildWeeklyTssStelvioRollingStats } = require("./weeklyTssDemographicStats");
exports.rebuildWeeklyTssStelvioRollingStats = onSchedule(
  {
    schedule: "45 4 * * *",
    timeZone: "Asia/Seoul",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    const db = admin.firestore();
    try {
      const r = await rebuildWeeklyTssStelvioRollingStats(db);
      console.log("[rebuildWeeklyTssStelvioRollingStats] ok", r);
    } catch (e) {
      console.error("[rebuildWeeklyTssStelvioRollingStats]", e && e.message ? e.message : e);
      throw e;
    }
  }
);

// ---------- Strava TSS 일괄 재계산 (잘못 저장된 기간의 TSS 정정) ----------
/**
 * HTTP Callable: 특정 날짜 범위의 모든 사용자 Strava 로그 TSS 재계산·정정
 * 용도: 2026-05-09~05-12 기간 TSS 계산 버그(tssPerKJ 가드레일 미적용으로 4173·9927 등 과대값)
 *       로 저장된 데이터를 올바른 값으로 정정.
 *
 * 호출 파라미터 (HTTPS onCall):
 *   startDate: "YYYY-MM-DD"  (기본값: "2026-05-09")
 *   endDate:   "YYYY-MM-DD"  (기본값: "2026-05-12")
 *   dryRun:    boolean       (true이면 실제 쓰기 없이 리포트만 반환)
 *
 * 보안: Firebase Auth 어드민 토큰 필요 (customClaims.admin === true)
 */
exports.fixStravaTssBatch = functions
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .https.onCall(async (data, context) => {
    // 어드민 권한 확인
    if (!context.auth || !context.auth.token || context.auth.token.admin !== true) {
      throw new functions.https.HttpsError("permission-denied", "어드민 권한이 필요합니다.");
    }

    const db = admin.firestore();
    const startDate = (data && data.startDate) || "2026-05-09";
    const endDate   = (data && data.endDate)   || "2026-05-12";
    const dryRun    = !!(data && data.dryRun);

    console.log(`[fixStravaTssBatch] 시작: ${startDate} ~ ${endDate}, dryRun=${dryRun}`);

    // 모든 사용자 목록
    const usersSnap = await db.collection("users").get();
    const results = { total: 0, updated: 0, skipped: 0, errors: 0, details: [] };

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data() || {};
      // 체중: 프로필에서 읽기 (없으면 기본값 70kg)
      const weightKg = (Number(userData.weight) > 0 ? Number(userData.weight)
        : (Number(userData.weightKg) > 0 ? Number(userData.weightKg) : STELVIO_RTSS_DEFAULT_WEIGHT_KG));

      let logsSnap;
      try {
        logsSnap = await db.collection("users").doc(userId).collection("logs")
          .where("source", "==", "strava")
          .where("date", ">=", startDate)
          .where("date", "<=", endDate)
          .get();
      } catch (e) {
        results.errors++;
        console.error(`[fixStravaTssBatch] 사용자 ${userId} 조회 오류:`, e.message);
        continue;
      }

      if (logsSnap.empty) continue;

      let batch = db.batch();
      let batchCount = 0;

      for (const logDoc of logsSnap.docs) {
        results.total++;
        const log = logDoc.data() || {};

        const durationSec = Number(log.duration_sec || log.time) || 0;
        const avgWatts    = log.avg_watts != null ? Number(log.avg_watts) : null;
        const weightedWatts = log.weighted_watts != null ? Number(log.weighted_watts) : null;
        const ftpAtTime   = Number(log.ftp_at_time) || 0;
        const oldTss      = Number(log.tss) || 0;

        // 재계산에 필요한 데이터가 없으면 건너뜀
        if (durationSec <= 0 || ftpAtTime <= 0) {
          results.skipped++;
          continue;
        }

        const np = weightedWatts != null ? weightedWatts : (avgWatts != null ? avgWatts : 0);
        const avgForTss = (avgWatts != null && avgWatts > 0) ? avgWatts : np;
        if (np <= 0 || avgForTss <= 0) {
          results.skipped++;
          continue;
        }

        const newTss = Math.max(0, calculateStelvioRevisedTSS(durationSec, avgForTss, np, ftpAtTime, weightKg));

        // TSS 값이 바뀐 경우만 업데이트
        if (Math.abs(newTss - oldTss) < 0.05) {
          results.skipped++;
          continue;
        }

        results.details.push({
          userId,
          logId: logDoc.id,
          date: log.date,
          oldTss,
          newTss,
          durationSec,
          np: Math.round(np),
          ftp: ftpAtTime,
        });

        if (!dryRun) {
          batch.update(logDoc.ref, { tss: newTss, tss_recalculated_at: new Date().toISOString() });
          batchCount++;
          if (batchCount >= 400) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
          }
        }
        results.updated++;
      }

      if (!dryRun && batchCount > 0) {
        await batch.commit();
      }
    }

    console.log(`[fixStravaTssBatch] 완료: total=${results.total}, updated=${results.updated}, skipped=${results.skipped}, errors=${results.errors}`);
    return {
      success: true,
      dryRun,
      startDate,
      endDate,
      total: results.total,
      updated: results.updated,
      skipped: results.skipped,
      errors: results.errors,
      details: results.details.slice(0, 200), // 최대 200건 리포트
    };
  });

// ---------- Supabase Auth Bridge (Firebase ID Token → Custom JWT) ----------
const supabaseAuthBridge = require("./supabaseAuthBridge");
const supabaseUserProvision = require("./supabaseUserProvision");
const deleteUserAccount = require("./deleteUserAccount");

const mintSupabaseSessionConfig = {
  cors: CORS_ORIGINS,
  secrets: [supabaseAuthBridge.supabaseCustomPrivateKey],
};

exports.mintSupabaseSessionHttp = onRequest(
  mintSupabaseSessionConfig,
  async (req, res) => {
    await supabaseAuthBridge.handleMintSupabaseSession(
      req,
      res,
      admin,
      setCorsHeaders
    );
  }
);

const provisionSupabaseUserConfig = supabaseDualWriteServer.appendServiceRoleSecret({
  cors: CORS_ORIGINS,
  timeoutSeconds: 30,
});

exports.provisionSupabaseUserAfterProfileHttp = onRequest(
  provisionSupabaseUserConfig,
  async (req, res) => {
    await supabaseUserProvision.handleProvisionSupabaseUserAfterProfile(
      req,
      res,
      admin,
      setCorsHeaders
    );
  }
);

const deleteUserAccountConfig = supabaseDualWriteServer.appendServiceRoleSecret({
  cors: CORS_ORIGINS,
  timeoutSeconds: 120,
  memory: "512MiB",
});

exports.deleteUserAccountHttp = onRequest(
  deleteUserAccountConfig,
  async (req, res) => {
    await deleteUserAccount.handleDeleteUserAccountHttp(req, res, admin, setCorsHeaders);
  }
);

const USER_PROFILE_SYNC_FIELDS = [
  "gender",
  "sex",
  "name",
  "displayName",
  "contact",
  "phone",
  "phoneNumber",
  "tel",
  "birth_year",
  "birthYear",
  "weight",
  "weightKg",
  "weight_kg",
  "ftp",
  "challenge",
  "grade",
  "email",
  "account_status",
  "expiry_date",
  "subscription_end_date",
  "is_private",
  "profileImageUrl",
  "profile_image_url",
  "rankingFavoriteUserIds",
  "starredUsers",
  "rankingFavoritesUpdatedAt",
  "rankingFavoritesSchemaVersion",
];

function userProfileFieldsChanged(before, after) {
  if (!before) return true;
  return USER_PROFILE_SYNC_FIELDS.some((key) => before[key] !== after[key]);
}

/** Firestore users/{userId} 프로필 변경 → Supabase public.users 동기화 (gender 포함) */
exports.onUserProfileWritten = functions
  .runWith({ timeoutSeconds: 60, secrets: ["SUPABASE_SERVICE_ROLE_KEY"] })
  .firestore.document("users/{userId}")
  .onWrite(async (change, context) => {
    const userId = context.params.userId;
    if (!userId || !change.after.exists) return;

    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.data() || {};
    if (!userProfileFieldsChanged(before, after)) return;

    try {
      await supabaseUserProvision.upsertSupabaseUserProfileFromFirestore(admin, userId, {
        ensureAuth: false,
        requireNameContact: false,
      });
    } catch (e) {
      console.warn("[onUserProfileWritten] Supabase profile sync failed:", userId, e.message || e);
    }

    // 비공개(is_private) 변경 시 랭킹 캐시 버전을 올린다.
    // 클라이언트가 이 버전을 리더보드 요청 URL에 붙여, 토글 즉시 CDN 캐시를 무효화(즉시 반영)한다.
    try {
      const wasPrivate = before ? before.is_private === true : false;
      const nowPrivate = after.is_private === true;
      if (!before || wasPrivate !== nowPrivate) {
        await admin
          .firestore()
          .collection("ranking_meta")
          .doc("run_privacy_version")
          .set(
            {
              version: admin.firestore.FieldValue.increment(1),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              lastUserId: userId,
            },
            { merge: true }
          );
      }
    } catch (e) {
      console.warn("[onUserProfileWritten] privacy version bump failed:", userId, e.message || e);
    }
  });

/**
 * 관리자(grade=1): Firestore 랭킹 공개 프로필(gender/sex, is_private, 프로필 이미지)
 * → Supabase users 백필 (배치). 트리거 배포 이전에 비공개로 설정된 사용자를 정정한다.
 * body/query: startAfterUid, maxUsers (기본 500, 최대 5000), dryRun
 */
exports.adminBackfillSupabaseUserGender = onRequest(
  supabaseDualWriteServer.appendServiceRoleSecret({ cors: true, timeoutSeconds: 540, memory: "1GiB" }),
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "POST만 지원합니다." });
      return;
    }

    const uid = await getUidFromRequest(req, res);
    if (!uid) return;

    try {
      await rankingReadRoutingAdmin.assertAdminGrade1(admin, uid);
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const startAfterUid = String(body.startAfterUid || req.query.startAfterUid || "").trim();
      const maxUsers = Math.max(
        1,
        Math.min(5000, Number(body.maxUsers || req.query.maxUsers || 500) || 500)
      );
      const dryRun = String(body.dryRun ?? req.query.dryRun ?? "false").toLowerCase() === "true";

      const stats = await supabaseUserProvision.backfillSupabaseUserGenderFromFirestore(admin, {
        startAfterUid,
        maxUsers,
        dryRun,
      });

      res.status(200).json({
        success: true,
        message: dryRun
          ? "Firestore gender 소스 집계 (dry-run, Supabase 미갱신)"
          : "Supabase users 프로필(gender·is_private·프로필이미지) 백필 배치 완료",
        ...stats,
      });
    } catch (e) {
      const status = e.status || 500;
      console.warn("[adminBackfillSupabaseUserGender]", e.message || e);
      res.status(status).json({
        success: false,
        error: e.message || String(e),
      });
    }
  }
);

// ---------- STELVIO AI 네이버 구독 자동화 (30분 스케줄, TypeScript 빌드 결과 사용) ----------
const path = require("path");
const fs = require("fs");
const libPath = path.join(__dirname, "lib", "index.js");
if (fs.existsSync(libPath)) {
  try {
    const naverSubscription = require("./lib/index.js");
    if (naverSubscription && naverSubscription.naverSubscriptionSyncSchedule) {
      exports.naverSubscriptionSyncSchedule = naverSubscription.naverSubscriptionSyncSchedule;
    }
    if (naverSubscription && naverSubscription.naverSubscriptionSyncTest) {
      exports.naverSubscriptionSyncTest = naverSubscription.naverSubscriptionSyncTest;
    }
    if (naverSubscription && naverSubscription.stravaWebhook) {
      exports.stravaWebhook = naverSubscription.stravaWebhook;
    }
    if (naverSubscription && naverSubscription.meetupInviteAlimtalkHttpsRelay) {
      exports.meetupInviteAlimtalkHttpsRelay = naverSubscription.meetupInviteAlimtalkHttpsRelay;
    }
    if (naverSubscription && naverSubscription.missionSubscriptionAlimtalkHttpsRelay) {
      exports.missionSubscriptionAlimtalkHttpsRelay = naverSubscription.missionSubscriptionAlimtalkHttpsRelay;
    }
    if (naverSubscription && naverSubscription.onRideCreatedMeetupInviteAlimtalk) {
      exports.onRideCreatedMeetupInviteAlimtalk = naverSubscription.onRideCreatedMeetupInviteAlimtalk;
    }
    if (naverSubscription && naverSubscription.onIndoorLogCreatedReward) {
      exports.onIndoorLogCreatedReward = naverSubscription.onIndoorLogCreatedReward;
    }
    if (naverSubscription && naverSubscription.verifyMeetingAttendance) {
      exports.verifyMeetingAttendance = naverSubscription.verifyMeetingAttendance;
    }
    if (naverSubscription && naverSubscription.scheduledRideAttendanceVerification) {
      exports.scheduledRideAttendanceVerification = naverSubscription.scheduledRideAttendanceVerification;
    }
  } catch (e) {
    console.warn("[Functions] Naver 구독 모듈 로드 실패:", e.message);
  }
}

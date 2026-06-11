/**
 * Strava Run 구간 피크 속도·심박 → Supabase run_activity_efforts.
 * processRunningActivity 직후 호출.
 *
 * [사이클 영향 검토]
 * - index.js 사이클 함수·rides 테이블: 미접촉
 */
const admin = require("firebase-admin");
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

/** Strava best_efforts 에서 직접 매핑 */
const BEST_EFFORT_DISTANCE_TARGETS = {
  "1k": 1000,
  "5k": 5000,
  "10k": 10000,
};

/** Streams 슬라이딩 윈도우로 계산 */
const STREAM_DISTANCE_TARGETS = {
  "3k": 3000,
  "7k": 7000,
  "20k": 20000,
  "42k": 42000,
};

const EFFORT_NAME_ALIASES = {
  "1k": ["1k", "1km", "1 kilometer", "1 kilometres"],
  "3k": ["3k", "3km", "3 kilometer", "3 kilometres"],
  "5k": ["5k", "5km", "5 kilometer", "5 kilometres"],
  "7k": ["7k", "7km", "7 kilometer", "7 kilometres"],
  "10k": ["10k", "10km", "10 kilometer", "10 kilometres"],
  "20k": ["20k", "20km", "20 kilometer", "20 kilometres"],
  "42k": ["42k", "42km", "42 kilometer", "42 kilometres", "marathon", "fullmarathon"],
};

const STRAVA_CALL_DELAY_MS = 9000;

function num(v, fallback = null) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function int(v, fallback = null) {
  const n = num(v, fallback);
  return n == null ? fallback : Math.trunc(n);
}

function normalizeEffortName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function effortNameMatches(label, effortName) {
  const normalized = normalizeEffortName(effortName);
  if (!normalized) return false;
  const aliases = EFFORT_NAME_ALIASES[label] || [label];
  return aliases.some((alias) => {
    const a = normalizeEffortName(alias);
    return normalized === a || normalized.includes(a) || a.includes(normalized);
  });
}

/**
 * @param {object[]} bestEfforts Strava best_efforts
 * @param {string} label '1k'|'5k'|'10k' 등
 */
function findBestEffortByLabel(bestEfforts, label) {
  const targetM = BEST_EFFORT_DISTANCE_TARGETS[label];
  if (!Array.isArray(bestEfforts) || !targetM) return null;
  for (const effort of bestEfforts) {
    if (!effort || typeof effort !== "object") continue;
    const dist = num(effort.distance);
    const nameOk = effortNameMatches(label, effort.name);
    const distOk = dist != null && Math.abs(dist - targetM) <= 80;
    if (nameOk || distOk) return effort;
  }
  return null;
}

/**
 * @param {object} effort
 * @param {number|null} fallbackHr 활동 전체 평균 심박
 */
function extractSpeedAndHrFromBestEffort(effort, fallbackHr) {
  if (!effort) return { speed: null, hr: null };
  const distance = num(effort.distance);
  const elapsed = int(effort.elapsed_time) || int(effort.moving_time);
  if (!distance || !elapsed || elapsed <= 0) return { speed: null, hr: null };
  const speed = distance / elapsed;
  const hr =
    int(effort.average_heartrate, null) ??
    int(effort.avg_heartrate, null) ??
    (fallbackHr != null ? int(fallbackHr, null) : null);
  return { speed, hr };
}

async function waitForStravaRateLimit(res) {
  const resetHeader = res.headers.get("x-ratelimit-usage") || res.headers.get("X-RateLimit-Usage");
  let waitMs = 60000;
  if (resetHeader) {
    const parts = String(resetHeader).split(",");
    if (parts.length >= 2) {
      const shortLimit = Number(parts[1]);
      if (Number.isFinite(shortLimit) && shortLimit > 0) waitMs = Math.min(900000, shortLimit * 1000 + 5000);
    }
  }
  await new Promise((r) => setTimeout(r, waitMs));
}

/** Strava Streams — time, distance, heartrate (러닝 구간 슬라이딩용) */
async function fetchStravaRunStreams(accessToken, activityId) {
  const url =
    `https://www.strava.com/api/v3/activities/${activityId}/streams` +
    `?keys=time,distance,heartrate&key_by_type=true`;
  const maxRetries = 5;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, STRAVA_CALL_DELAY_MS));
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.status === 429) {
        await waitForStravaRateLimit(res);
        continue;
      }
      if (!res.ok) {
        return { success: false, status: res.status, error: `Strava streams ${res.status}` };
      }
      const raw = await res.json().catch(() => null);
      const extractData = (key) => {
        if (!raw || typeof raw !== "object") return null;
        const node = raw[key];
        if (Array.isArray(node)) return node;
        if (node && Array.isArray(node.data)) return node.data;
        return null;
      };
      let time = extractData("time");
      let distance = extractData("distance");
      let heartrate = extractData("heartrate");
      if ((!time || !distance) && Array.isArray(raw)) {
        for (const s of raw) {
          const t = String(s && s.type ? s.type : "").toLowerCase();
          if (t === "time" && Array.isArray(s.data)) time = s.data;
          if (t === "distance" && Array.isArray(s.data)) distance = s.data;
          if (t === "heartrate" && Array.isArray(s.data)) heartrate = s.data;
        }
      }
      if (!time || !distance || time.length < 2 || distance.length < 2) {
        return { success: false, error: "streams time/distance 부족" };
      }
      const n = Math.min(time.length, distance.length);
      return {
        success: true,
        time: time.slice(0, n).map((v) => Number(v) || 0),
        distance: distance.slice(0, n).map((v) => Number(v) || 0),
        heartrate: heartrate ? heartrate.slice(0, n).map((v) => Number(v) || 0) : null,
      };
    } catch (e) {
      if (attempt === maxRetries) {
        return { success: false, error: e && e.message ? e.message : String(e) };
      }
    }
  }
  return { success: false, error: "Strava streams 429 retries exhausted" };
}

/**
 * 거리 차이 >= targetDistanceM 인 윈도우 중 elapsed(time) 최소 구간.
 * @returns {{ speed: number, hr: number|null }|null} speed m/s, hr = 구간 최고 심박
 */
function findFastestDistanceWindow(timeArr, distanceArr, hrArr, targetDistanceM) {
  const n = Math.min(timeArr.length, distanceArr.length);
  if (n < 2 || targetDistanceM <= 0) return null;

  let bestElapsed = null;
  let bestStart = -1;
  let bestEnd = -1;

  let left = 0;
  for (let right = 1; right < n; right++) {
    while (left < right && distanceArr[right] - distanceArr[left] >= targetDistanceM) {
      const elapsed = timeArr[right] - timeArr[left];
      if (elapsed > 0 && (bestElapsed == null || elapsed < bestElapsed)) {
        bestElapsed = elapsed;
        bestStart = left;
        bestEnd = right;
      }
      left += 1;
    }
  }

  if (bestElapsed == null || bestStart < 0 || bestEnd < 0) return null;

  const speed = targetDistanceM / bestElapsed;
  let hr = null;
  if (hrArr && hrArr.length > bestEnd) {
    let maxHr = 0;
    let found = false;
    for (let i = bestStart; i <= bestEnd; i++) {
      const h = int(hrArr[i], 0) || 0;
      if (h > 0) {
        found = true;
        if (h > maxHr) maxHr = h;
      }
    }
    if (found) hr = maxHr;
  }
  return { speed, hr };
}

function buildEmptyEffortsRow() {
  return {
    speed_1k: null,
    speed_3k: null,
    speed_5k: null,
    speed_7k: null,
    speed_10k: null,
    speed_20k: null,
    speed_42k: null,
    hr_1k: null,
    hr_3k: null,
    hr_5k: null,
    hr_7k: null,
    hr_10k: null,
    hr_20k: null,
    hr_42k: null,
  };
}

function minStreamDistanceNeeded(totalDistanceM) {
  const targets = Object.values(STREAM_DISTANCE_TARGETS);
  const eligible = targets.filter((m) => totalDistanceM >= m);
  return eligible.length > 0 ? Math.min(...eligible) : null;
}

/**
 * @param {object} activity Strava Detailed Activity
 * @param {string} accessToken
 */
async function computeRunEffortsFromActivity(activity, accessToken) {
  const out = buildEmptyEffortsRow();
  const fallbackHr = int(activity.average_heartrate, null);
  const bestEfforts = Array.isArray(activity.best_efforts) ? activity.best_efforts : [];
  const totalDistanceM = num(activity.distance) || 0;

  for (const label of Object.keys(BEST_EFFORT_DISTANCE_TARGETS)) {
    const effort = findBestEffortByLabel(bestEfforts, label);
    const { speed, hr } = extractSpeedAndHrFromBestEffort(effort, fallbackHr);
    out[`speed_${label}`] = speed;
    out[`hr_${label}`] = hr;
  }

  const streamThresholdM = minStreamDistanceNeeded(totalDistanceM);
  if (streamThresholdM != null && accessToken) {
    const streams = await fetchStravaRunStreams(accessToken, String(activity.id));
    if (streams.success) {
      for (const [label, targetM] of Object.entries(STREAM_DISTANCE_TARGETS)) {
        if (totalDistanceM < targetM) continue;
        const maxDist = streams.distance[streams.distance.length - 1] - streams.distance[0];
        if (maxDist < targetM) continue;
        const window = findFastestDistanceWindow(
          streams.time,
          streams.distance,
          streams.heartrate,
          targetM
        );
        if (window) {
          out[`speed_${label}`] = window.speed;
          out[`hr_${label}`] = window.hr;
        }
      }
    } else {
      console.warn("[calculateAndSaveRunEfforts] streams 조회 실패:", streams.error || streams.status);
    }
  }

  return out;
}

async function upsertRunEffortsToSupabase(firebaseUid, activityId, effortsRow) {
  await supabaseDualWriteServer.refreshDualRunFromRemoteConfig(admin, true);
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const uidConfig = {
    uidNamespace: String(supabaseDualWriteServer.uidNamespaceParam.value() || "").trim(),
    uidMode: String(supabaseDualWriteServer.uidModeParam.value() || "v5").trim(),
  };
  const userId = supabaseDualWriteServer.resolveUserUuid(
    firebaseUid,
    uidConfig.uidNamespace,
    uidConfig.uidMode
  );
  if (!userId) throw new Error("resolveUserUuid failed");

  const row = {
    user_id: userId,
    activity_id: String(activityId),
    ...effortsRow,
    updated_at: new Date().toISOString(),
  };

  async function writeOnce() {
    const { error } = await supabase.from("run_activity_efforts").upsert(row, {
      onConflict: "user_id,activity_id",
      ignoreDuplicates: false,
    });
    if (error) throw error;
  }

  try {
    await writeOnce();
  } catch (error) {
    const msg = error && error.message ? error.message : String(error);
    if (!/run_activity_efforts|activities|users.*fkey|23503/i.test(msg)) {
      throw error;
    }
    const supabaseUserProvision = require("./supabaseUserProvision");
    await supabaseUserProvision.provisionSupabaseUserAfterProfile(admin, firebaseUid);
    row.user_id = await supabaseDualWriteServer.resolveRideUserIdForFirebaseUid(
      supabase,
      firebaseUid,
      uidConfig
    );
    await writeOnce();
  }
}

/**
 * Strava Run 활동 → 구간 피크 계산 후 run_activity_efforts upsert.
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {string} firebaseUid
 * @param {object} activity Strava Detailed Activity (best_efforts 포함)
 * @param {string} [accessToken] Streams API용 (없으면 자동 갱신)
 */
async function calculateAndSaveRunEfforts(db, firebaseUid, activity, accessToken) {
  if (!activity || !firebaseUid) {
    throw new Error("calculateAndSaveRunEfforts: activity 또는 firebaseUid 없음");
  }

  let token = String(accessToken || "").trim();
  if (!token) {
    const userSnap = await db.collection("users").doc(firebaseUid).get();
    if (!userSnap.exists) throw new Error("user_not_found");
    const userData = userSnap.data() || {};
    const mainModule = require("./index.js");
    const tokenExpiresAt = Number(userData.strava_expires_at || 0);
    const nowSec = Math.floor(Date.now() / 1000);
    token = userData.strava_access_token || "";
    if (!token || tokenExpiresAt < nowSec + 300) {
      const tokenResult = await mainModule.refreshStravaTokenForUser(db, firebaseUid);
      token = tokenResult.accessToken;
    }
  }

  const efforts = await computeRunEffortsFromActivity(activity, token);
  await upsertRunEffortsToSupabase(firebaseUid, activity.id, efforts);

  console.log("[calculateAndSaveRunEfforts] upsert OK", {
    userId: firebaseUid,
    activityId: String(activity.id),
    speed_1k: efforts.speed_1k,
    speed_3k: efforts.speed_3k,
    speed_5k: efforts.speed_5k,
    speed_7k: efforts.speed_7k,
    speed_10k: efforts.speed_10k,
    speed_20k: efforts.speed_20k,
    speed_42k: efforts.speed_42k,
  });

  return { efforts, activityId: String(activity.id) };
}

module.exports = {
  BEST_EFFORT_DISTANCE_TARGETS,
  STREAM_DISTANCE_TARGETS,
  findBestEffortByLabel,
  findFastestDistanceWindow,
  fetchStravaRunStreams,
  computeRunEffortsFromActivity,
  calculateAndSaveRunEfforts,
};

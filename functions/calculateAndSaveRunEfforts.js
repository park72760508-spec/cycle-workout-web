/**
 * Strava Run 구간 피크 속도·심박 → Supabase run_activity_efforts.
 * processRunningActivity 직후 호출.
 *
 * [사이클 영향 검토]
 * - index.js 사이클 함수·rides 테이블: 미접촉
 */
const admin = require("firebase-admin");
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

/** Strava best_efforts — Streams 미사용 시 폴백 */
const BEST_EFFORT_DISTANCE_TARGETS = {
  "1k": 1000,
  "5k": 5000,
  "10k": 10000,
};

/** GPS Streams 슬라이딩 윈도우 (1k~42k 통일 산출 — best_efforts 와 혼용 시 페이스 역전 방지) */
const STREAM_DISTANCE_TARGETS = {
  "1k": 1000,
  "3k": 3000,
  "5k": 5000,
  "7k": 7000,
  "10k": 10000,
  "20k": 20000,
  "42k": 42000,
};

/** 짧은 거리일수록 빠르거나 같아야 함: speed_1k >= speed_3k >= … >= speed_42k (m/s) */
const EFFORT_DISTANCE_ORDER = ["1k", "3k", "5k", "7k", "10k", "20k", "42k"];

/** 중첩 탐색 순서: 긴 거리 최적 윈도우 → 그 안에서 짧은 거리 */
const NESTED_EFFORT_DISTANCE_ORDER = ["42k", "20k", "10k", "7k", "5k", "3k", "1k"];

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

/** Strava Streams — time, distance, heartrate, cadence (러닝 구간 슬라이딩용) */
async function fetchStravaRunStreams(accessToken, activityId) {
  const url =
    `https://www.strava.com/api/v3/activities/${activityId}/streams` +
    `?keys=time,distance,heartrate,cadence&key_by_type=true`;
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
      let cadence = extractData("cadence");
      if ((!time || !distance) && Array.isArray(raw)) {
        for (const s of raw) {
          const t = String(s && s.type ? s.type : "").toLowerCase();
          if (t === "time" && Array.isArray(s.data)) time = s.data;
          if (t === "distance" && Array.isArray(s.data)) distance = s.data;
          if (t === "heartrate" && Array.isArray(s.data)) heartrate = s.data;
          if (t === "cadence" && Array.isArray(s.data)) cadence = s.data;
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
        cadence: cadence ? cadence.slice(0, n).map((v) => Number(v) || 0) : null,
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
 * distanceArr 구간 [fromIdx, toIdx] 안에서 targetDist 지점의 time 선형 보간.
 */
function interpolateTimeAtDistance(timeArr, distanceArr, targetDist, fromIdx, toIdx) {
  const lo = Math.max(0, fromIdx);
  const hi = Math.min(timeArr.length - 1, toIdx);
  if (lo >= hi) return timeArr[lo] ?? null;
  if (targetDist <= distanceArr[lo]) return timeArr[lo];
  if (targetDist >= distanceArr[hi]) return timeArr[hi];
  for (let i = lo; i < hi; i++) {
    const d0 = distanceArr[i];
    const d1 = distanceArr[i + 1];
    if (d0 <= targetDist && d1 >= targetDist) {
      if (d1 <= d0) return timeArr[i];
      const ratio = (targetDist - d0) / (d1 - d0);
      return timeArr[i] + ratio * (timeArr[i + 1] - timeArr[i]);
    }
  }
  return timeArr[hi];
}

/**
 * 정확히 targetDistanceM 구간의 elapsed — GPS 샘플 경계 보간.
 */
function elapsedForExactDistanceWindow(timeArr, distanceArr, startIdx, endIdx, targetDistanceM) {
  const startDist = distanceArr[startIdx];
  const endDistExact = startDist + targetDistanceM;
  if (endDistExact > distanceArr[endIdx]) return null;
  const tStart = timeArr[startIdx];
  const tEnd = interpolateTimeAtDistance(timeArr, distanceArr, endDistExact, startIdx, endIdx);
  if (tStart == null || tEnd == null) return null;
  const elapsed = tEnd - tStart;
  return elapsed > 0 ? elapsed : null;
}

/**
 * 거리 차이 >= targetDistanceM 인 윈도우 중 정확 target 구간 elapsed 최소.
 * @param {{ indexLo?: number, indexHi?: number }} [opts] 탐색 허용 인덱스 (중첩 탐색용 클립)
 * @returns {{ speed: number, hr: number|null, cadence: number|null, start: number, end: number }|null}
 */
function findFastestDistanceWindow(timeArr, distanceArr, hrArr, targetDistanceM, opts, cadenceArr) {
  opts = opts || {};
  const n = Math.min(timeArr.length, distanceArr.length);
  if (n < 2 || targetDistanceM <= 0) return null;

  const indexLo = Math.max(0, int(opts.indexLo, 0) ?? 0);
  const indexHi = Math.min(n - 1, int(opts.indexHi, n - 1) ?? n - 1);
  if (indexHi <= indexLo) return null;
  if (distanceArr[indexHi] - distanceArr[indexLo] < targetDistanceM) return null;

  let bestElapsed = null;
  let bestStart = -1;
  let bestEnd = -1;

  let left = indexLo;
  for (let right = indexLo + 1; right <= indexHi; right++) {
    while (left < right && distanceArr[right] - distanceArr[left] >= targetDistanceM) {
      const elapsed = elapsedForExactDistanceWindow(timeArr, distanceArr, left, right, targetDistanceM);
      if (elapsed != null && (bestElapsed == null || elapsed < bestElapsed)) {
        bestElapsed = elapsed;
        bestStart = left;
        bestEnd = right;
      }
      left += 1;
      if (left < indexLo) left = indexLo;
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
  let cadence = null;
  if (cadenceArr && cadenceArr.length > bestEnd) {
    let sumCad = 0;
    let cadCount = 0;
    for (let i = bestStart; i <= bestEnd; i++) {
      const c = int(cadenceArr[i], 0) || 0;
      if (c > 0) {
        sumCad += c;
        cadCount += 1;
      }
    }
    if (cadCount > 0) cadence = Math.round(sumCad / cadCount);
  }
  return { speed, hr, cadence, start: bestStart, end: bestEnd };
}

/**
 * GPS Streams 중첩 슬라이딩 윈도우: 42k→20k→…→1k
 * 긴 거리 최적 [start,end] 확정 후 그 인덱스 범위 안에서만 짧은 거리 탐색 → 포함 관계·페이스 단조.
 */
function findNestedEffortWindowsFromStreams(timeArr, distanceArr, hrArr, totalDistanceM, cadenceArr) {
  const out = buildEmptyEffortsRow();
  const n = Math.min(timeArr.length, distanceArr.length);
  if (n < 2) return out;

  let clipLo = 0;
  let clipHi = n - 1;
  const windows = {};

  for (const label of NESTED_EFFORT_DISTANCE_ORDER) {
    const targetM = STREAM_DISTANCE_TARGETS[label];
    if (!targetM || totalDistanceM < targetM) continue;
    if (distanceArr[clipHi] - distanceArr[clipLo] < targetM) continue;

    const window = findFastestDistanceWindow(
      timeArr,
      distanceArr,
      hrArr,
      targetM,
      { indexLo: clipLo, indexHi: clipHi },
      cadenceArr
    );
    if (!window) continue;

    out[`speed_${label}`] = window.speed;
    if (window.hr != null) out[`hr_${label}`] = window.hr;
    if (window.cadence != null) out[`cadence_${label}`] = window.cadence;
    windows[label] = window;
    clipLo = window.start;
    clipHi = window.end;
  }

  imputeMissingShorterFromWindows(timeArr, distanceArr, hrArr, cadenceArr, out, windows);
  fillMissingShorterEffortsFromLonger(out);
  return out;
}

/**
 * 중첩 윈도우 내 GPS로 짧은 거리 보간 (3k 윈도우 있으면 1k elapsed 산출)
 */
function imputeMissingShorterFromWindows(timeArr, distanceArr, hrArr, cadenceArr, out, windows) {
  const chain = ["42k", "20k", "10k", "7k", "5k", "3k", "1k"];
  for (let i = chain.length - 1; i >= 1; i--) {
    const shortLabel = chain[i];
    const shortKey = `speed_${shortLabel}`;
    if (out[shortKey] != null && out[shortKey] > 0) continue;

    const targetM = STREAM_DISTANCE_TARGETS[shortLabel];
    if (!targetM) continue;

    for (let j = i - 1; j >= 0; j--) {
      const longLabel = chain[j];
      const parent = windows[longLabel];
      if (!parent) continue;

      const elapsed = elapsedForExactDistanceWindow(
        timeArr,
        distanceArr,
        parent.start,
        parent.end,
        targetM
      );
      if (elapsed == null || elapsed <= 0) continue;

      out[shortKey] = targetM / elapsed;
      if (out[`hr_${shortLabel}`] == null && parent.hr != null) {
        out[`hr_${shortLabel}`] = parent.hr;
      }
      if (out[`cadence_${shortLabel}`] == null && parent.cadence != null) {
        out[`cadence_${shortLabel}`] = parent.cadence;
      } else if (out[`cadence_${shortLabel}`] == null && cadenceArr && cadenceArr.length > parent.end) {
        let sumCad = 0;
        let cadCount = 0;
        for (let k = parent.start; k <= parent.end; k++) {
          const c = int(cadenceArr[k], 0) || 0;
          if (c > 0) {
            sumCad += c;
            cadCount += 1;
          }
        }
        if (cadCount > 0) out[`cadence_${shortLabel}`] = Math.round(sumCad / cadCount);
      }
      break;
    }
  }
}

/**
 * 긴 거리 speed 가 있으면 짧은 거리 누락 시 동일 speed 로 채움 (중첩 불변식)
 */
function fillMissingShorterEffortsFromLonger(row) {
  if (!row || typeof row !== "object") return row;
  const chain = ["42k", "20k", "10k", "7k", "5k", "3k", "1k"];
  let anchor = null;
  for (let i = 0; i < chain.length; i++) {
    const key = `speed_${chain[i]}`;
    const raw = num(row[key], null);
    if (raw != null && raw > 0) {
      anchor = raw;
      continue;
    }
    if (anchor != null) row[key] = anchor;
  }
  return row;
}

/** m/s → sec/km (페이스 단조 검증용) */
function paceSecPerKmFromSpeed(speedMps) {
  const s = num(speedMps, null);
  if (s == null || s <= 0) return null;
  return 1000 / s;
}

/** pace(1k) <= pace(3k) <= … (sec/km) 준수 여부 */
function effortSpeedsAreMonotonic(row) {
  if (!row) return true;
  let prevPace = null;
  for (const label of EFFORT_DISTANCE_ORDER) {
    const pace = paceSecPerKmFromSpeed(row[`speed_${label}`]);
    if (pace == null) continue;
    if (prevPace != null && pace + 1e-6 < prevPace) return false;
    prevPace = pace;
  }
  return true;
}

/**
 * 짧은 거리일수록 빠르거나 같도록 speed(m/s) 단조 감소 보정.
 * 긴 거리가 더 빠르게 나온 경우(슬라이딩 윈도우·활동 간 max 혼합) 상위 구간 속도로 캡.
 */
function enforceMonotonicEffortSpeeds(row) {
  if (!row || typeof row !== "object") return row;
  let capSpeed = null;
  for (const label of EFFORT_DISTANCE_ORDER) {
    const key = `speed_${label}`;
    const raw = num(row[key], null);
    if (raw == null || raw <= 0) continue;
    if (capSpeed != null && raw > capSpeed) {
      row[key] = capSpeed;
    } else {
      capSpeed = raw;
    }
  }
  return row;
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
    cadence_1k: null,
    cadence_3k: null,
    cadence_5k: null,
    cadence_7k: null,
    cadence_10k: null,
    cadence_20k: null,
    cadence_42k: null,
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

  /** 1) best_efforts 폴백 (Streams 없을 때만 최종 사용) */
  for (const label of Object.keys(BEST_EFFORT_DISTANCE_TARGETS)) {
    const effort = findBestEffortByLabel(bestEfforts, label);
    const { speed, hr } = extractSpeedAndHrFromBestEffort(effort, fallbackHr);
    out[`speed_${label}`] = speed;
    out[`hr_${label}`] = hr;
  }

  /** 2) Streams — 중첩 슬라이딩 윈도우 (42k→…→1k, 포함 관계) */
  const streamThresholdM = minStreamDistanceNeeded(totalDistanceM);
  if (streamThresholdM != null && accessToken) {
    const streams = await fetchStravaRunStreams(accessToken, String(activity.id));
    if (streams.success) {
      const nested = findNestedEffortWindowsFromStreams(
        streams.time,
        streams.distance,
        streams.heartrate,
        totalDistanceM,
        streams.cadence
      );
      for (const label of EFFORT_DISTANCE_ORDER) {
        const sk = `speed_${label}`;
        const hk = `hr_${label}`;
        const ck = `cadence_${label}`;
        if (nested[sk] != null) out[sk] = nested[sk];
        if (nested[hk] != null) out[hk] = nested[hk];
        if (nested[ck] != null) out[ck] = nested[ck];
      }
    } else {
      console.warn("[calculateAndSaveRunEfforts] streams 조회 실패:", streams.error || streams.status);
    }
  }

  /** 3) GPS 노이즈·활동 간 max 대비 안전망 (중첩 탐색 후에도 역전 시 캡) */
  enforceMonotonicEffortSpeeds(out);
  fillMissingShorterEffortsFromLonger(out);

  return out;
}

function toActivityDate(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function upsertRunEffortsToSupabase(firebaseUid, activityId, effortsRow, activityDate) {
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
    activity_date: activityDate,
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
    if (!/23503|foreign key|users.*fkey|activities_user_id_fkey/i.test(msg)) {
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
  const activityDate = toActivityDate(activity.start_date_local || activity.start_date);
  if (!activityDate) throw new Error("calculateAndSaveRunEfforts: activity_date 없음");
  await upsertRunEffortsToSupabase(firebaseUid, activity.id, efforts, activityDate);

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
    cadence_1k: efforts.cadence_1k,
    cadence_5k: efforts.cadence_5k,
    cadence_10k: efforts.cadence_10k,
  });

  return { efforts, activityId: String(activity.id) };
}

module.exports = {
  BEST_EFFORT_DISTANCE_TARGETS,
  STREAM_DISTANCE_TARGETS,
  EFFORT_DISTANCE_ORDER,
  NESTED_EFFORT_DISTANCE_ORDER,
  findBestEffortByLabel,
  interpolateTimeAtDistance,
  elapsedForExactDistanceWindow,
  findFastestDistanceWindow,
  findNestedEffortWindowsFromStreams,
  imputeMissingShorterFromWindows,
  fillMissingShorterEffortsFromLonger,
  paceSecPerKmFromSpeed,
  effortSpeedsAreMonotonic,
  enforceMonotonicEffortSpeeds,
  fetchStravaRunStreams,
  computeRunEffortsFromActivity,
  calculateAndSaveRunEfforts,
};

/**
 * weekly_tss_demographic_samples → stats_weekly_tss_stelvio_rolling 집계
 * Supabase weekly_tss_demographic_samples 우선 Read (Firestore ORDER BY __name__ LIMIT 400 스캔 대체).
 *
 * - 신규: weekTssList(30주) — 주차별 TSS>0 사용자만 분모
 * - 레거시: avgThirtyWeekWindowTss 만 있는 문서
 */
const admin = require("firebase-admin");
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

const MIN_SAMPLES = 5;
const SLOT_COUNT = 30;
const SUPABASE_PAGE_SIZE = 1000;

function parseBool(raw) {
  if (raw === true || raw === 1) return true;
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function normalizeWeekTssList(raw) {
  const arr = raw;
  if (!Array.isArray(arr) || arr.length !== SLOT_COUNT) return null;
  const out = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const v = Number(arr[i]);
    if (!Number.isFinite(v) || v < 0 || v > 50000) {
      out.push(0);
    } else {
      out.push(Math.round(v * 10) / 10);
    }
  }
  const sum = out.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  return out;
}

function normalizeWeeklyTssSampleRow(sample) {
  if (!sample || typeof sample !== "object") return null;
  const weekTssList = normalizeWeekTssList(
    sample.weekTssList != null ? sample.weekTssList : sample.week_tss_list
  );
  const avgRaw =
    sample.avgThirtyWeekWindowTss != null
      ? sample.avgThirtyWeekWindowTss
      : sample.avg_thirty_week_window_tss;
  const avgThirtyWeekWindowTss =
    avgRaw != null && Number.isFinite(Number(avgRaw)) ? Math.round(Number(avgRaw) * 10) / 10 : null;

  if (weekTssList) {
    const avgFromList = weekTssList.reduce((a, b) => a + b, 0) / weekTssList.length;
    return {
      weekTssList,
      avgThirtyWeekWindowTss: Math.round(avgFromList * 10) / 10,
    };
  }
  if (
    avgThirtyWeekWindowTss != null &&
    avgThirtyWeekWindowTss >= 0 &&
    avgThirtyWeekWindowTss <= 20000
  ) {
    return { weekTssList: null, avgThirtyWeekWindowTss };
  }
  return null;
}

/**
 * @param {Record<string, unknown>} d
 * @param {number[]} sums
 * @param {number[]} counts
 * @param {{ sum: number, count: number }} legacyAll
 * @returns {boolean} user contributed cohort slots
 */
function aggregateWeeklyTssSampleDoc(d, sums, counts, legacyAll) {
  const arr = d.weekTssList || d.week_tss_list;
  if (Array.isArray(arr) && arr.length === SLOT_COUNT) {
    let userHasPositive = false;
    for (let j = 0; j < SLOT_COUNT; j++) {
      const v = Number(arr[j]);
      if (!Number.isFinite(v) || v < 0 || v > 50000) continue;
      if (v > 0) {
        sums[j] += v;
        counts[j] += 1;
        userHasPositive = true;
      }
    }
    return userHasPositive;
  }
  const v = Number(d.avgThirtyWeekWindowTss ?? d.avg_thirty_week_window_tss);
  if (Number.isFinite(v) && v >= 0 && v <= 20000) {
    legacyAll.sum += v;
    legacyAll.count += 1;
  }
  return false;
}

/**
 * @returns {Promise<object[]>}
 */
async function loadWeeklyTssDemographicSamplesFromSupabase() {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return [];

  const out = [];
  let from = 0;
  for (let page = 0; page < 100; page += 1) {
    /* eslint-disable no-await-in-loop */
    const { data, error } = await supabase
      .from("weekly_tss_demographic_samples")
      .select("week_tss_list, avg_thirty_week_window_tss")
      .order("firebase_uid", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    /* eslint-enable no-await-in-loop */
    if (error) throw error;
    for (const row of data || []) {
      out.push({
        week_tss_list: row.week_tss_list,
        avg_thirty_week_window_tss: row.avg_thirty_week_window_tss,
      });
    }
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return out;
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @returns {Promise<object[]>}
 */
async function loadWeeklyTssDemographicSamplesFromFirestore(db) {
  if (!db) return [];
  const out = [];
  const col = db.collection("weekly_tss_demographic_samples");
  let lastDoc = null;
  const pageSize = 400;

  for (;;) {
    let q = col.orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    /* eslint-disable no-await-in-loop */
    const snap = await q.get();
    /* eslint-enable no-await-in-loop */
    if (snap.empty) break;
    snap.docs.forEach((doc) => {
      const d = doc.data() || {};
      out.push({
        firebaseUid: doc.id,
        weekTssList: d.weekTssList,
        avgThirtyWeekWindowTss: d.avgThirtyWeekWindowTss,
      });
    });
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }
  return out;
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @returns {Promise<{ samples: object[], source: string }>}
 */
async function loadWeeklyTssDemographicSamples(db) {
  const forceFirestore = parseBool(process.env.WEEKLY_TSS_DEMOGRAPHIC_SAMPLES_FORCE_FIRESTORE);
  const allowFirestoreFallback =
    parseBool(process.env.WEEKLY_TSS_DEMOGRAPHIC_SAMPLES_FIRESTORE_FALLBACK) ||
    process.env.WEEKLY_TSS_DEMOGRAPHIC_SAMPLES_FIRESTORE_FALLBACK == null;

  if (!forceFirestore) {
    try {
      const fromSupabase = await loadWeeklyTssDemographicSamplesFromSupabase();
      if (fromSupabase.length > 0) {
        return { samples: fromSupabase, source: "supabase" };
      }
      console.warn("[weeklyTssDemographicStats] Supabase weekly_tss_demographic_samples empty");
    } catch (err) {
      console.warn(
        "[weeklyTssDemographicStats] Supabase load failed:",
        err && err.message ? err.message : err
      );
    }
  }

  if (allowFirestoreFallback || forceFirestore) {
    const fromFirestore = await loadWeeklyTssDemographicSamplesFromFirestore(db);
    return { samples: fromFirestore, source: "firestore" };
  }

  return { samples: [], source: "none" };
}

/**
 * @param {string} firebaseUid
 * @param {Record<string, unknown>} sample
 */
async function upsertWeeklyTssDemographicSampleForUser(firebaseUid, sample) {
  const uid = String(firebaseUid || "").trim();
  const row = normalizeWeeklyTssSampleRow(sample);
  if (!uid || !row) {
    return { ok: false, reason: "invalid_payload" };
  }

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) {
    return { ok: false, reason: "supabase_unavailable" };
  }

  let userId = null;
  try {
    userId = await supabaseDualWriteServer.resolveSupabaseUserIdForFirebaseUid(uid);
  } catch (_) {
    userId = null;
  }

  const payload = {
    firebase_uid: uid,
    user_id: userId,
    week_tss_list: row.weekTssList,
    avg_thirty_week_window_tss: row.avgThirtyWeekWindowTss,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("weekly_tss_demographic_samples")
    .upsert(payload, { onConflict: "firebase_uid" });
  if (error) throw error;
  return { ok: true };
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 */
async function backfillWeeklyTssDemographicSamplesToSupabase(db) {
  const rows = await loadWeeklyTssDemographicSamplesFromFirestore(db);
  let upserted = 0;
  for (const row of rows) {
    const normalized = normalizeWeeklyTssSampleRow(row);
    if (!normalized) continue;
    /* eslint-disable no-await-in-loop */
    await upsertWeeklyTssDemographicSampleForUser(row.firebaseUid, {
      weekTssList: normalized.weekTssList,
      avgThirtyWeekWindowTss: normalized.avgThirtyWeekWindowTss,
    });
    /* eslint-enable no-await-in-loop */
    upserted += 1;
  }
  return { upserted, scanned: rows.length };
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 */
async function rebuildWeeklyTssStelvioRollingStats(db) {
  const sums = new Array(SLOT_COUNT).fill(0);
  const counts = new Array(SLOT_COUNT).fill(0);
  let contributingUsers = 0;
  const legacyAll = { sum: 0, count: 0 };

  const loaded = await loadWeeklyTssDemographicSamples(db);
  for (const row of loaded.samples) {
    if (aggregateWeeklyTssSampleDoc(row, sums, counts, legacyAll)) {
      contributingUsers += 1;
    }
  }

  const statsCol = db.collection("stats_weekly_tss_stelvio_rolling");
  const now = admin.firestore.FieldValue.serverTimestamp();
  const ref = statsCol.doc("all_all");
  const batch = db.batch();

  const useCohort = contributingUsers >= MIN_SAMPLES;
  const useLegacy = !useCohort && legacyAll.count >= MIN_SAMPLES;

  if (useCohort) {
    const weeklyCohortAvgTss = [];
    let sumWeeklyMeans = 0;
    let weeksWithData = 0;
    for (let j = 0; j < SLOT_COUNT; j++) {
      if (counts[j] > 0) {
        const avgj = sums[j] / counts[j];
        const rounded = Math.round(avgj * 10) / 10;
        weeklyCohortAvgTss.push(rounded);
        sumWeeklyMeans += rounded;
        weeksWithData += 1;
      } else {
        weeklyCohortAvgTss.push(null);
      }
    }
    const avgWeeklyTss =
      weeksWithData > 0 ? Math.round((sumWeeklyMeans / weeksWithData) * 10) / 10 : null;

    batch.set(
      ref,
      {
        weeklyCohortAvgTss,
        weeklyCohortCounts: counts,
        avgWeeklyTss,
        userCount: contributingUsers,
        minSamplesMet: true,
        source: "weekly_tss_demographic_samples",
        aggregation: "per_week_tss_gt_0_cohort_mean",
        readBackend: loaded.source,
        updatedAt: now,
      },
      { merge: true }
    );
  } else if (useLegacy) {
    const avg = Math.round((legacyAll.sum / legacyAll.count) * 10) / 10;
    const flat = [];
    for (let j = 0; j < SLOT_COUNT; j++) flat.push(avg);
    batch.set(
      ref,
      {
        weeklyCohortAvgTss: flat,
        weeklyCohortCounts: admin.firestore.FieldValue.delete(),
        avgWeeklyTss: avg,
        userCount: legacyAll.count,
        minSamplesMet: true,
        source: "weekly_tss_demographic_samples",
        aggregation: "legacy_user_mean_of_avg_thirty_week_window",
        readBackend: loaded.source,
        updatedAt: now,
      },
      { merge: true }
    );
  } else {
    batch.set(
      ref,
      {
        weeklyCohortAvgTss: admin.firestore.FieldValue.delete(),
        weeklyCohortCounts: admin.firestore.FieldValue.delete(),
        avgWeeklyTss: null,
        userCount: contributingUsers + legacyAll.count,
        minSamplesMet: false,
        source: "weekly_tss_demographic_samples",
        readBackend: loaded.source,
        updatedAt: now,
      },
      { merge: true }
    );
  }

  await batch.commit();
  return {
    userCount: contributingUsers || legacyAll.count,
    minSamplesMet: useCohort || useLegacy,
    mode: useCohort ? "cohort" : useLegacy ? "legacy" : "insufficient",
    readSource: loaded.source,
  };
}

module.exports = {
  rebuildWeeklyTssStelvioRollingStats,
  upsertWeeklyTssDemographicSampleForUser,
  backfillWeeklyTssDemographicSamplesToSupabase,
  loadWeeklyTssDemographicSamples,
  MIN_SAMPLES,
  SLOT_COUNT,
};

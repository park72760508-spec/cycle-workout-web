/**
 * vo2_demographic_samples → stats_vo2_stelvio_rolling 집계
 * Supabase vo2_demographic_samples 우선 Read (Firestore ORDER BY __name__ LIMIT 400 스캔 대체).
 */
const admin = require("firebase-admin");
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

const BRACKETS = ["20-29", "30-39", "40-49", "50-59", "60+"];
const MIN_SAMPLES = 5;
const SUPABASE_PAGE_SIZE = 1000;

function parseBool(raw) {
  if (raw === true || raw === 1) return true;
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function emptyBuckets() {
  const b = {};
  for (const g of ["male", "female"]) {
    for (const ab of BRACKETS) {
      b[`${g}_${ab}`] = { sum: 0, count: 0 };
    }
  }
  return b;
}

function normalizeSampleRow(d) {
  if (!d || typeof d !== "object") return null;
  const gk = d.genderKey === "female" || d.gender_key === "female" ? "female" : "male";
  const ab = String(d.ageBracket || d.age_bracket || "").trim();
  if (!BRACKETS.includes(ab)) return null;
  const v = Number(d.avgSixMonthVo2 != null ? d.avgSixMonthVo2 : d.avg_six_month_vo2);
  if (!Number.isFinite(v) || v < 15 || v > 110) return null;
  return { genderKey: gk, ageBracket: ab, avgSixMonthVo2: v };
}

function aggregateVo2Samples(samples, bucket, allGender, globalAll) {
  for (const raw of samples || []) {
    const row = normalizeSampleRow(raw);
    if (!row) continue;
    const key = `${row.genderKey}_${row.ageBracket}`;
    if (!bucket[key]) continue;
    bucket[key].sum += row.avgSixMonthVo2;
    bucket[key].count += 1;
    allGender[row.genderKey].sum += row.avgSixMonthVo2;
    allGender[row.genderKey].count += 1;
    globalAll.sum += row.avgSixMonthVo2;
    globalAll.count += 1;
  }
}

/**
 * @returns {Promise<object[]>}
 */
async function loadVo2DemographicSamplesFromSupabase() {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return [];

  const out = [];
  let from = 0;
  for (let page = 0; page < 100; page += 1) {
    /* eslint-disable no-await-in-loop */
    const { data, error } = await supabase
      .from("vo2_demographic_samples")
      .select("gender_key, age_bracket, avg_six_month_vo2")
      .order("firebase_uid", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    /* eslint-enable no-await-in-loop */
    if (error) throw error;
    for (const row of data || []) {
      out.push({
        gender_key: row.gender_key,
        age_bracket: row.age_bracket,
        avg_six_month_vo2: row.avg_six_month_vo2,
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
async function loadVo2DemographicSamplesFromFirestore(db) {
  if (!db) return [];
  const out = [];
  const col = db.collection("vo2_demographic_samples");
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
        genderKey: d.genderKey,
        ageBracket: d.ageBracket,
        avgSixMonthVo2: d.avgSixMonthVo2,
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
async function loadVo2DemographicSamples(db) {
  const forceFirestore = parseBool(process.env.VO2_DEMOGRAPHIC_SAMPLES_FORCE_FIRESTORE);
  const allowFirestoreFallback =
    parseBool(process.env.VO2_DEMOGRAPHIC_SAMPLES_FIRESTORE_FALLBACK) ||
    process.env.VO2_DEMOGRAPHIC_SAMPLES_FIRESTORE_FALLBACK == null;

  if (!forceFirestore) {
    try {
      const fromSupabase = await loadVo2DemographicSamplesFromSupabase();
      if (fromSupabase.length > 0) {
        return { samples: fromSupabase, source: "supabase" };
      }
      console.warn("[vo2DemographicStats] Supabase vo2_demographic_samples empty");
    } catch (err) {
      console.warn(
        "[vo2DemographicStats] Supabase load failed:",
        err && err.message ? err.message : err
      );
    }
  }

  if (allowFirestoreFallback || forceFirestore) {
    const fromFirestore = await loadVo2DemographicSamplesFromFirestore(db);
    return { samples: fromFirestore, source: "firestore" };
  }

  return { samples: [], source: "none" };
}

/**
 * @param {string} firebaseUid
 * @param {{ genderKey: string, ageBracket: string, avgSixMonthVo2: number }} sample
 */
async function upsertVo2DemographicSampleForUser(firebaseUid, sample) {
  const uid = String(firebaseUid || "").trim();
  const row = normalizeSampleRow(sample);
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
    gender_key: row.genderKey,
    age_bracket: row.ageBracket,
    avg_six_month_vo2: Math.round(row.avgSixMonthVo2 * 10) / 10,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("vo2_demographic_samples")
    .upsert(payload, { onConflict: "firebase_uid" });
  if (error) throw error;
  return { ok: true };
}

/**
 * Firestore vo2_demographic_samples → Supabase 1회 백필 (관리자/초기 cutover).
 * @param {import('firebase-admin').firestore.Firestore} db
 */
async function backfillVo2DemographicSamplesToSupabase(db) {
  const rows = await loadVo2DemographicSamplesFromFirestore(db);
  let upserted = 0;
  for (const row of rows) {
    const normalized = normalizeSampleRow(row);
    if (!normalized) continue;
    /* eslint-disable no-await-in-loop */
    await upsertVo2DemographicSampleForUser(row.firebaseUid || row.firebase_uid, {
      genderKey: normalized.genderKey,
      ageBracket: normalized.ageBracket,
      avgSixMonthVo2: normalized.avgSixMonthVo2,
    });
    /* eslint-enable no-await-in-loop */
    upserted += 1;
  }
  return { upserted, scanned: rows.length };
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 */
async function rebuildVo2StelvioRollingStats(db) {
  const bucket = emptyBuckets();
  const allGender = { male: { sum: 0, count: 0 }, female: { sum: 0, count: 0 } };
  const globalAll = { sum: 0, count: 0 };

  const loaded = await loadVo2DemographicSamples(db);
  aggregateVo2Samples(loaded.samples, bucket, allGender, globalAll);

  const batch = db.batch();
  const statsCol = db.collection("stats_vo2_stelvio_rolling");
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (const key of Object.keys(bucket)) {
    const { sum, count } = bucket[key];
    const ref = statsCol.doc(key);
    if (count >= MIN_SAMPLES) {
      batch.set(
        ref,
        {
          avgMlKg: Math.round((sum / count) * 10) / 10,
          userCount: count,
          minSamplesMet: true,
          source: "vo2_demographic_samples",
          readBackend: loaded.source,
          updatedAt: now,
        },
        { merge: true }
      );
    } else {
      batch.set(
        ref,
        {
          avgMlKg: null,
          userCount: count,
          minSamplesMet: false,
          source: "vo2_demographic_samples",
          readBackend: loaded.source,
          updatedAt: now,
        },
        { merge: true }
      );
    }
  }

  for (const gk of ["male", "female"]) {
    const ag = allGender[gk];
    const ref = statsCol.doc(`${gk}_all`);
    if (ag.count >= MIN_SAMPLES) {
      batch.set(
        ref,
        {
          avgMlKg: Math.round((ag.sum / ag.count) * 10) / 10,
          userCount: ag.count,
          minSamplesMet: true,
          source: "vo2_demographic_samples",
          readBackend: loaded.source,
          scope: "all_ages_same_gender",
          updatedAt: now,
        },
        { merge: true }
      );
    } else {
      batch.set(
        ref,
        {
          avgMlKg: null,
          userCount: ag.count,
          minSamplesMet: false,
          source: "vo2_demographic_samples",
          readBackend: loaded.source,
          scope: "all_ages_same_gender",
          updatedAt: now,
        },
        { merge: true }
      );
    }
  }

  {
    const ref = statsCol.doc("all_all");
    if (globalAll.count >= MIN_SAMPLES) {
      batch.set(
        ref,
        {
          avgMlKg: Math.round((globalAll.sum / globalAll.count) * 10) / 10,
          userCount: globalAll.count,
          minSamplesMet: true,
          source: "vo2_demographic_samples",
          readBackend: loaded.source,
          scope: "all_users",
          updatedAt: now,
        },
        { merge: true }
      );
    } else {
      batch.set(
        ref,
        {
          avgMlKg: null,
          userCount: globalAll.count,
          minSamplesMet: false,
          source: "vo2_demographic_samples",
          readBackend: loaded.source,
          scope: "all_users",
          updatedAt: now,
        },
        { merge: true }
      );
    }
  }

  await batch.commit();
  return {
    buckets: Object.keys(bucket).length,
    sampleCount: loaded.samples.length,
    readSource: loaded.source,
  };
}

module.exports = {
  rebuildVo2StelvioRollingStats,
  upsertVo2DemographicSampleForUser,
  backfillVo2DemographicSamplesToSupabase,
  loadVo2DemographicSamples,
  MIN_SAMPLES,
  BRACKETS,
};

/**
 * fitness_demographic_samples → stats_fitness_stelvio_rolling 집계
 * Supabase fitness_demographic_samples 우선 Read (Firestore ORDER BY __name__ LIMIT 400 스캔 대체).
 * CYCLE PMC(Coggan CTL): latestCtl 우선 · 레거시 decay 합산(>200) 제외
 */
const admin = require("firebase-admin");
const supabaseDualWriteServer = require("./supabaseDualWriteServer");

const MIN_SAMPLES = 5;
const MAX_PLAUSIBLE_CYCLE_CTL = 200;
const SUPABASE_PAGE_SIZE = 1000;

function parseBool(raw) {
  if (raw === true || raw === 1) return true;
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/**
 * @param {Record<string, unknown>} d
 * @returns {number|null}
 */
function readCycleCtlSampleForAggregate(d) {
  if (!d || typeof d !== "object") return null;
  const pmcModel = String(d.pmcModel || d.pmc_model || "").trim();
  if (pmcModel === "coggan_ctl") {
    const latest = Number(d.latestCtl != null ? d.latestCtl : d.latest_ctl);
    if (Number.isFinite(latest) && latest >= 0 && latest <= MAX_PLAUSIBLE_CYCLE_CTL) {
      return latest;
    }
    const avgCtl = Number(d.avgTrendCtl != null ? d.avgTrendCtl : d.avg_trend_ctl);
    if (Number.isFinite(avgCtl) && avgCtl >= 0 && avgCtl <= MAX_PLAUSIBLE_CYCLE_CTL) {
      return avgCtl;
    }
    return null;
  }
  const legacy = Number(d.avgTrendFitness != null ? d.avgTrendFitness : d.avg_trend_fitness);
  if (!Number.isFinite(legacy) || legacy < 0 || legacy > MAX_PLAUSIBLE_CYCLE_CTL) return null;
  return legacy;
}

function normalizeFitnessSampleRow(sample) {
  if (!sample || typeof sample !== "object") return null;
  const pmcModel = String(sample.pmcModel || sample.pmc_model || "coggan_ctl").trim() || "coggan_ctl";
  const latestCtlRaw = sample.latestCtl != null ? sample.latestCtl : sample.latest_ctl;
  const avgTrendCtlRaw = sample.avgTrendCtl != null ? sample.avgTrendCtl : sample.avg_trend_ctl;
  const avgTrendFitnessRaw =
    sample.avgTrendFitness != null ? sample.avgTrendFitness : sample.avg_trend_fitness;

  const latestCtl =
    latestCtlRaw != null && Number.isFinite(Number(latestCtlRaw)) ? Number(latestCtlRaw) : null;
  const avgTrendCtl =
    avgTrendCtlRaw != null && Number.isFinite(Number(avgTrendCtlRaw)) ? Number(avgTrendCtlRaw) : null;
  const avgTrendFitness =
    avgTrendFitnessRaw != null && Number.isFinite(Number(avgTrendFitnessRaw))
      ? Number(avgTrendFitnessRaw)
      : null;

  if (readCycleCtlSampleForAggregate({ pmcModel, latestCtl, avgTrendCtl, avgTrendFitness }) == null) {
    return null;
  }

  return {
    pmcModel,
    latestCtl: latestCtl != null ? Math.round(latestCtl * 10) / 10 : null,
    avgTrendCtl: avgTrendCtl != null ? Math.round(avgTrendCtl * 10) / 10 : null,
    avgTrendFitness: avgTrendFitness != null ? Math.round(avgTrendFitness * 10) / 10 : null,
  };
}

/**
 * @returns {Promise<object[]>}
 */
async function loadFitnessDemographicSamplesFromSupabase() {
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  if (!supabase) return [];

  const out = [];
  let from = 0;
  for (let page = 0; page < 100; page += 1) {
    /* eslint-disable no-await-in-loop */
    const { data, error } = await supabase
      .from("fitness_demographic_samples")
      .select("pmc_model, latest_ctl, avg_trend_ctl, avg_trend_fitness")
      .order("firebase_uid", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    /* eslint-enable no-await-in-loop */
    if (error) throw error;
    for (const row of data || []) {
      out.push({
        pmc_model: row.pmc_model,
        latest_ctl: row.latest_ctl,
        avg_trend_ctl: row.avg_trend_ctl,
        avg_trend_fitness: row.avg_trend_fitness,
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
async function loadFitnessDemographicSamplesFromFirestore(db) {
  if (!db) return [];
  const out = [];
  const col = db.collection("fitness_demographic_samples");
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
        pmcModel: d.pmcModel,
        latestCtl: d.latestCtl,
        avgTrendCtl: d.avgTrendCtl,
        avgTrendFitness: d.avgTrendFitness,
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
async function loadFitnessDemographicSamples(db) {
  const forceFirestore = parseBool(process.env.FITNESS_DEMOGRAPHIC_SAMPLES_FORCE_FIRESTORE);
  const allowFirestoreFallback =
    parseBool(process.env.FITNESS_DEMOGRAPHIC_SAMPLES_FIRESTORE_FALLBACK) ||
    process.env.FITNESS_DEMOGRAPHIC_SAMPLES_FIRESTORE_FALLBACK == null;

  if (!forceFirestore) {
    try {
      const fromSupabase = await loadFitnessDemographicSamplesFromSupabase();
      if (fromSupabase.length > 0) {
        return { samples: fromSupabase, source: "supabase" };
      }
      console.warn("[fitnessDemographicStats] Supabase fitness_demographic_samples empty");
    } catch (err) {
      console.warn(
        "[fitnessDemographicStats] Supabase load failed:",
        err && err.message ? err.message : err
      );
    }
  }

  if (allowFirestoreFallback || forceFirestore) {
    const fromFirestore = await loadFitnessDemographicSamplesFromFirestore(db);
    return { samples: fromFirestore, source: "firestore" };
  }

  return { samples: [], source: "none" };
}

/**
 * @param {string} firebaseUid
 * @param {Record<string, unknown>} sample
 */
async function upsertFitnessDemographicSampleForUser(firebaseUid, sample) {
  const uid = String(firebaseUid || "").trim();
  const row = normalizeFitnessSampleRow(sample);
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
    pmc_model: row.pmcModel,
    latest_ctl: row.latestCtl,
    avg_trend_ctl: row.avgTrendCtl,
    avg_trend_fitness: row.avgTrendFitness,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("fitness_demographic_samples")
    .upsert(payload, { onConflict: "firebase_uid" });
  if (error) throw error;
  return { ok: true };
}

/**
 * Firestore fitness_demographic_samples → Supabase 1회 백필.
 * @param {import('firebase-admin').firestore.Firestore} db
 */
async function backfillFitnessDemographicSamplesToSupabase(db) {
  const rows = await loadFitnessDemographicSamplesFromFirestore(db);
  let upserted = 0;
  for (const row of rows) {
    const normalized = normalizeFitnessSampleRow(row);
    if (!normalized) continue;
    /* eslint-disable no-await-in-loop */
    await upsertFitnessDemographicSampleForUser(row.firebaseUid, {
      pmcModel: normalized.pmcModel,
      latestCtl: normalized.latestCtl,
      avgTrendCtl: normalized.avgTrendCtl,
      avgTrendFitness: normalized.avgTrendFitness,
    });
    /* eslint-enable no-await-in-loop */
    upserted += 1;
  }
  return { upserted, scanned: rows.length };
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 */
async function rebuildFitnessStelvioRollingStats(db) {
  const globalAll = { sum: 0, count: 0 };
  const loaded = await loadFitnessDemographicSamples(db);

  for (const row of loaded.samples) {
    const v = readCycleCtlSampleForAggregate(row);
    if (v == null) continue;
    globalAll.sum += v;
    globalAll.count += 1;
  }

  const statsCol = db.collection("stats_fitness_stelvio_rolling");
  const now = admin.firestore.FieldValue.serverTimestamp();
  const ref = statsCol.doc("all_all");
  const { sum, count } = globalAll;
  const batch = db.batch();

  if (count >= MIN_SAMPLES) {
    batch.set(
      ref,
      {
        avgFitness: Math.round((sum / count) * 10) / 10,
        avgCtl: Math.round((sum / count) * 10) / 10,
        userCount: count,
        minSamplesMet: true,
        pmcModel: "coggan_ctl",
        source: "fitness_demographic_samples",
        readBackend: loaded.source,
        updatedAt: now,
      },
      { merge: true }
    );
  } else {
    batch.set(
      ref,
      {
        avgFitness: null,
        avgCtl: null,
        userCount: count,
        minSamplesMet: false,
        pmcModel: "coggan_ctl",
        source: "fitness_demographic_samples",
        readBackend: loaded.source,
        updatedAt: now,
      },
      { merge: true }
    );
  }

  await batch.commit();
  return { userCount: count, minSamplesMet: count >= MIN_SAMPLES, readSource: loaded.source };
}

async function rebuildRunFitnessStelvioRollingStats(db) {
  const globalAll = { sum: 0, count: 0 };
  const col = db.collection("run_fitness_demographic_samples");
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
      const v = Number(d.avgTrendFitness);
      if (!Number.isFinite(v) || v < 0 || v > 50000) return;
      globalAll.sum += v;
      globalAll.count += 1;
    });

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  const statsCol = db.collection("stats_fitness_run_stelvio_rolling");
  const now = admin.firestore.FieldValue.serverTimestamp();
  const ref = statsCol.doc("all_all");
  const { sum, count } = globalAll;
  const batch = db.batch();

  if (count >= MIN_SAMPLES) {
    batch.set(
      ref,
      {
        avgFitness: Math.round((sum / count) * 10) / 10,
        userCount: count,
        minSamplesMet: true,
        source: "run_fitness_demographic_samples",
        sport: "run",
        updatedAt: now,
      },
      { merge: true }
    );
  } else {
    batch.set(
      ref,
      {
        avgFitness: null,
        userCount: count,
        minSamplesMet: false,
        source: "run_fitness_demographic_samples",
        sport: "run",
        updatedAt: now,
      },
      { merge: true }
    );
  }

  await batch.commit();
  return { userCount: count, minSamplesMet: count >= MIN_SAMPLES };
}

module.exports = {
  rebuildFitnessStelvioRollingStats,
  rebuildRunFitnessStelvioRollingStats,
  upsertFitnessDemographicSampleForUser,
  backfillFitnessDemographicSamplesToSupabase,
  loadFitnessDemographicSamples,
  readCycleCtlSampleForAggregate,
  MIN_SAMPLES,
};

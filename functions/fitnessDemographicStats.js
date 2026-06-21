/**
 * fitness_demographic_samples → stats_fitness_stelvio_rolling 집계
 * CYCLE PMC(Coggan CTL): latestCtl 우선 · 레거시 decay 합산(>200) 제외
 */
const admin = require("firebase-admin");

const MIN_SAMPLES = 5;
const MAX_PLAUSIBLE_CYCLE_CTL = 200;

/**
 * @param {Record<string, unknown>} d
 * @returns {number|null}
 */
function readCycleCtlSampleForAggregate(d) {
  if (!d || typeof d !== "object") return null;
  if (d.pmcModel === "coggan_ctl") {
    const latest = Number(d.latestCtl);
    if (Number.isFinite(latest) && latest >= 0 && latest <= MAX_PLAUSIBLE_CYCLE_CTL) {
      return latest;
    }
    const avgCtl = Number(d.avgTrendCtl);
    if (Number.isFinite(avgCtl) && avgCtl >= 0 && avgCtl <= MAX_PLAUSIBLE_CYCLE_CTL) {
      return avgCtl;
    }
    return null;
  }
  const legacy = Number(d.avgTrendFitness);
  if (!Number.isFinite(legacy) || legacy < 0 || legacy > MAX_PLAUSIBLE_CYCLE_CTL) return null;
  return legacy;
}

/**
 * @param {FirebaseFirestore.Firestore} db
 */
async function rebuildFitnessStelvioRollingStats(db) {
  const globalAll = { sum: 0, count: 0 };
  const col = db.collection("fitness_demographic_samples");
  let lastDoc = null;
  const pageSize = 400;

  for (;;) {
    let q = col.orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    snap.docs.forEach((doc) => {
      const d = doc.data() || {};
      const v = readCycleCtlSampleForAggregate(d);
      if (v == null) return;
      globalAll.sum += v;
      globalAll.count += 1;
    });

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
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
        updatedAt: now,
      },
      { merge: true }
    );
  }

  await batch.commit();
  return { userCount: count, minSamplesMet: count >= MIN_SAMPLES };
}

async function rebuildRunFitnessStelvioRollingStats(db) {
  const globalAll = { sum: 0, count: 0 };
  const col = db.collection("run_fitness_demographic_samples");
  let lastDoc = null;
  const pageSize = 400;

  for (;;) {
    let q = col.orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
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

module.exports = { rebuildFitnessStelvioRollingStats, rebuildRunFitnessStelvioRollingStats, MIN_SAMPLES };

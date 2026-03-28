/**
 * fitness_demographic_samples → stats_fitness_stelvio_rolling 집계
 * 대시보드 훈련 트렌드: 사용자별 최근 1개월 차트에서 7일 버킷별 Fitness 값의 산술평균(avgTrendFitness)을 전체 평균.
 */
const admin = require("firebase-admin");

const MIN_SAMPLES = 5;

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
      const v = Number(d.avgTrendFitness);
      if (!Number.isFinite(v) || v < 0 || v > 50000) return;
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
        userCount: count,
        minSamplesMet: true,
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
        userCount: count,
        minSamplesMet: false,
        source: "fitness_demographic_samples",
        updatedAt: now,
      },
      { merge: true }
    );
  }

  await batch.commit();
  return { userCount: count, minSamplesMet: count >= MIN_SAMPLES };
}

module.exports = { rebuildFitnessStelvioRollingStats, MIN_SAMPLES };

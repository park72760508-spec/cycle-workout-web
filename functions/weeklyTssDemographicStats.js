/**
 * weekly_tss_demographic_samples → stats_weekly_tss_stelvio_rolling 집계
 * 대시보드 성장 추이: 사용자별 최근 30주(동일 7일 창) 주간 TSS의 산술평균(avgThirtyWeekWindowTss)을 전체 평균.
 */
const admin = require("firebase-admin");

const MIN_SAMPLES = 5;

/**
 * @param {FirebaseFirestore.Firestore} db
 */
async function rebuildWeeklyTssStelvioRollingStats(db) {
  const globalAll = { sum: 0, count: 0 };
  const col = db.collection("weekly_tss_demographic_samples");
  let lastDoc = null;
  const pageSize = 400;

  for (;;) {
    let q = col.orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    snap.docs.forEach((doc) => {
      const d = doc.data() || {};
      const v = Number(d.avgThirtyWeekWindowTss);
      if (!Number.isFinite(v) || v < 0 || v > 20000) return;
      globalAll.sum += v;
      globalAll.count += 1;
    });

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  const statsCol = db.collection("stats_weekly_tss_stelvio_rolling");
  const now = admin.firestore.FieldValue.serverTimestamp();
  const ref = statsCol.doc("all_all");
  const { sum, count } = globalAll;
  const batch = db.batch();

  if (count >= MIN_SAMPLES) {
    batch.set(
      ref,
      {
        avgWeeklyTss: Math.round((sum / count) * 10) / 10,
        userCount: count,
        minSamplesMet: true,
        source: "weekly_tss_demographic_samples",
        updatedAt: now,
      },
      { merge: true }
    );
  } else {
    batch.set(
      ref,
      {
        avgWeeklyTss: null,
        userCount: count,
        minSamplesMet: false,
        source: "weekly_tss_demographic_samples",
        updatedAt: now,
      },
      { merge: true }
    );
  }

  await batch.commit();
  return { userCount: count, minSamplesMet: count >= MIN_SAMPLES };
}

module.exports = { rebuildWeeklyTssStelvioRollingStats, MIN_SAMPLES };

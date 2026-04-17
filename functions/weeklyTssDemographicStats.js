/**
 * weekly_tss_demographic_samples → stats_weekly_tss_stelvio_rolling 집계
 * - 신규: 사용자별 weekTssList(30주, 오래된 주→최근 주)를 읽어, 각 주차 j마다
 *   「해당 주에 TSS>0 인 사용자」만 분모에 넣고 sum/count 로 코호트 평균을 산출.
 * - 레거시: weekTssList 없이 avgThirtyWeekWindowTss 만 있는 문서는 기존처럼
 *   사용자별 30주 평균값의 산술평균으로 단일 참고선(전 주 동일 값)을 유지.
 */
const admin = require("firebase-admin");

const MIN_SAMPLES = 5;
const SLOT_COUNT = 30;

/**
 * @param {FirebaseFirestore.Firestore} db
 */
async function rebuildWeeklyTssStelvioRollingStats(db) {
  const sums = new Array(SLOT_COUNT).fill(0);
  const counts = new Array(SLOT_COUNT).fill(0);
  let contributingUsers = 0;
  const legacyAll = { sum: 0, count: 0 };

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
      const arr = d.weekTssList;
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
        if (userHasPositive) contributingUsers += 1;
      } else {
        const v = Number(d.avgThirtyWeekWindowTss);
        if (Number.isFinite(v) && v >= 0 && v <= 20000) {
          legacyAll.sum += v;
          legacyAll.count += 1;
        }
      }
    });

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
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
        avgWeeklyTss: avgWeeklyTss,
        userCount: contributingUsers,
        minSamplesMet: true,
        source: "weekly_tss_demographic_samples",
        aggregation: "per_week_tss_gt_0_cohort_mean",
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
  };
}

module.exports = { rebuildWeeklyTssStelvioRollingStats, MIN_SAMPLES, SLOT_COUNT };

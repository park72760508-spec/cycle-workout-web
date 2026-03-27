/**
 * vo2_demographic_samples → stats_vo2_stelvio_rolling 집계
 * 대시보드와 동일: 사용자별 최근 6개월 월별 VO₂(추정)의 산술평균(avgSixMonthVo2)을 연령대·성별 버킷별로 평균.
 */
const admin = require("firebase-admin");

const BRACKETS = ["20-29", "30-39", "40-49", "50-59", "60+"];
const MIN_SAMPLES = 5;

function emptyBuckets() {
  const b = {};
  for (const g of ["male", "female"]) {
    for (const ab of BRACKETS) {
      b[`${g}_${ab}`] = { sum: 0, count: 0 };
    }
  }
  return b;
}

/**
 * @param {FirebaseFirestore.Firestore} db
 */
async function rebuildVo2StelvioRollingStats(db) {
  const bucket = emptyBuckets();
  /** 동일 성별·전 연령대 합산 (문서 ID: male_all, female_all) */
  const allGender = { male: { sum: 0, count: 0 }, female: { sum: 0, count: 0 } };
  /** 연령·성별 구분 없음 전체 평균 (문서 ID: all_all — 대시보드 VO₂ 녹색 가이드) */
  const globalAll = { sum: 0, count: 0 };
  const col = db.collection("vo2_demographic_samples");
  let lastDoc = null;
  const pageSize = 400;

  for (;;) {
    let q = col.orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    snap.docs.forEach((doc) => {
      const d = doc.data() || {};
      const gk = d.genderKey === "female" ? "female" : "male";
      const ab = String(d.ageBracket || "").trim();
      if (!BRACKETS.includes(ab)) return;
      const v = Number(d.avgSixMonthVo2);
      if (!Number.isFinite(v) || v < 15 || v > 110) return;
      const key = `${gk}_${ab}`;
      if (!bucket[key]) return;
      bucket[key].sum += v;
      bucket[key].count += 1;
      allGender[gk].sum += v;
      allGender[gk].count += 1;
      globalAll.sum += v;
      globalAll.count += 1;
    });

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

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
          scope: "all_users",
          updatedAt: now,
        },
        { merge: true }
      );
    }
  }

  await batch.commit();
  return { buckets: Object.keys(bucket).length };
}

module.exports = { rebuildVo2StelvioRollingStats, MIN_SAMPLES, BRACKETS };

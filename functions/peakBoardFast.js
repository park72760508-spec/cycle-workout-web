/**
 * 28일 피크 랭킹 보드 — O(rollup 문서 수) 조립.
 * users×28버킷 전체 스캔·인라인 rollup 재빌드 없이 collectionGroup + 메모리 정렬.
 */

const rankingDayRollup = require("./rankingDayRollup");

const ROLLUP_PAGE = 450;
const ENRICH_USER_CHUNK = 80;

/**
 * v2·v3 peak_28d 모두 조회 (rollupLogicVersion==3 만 쓰면 대부분 빈 결과 → legacy 60분 폴백).
 * @param {import("firebase-admin").firestore.Firestore} db
 * @returns {Promise<Array<{ userId: string, rollup: object }>>}
 */
async function fetchPeak28dRollupsForWindow(db, startStr, endStr) {
  if (!db || !startStr || !endStr) return [];
  const coll = rankingDayRollup.RANKING_ROLLUPS_COLL;
  const out = [];
  let lastDoc = null;
  for (let page = 0; page < 200; page++) {
    let q = db
      .collectionGroup(coll)
      .where("windowStart", "==", startStr)
      .where("windowEnd", "==", endStr)
      .limit(ROLLUP_PAGE);
    if (lastDoc) q = q.startAfter(lastDoc);
    /* eslint-disable no-await-in-loop */
    const snap = await q.get();
    /* eslint-enable no-await-in-loop */
    if (snap.empty) break;
    snap.docs.forEach((doc) => {
      if (doc.id !== rankingDayRollup.PEAK_28D_ROLLUP_ID) return;
      const userRef = doc.ref.parent && doc.ref.parent.parent;
      const userId = userRef && userRef.id ? userRef.id : "";
      if (!userId) return;
      const data = doc.data() || {};
      if (!data.peaks || typeof data.peaks !== "object" || !Object.keys(data.peaks).length) return;
      out.push({ userId, rollup: data });
    });
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < ROLLUP_PAGE) break;
  }
  return out;
}

/**
 * userMeta 없는 rollup 행만 users 배치 조회로 보강 (전체 554명 스캔·28버킷 재빌드 없음).
 */
async function enrichRollupRowsMissingUserMeta(db, rows, getLeagueCategory) {
  if (!rows || !rows.length || typeof getLeagueCategory !== "function") return rows;
  const needIds = [];
  const rowById = new Map();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const peaks = row.rollup && row.rollup.peaks;
    if (!peaks || !Object.keys(peaks).length) continue;
    const um = row.rollup.userMeta;
    if (um && um.ageCategory) continue;
    needIds.push(row.userId);
    rowById.set(row.userId, row);
  }
  if (!needIds.length) return rows;

  for (let i = 0; i < needIds.length; i += ENRICH_USER_CHUNK) {
    const chunk = needIds.slice(i, i + ENRICH_USER_CHUNK);
    const refs = chunk.map((uid) => db.collection("users").doc(uid));
    /* eslint-disable no-await-in-loop */
    const snaps = await rankingDayRollup.chunkedGetAll(db, refs, 40);
    /* eslint-enable no-await-in-loop */
    for (let j = 0; j < chunk.length; j++) {
      const snap = snaps[j];
      const row = rowById.get(chunk[j]);
      if (!row || !snap || !snap.exists) continue;
      row.rollup.userMeta = rankingDayRollup.snapshotUserMetaForPeakRollup(snap.data(), getLeagueCategory);
    }
  }
  return rows;
}

/**
 * @param {object} deps — index.js 에서 주입
 */
function buildPeakBoardsFromRollupRows(rollupRows, startStr, endStr, deps) {
  const {
    getLeagueCategory,
    privacyFlagFromFirestoreDoc,
    profileImageUrlFromUserData,
    rankingUserStatusFieldsFromData,
    DURATION_FIELDS,
    DURATION_HR_FIELDS,
  } = deps;
  const genders = ["all", "M", "F"];
  const durKeys = Object.keys(DURATION_FIELDS);
  const byGenderDur = {};
  genders.forEach((g) => {
    byGenderDur[g] = {};
    durKeys.forEach((dt) => {
      byGenderDur[g][dt] = { raw: [] };
    });
  });
  const cohortSum = { all: {}, M: {}, F: {} };
  const cohortN = { all: {}, M: {}, F: {} };
  genders.forEach((g) => {
    Object.keys(DURATION_HR_FIELDS).forEach((dt) => {
      cohortSum[g][dt] = 0;
      cohortN[g][dt] = 0;
    });
  });

  let used = 0;
  let skippedNoMeta = 0;

  for (let i = 0; i < rollupRows.length; i++) {
    const { userId, rollup } = rollupRows[i];
    const peaks = rollup.peaks;
    if (!peaks || typeof peaks !== "object") continue;
    const um = rollup.userMeta && typeof rollup.userMeta === "object" ? rollup.userMeta : null;
    let ageCategory = um && um.ageCategory ? String(um.ageCategory) : "";
    let name = um && um.name ? String(um.name) : "";
    let gKey = um && um.genderKey ? um.genderKey : null;
    let is_private = um && um.is_private === true;
    let profileImageUrl = um && um.profileImageUrl ? um.profileImageUrl : null;
    let statusFields =
      um && um.account_status != null
        ? {
            account_status: um.account_status,
            isWithdrawn: um.isWithdrawn === true,
          }
        : {};

    if (!ageCategory && rollup._userData && getLeagueCategory) {
      const ud = rollup._userData;
      const birthYear = ud.birth_year ?? ud.birthYear ?? ud.birth?.year ?? null;
      ageCategory = getLeagueCategory(ud.challenge || "Fitness", birthYear) || "";
      name = name || ud.name || "(이름 없음)";
      const gender = String(ud.gender || ud.sex || "").toLowerCase();
      gKey =
        gender === "m" || gender === "male" || gender === "남"
          ? "M"
          : gender === "f" || gender === "female" || gender === "여"
            ? "F"
            : null;
      if (privacyFlagFromFirestoreDoc) is_private = privacyFlagFromFirestoreDoc(ud);
      if (profileImageUrlFromUserData) profileImageUrl = profileImageUrlFromUserData(ud);
      if (rankingUserStatusFieldsFromData) statusFields = rankingUserStatusFieldsFromData(ud);
    }

    if (!ageCategory) {
      skippedNoMeta++;
      continue;
    }
    used++;

    const hrMax = rollup.hrMaxByDuration || {};
    for (const slot of genders) {
      if (slot === "M" && gKey !== "M") continue;
      if (slot === "F" && gKey !== "F") continue;
      Object.keys(DURATION_HR_FIELDS).forEach((dth) => {
        if (hrMax[dth] > 0) {
          cohortSum[slot][dth] += hrMax[dth];
          cohortN[slot][dth] += 1;
        }
      });
    }

    Object.keys(peaks).forEach((dt) => {
      const p = peaks[dt];
      if (!p || p.wkg <= 0) return;
      const row = {
        userId,
        name: name || "(이름 없음)",
        wkg: p.wkg,
        watts: p.watts,
        weightKg: p.weightKg || rollup.weightKg,
        ageCategory,
        gender: gKey === "M" ? "male" : gKey === "F" ? "female" : "",
        is_private,
        profileImageUrl,
        ...statusFields,
      };
      for (const slot of genders) {
        if (slot === "M" && gKey !== "M") continue;
        if (slot === "F" && gKey !== "F") continue;
        byGenderDur[slot][dt].raw.push(row);
      }
    });
  }

  const out = { all: {}, M: {}, F: {} };
  genders.forEach((g) => {
    durKeys.forEach((dt) => {
      const raw = byGenderDur[g][dt].raw;
      raw.sort((a, b) => b.wkg - a.wkg);
      const withRank = raw.map((e, j) => ({ ...e, rank: j + 1 }));
      const byCategory = {
        Supremo: withRank,
        Bianco: [],
        Rosa: [],
        Infinito: [],
        Leggenda: [],
        Assoluto: [],
      };
      withRank.forEach((e) => {
        if (byCategory[e.ageCategory]) byCategory[e.ageCategory].push(e);
      });
      let cohortAvgHrBpm = null;
      if (DURATION_HR_FIELDS[dt] && cohortN[g][dt] > 0) {
        cohortAvgHrBpm = Math.round((cohortSum[g][dt] / cohortN[g][dt]) * 10) / 10;
      }
      out[g][dt] = {
        entries: withRank,
        byCategory,
        cohortAvgHrBpm: cohortAvgHrBpm != null && !isNaN(cohortAvgHrBpm) ? cohortAvgHrBpm : null,
      };
    });
  });

  return {
    boards: out,
    stats: {
      rollupRows: rollupRows.length,
      used,
      skippedNoMeta,
      startStr,
      endStr,
      mode: "collection_group",
    },
  };
}

module.exports = {
  fetchPeak28dRollupsForWindow,
  enrichRollupRowsMissingUserMeta,
  buildPeakBoardsFromRollupRows,
};

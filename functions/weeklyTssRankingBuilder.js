/**
 * 주간 TSS 랭킹 — Firestore ranking_day_totals 일 버킷 기준 (Strava 우선·Stelvio 포함).
 * Supabase daily_summaries 동기화 전에도 TOP10·TSS 탭과 동일한 정본 수치를 제공한다.
 */
const rankingDayRollup = require("./rankingDayRollup");
const {
  isRankingEligibleUserData,
  rankingUserStatusFieldsFromData,
} = require("./rankingEligibility");

const WEEKLY_TSS_BATCH_SIZE = 50;

function profileImageUrlFromUserData(data) {
  if (!data || typeof data !== "object") return null;
  const v = data.profileImageUrl;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function privacyFlagFromFirestoreDoc(data) {
  if (!data || typeof data !== "object") return false;
  const v =
    data.is_private !== undefined && data.is_private !== null
      ? data.is_private
      : data.isPrivate;
  return v === true || v === "true" || v === 1 || v === "1";
}

function getAgeCategory(birthYear) {
  if (birthYear == null || birthYear === "") return null;
  const y = Number(birthYear);
  if (!Number.isFinite(y)) return null;
  const age = new Date().getFullYear() - y;
  if (age <= 39) return "Bianco";
  if (age <= 49) return "Rosa";
  if (age <= 59) return "Infinito";
  return "Leggenda";
}

function getLeagueCategory(challenge, birthYear) {
  const ch = String(challenge || "").trim();
  if (ch === "Elite" || ch === "PRO") return "Assoluto";
  return getAgeCategory(birthYear);
}

function userMatchesGenderFilter(userData, genderFilter) {
  if (!genderFilter || genderFilter === "all") return true;
  const gender = String(userData.gender || userData.sex || "").toLowerCase();
  const want =
    genderFilter === "M" || genderFilter === "male" || genderFilter === "남"
      ? "male"
      : "female";
  const match =
    gender === "m" || gender === "male" || gender === "남"
      ? "male"
      : gender === "f" || gender === "female" || gender === "여"
        ? "female"
        : null;
  return match === want;
}

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {string} startStr
 * @param {string} endStr
 * @param {string} genderFilter all|M|F
 * @param {FirebaseFirestore.QuerySnapshot|null} usersSnap
 */
async function buildWeeklyTssRankingBoardEntries(db, startStr, endStr, genderFilter, usersSnap = null) {
  const snap = usersSnap ?? (await db.collection("users").get());
  const docs = snap.docs;
  const entries = [];
  for (let i = 0; i < docs.length; i += WEEKLY_TSS_BATCH_SIZE) {
    const batch = docs.slice(i, i + WEEKLY_TSS_BATCH_SIZE);
    /* eslint-disable no-await-in-loop */
    const results = await Promise.all(
      batch.map(async (doc) => {
        const userId = doc.id;
        const data = doc.data();
        if (!isRankingEligibleUserData(data)) return null;
        if (!userMatchesGenderFilter(data, genderFilter)) return null;
        const name = data.name || "(이름 없음)";
        const gender = String(data.gender || data.sex || "").toLowerCase();
        const birthYear = data.birth_year ?? data.birthYear ?? data.birth?.year ?? null;
        const challenge = data.challenge || "Fitness";
        const leagueCategory = getLeagueCategory(challenge, birthYear);
        if (!leagueCategory) return null;
        const totalTssRaw = await rankingDayRollup.weeklyTssSumFromDayBuckets(
          db,
          userId,
          data,
          startStr,
          endStr
        );
        if (totalTssRaw <= 0) return null;
        const totalTss = Math.round(totalTssRaw * 100) / 100;
        return {
          userId,
          name,
          totalTss,
          ageCategory: leagueCategory,
          gender,
          is_private: privacyFlagFromFirestoreDoc(data),
          profileImageUrl: profileImageUrlFromUserData(data),
          ...rankingUserStatusFieldsFromData(data),
        };
      })
    );
    /* eslint-enable no-await-in-loop */
    results.forEach((r) => {
      if (r) entries.push(r);
    });
  }
  entries.sort((a, b) => b.totalTss - a.totalTss);
  const withRank = entries.map((e, i) => ({ ...e, rank: i + 1 }));
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
  return { entries: withRank, byCategory };
}

module.exports = {
  buildWeeklyTssRankingBoardEntries,
  WEEKLY_TSS_BATCH_SIZE,
};

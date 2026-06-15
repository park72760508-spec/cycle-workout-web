/**
 * 랭킹·헵타곤 집계 — 탈퇴(비활성) 사용자 제외 규칙 (Functions 공통).
 */
function isRankingEligibleUserData(data) {
  if (!data || typeof data !== "object") return false;
  if (data.is_active === false) return false;
  const accountStatus = String(data.account_status || "").trim().toLowerCase();
  if (accountStatus === "withdrawn") return false;
  const legacyStatus = String(data.status || "").trim().toLowerCase();
  if (legacyStatus === "withdrawn" || legacyStatus === "inactive" || legacyStatus === "deleted") {
    return false;
  }
  return true;
}

function rankingUserStatusFieldsFromData(data) {
  const withdrawn = !isRankingEligibleUserData(data);
  const accountStatus = withdrawn
    ? "withdrawn"
    : String(data.account_status || "active").trim() || "active";
  return { account_status: accountStatus, isWithdrawn: withdrawn };
}

function filterEligibleRankingRows(rows) {
  return (rows || []).filter((r) => r && isRankingEligibleUserData(r) && r.isWithdrawn !== true);
}

function rerankRowsWithSequentialRank(rows) {
  return filterEligibleRankingRows(rows).map((r, i) => ({ ...r, rank: i + 1 }));
}

/** byCategory 각 부문 — 탈퇴 제외 후 rank 1..N 재부여 */
function filterEligibleByCategory(byCategory) {
  if (!byCategory || typeof byCategory !== "object") return byCategory;
  const cats = ["Supremo", "Assoluto", "Bianco", "Rosa", "Infinito", "Leggenda"];
  const out = {};
  for (const cat of cats) {
    const rows = Array.isArray(byCategory[cat]) ? byCategory[cat] : [];
    out[cat] = rerankRowsWithSequentialRank(rows);
  }
  return out;
}

module.exports = {
  isRankingEligibleUserData,
  rankingUserStatusFieldsFromData,
  filterEligibleRankingRows,
  rerankRowsWithSequentialRank,
  filterEligibleByCategory,
};

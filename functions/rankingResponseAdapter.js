/**
 * Supabase MV / 테이블 행 → Firebase getPeakPowerRanking JSON 스펙 어댑터.
 */

const PEAK_RANKING_USER_LOOKUP_ORDER = [
  "Assoluto",
  "Bianco",
  "Rosa",
  "Infinito",
  "Leggenda",
  "Supremo",
];

function genderDbToClient(g) {
  const s = String(g || "").toLowerCase();
  if (s === "male") return "male";
  if (s === "female") return "female";
  return s || "";
}

/**
 * @param {Array<object>} entries
 */
function buildByCategoryFromEntries(entries) {
  const sorted = (entries || []).slice().sort((a, b) => {
    const scoreA = a.wkg ?? a.totalTss ?? a.totalKm ?? a.speedKmh ?? 0;
    const scoreB = b.wkg ?? b.totalTss ?? b.totalKm ?? b.speedKmh ?? 0;
    return scoreB - scoreA;
  });
  const withRank = sorted.map((e, i) => ({ ...e, rank: i + 1 }));
  const byCategory = {
    Supremo: withRank,
    Bianco: [],
    Rosa: [],
    Infinito: [],
    Leggenda: [],
    Assoluto: [],
  };
  withRank.forEach((e) => {
    const cat = e.ageCategory;
    if (cat && byCategory[cat]) {
      byCategory[cat].push(e);
    }
  });
  return { entries: withRank, byCategory };
}

/**
 * @param {object} payload
 * @param {string|null} uid
 * @param {function} buildMotivationMessage
 */
function attachCurrentUserToPayload(payload, uid, buildMotivationMessage) {
  if (!uid || !payload || !payload.byCategory) return payload;
  let current = null;
  let nextUser = null;
  for (let i = 0; i < PEAK_RANKING_USER_LOOKUP_ORDER.length; i++) {
    const c = PEAK_RANKING_USER_LOOKUP_ORDER[i];
    const arr = payload.byCategory[c] || [];
    const idx = arr.findIndex((e) => e && e.userId === uid);
    if (idx >= 0) {
      current = arr[idx];
      nextUser = idx > 0 ? arr[idx - 1] : null;
      break;
    }
  }
  if (current) {
    payload.currentUser = current;
    if (typeof buildMotivationMessage === "function") {
      payload.motivationMessage = buildMotivationMessage(current, nextUser);
    }
  }
  return payload;
}

module.exports = {
  PEAK_RANKING_USER_LOOKUP_ORDER,
  genderDbToClient,
  buildByCategoryFromEntries,
  attachCurrentUserToPayload,
};

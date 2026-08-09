/**
 * 대시보드 헵타곤 카드(스텔비오 옥타곤) 전용 — `heptagon_cohort_ranks`를 Firestore 대신 Supabase에서 읽는다.
 * 랭킹보드 GC 탭(`supabaseRankingReader.fetchGcRanking`/`attachGcViewerHeptagonAxes`)과 동일한 테이블·UID 매핑을 재사용.
 * 클라이언트가 실제로 쓰는 필드만 반환: userId(firebase uid), displayName, boardRank, sumPositionScores, is_private.
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const supabaseRankingReader = require("./supabaseRankingReader");

function monthKeyKstNow() {
  return supabaseRankingReader.getMonthKeyKstNow();
}

function normStr(v, fallback) {
  return v != null && String(v).trim() !== "" ? String(v).trim() : fallback;
}

function rowToDashboardItem(row, fbUid) {
  return {
    userId: fbUid,
    displayName: row.display_name != null ? String(row.display_name) : "",
    boardRank:
      row.board_rank != null && isFinite(Number(row.board_rank)) ? Math.floor(Number(row.board_rank)) : null,
    sumPositionScores:
      row.sum_position_scores != null && isFinite(Number(row.sum_position_scores))
        ? Number(row.sum_position_scores)
        : null,
    is_private: row.is_private === true,
  };
}

/**
 * `queryStelvioHeptagonCohortBySumDesc` 대체 — 월·부문·성별 코호트를 환산 합 내림차순으로.
 * @param {import('firebase-admin')} admin
 */
async function fetchCohortBySumDesc(admin, o) {
  o = o || {};
  const monthKey = normStr(o.monthKey, monthKeyKstNow());
  const filterCategory = normStr(o.filterCategory, "Supremo");
  const filterGender = normStr(o.filterGender, "all");
  let lim = parseInt(o.limit, 10);
  if (!isFinite(lim) || lim < 1) lim = 200;
  if (lim > 10000) lim = 10000;

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("heptagon_cohort_ranks")
    .select("user_id, display_name, board_rank, sum_position_scores, is_private")
    .eq("month_key", monthKey)
    .eq("filter_category", filterCategory)
    .eq("filter_gender", filterGender)
    .order("sum_position_scores", { ascending: false })
    .limit(lim);
  if (error) throw error;

  const uuidToFbUid = await supabaseRankingReader.getFirebaseUidByUuidMap(admin);
  const items = [];
  for (const row of data || []) {
    const fbUid = row.user_id != null ? uuidToFbUid.get(String(row.user_id)) : null;
    if (!fbUid) continue;
    items.push(rowToDashboardItem(row, fbUid));
  }
  return { ok: true, items };
}

/**
 * `getStelvioHeptagonCohortEntry` 대체 — 단일 사용자 코호트 행(가장 최신 as_of_seoul).
 * @param {import('firebase-admin')} admin
 */
async function fetchCohortEntry(admin, o) {
  o = o || {};
  const fbUid = o.userId != null ? String(o.userId).trim() : "";
  if (!fbUid) return { ok: false, data: null, error: "no-uid" };
  const monthKey = normStr(o.monthKey, monthKeyKstNow());
  const filterCategory = normStr(o.filterCategory, "Supremo");
  const filterGender = normStr(o.filterGender, "all");

  const uuid = supabaseRankingReader.resolveUuid(fbUid);
  if (!uuid) return { ok: false, data: null, error: "no-uuid" };

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("heptagon_cohort_ranks")
    .select("user_id, display_name, board_rank, sum_position_scores, is_private")
    .eq("month_key", monthKey)
    .eq("filter_category", filterCategory)
    .eq("filter_gender", filterGender)
    .eq("user_id", uuid)
    .order("as_of_seoul", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: true, exists: false, data: null };
  return { ok: true, exists: true, data: rowToDashboardItem(data, fbUid) };
}

/**
 * `queryStelvioHeptagonCohortBoardN` 대체 — 동일 코호트 최대 board_rank(=집계 인원 N).
 * @param {import('firebase-admin')} admin
 */
async function fetchCohortBoardN(admin, o) {
  o = o || {};
  const monthKey = normStr(o.monthKey, monthKeyKstNow());
  const filterCategory = normStr(o.filterCategory, "Supremo");
  const filterGender = normStr(o.filterGender, "all");

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("heptagon_cohort_ranks")
    .select("board_rank")
    .eq("month_key", monthKey)
    .eq("filter_category", filterCategory)
    .eq("filter_gender", filterGender)
    .order("board_rank", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const nTotal = data && data.board_rank != null && isFinite(Number(data.board_rank)) ? Math.floor(Number(data.board_rank)) : 0;
  return { ok: true, nTotal };
}

module.exports = {
  fetchCohortBySumDesc,
  fetchCohortEntry,
  fetchCohortBoardN,
};

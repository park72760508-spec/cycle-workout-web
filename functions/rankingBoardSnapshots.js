/**
 * 비용 절감 3단계: getPeakPowerRanking 공용 스냅샷 쓰기.
 *
 * 랭킹보드는 배치 구간 동안 모든 사용자에게 같다 — Cloud Run 이 구간당 처음 계산한 응답에서
 * 뷰어 개인화(currentUser·동기부여 메시지·GC 뷰어 7축)를 떼어낸 공용본을
 * Supabase ranking_board_snapshots 에 저장한다. 앱(assets/js/stelvioRankingSnapshotFetch.js)은
 * 같은 epoch 스냅샷이 있으면 Cloud Run 을 부르지 않고 직접 읽어 본인 행만 붙인다.
 *
 * @see supabase/migrations/20260925130000_ranking_board_snapshots.sql
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const supabaseRankingReader = require("./supabaseRankingReader");

const PEAK_DURATIONS = ["max", "1min", "5min", "10min", "20min", "40min", "60min"];

/** duration → 서버 캐시와 동일한 배치 경계 */
function boundariesForDuration(duration) {
  if (duration === "gc") return supabaseRankingReader.GC_BATCH_BOUNDARIES_KST;
  if (duration === "personal_speed") return supabaseRankingReader.PERSONAL_SPEED_BATCH_BOUNDARIES_KST;
  if (PEAK_DURATIONS.indexOf(duration) >= 0) return supabaseRankingReader.PEAK_POWER_BATCH_BOUNDARIES_KST;
  return null; // tss(실시간)·group_dist(뷰어 의존)·personal_dist(배치 없음) 등은 스냅샷 대상 아님
}

function snapshotKeyForQuery(query) {
  const q = query || {};
  let period = String(q.period || "monthly");
  if (period === "yearly") period = "monthly";
  const duration = String(q.duration || "5min");
  const gender = String(q.gender || "all");
  return period + "|" + duration + "|" + gender;
}

/** 뷰어 개인화 필드 제거 — attachCurrentUserToPayload·attachGcViewerHeptagonAxes 가 붙이는 값 */
function stripViewerFields(payload) {
  delete payload.currentUser;
  delete payload.motivationMessage;
  delete payload.viewerHeptagonAxis;
  delete payload.rankingParity;
  const cats = payload.byCategory && typeof payload.byCategory === "object" ? Object.keys(payload.byCategory) : [];
  const strip = (row) => {
    if (!row || typeof row !== "object") return;
    delete row.heptagonRanks;
    delete row.heptagonCohortNPerAxis;
    delete row.positionScores100;
  };
  cats.forEach((c) => (Array.isArray(payload.byCategory[c]) ? payload.byCategory[c] : []).forEach(strip));
  if (Array.isArray(payload.entries)) payload.entries.forEach(strip);
  return payload;
}

/** 인스턴스 내 중복 쓰기 방지: key → 마지막으로 확인·기록한 epoch */
const confirmedEpochByKey = new Map();

/**
 * @param {object} query req.query
 * @param {object} payload getPeakPowerRanking 최종 응답(개인화 포함) — 변경하지 않는다
 * @param {(p: object) => object} filterWithdrawn index.js filterWithdrawnUsersFromRankingPayload
 */
async function maybeWriteRankingBoardSnapshot(query, payload, filterWithdrawn) {
  try {
    if (!payload || payload.success !== true || payload.pendingAggregate === true) return;
    const duration = String((query && query.duration) || "5min");
    const boundaries = boundariesForDuration(duration);
    if (!boundaries) return;
    const epoch = supabaseRankingReader.currentBatchEpochKeyKst(boundaries);
    const key = snapshotKeyForQuery(query);
    if (confirmedEpochByKey.get(key) === epoch) return;

    const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
    const { data: existing } = await supabase
      .from("ranking_board_snapshots")
      .select("epoch")
      .eq("snapshot_key", key)
      .maybeSingle();
    if (existing && existing.epoch === epoch) {
      confirmedEpochByKey.set(key, epoch);
      return;
    }

    const shared = stripViewerFields(JSON.parse(JSON.stringify(payload)));
    // 기존 응답의 currentUser 는 탈퇴자 필터(순위 재부여) 이전 행이라 rank 가 필터 전 값이다 —
    // 앱이 같은 값을 쓰도록 필터 전 순위를 _origRank 로 보존한다(행 표시 순위는 필터 후 값 그대로).
    if (shared.byCategory && typeof shared.byCategory === "object") {
      Object.keys(shared.byCategory).forEach((c) =>
        (Array.isArray(shared.byCategory[c]) ? shared.byCategory[c] : []).forEach((row) => {
          if (row && typeof row === "object") row._origRank = row.rank;
        })
      );
    }
    if (typeof filterWithdrawn === "function") filterWithdrawn(shared);
    shared.snapshotEpoch = epoch;
    const { error } = await supabase
      .from("ranking_board_snapshots")
      .upsert({ snapshot_key: key, epoch, payload: shared, updated_at: new Date().toISOString() }, {
        onConflict: "snapshot_key",
      });
    if (error) throw error;
    confirmedEpochByKey.set(key, epoch);
  } catch (err) {
    console.warn("[rankingBoardSnapshots] write skipped:", err && err.message ? err.message : err);
  }
}

module.exports = {
  maybeWriteRankingBoardSnapshot,
  snapshotKeyForQuery,
  boundariesForDuration,
  stripViewerFields,
};

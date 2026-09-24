/**
 * 비용 절감 3·4단계: getPeakPowerRanking·getWeeklyRanking 공용 스냅샷 쓰기.
 *
 * 랭킹보드는 배치 구간 동안 모든 사용자에게 같다 — Cloud Run 이 구간당 처음 계산한 응답에서
 * 뷰어 개인화(currentUser·동기부여 메시지·GC 뷰어 7축)를 떼어낸 공용본을
 * Supabase ranking_board_snapshots 에 저장한다. 앱(assets/js/stelvioRankingSnapshotFetch.js)은
 * 같은 epoch 스냅샷이 있으면 Cloud Run 을 부르지 않고 직접 읽어 본인 행만 붙인다.
 * 4단계: 실시간 보드(TSS·주간 TOP10·30일 거리·클럽 거리)는 배치 경계 대신 Supabase 변경 신호
 * (supabaseRankingReader.fetchLiveBoardEpochKst)를 epoch 로 쓴다.
 *
 * @see supabase/migrations/20260925130000_ranking_board_snapshots.sql
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const supabaseRankingReader = require("./supabaseRankingReader");

const PEAK_DURATIONS = ["max", "1min", "5min", "10min", "20min", "40min", "60min"];
/** 4단계: 실시간 보드 — 배치 경계 대신 Supabase 변경 신호(live epoch)로 공용본을 구분 */
const LIVE_DURATIONS = ["tss", "personal_dist", "group_dist"];

function isLiveDuration(duration) {
  return LIVE_DURATIONS.indexOf(String(duration || "")) >= 0;
}

/**
 * 실시간 보드면 계산 **전에** epoch 를 잡아 둔다 — 계산 중 데이터가 바뀌면 신호가 달라져
 * 앱이 이 스냅샷을 쓰지 않으므로, 스냅샷 데이터는 항상 자기 epoch 이상으로 최신이다.
 * @returns {Promise<string|null>}
 */
async function captureLiveEpochForQuery(query) {
  const duration = String((query && query.duration) || "5min");
  if (!isLiveDuration(duration)) return null;
  return supabaseRankingReader.fetchLiveBoardEpochKst();
}

/** duration → 서버 캐시와 동일한 배치 경계 */
function boundariesForDuration(duration) {
  if (duration === "gc") return supabaseRankingReader.GC_BATCH_BOUNDARIES_KST;
  if (duration === "personal_speed") return supabaseRankingReader.PERSONAL_SPEED_BATCH_BOUNDARIES_KST;
  if (PEAK_DURATIONS.indexOf(duration) >= 0) return supabaseRankingReader.PEAK_POWER_BATCH_BOUNDARIES_KST;
  return null; // tss·group_dist·personal_dist 는 live epoch(captureLiveEpochForQuery) 사용
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
    /* 클럽 거리: 뷰어 참가 여부 — 앱이 fn_my_group_dist_participated_hosts 로 다시 붙인다 */
    if (Object.prototype.hasOwnProperty.call(row, "currentUserParticipated")) row.currentUserParticipated = false;
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
 * @param {string|null} [liveEpoch] 실시간 보드: 계산 전에 captureLiveEpochForQuery 로 잡은 값
 */
async function maybeWriteRankingBoardSnapshot(query, payload, filterWithdrawn, liveEpoch) {
  try {
    if (!payload || payload.success !== true || payload.pendingAggregate === true) return;
    const duration = String((query && query.duration) || "5min");
    let epoch = null;
    if (isLiveDuration(duration)) {
      epoch = liveEpoch || null;
    } else {
      const boundaries = boundariesForDuration(duration);
      if (boundaries) epoch = supabaseRankingReader.currentBatchEpochKeyKst(boundaries);
    }
    if (!epoch) return;
    const key = snapshotKeyForQuery(query);
    await upsertSharedSnapshot(key, epoch, payload, (shared) => {
      stripViewerFields(shared);
      // 탈퇴자 필터(순위 재부여) 전 순위를 _origRank 로 보존(진단용). 앱은 currentUser 에
      // 필터 후 순위를 쓰고 _origRank 는 떼어낸다 — 현재 Cloud Run 응답과 동일.
      if (shared.byCategory && typeof shared.byCategory === "object") {
        Object.keys(shared.byCategory).forEach((c) =>
          (Array.isArray(shared.byCategory[c]) ? shared.byCategory[c] : []).forEach((row) => {
            if (row && typeof row === "object") row._origRank = row.rank;
          })
        );
      }
      if (typeof filterWithdrawn === "function") filterWithdrawn(shared);
    });
  } catch (err) {
    console.warn("[rankingBoardSnapshots] write skipped:", err && err.message ? err.message : err);
  }
}

/**
 * getWeeklyRanking(주간 TOP10) 공용본 — 응답 직전 payload(allEntries 제거 전)에서 만든다.
 * 뷰어 전용 myRank 는 빼고, 앱이 myRank 를 계산할 수 있게 allEntries 를 표시 필드만 남겨 보관한다.
 * @param {object} query req.query (week=prev|'')
 * @param {object} payload 개인화 전 응답 본문(ranking·메타) — 변경하지 않는다
 * @param {object[]} allEntries 서버 entries 전체(순서 = 내 순위 계산 기준)
 * @param {string|null} liveEpoch 계산 전에 잡은 live epoch
 */
async function maybeWriteWeeklyTop10Snapshot(query, payload, allEntries, liveEpoch) {
  try {
    if (!liveEpoch || !payload || payload.success !== true || payload.pendingAggregate === true) return;
    const key = weeklyTop10SnapshotKey(query);
    await upsertSharedSnapshot(key, liveEpoch, payload, (shared) => {
      delete shared.myRank;
      shared.allEntriesLite = (Array.isArray(allEntries) ? allEntries : []).map((e) => ({
        userId: e.userId,
        name: e.name,
        totalTss: e.totalTss,
        rankChange: e.rankChange,
        previousBoardRank: e.previousBoardRank,
        is_private: e.is_private === true,
        profileImageUrl: e.profileImageUrl || null,
      }));
    });
  } catch (err) {
    console.warn("[rankingBoardSnapshots] weekly write skipped:", err && err.message ? err.message : err);
  }
}

function weeklyTop10SnapshotKey(query) {
  return "weekly_top10|" + ((query && query.week) === "prev" ? "prev" : "current");
}

async function upsertSharedSnapshot(key, epoch, payload, transform) {
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

  const shared = JSON.parse(JSON.stringify(payload));
  transform(shared);
  shared.snapshotEpoch = epoch;
  const { error } = await supabase
    .from("ranking_board_snapshots")
    .upsert({ snapshot_key: key, epoch, payload: shared, updated_at: new Date().toISOString() }, {
      onConflict: "snapshot_key",
    });
  if (error) throw error;
  confirmedEpochByKey.set(key, epoch);
}

module.exports = {
  maybeWriteRankingBoardSnapshot,
  maybeWriteWeeklyTop10Snapshot,
  captureLiveEpochForQuery,
  weeklyTop10SnapshotKey,
  isLiveDuration,
  snapshotKeyForQuery,
  boundariesForDuration,
  stripViewerFields,
};

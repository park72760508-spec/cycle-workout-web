/**
 * 클럽 챌린지 미션 — Supabase(club_missions / club_mission_completions) 읽기·쓰기.
 *
 * - 클럽당 진행 중 미션 1개(is_active). 생성·수정은 방장/관리자(grade=1|3, 가입된 클럽 한정).
 * - 회원은 steps 순서대로 수행한다. 완료는 클라이언트가 훈련 저장 직후 호출하며, 서버가
 *   Firestore 훈련 로그(users/{uid}/logs/{logId})로 워크아웃 일치·수행 시간·미션 기간을 검증한다.
 *
 * @see supabase/migrations/20260924150000_club_missions.sql
 * @see functions/clubWorkoutWrites.js — 권한 검증 패턴 동일
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const supabaseGroupDualWrite = require("./supabaseGroupDualWriteServer");
const ridingGroupSupabaseWrites = require("./ridingGroupSupabaseWrites");

const clubMissionScoring = require("./clubMissionScoring");
const supabaseUidMap = require("./supabaseUidMap");

const { WriteError, fetchOrBackfillGroupRow, isRidingGroupAdminGrade } = ridingGroupSupabaseWrites;

/** STELVIO(구글시트) 워크아웃 조회 — 프런트 window.GAS_URL 과 동일한 공개 웹앱 */
const GAS_WORKOUT_URL =
  "https://script.google.com/macros/s/AKfycbzF8br63uD3ziNxCFkp0UUSpP49zURthDsEVZ6o3uRu47pdS5uXE5S1oJ3d7AKHFouJ/exec";
const MAX_SEGMENTS = 200;

const MAX_STEPS = 60;
/** 훈련 로그 수행 시간이 워크아웃 총 시간의 이 비율 이상이어야 완료로 인정 */
const MIN_COMPLETION_RATIO = 0.9;
const VALID_SOURCES = new Set(["gas", "club"]);
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function seoulTodayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function sanitizeSteps(stepsRaw) {
  if (!Array.isArray(stepsRaw) || !stepsRaw.length) {
    throw new WriteError(400, "미션을 1개 이상 설정해 주세요.");
  }
  if (stepsRaw.length > MAX_STEPS) throw new WriteError(400, "미션은 최대 " + MAX_STEPS + "개까지 설정할 수 있습니다.");
  return stepsRaw.map((s, idx) => {
    const workoutId = String((s && s.workoutId) || "").trim();
    const workoutSource = String((s && s.workoutSource) || "").trim();
    if (!workoutId || !VALID_SOURCES.has(workoutSource)) {
      throw new WriteError(400, idx + 1 + "번 미션의 워크아웃을 선택해 주세요.");
    }
    return {
      ord: idx + 1,
      workoutId: workoutId.slice(0, 100),
      workoutSource,
      title: String((s && s.title) || "").slice(0, 100),
      totalSeconds: Math.max(0, Math.floor(Number(s && s.totalSeconds) || 0)),
    };
  });
}

function sanitizeSegments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SEGMENTS).map((seg) => ({
    segment_type: String((seg && seg.segment_type) || "").slice(0, 30),
    duration_sec: Math.max(0, Math.floor(Number(seg && (seg.duration_sec != null ? seg.duration_sec : seg.duration)) || 0)),
    target_type: String((seg && seg.target_type) || "ftp_pct").slice(0, 30),
    target_value: String(seg && seg.target_value != null ? seg.target_value : "").slice(0, 30),
    ramp: seg && seg.ramp === "linear" ? "linear" : "none",
    ramp_to_value: seg && seg.ramp === "linear" ? Number(seg.ramp_to_value) || null : null,
  }));
}

/**
 * 단계 워크아웃의 세그먼트(목표) — 달성 점수 산출용. 클라이언트 값은 믿지 않고 서버가 원본에서 조회한다.
 * @returns {Promise<object[]>} 실패 시 빈 배열
 */
async function fetchStepSegments(supabase, step) {
  try {
    if (step.workoutSource === "club") {
      const { data } = await supabase
        .from("club_workout_segments")
        .select("*")
        .eq("workout_id", step.workoutId)
        .order("ord", { ascending: true });
      return sanitizeSegments(data || []);
    }
    const res = await fetch(GAS_WORKOUT_URL + "?action=getWorkout&id=" + encodeURIComponent(step.workoutId));
    const json = await res.json();
    return sanitizeSegments(json && json.success && json.item ? json.item.segments : []);
  } catch (err) {
    console.warn("[clubMissions] segments fetch failed:", step.workoutSource, step.workoutId, err && err.message);
    return [];
  }
}

async function attachStepSegments(supabase, steps) {
  const segs = await Promise.all(steps.map((st) => fetchStepSegments(supabase, st)));
  return steps.map((st, i) => Object.assign({}, st, { segments: segs[i] }));
}

/** 공개 프로필 표시명 — 비공개 회원은 본인 외에는 첫 글자만 */
function maskName(name, isPrivate, isMe) {
  const n = String(name || "").trim() || "(이름 없음)";
  if (!isPrivate || isMe) return n;
  return n.slice(0, 1) + "**";
}

async function assertGroupWriteAuthority(admin, supabase, uid, gid) {
  const group = await fetchOrBackfillGroupRow(admin, supabase, gid);
  if (!group) throw new WriteError(404, "클럽을 찾을 수 없습니다.");
  const userUuid = supabaseGroupDualWrite.resolveUserUuid(uid);
  const isOwner = userUuid && String(group.created_by || "") === String(userUuid);
  const isAdmin = await isRidingGroupAdminGrade(admin, uid, supabase, group.id);
  if (!isOwner && !isAdmin) throw new WriteError(403, "미션을 관리할 권한이 없습니다.");
  return group;
}

/** 멤버십이 유효한 회원인지(만료일 없음 또는 오늘 이후) */
async function isActiveMember(supabase, groupUuid, userUuid) {
  if (!groupUuid || !userUuid) return false;
  const { data } = await supabase
    .from("riding_group_members")
    .select("membership_expires_at")
    .eq("group_id", groupUuid)
    .eq("user_id", userUuid)
    .maybeSingle();
  if (!data) return false;
  const exp = data.membership_expires_at ? String(data.membership_expires_at).slice(0, 10) : "";
  return !exp || exp >= seoulTodayYmd();
}

function mapMissionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    startDate: String(row.start_date).slice(0, 10),
    endDate: String(row.end_date).slice(0, 10),
    steps: Array.isArray(row.steps) ? row.steps : [],
    updatedAt: row.updated_at,
  };
}

async function fetchActiveMissionRow(supabase, groupUuid) {
  const { data, error } = await supabase
    .from("club_missions")
    .select("*")
    .eq("group_id", groupUuid)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * 진행 중 미션 + 내 완료 단계.
 * @param {{ groupId: string }} body
 * @returns {{ success: true, mission: object|null, completedOrds: number[], canManage: boolean }}
 */
async function handleGetClubMission(admin, uid, body) {
  const gid = String((body && body.groupId) || "").trim();
  if (!gid) throw new WriteError(400, "요청이 올바르지 않습니다.");
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const groupUuid = supabaseGroupDualWrite.resolveRidingGroupUuid(gid);
  if (!groupUuid) return { success: true, mission: null, completedOrds: [], canManage: false };

  const userUuid = supabaseGroupDualWrite.resolveUserUuid(uid);
  const row = await fetchActiveMissionRow(supabase, groupUuid);

  let completedOrds = [];
  const myResults = {};
  let leaderboard = [];
  let myRank = null;
  if (row) {
    const { data: allComps } = await supabase
      .from("club_mission_completions")
      .select("user_id, step_ord, step_score, interval_achievement, wkg, completed_at")
      .eq("mission_id", row.id);
    const byUser = new Map();
    // 미션 수정으로 단계 수가 줄면(예: 30→5) 없어진 번호의 완료 기록은 집계에서 제외(기록 자체는 보존)
    const validOrds = new Set((Array.isArray(row.steps) ? row.steps : []).map((st) => Number(st.ord)));
    (allComps || []).forEach((c) => {
      if (!validOrds.has(Number(c.step_ord))) return;
      const key = String(c.user_id);
      if (!byUser.has(key)) byUser.set(key, { userId: key, stepScores: [], lastCompletedAt: "" });
      const u = byUser.get(key);
      u.stepScores.push(c.step_score != null ? Number(c.step_score) : null);
      if (String(c.completed_at || "") > u.lastCompletedAt) u.lastCompletedAt = String(c.completed_at || "");
      if (userUuid && key === String(userUuid)) {
        completedOrds.push(Number(c.step_ord));
        myResults[c.step_ord] = {
          score: c.step_score != null ? Number(c.step_score) : null,
          intervalAchievement: c.interval_achievement != null ? Number(c.interval_achievement) : null,
          wkg: c.wkg != null ? Number(c.wkg) : null,
        };
      }
    });
    completedOrds.sort((a, b) => a - b);

    const ranked = clubMissionScoring.rankMissionUsers(
      Array.isArray(row.steps) ? row.steps.length : 0,
      Array.from(byUser.values())
    );
    const ids = ranked.map((r) => r.userId);
    const names = new Map();
    if (ids.length) {
      const { data: profs } = await supabase
        .from("v_user_public_profile")
        .select("id, display_name, is_private")
        .in("id", ids);
      (profs || []).forEach((p) => names.set(String(p.id), p));
    }
    // 클럽 상세 멤버 리스트(항목 '미션')가 Firebase uid로 멤버와 매칭하므로 함께 내려준다
    let fbUidByUuid = new Map();
    if (ids.length) {
      try {
        fbUidByUuid = (await supabaseUidMap.getUuidToFirebaseUidMap(admin)) || new Map();
      } catch (eMap) {
        console.warn("[clubMissions] uid map failed:", eMap && eMap.message);
      }
    }
    leaderboard = ranked.map((r) => {
      const p = names.get(r.userId) || {};
      const isMe = !!userUuid && r.userId === String(userUuid);
      if (isMe) myRank = r.rank;
      return {
        rank: r.rank,
        uid: fbUidByUuid.get(r.userId) || null,
        name: maskName(p.display_name, p.is_private === true, isMe),
        isMe,
        completed: r.completed,
        completionRate: r.completionRate,
        avgStepScore: r.avgStepScore,
        total: r.total,
      };
    });
  }

  let canManage = false;
  try {
    const { data: g } = await supabase.from("riding_groups").select("created_by").eq("id", groupUuid).maybeSingle();
    canManage =
      (userUuid && g && String(g.created_by || "") === String(userUuid)) ||
      (await isRidingGroupAdminGrade(admin, uid, supabase, groupUuid));
  } catch (_eAuth) {
    canManage = false;
  }

  return {
    success: true,
    mission: mapMissionRow(row),
    completedOrds,
    myResults,
    leaderboard,
    myRank,
    canManage: !!canManage,
  };
}

/**
 * 미션 생성·수정 — 진행 중 미션이 있으면 그 행을 갱신(수정), 없으면 새로 만든다.
 * 수정으로 단계 구성이 바뀌어도 기존 완료 기록(step_ord 기준)은 유지된다.
 * @param {{ groupId: string, title: string, startDate: string, endDate: string, steps: object[] }} body
 */
async function handleSaveClubMission(admin, uid, body) {
  const gid = String((body && body.groupId) || "").trim();
  const title = String((body && body.title) || "").trim();
  const startDate = String((body && body.startDate) || "").trim();
  const endDate = String((body && body.endDate) || "").trim();
  if (!uid || !gid) throw new WriteError(400, "요청이 올바르지 않습니다.");
  if (!title) throw new WriteError(400, "미션명을 입력해 주세요.");
  if (!YMD_RE.test(startDate) || !YMD_RE.test(endDate)) throw new WriteError(400, "미션 기간을 선택해 주세요.");
  if (endDate < startDate) throw new WriteError(400, "종료일은 시작일 이후여야 합니다.");
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const group = await assertGroupWriteAuthority(admin, supabase, uid, gid);
  // 달성 점수용 세그먼트 목표를 서버가 원본에서 조회해 단계에 저장(실패한 단계는 완료 시 재조회)
  const steps = await attachStepSegments(supabase, sanitizeSteps(body && body.steps));
  const existing = await fetchActiveMissionRow(supabase, group.id);
  const fields = {
    title: title.slice(0, 100),
    start_date: startDate,
    end_date: endDate,
    steps,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase.from("club_missions").update(fields).eq("id", existing.id);
    if (error) throw error;
    return { success: true, id: existing.id, updated: true };
  }
  const { data, error } = await supabase
    .from("club_missions")
    .insert(Object.assign({ group_id: group.id, created_by: supabaseGroupDualWrite.resolveUserUuid(uid) }, fields))
    .select("id")
    .single();
  if (error) throw error;
  return { success: true, id: data.id, updated: false };
}

/**
 * 미션 단계 완료 — 훈련 저장 직후 호출.
 * 검증: 활성 회원 · 미션 기간 내 · 다음 순서 단계 · 훈련 로그의 workout_id 일치 · 수행 시간 90% 이상.
 * @param {{ groupId: string, missionId: string, stepOrd: number, trainingLogId: string }} body
 */
async function handleCompleteClubMissionStep(admin, uid, body) {
  const gid = String((body && body.groupId) || "").trim();
  const missionId = String((body && body.missionId) || "").trim();
  const stepOrd = Math.floor(Number(body && body.stepOrd));
  const logId = String((body && body.trainingLogId) || "").trim();
  if (!uid || !gid || !missionId || !(stepOrd >= 1) || !logId) {
    throw new WriteError(400, "요청이 올바르지 않습니다.");
  }

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const groupUuid = supabaseGroupDualWrite.resolveRidingGroupUuid(gid);
  const userUuid = supabaseGroupDualWrite.resolveUserUuid(uid);
  if (!groupUuid || !userUuid) throw new WriteError(404, "클럽 또는 사용자를 찾을 수 없습니다.");
  if (!(await isActiveMember(supabase, groupUuid, userUuid))) {
    throw new WriteError(403, "클럽 회원만 미션을 수행할 수 있습니다.");
  }

  const row = await fetchActiveMissionRow(supabase, groupUuid);
  if (!row || String(row.id) !== missionId) throw new WriteError(404, "진행 중인 미션이 아닙니다.");
  const mission = mapMissionRow(row);
  const today = seoulTodayYmd();
  if (today < mission.startDate || today > mission.endDate) {
    throw new WriteError(400, "미션 기간이 아닙니다.");
  }
  const step = mission.steps.find((s) => Number(s.ord) === stepOrd);
  if (!step) throw new WriteError(404, "미션 단계를 찾을 수 없습니다.");

  const { data: comps } = await supabase
    .from("club_mission_completions")
    .select("step_ord")
    .eq("mission_id", row.id)
    .eq("user_id", userUuid);
  const done = new Set((comps || []).map((c) => Number(c.step_ord)));
  if (done.has(stepOrd)) return { success: true, alreadyCompleted: true };
  const nextOrd = mission.steps.map((s) => Number(s.ord)).sort((a, b) => a - b).find((o) => !done.has(o));
  if (nextOrd !== stepOrd) throw new WriteError(400, "미션은 순서대로 수행해야 합니다.");

  const logSnap = await admin.firestore().collection("users").doc(uid).collection("logs").doc(logId).get();
  if (!logSnap.exists) throw new WriteError(404, "훈련 기록을 찾을 수 없습니다.");
  const log = logSnap.data() || {};
  if (String(log.workout_id || "") !== String(step.workoutId)) {
    throw new WriteError(400, "미션 워크아웃과 다른 훈련입니다.");
  }
  const logDate = String(log.date || "").slice(0, 10);
  if (logDate && (logDate < mission.startDate || logDate > mission.endDate)) {
    throw new WriteError(400, "미션 기간 밖의 훈련입니다.");
  }
  const needSec = Math.floor((Number(step.totalSeconds) || 0) * MIN_COMPLETION_RATIO);
  if (needSec > 0 && (Number(log.duration_sec) || 0) < needSec) {
    return { success: true, completed: false, reason: "too_short", needSec };
  }

  // 세그먼트 목표가 없으면(미션 저장 당시 조회 실패·기능 추가 전 미션) 지금 조회해 미션에 채워 둔다
  let segments = Array.isArray(step.segments) ? step.segments : [];
  if (!segments.length) {
    segments = await fetchStepSegments(supabase, step);
    if (segments.length) {
      const nextSteps = mission.steps.map((s) => (Number(s.ord) === stepOrd ? Object.assign({}, s, { segments }) : s));
      await supabase.from("club_missions").update({ steps: nextSteps }).eq("id", row.id);
    }
  }
  const result = clubMissionScoring.computeStepAchievement(
    segments,
    log.segment_avg_watts,
    Number(log.ftp_at_time),
    Number(log.weight),
    Number(log.avg_watts)
  );

  const { error } = await supabase.from("club_mission_completions").insert({
    mission_id: row.id,
    user_id: userUuid,
    step_ord: stepOrd,
    workout_id: String(step.workoutId),
    training_log_id: logId,
    step_score: result ? result.score : null,
    interval_achievement: result ? result.intervalAchievement : null,
    wkg: result ? result.wkg : null,
    wkg_factor: result ? result.wkgFactor : null,
    score_method: result ? result.method : null,
  });
  if (error && error.code !== "23505") throw error;
  return { success: true, completed: true, stepOrd, result };
}

module.exports = {
  handleGetClubMission,
  handleSaveClubMission,
  handleCompleteClubMissionStep,
  MIN_COMPLETION_RATIO,
};

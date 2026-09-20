/**
 * 클럽 전용 워크아웃 — Supabase(club_workouts/club_workout_segments) 쓰기·읽기.
 *
 * 기존 워크아웃(구글시트 Workouts/WorkoutSegments)과 컬럼명을 동일하게 맞춰 프런트엔드
 * 렌더링 코드(assets/js/workoutManager.js의 세그먼트 그래프 등)가 변환 없이 그대로
 * 소비할 수 있게 한다. group_id로 클럽에 스코프되며, 방장/관리자(grade=1|3, 가입된 클럽 한정)만
 * 생성·삭제할 수 있다.
 *
 * @see supabase/migrations/20260920090000_club_workouts_and_group_session_fields.sql
 * @see functions/ridingGroupSupabaseWrites.js — fetchOrBackfillGroupRow, isRidingGroupAdminGrade 재사용
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const supabaseGroupDualWrite = require("./supabaseGroupDualWriteServer");
const ridingGroupSupabaseWrites = require("./ridingGroupSupabaseWrites");

const { WriteError, fetchOrBackfillGroupRow, isRidingGroupAdminGrade } = ridingGroupSupabaseWrites;

const MAX_SEGMENTS = 200;
const VALID_RAMP = new Set(["none", "linear"]);

function sanitizeSegments(segmentsRaw) {
  if (!Array.isArray(segmentsRaw)) throw new WriteError(400, "세그먼트 목록이 올바르지 않습니다.");
  if (!segmentsRaw.length) throw new WriteError(400, "세그먼트를 1개 이상 추가해 주세요.");
  if (segmentsRaw.length > MAX_SEGMENTS) throw new WriteError(400, "세그먼트가 너무 많습니다.");
  return segmentsRaw.map((seg, idx) => {
    const durationSec = Math.max(0, Math.floor(Number(seg && seg.duration_sec) || 0));
    const ramp = VALID_RAMP.has(String(seg && seg.ramp)) ? String(seg.ramp) : "none";
    return {
      ord: Number.isFinite(Number(seg && seg.ord)) ? Number(seg.ord) : idx,
      label: String((seg && seg.label) || "").slice(0, 100),
      segment_type: String((seg && seg.segment_type) || "steady").slice(0, 50),
      duration_sec: durationSec,
      target_type: String((seg && seg.target_type) || "ftp_pct").slice(0, 30),
      target_value: String((seg && seg.target_value) != null ? seg.target_value : "0").slice(0, 30),
      ramp,
      ramp_to_value: ramp === "linear" ? Number(seg.ramp_to_value) || null : null,
    };
  });
}

async function assertGroupWriteAuthority(admin, supabase, uid, gid) {
  const group = await fetchOrBackfillGroupRow(admin, supabase, gid);
  if (!group) throw new WriteError(404, "그룹을 찾을 수 없습니다.");
  const userUuid = supabaseGroupDualWrite.resolveUserUuid(uid);
  const isOwner = userUuid && String(group.created_by || "") === String(userUuid);
  const isAdmin = await isRidingGroupAdminGrade(admin, uid, supabase, group.id);
  if (!isOwner && !isAdmin) throw new WriteError(403, "이 작업을 수행할 권한이 없습니다.");
  return group;
}

/**
 * @param {{ groupId: string, title: string, description?: string, author?: string,
 *   status?: string, publishDate?: string, segments: object[] }} body
 */
async function handleCreateClubWorkout(admin, uid, body) {
  const gid = String((body && body.groupId) || "").trim();
  const title = String((body && body.title) || "").trim();
  if (!uid || !gid || !title) throw new WriteError(400, "요청이 올바르지 않습니다.");
  const segments = sanitizeSegments(body && body.segments);

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const group = await assertGroupWriteAuthority(admin, supabase, uid, gid);
  const createdByUuid = supabaseGroupDualWrite.resolveUserUuid(uid);
  const totalSeconds = segments.reduce((sum, s) => sum + (s.duration_sec || 0), 0);

  const { data: workoutRow, error: workoutErr } = await supabase
    .from("club_workouts")
    .insert({
      group_id: group.id,
      title: title.slice(0, 100),
      description: String((body && body.description) || "").slice(0, 500),
      author: String((body && body.author) || "").slice(0, 50),
      total_seconds: totalSeconds,
      status: (body && body.status) === "숨기기" ? "숨기기" : "보이기",
      publish_date: (body && body.publishDate) || null,
      created_by: createdByUuid,
    })
    .select("id")
    .single();
  if (workoutErr) throw workoutErr;

  const segmentRows = segments.map((s) => Object.assign({ workout_id: workoutRow.id }, s));
  const { error: segErr } = await supabase.from("club_workout_segments").insert(segmentRows);
  if (segErr) {
    await supabase.from("club_workouts").delete().eq("id", workoutRow.id);
    throw segErr;
  }

  return { success: true, id: workoutRow.id };
}

/**
 * @param {{ groupId: string, workoutId: string }} body
 */
async function handleDeleteClubWorkout(admin, uid, body) {
  const gid = String((body && body.groupId) || "").trim();
  const workoutId = String((body && body.workoutId) || "").trim();
  if (!uid || !gid || !workoutId) throw new WriteError(400, "요청이 올바르지 않습니다.");

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const group = await assertGroupWriteAuthority(admin, supabase, uid, gid);

  const { error: delErr } = await supabase
    .from("club_workouts")
    .delete()
    .eq("id", workoutId)
    .eq("group_id", group.id);
  if (delErr) throw delErr;

  return { success: true };
}

/**
 * 클럽 전용 워크아웃 목록 조회 — 기존 GAS listWorkouts 응답과 동일한 shape로 반환해
 * 프런트엔드 워크아웃 카드/그래프 렌더링 코드를 변환 없이 재사용한다.
 * @param {string} groupFirestoreDocId
 */
async function fetchClubWorkoutsForRead(admin, groupFirestoreDocId) {
  const gid = String(groupFirestoreDocId || "").trim();
  if (!gid) return [];
  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const groupUuid = supabaseGroupDualWrite.resolveRidingGroupUuid(gid);
  if (!groupUuid) return [];

  const { data: workouts } = await supabase
    .from("club_workouts")
    .select("*")
    .eq("group_id", groupUuid)
    .order("created_at", { ascending: false });
  if (!workouts || !workouts.length) return [];

  const ids = workouts.map((w) => w.id);
  const { data: segments } = await supabase
    .from("club_workout_segments")
    .select("*")
    .in("workout_id", ids)
    .order("ord", { ascending: true });

  const segmentsByWorkout = new Map();
  (segments || []).forEach((s) => {
    const list = segmentsByWorkout.get(s.workout_id) || [];
    list.push({
      ord: s.ord,
      label: s.label || "",
      segment_type: s.segment_type,
      duration_sec: s.duration_sec,
      target_type: s.target_type,
      target_value: s.target_value,
      ramp: s.ramp,
      ramp_to_value: s.ramp_to_value,
    });
    segmentsByWorkout.set(s.workout_id, list);
  });

  return workouts.map((w) => ({
    id: w.id,
    title: w.title,
    description: w.description || "",
    author: w.author || "",
    status: w.status,
    total_seconds: w.total_seconds,
    publish_date: w.publish_date,
    source: "club",
    groupId: gid,
    segments: segmentsByWorkout.get(w.id) || [],
  }));
}

module.exports = {
  handleCreateClubWorkout,
  handleDeleteClubWorkout,
  fetchClubWorkoutsForRead,
};

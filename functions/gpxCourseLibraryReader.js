/**
 * "즐겨찾기 코스" 팝업(라이딩/러닝 모임 생성 GPX 선택) — 내가 host로 만든 모임 중
 * GPX가 등록된 것들을 Supabase open_rides에서 조회.
 * 중복 제외 기준은 gpx_url(다운로드 토큰 포함, 재발급되면 값이 달라짐)이 아니라
 * gpx_storage_path(실제 Storage 객체 경로 — 같은 파일이면 항상 동일)로 판단한다.
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const supabaseRankingReader = require("./supabaseRankingReader");

const MAX_ROWS = 200;

/**
 * @param {import('firebase-admin')} admin
 * @param {string} fbUid Firebase UID
 * @param {'CYCLE'|'RUN'} category
 * @returns {Promise<Array<{id:string, title:string, course:string, gpxUrl:string, distanceKm:number|null, createdAt:string|null}>>}
 */
async function fetchMyGpxCourses(admin, fbUid, category) {
  const uid = String(fbUid || "").trim();
  if (!uid) return [];
  const cat = category === "RUN" ? "RUN" : "CYCLE";

  const uuid = supabaseRankingReader.resolveUuid(uid);
  if (!uuid) return [];

  const supabase = supabaseDualWriteServer.getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("open_rides")
    .select("id, title, course, gpx_url, gpx_storage_path, distance_km, created_at")
    .eq("host_user_id", uuid)
    .eq("category", cat)
    .not("gpx_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw error;

  const seen = new Set();
  const out = [];
  for (const row of data || []) {
    const gpxUrl = row.gpx_url != null ? String(row.gpx_url).trim() : "";
    if (!gpxUrl) continue;
    // 같은 GPX 파일이면 gpx_storage_path가 항상 동일 — 없는(구형) 행만 gpx_url로 폴백
    const dedupKey = row.gpx_storage_path != null && String(row.gpx_storage_path).trim()
      ? String(row.gpx_storage_path).trim()
      : gpxUrl;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const distanceKm =
      row.distance_km != null && isFinite(Number(row.distance_km)) ? Number(row.distance_km) : null;
    out.push({
      id: row.id,
      title: row.title != null ? String(row.title) : "",
      course: row.course != null ? String(row.course) : "",
      gpxUrl,
      distanceKm,
      createdAt: row.created_at || null,
    });
  }
  return out;
}

module.exports = { fetchMyGpxCourses };

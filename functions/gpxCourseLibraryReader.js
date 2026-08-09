/**
 * "즐겨찾기 코스" 팝업(라이딩/러닝 모임 생성 GPX 선택) — 내가 host로 만든 모임 중
 * GPX가 등록된 것들을 Supabase open_rides에서 조회, gpx_url 기준 중복 제외.
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const supabaseRankingReader = require("./supabaseRankingReader");

const MAX_ROWS = 200;

/**
 * @param {import('firebase-admin')} admin
 * @param {string} fbUid Firebase UID
 * @param {'CYCLE'|'RUN'} category
 * @returns {Promise<Array<{id:string, title:string, course:string, gpxUrl:string, createdAt:string|null}>>}
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
    .select("id, title, course, gpx_url, created_at")
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
    if (!gpxUrl || seen.has(gpxUrl)) continue;
    seen.add(gpxUrl);
    out.push({
      id: row.id,
      title: row.title != null ? String(row.title) : "",
      course: row.course != null ? String(row.course) : "",
      gpxUrl,
      createdAt: row.created_at || null,
    });
  }
  return out;
}

module.exports = { fetchMyGpxCourses };

/**
 * "즐겨찾기 코스" 팝업(라이딩/러닝 모임 생성 GPX 선택) — 내가 host로 만든 모임 중
 * GPX가 등록된 것들을 Supabase open_rides에서 조회.
 *
 * 중복 판별은 2단계:
 *  1) gpx_storage_path(실제 Storage 객체 경로) 완전 일치 — 같은 파일 재사용의 가장 흔한 케이스, 빠름.
 *  2) 1단계를 통과한 후보들끼리 실제 GPX 지오메트리(총거리·상승고도·시작/종료점·리샘플 포인트)를
 *     비교해 "파일은 다르지만 사실상 같은 코스"를 하나로 묶음 — 파일명/제목/코스설명은 비교 기준에서 제외.
 */
const supabaseDualWriteServer = require("./supabaseDualWriteServer");
const supabaseRankingReader = require("./supabaseRankingReader");

const MAX_ROWS = 200;

/** 근접 중복 판정 허용 오차 (요청 스펙) */
const DIST_TOLERANCE_M = 50;
const ELEV_TOLERANCE_M = 5;
const ENDPOINT_TOLERANCE_M = 30;
const RESAMPLE_POINTS = 50;
const AVG_POINT_DIST_THRESHOLD_M = 50;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** DOMParser 없는 Node 환경용 — trkpt/rtept lat/lon/ele만 뽑는 최소 GPX 파서(브라우저 openRidingGpx.js와 동일 대상 태그) */
function parseGpxPoints(xmlText) {
  const text = String(xmlText || "");
  const points = [];
  const elRe = /<(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  let m;
  while ((m = elRe.exec(text)) !== null) {
    const attrs = m[2] || "";
    const inner = m[3] || "";
    const latM = attrs.match(/\blat=["']([-\d.]+)["']/);
    const lonM = attrs.match(/\blon=["']([-\d.]+)["']/);
    if (!latM || !lonM) continue;
    const lat = parseFloat(latM[1]);
    const lon = parseFloat(lonM[1]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    let ele = 0;
    const eleM = inner.match(/<ele>([^<]*)<\/ele>/);
    if (eleM) {
      const v = parseFloat(eleM[1]);
      if (isFinite(v)) ele = v;
    }
    points.push({ lat, lon, ele });
  }
  return points;
}

/** 누적거리·상승고도·시작/종료점 — 근접 중복 1차 필터용 요약 통계 */
function computeTrackStats(points) {
  if (!points || points.length < 2) return null;
  let totalDistanceM = 0;
  let elevGainM = 0;
  for (let i = 1; i < points.length; i++) {
    totalDistanceM += haversineMeters(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
    const d = points[i].ele - points[i - 1].ele;
    if (d > 0) elevGainM += d;
  }
  return {
    points,
    totalDistanceM,
    elevGainM,
    start: points[0],
    end: points[points.length - 1],
  };
}

/** 누적거리 기준 n개 지점으로 균등 리샘플(선형 보간) — 형태 비교용 */
function resampleTrack(points, n) {
  if (!points || points.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + haversineMeters(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon));
  }
  const total = cum[cum.length - 1];
  if (!(total > 0)) return [];
  const out = [];
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    let idx = 0;
    while (idx < cum.length - 2 && cum[idx + 1] < target) idx++;
    const segStart = cum[idx];
    const segEnd = cum[idx + 1] != null ? cum[idx + 1] : cum[idx];
    const segLen = segEnd - segStart;
    const t = segLen > 0 ? (target - segStart) / segLen : 0;
    const p0 = points[idx];
    const p1 = points[Math.min(idx + 1, points.length - 1)];
    out.push({
      lat: p0.lat + (p1.lat - p0.lat) * t,
      lon: p0.lon + (p1.lon - p0.lon) * t,
    });
  }
  return out;
}

/** 요청 스펙 4단계 필터를 모두 통과해야 "같은 코스"로 판정 */
function isNearDuplicateTrack(a, b) {
  if (Math.abs(a.totalDistanceM - b.totalDistanceM) > DIST_TOLERANCE_M) return false;
  if (Math.abs(a.elevGainM - b.elevGainM) > ELEV_TOLERANCE_M) return false;
  if (haversineMeters(a.start.lat, a.start.lon, b.start.lat, b.start.lon) > ENDPOINT_TOLERANCE_M) return false;
  if (haversineMeters(a.end.lat, a.end.lon, b.end.lat, b.end.lon) > ENDPOINT_TOLERANCE_M) return false;

  const ra = resampleTrack(a.points, RESAMPLE_POINTS);
  const rb = resampleTrack(b.points, RESAMPLE_POINTS);
  if (ra.length !== RESAMPLE_POINTS || rb.length !== RESAMPLE_POINTS) return false;

  let sum = 0;
  for (let i = 0; i < RESAMPLE_POINTS; i++) {
    sum += haversineMeters(ra[i].lat, ra[i].lon, rb[i].lat, rb[i].lon);
  }
  return sum / RESAMPLE_POINTS <= AVG_POINT_DIST_THRESHOLD_M;
}

function makeUnionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  return { find, union };
}

/**
 * gpx_storage_path로 1차 중복 제외된 후보들의 실제 GPX를 내려받아 지오메트리 비교로 그룹화하고,
 * 그룹당 대표 1건(가장 최근 생성)만 남긴다.
 * @param {ReturnType<import('firebase-admin').storage>['bucket']} bucket
 * @param {Array<{gpxStoragePath:string}>} candidates gpx_storage_path 기준 이미 1차 dedup된 목록(최신순)
 */
async function collapseNearDuplicateCourses(bucket, candidates) {
  const withPath = candidates.filter((c) => c.gpxStoragePath);
  const withoutPath = candidates.filter((c) => !c.gpxStoragePath);

  const stats = await Promise.all(
    withPath.map(async (c) => {
      try {
        const file = bucket.file(c.gpxStoragePath);
        const [buf] = await file.download();
        const points = parseGpxPoints(buf.toString("utf8"));
        return computeTrackStats(points);
      } catch (e) {
        console.warn("[gpxCourseLibraryReader] GPX 다운로드/파싱 실패:", c.gpxStoragePath, e && e.message ? e.message : e);
        return null;
      }
    })
  );
  // 목록 표시용 거리/상승고도는 저장된 값이 아니라 실제 GPX 지오메트리 계산값을 사용
  for (let i = 0; i < withPath.length; i++) {
    if (!stats[i]) continue;
    withPath[i].distanceKm = stats[i].totalDistanceM / 1000;
    withPath[i].elevGainM = Math.round(stats[i].elevGainM);
  }

  const n = withPath.length;
  const uf = makeUnionFind(n);
  for (let i = 0; i < n; i++) {
    if (!stats[i]) continue;
    for (let j = i + 1; j < n; j++) {
      if (!stats[j]) continue;
      if (isNearDuplicateTrack(stats[i], stats[j])) uf.union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }

  const representatives = [];
  for (const idxs of groups.values()) {
    // 후보는 이미 created_at 내림차순으로 들어오므로 그룹 내 첫 항목이 가장 최신
    let best = idxs[0];
    for (const idx of idxs) {
      if (idx < best) best = idx;
    }
    representatives.push(withPath[best]);
  }
  // GPX 다운로드/파싱에 실패한 항목(stats[i]===null)은 다른 무엇과도 union되지 않으므로
  // 위 groups 루프에서 이미 자기 자신만의 그룹으로 자동 포함됨(그대로 유지, 목록에서 사라지지 않음).

  return representatives.concat(withoutPath);
}

/**
 * 내 코스 라이브러리(호스트로 만든 모임 중 GPX 있는 것들, gpx_storage_path 1차 dedup +
 * 지오메트리 근접중복 그룹화까지 마친 대표 목록) — gpxStoragePath 포함한 내부용 전체 필드.
 * fetchMyGpxCourses(공개 API)와 findMatchingExistingCourse(신규 업로드 중복 체크)가 공유.
 * @param {import('firebase-admin')} admin
 * @param {string} fbUid Firebase UID
 * @param {'CYCLE'|'RUN'} category
 */
async function fetchMyDedupedCourseLibrary(admin, fbUid, category) {
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

  const seenPaths = new Set();
  const firstPass = [];
  for (const row of data || []) {
    const gpxUrl = row.gpx_url != null ? String(row.gpx_url).trim() : "";
    if (!gpxUrl) continue;
    const gpxStoragePath = row.gpx_storage_path != null ? String(row.gpx_storage_path).trim() : "";
    const dedupKey = gpxStoragePath || gpxUrl;
    if (seenPaths.has(dedupKey)) continue;
    seenPaths.add(dedupKey);
    const distanceKm =
      row.distance_km != null && isFinite(Number(row.distance_km)) ? Number(row.distance_km) : null;
    firstPass.push({
      id: row.id,
      title: row.title != null ? String(row.title) : "",
      course: row.course != null ? String(row.course) : "",
      gpxUrl,
      gpxStoragePath,
      distanceKm,
      createdAt: row.created_at || null,
    });
  }

  let finalList = firstPass;
  try {
    const bucket = admin.storage().bucket();
    finalList = await collapseNearDuplicateCourses(bucket, firstPass);
    // 원래 최신순 유지
    finalList.sort(function (a, b) {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return tb - ta;
    });
  } catch (e) {
    console.warn("[gpxCourseLibraryReader] 근접 중복 그룹화 실패, 1차 dedup 결과만 반환:", e && e.message ? e.message : e);
    finalList = firstPass;
  }

  return finalList;
}

/**
 * @param {import('firebase-admin')} admin
 * @param {string} fbUid Firebase UID
 * @param {'CYCLE'|'RUN'} category
 * @returns {Promise<Array<{id:string, title:string, course:string, gpxUrl:string, distanceKm:number|null, elevGainM:number|null, createdAt:string|null}>>}
 */
async function fetchMyGpxCourses(admin, fbUid, category) {
  const list = await fetchMyDedupedCourseLibrary(admin, fbUid, category);
  return list.map(function (c) {
    return {
      id: c.id,
      title: c.title,
      course: c.course,
      gpxUrl: c.gpxUrl,
      distanceKm: c.distanceKm,
      elevGainM: c.elevGainM != null ? c.elevGainM : null,
      createdAt: c.createdAt,
    };
  });
}

/**
 * 라이딩/러닝 모임 생성 시 새로 첨부한 GPX가 내 기존 코스 라이브러리와 지오메트리상 같은 코스인지 확인.
 * 매치되면 그 기존 코스의 gpxUrl/gpxStoragePath를 돌려줘서, 호출부가 새 Storage 업로드 없이
 * 기존 파일을 그대로 재사용하도록 한다(중복 코스맵 누적 방지).
 * @param {import('firebase-admin')} admin
 * @param {string} fbUid Firebase UID
 * @param {'CYCLE'|'RUN'} category
 * @param {string} candidateGpxText 방금 첨부한 로컬 GPX 파일의 원문(XML)
 * @returns {Promise<{id:string, title:string, gpxUrl:string, gpxStoragePath:string}|null>}
 */
async function findMatchingExistingCourse(admin, fbUid, category, candidateGpxText) {
  const candidatePoints = parseGpxPoints(candidateGpxText);
  const candidateStats = computeTrackStats(candidatePoints);
  if (!candidateStats) return null;

  const library = await fetchMyDedupedCourseLibrary(admin, fbUid, category);
  if (!library.length) return null;

  const bucket = admin.storage().bucket();
  for (const course of library) {
    if (!course.gpxStoragePath) continue;
    try {
      const file = bucket.file(course.gpxStoragePath);
      const [buf] = await file.download();
      const existingStats = computeTrackStats(parseGpxPoints(buf.toString("utf8")));
      if (existingStats && isNearDuplicateTrack(candidateStats, existingStats)) {
        return {
          id: course.id,
          title: course.title,
          gpxUrl: course.gpxUrl,
          gpxStoragePath: course.gpxStoragePath,
        };
      }
    } catch (e) {
      console.warn(
        "[gpxCourseLibraryReader] 기존 코스 비교용 GPX 다운로드 실패:",
        course.gpxStoragePath,
        e && e.message ? e.message : e
      );
    }
  }
  return null;
}

module.exports = { fetchMyGpxCourses, findMatchingExistingCourse };

/**
 * 관리자 권한(grade) 확인 전용 캐시 — Cloud Functions 전역에서 반복되는
 * "호출자 users/{uid} 문서를 읽어 grade만 확인" 패턴의 Firestore 읽기를 줄인다.
 * 프로필 전체가 필요한 호출부(본인 정보 조회 등)는 대상이 아니며 원래 db.get()을 그대로 쓴다.
 *
 * TTL 30초: grade 승급/강등이 최대 30초 지연 반영될 수 있으나, 함수 인스턴스별 인메모리 캐시라
 * 콜드스타트마다 초기화되고 트래픽 대부분은 자연히 새 인스턴스로 분산되어 실사용 지연은 이보다 짧다.
 * 기존에도 appConfig 라우팅 설정 등에 60초 캐시가 쓰이는 저장소 관례와 일치.
 * 롤백: GRADE_TTL_MS를 0으로 바꾸면 즉시 매번 조회로 되돌아간다.
 */
const GRADE_TTL_MS = 30 * 1000;

/** @type {Map<string, { grade: string, at: number }>} */
const cache = new Map();

/**
 * @param {import('firebase-admin').firestore.Firestore} db
 * @param {string} uid
 * @returns {Promise<string>} grade 문자열(기본 "2")
 */
async function getCachedCallerGrade(db, uid) {
  const key = String(uid || "");
  if (!key) return "2";
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < GRADE_TTL_MS) {
    return hit.grade;
  }
  const snap = await db.collection("users").doc(key).get();
  const grade = snap.exists ? String((snap.data() || {}).grade ?? "2") : "2";
  cache.set(key, { grade, at: now });
  return grade;
}

module.exports = { getCachedCallerGrade, GRADE_TTL_MS };

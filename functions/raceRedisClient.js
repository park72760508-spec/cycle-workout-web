/**
 * Upstash Redis REST API — 대회 신청 선착순 슬롯의 원자적 증감.
 * ioredis 대신 REST(HTTPS) 기반 공식 서버리스 클라이언트 방식을 직접 fetch로 구현 —
 * Cloud Functions의 stateless 특성상 TCP 커넥션 풀링이 필요 없고 추가 의존성도 없다.
 * https://upstash.com/docs/redis/features/restapi — 명령을 JSON 배열로 POST하면
 * { result: ... } 또는 { error: ... }를 반환한다.
 *
 * 신청(RESERVE): GET 후 정원 비교, 원자적 INCR — Lua eval로 레이스 없이 실행.
 * 해제(RELEASE): 0 하한 가드 DECR — 취소·미입금 시 좌석을 돌려준다.
 */

/** 정원 초과 시 반환값 — 호출부는 이 값으로 '마감'을 판별한다. */
const SOLD_OUT = -1;

const RESERVE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then return -1 end
return redis.call('INCR', KEYS[1])
`;

const RELEASE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current <= 0 then return 0 end
return redis.call('DECR', KEYS[1])
`;

async function upstashCommand(restUrlRaw, restTokenRaw, command) {
  const restUrl = String(restUrlRaw || "").trim().replace(/\/+$/, "");
  const restToken = String(restTokenRaw || "").trim();
  if (!restUrl || !restToken) {
    throw new Error("[raceRedisClient] UPSTASH_REDIS_REST_URL/TOKEN이 비어 있습니다.");
  }
  const res = await fetch(restUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${restToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(`[raceRedisClient] Upstash 명령 실패: ${json.error || res.status}`);
  }
  return json.result;
}

/**
 * 정원 내면 증가 후 새 카운트, 정원 초과면 SOLD_OUT(-1) 반환. 레이스 없음(Lua 원자 실행).
 * @param {{restUrl:string, restToken:string}} conn
 * @param {string} key 예: race:{competitionId}:count
 * @param {number} capacity
 * @returns {Promise<number>}
 */
async function reserveSlot(conn, key, capacity) {
  const result = await upstashCommand(conn.restUrl, conn.restToken, [
    "EVAL",
    RESERVE_SCRIPT,
    "1",
    key,
    String(capacity),
  ]);
  return Number(result);
}

/**
 * 좌석 반환(취소·미입금·발급 실패 롤백). 0 아래로 내려가지 않는다.
 * @param {{restUrl:string, restToken:string}} conn
 * @param {string} key
 * @returns {Promise<number>} 반환 후 카운트
 */
async function releaseSlot(conn, key) {
  const result = await upstashCommand(conn.restUrl, conn.restToken, [
    "EVAL",
    RELEASE_SCRIPT,
    "1",
    key,
  ]);
  return Number(result);
}

/** 화면 표시용 — 현재 카운트만 조회(부작용 없음). */
async function getSlotCount(conn, key) {
  const result = await upstashCommand(conn.restUrl, conn.restToken, ["GET", key]);
  return result == null ? 0 : Number(result);
}

/**
 * 리컨실 전용 — 증감(INCR/DECR) 없이 카운트를 절대값으로 덮어쓴다.
 * releaseSlot 호출이 일시적으로 실패하면(네트워크 오류 등) 재시도·복구 수단이 없어 취소 처리된
 * 신청 건이 카운트에 영원히 남는 드리프트가 생길 수 있다 — Firestore(실제 유효 신청 건수)를
 * 신뢰 원본으로 삼아 주기적으로 이 값으로 맞춰준다(reconcileCompetitionSlotCount).
 */
async function setSlotCount(conn, key, value) {
  const safeValue = Math.max(0, Math.floor(Number(value) || 0));
  await upstashCommand(conn.restUrl, conn.restToken, ["SET", key, String(safeValue)]);
  return safeValue;
}

module.exports = {
  SOLD_OUT,
  reserveSlot,
  releaseSlot,
  getSlotCount,
  setSlotCount,
};

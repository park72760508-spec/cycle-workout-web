/**
 * 토스페이먼츠 Secret 복사-붙여넣기 시 흔한 오류(BOM, 따옴표, 개행) 제거.
 * 값 자체는 로그에 남기지 않는다. functions/lib/aligoCredentials.js와 동일 패턴.
 */
function scrubTossCredential(raw) {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (s.charCodeAt(0) === 0xfeff) {
    s = s.slice(1).trim();
  }
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1).trim();
  }
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

/** 로그용: 비밀 값 노출 없이 길이만 (TOSS_DEBUG_AUTH=1 일 때) */
function logTossAuthShape(label, secretKey) {
  const on = String(process.env.TOSS_DEBUG_AUTH || "").toLowerCase();
  if (on !== "1" && on !== "true" && on !== "yes") return;
  console.log(`[Toss][${label}] secretKey length=${secretKey.length}`);
}

module.exports = {
  scrubTossCredential,
  logTossAuthShape,
};

/**
 * 알리고 Secret/환경 변수 복사-붙여넣기 시 흔한 오류(BOM, 따옴표, 개행) 제거.
 * 값 자체는 로그에 남기지 않는다.
 */
export function scrubAligoCredential(raw: string | undefined | null): string {
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

/**
 * 알림톡 API JSON 응답 code/message 기준 운영 힌트 (Firestore 로그·콘솔용)
 * @see https://kakaoapi.aligo.in/akv10/alimtalk/send/
 */
export function aligoApiFailureHint(code: unknown, message: string): string {
  const c = code === undefined || code === null ? "" : String(code).trim();
  const m = (message || "").trim();
  if (c === "-99" || c === "99" || Number(code) === -99) {
    if (m.includes("인증키") || m.includes("등록되지")) {
      return (
        " [조치] Firebase Secret ALIGO_API_KEY·ALIGO_USER_ID·ALIGO_TOKEN 재확인: " +
        "알리고 콘솔 「문자 API → 카카오톡 → 신청/인증」의 Identifier(=userid)·발급키(=apikey) 사용. " +
        "일반 문자(SMS) 전용 키와 혼동 금지. ALIGO_TOKEN은 임의 비밀번호가 아니라 " +
        "`POST .../akv10/token/create/{time}/{type}` 응답의 token 값(만료 시 재발급). " +
        "Secret 갱신 후 `firebase deploy --only functions` 로 반영. " +
        "발송 서버 IP가 알리고에 미등록이면 별도 오류가 날 수 있음(고정 egress IP 등록)."
      );
    }
    const ipish = m.includes("서버 IP") || m.includes("IP로");
    if (ipish) {
      return (
        " [조치] 문구는 IP이나, code=-99는 동일 코드로 (1) 카카오톡 API userid·api_key·token 불일치·만료 " +
        "(2) SMS용 키로 카카오 API 호출 (3) 실제 패킷 egress IP가 알리고 「카카오톡 API」 화이트리스트와 불일치 등이 겹칩니다. " +
        "rides.meetupInviteAlimtalkSummary.diagSeenPublicIp(진단)·미션 측 diag를 NAT 허용 IP와 비교하고, " +
        "meetupInviteAlimtalkHttpsRelay 에 Gen2 Direct VPC(networkInterface+vpcEgress)·firebase-functions/SDK 최신 빌드로 배포됐는지 확인하세요(구형 SDK에선 VPC 옵션이 빠져 34.96.x처럼 기본 egress만 나올 수 있음). " +
        "ALIGO_DEBUG_AUTH=1 로 Secret 길이 확인. 미션은 정상·모임만 실패면 템플릿(UH_5528)·tpl_code가 아니라 인증·NAT 경로 차이를 우선 의심합니다."
      );
    }
    return (
      " [조치] code=-99: 카카오톡 API 인증 실패(키·token·userid) 또는 발송 IP 미등록 가능. " +
        "알리고 콘솔에서는 「카카오톡/API」 경로의 허용 IP·발급키·Identifier·token을 확인하세요."
    );
  }
  return "";
}

/** 로그용: 비밀 값 노출 없이 길이만 (ALIGO_DEBUG_AUTH=1 일 때) */
export function logAligoAuthShape(
  label: string,
  apikey: string,
  userid: string,
  token: string
): void {
  const on = String(process.env.ALIGO_DEBUG_AUTH || "").toLowerCase();
  if (on !== "1" && on !== "true" && on !== "yes") return;
  console.log(
    `[Aligo][${label}] cred lengths apikey=${apikey.length} userid=${userid.length} token=${token.length} useridOk=${userid.length > 0}`
  );
}

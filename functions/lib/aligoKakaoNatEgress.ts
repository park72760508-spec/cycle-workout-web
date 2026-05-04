/** 알리고(카카오) API egress를 Cloud NAT 고정 IP와 맞추기 위한 Gen2 Direct VPC 옵션 공통화 */

export const ALIGO_KAKAO_NAT_REGION = "asia-northeast3" as const;

/** Firestore/onRequest 등 동일 네트워크·VPC egress 트래픽 패턴 재사용 (드리프트 방지) */
export const ALIGO_KAKAO_CLOUD_FUNCTIONS_VPC_EGRESS_OPTS = {
  region: ALIGO_KAKAO_NAT_REGION,
  network: "default",
  vpcEgress: "ALL_TRAFFIC" as const,
};

/**
 * VPC+NAT 출구 진단용 공인 IPv4 (카카오톡 API 허용 IP 대조용; 알리고 kakaoapi와 동일 egress일 가능성이 큼).
 */
export async function fetchAligoKakaoEgressPublicIpDiagnostics(): Promise<string | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 12000);
    const r = await fetch("https://api.ipify.org?format=json", { signal: ac.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = (await r.json()) as { ip?: unknown };
    const ip = typeof j.ip === "string" ? j.ip.trim() : "";
    return ip.length > 0 ? ip : null;
  } catch {
    return null;
  }
}

export function warnIfDiagPublicIpMismatch(
  seen: string | null | undefined,
  expectedRaw: string,
  logTag: string
): void {
  const expected = expectedRaw.trim();
  if (!expected || !seen) return;
  if (seen !== expected) {
    console.warn(
      `[${logTag}] diagSeenPublicIp NAT 불일치: seen=${seen} expected=${expected} (카카오 API 허용 IP 화이트리스트 확인)`
    );
  }
}

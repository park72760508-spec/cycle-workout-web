/** 알리고(카카오) API egress를 Cloud NAT 고정 IP와 맞추기 위한 Gen2 Direct VPC 옵션 공통화 */

export const ALIGO_KAKAO_NAT_REGION = "asia-northeast3" as const;

/**
 * Firebase Functions Gen2 Direct VPC egress (Cloud NAT 고정 출구와 정렬).
 * firebase-functions ^4 는 `network`·`vpcEgress` 플랫 필드를 매니페스트에 넣지 않아 배포 시 VPC가 빠졌을 수 있음.
 * ^7+: `vpcEgress` + `networkInterface` 가 Cloud Run `networkInterfaces` 로 전달됨 (공식 SDK).
 *
 * GCP 기본 VPC: 보통 네트워크 `default` + 리전별 서브넷 `default`(asia-northeast3 배포 시 동일 리전 매칭).
 */
export const ALIGO_KAKAO_CLOUD_FUNCTIONS_VPC_EGRESS_OPTS = {
  region: ALIGO_KAKAO_NAT_REGION,
  vpcEgress: "ALL_TRAFFIC" as const,
  networkInterface: {
    network: "default",
    subnetwork: "default",
  },
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

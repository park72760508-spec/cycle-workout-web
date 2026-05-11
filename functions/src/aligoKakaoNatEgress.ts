/** 알리고(카카오) API egress를 Cloud NAT 고정 IP와 맞추기 위한 Gen2 Direct VPC 옵션 공통화 */

export const ALIGO_KAKAO_NAT_REGION = "asia-northeast3" as const;

/**
 * firebase-functions ^7: `vpcEgress: "ALL_TRAFFIC"` + `networkInterface` → Cloud Run Direct VPC Egress.
 * 모든 알리고 카카오톡 API 호출 함수(meetupInviteAlimtalkHttpsRelay, missionSubscriptionAlimtalkHttpsRelay 등)는
 * Cloud NAT 고정 IP를 통해 나가도록 항상 이 옵션을 사용한다.
 *
 * ※ 배포 전 firebase-tools 최신화 필요:
 *    npm install -g firebase-tools@latest
 *
 * [이전 조건부 로직 제거 이유]
 * STELVIO_FUNCTIONS_USE_DIRECT_VPC 환경변수가 배포 셸에 설정되지 않으면 VPC가 빠진 채로
 * 배포되어 랜덤 egress IP(34.96.x)가 사용되고 알리고 code=-99 가 발생한다.
 * Cloud NAT·VPC 인프라가 이미 구성돼 있으므로 항상 활성화한다.
 */

export type AligoKakaoCloudFunctionVpcEgressOpts = {
  readonly region: typeof ALIGO_KAKAO_NAT_REGION;
  readonly vpcEgress?: "ALL_TRAFFIC";
  readonly networkInterface?: { readonly network: string; readonly subnetwork: string };
};

export const ALIGO_KAKAO_CLOUD_FUNCTIONS_VPC_EGRESS_OPTS: AligoKakaoCloudFunctionVpcEgressOpts = {
  region: ALIGO_KAKAO_NAT_REGION,
  vpcEgress: "ALL_TRAFFIC",
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

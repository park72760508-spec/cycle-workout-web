/** 알리고(카카오) API egress를 Cloud NAT 고정 IP와 맞추기 위한 Gen2 Direct VPC 옵션 공통화 */

export const ALIGO_KAKAO_NAT_REGION = "asia-northeast3" as const;

/**
 * firebase-functions ^7: `vpcEgress` + `networkInterface` → Cloud Run 매니페스트 `vpc.networkInterfaces`.
 *
 * 🔧 배포 분석 단계 오류 예:
 *   Unexpected key `endpoints[..].vpc.networkInterfaces` … install a newer version of the Firebase CLI
 * → 우선순위: `npm install -g firebase-tools@latest` (NetworkInterfaces 지원 버전 필요)
 *
 * 📌 최신 CLI를 바로 못 올릴 경우에만 배포 직전:
 *    PowerShell: `$env:STELVIO_FUNCTIONS_USE_DIRECT_VPC='0'` 후 `firebase deploy`
 *    (region만 포함 → Direct VPC 미적용, 고정 egress NAT 코드 경로 미반영 가능)
 */

const omitDirectVpcForDeploy =
  String(process.env.STELVIO_FUNCTIONS_USE_DIRECT_VPC || "").trim() === "0";

export type AligoKakaoCloudFunctionVpcEgressOpts = {
  readonly region: typeof ALIGO_KAKAO_NAT_REGION;
  readonly vpcEgress?: "ALL_TRAFFIC";
  readonly networkInterface?: { readonly network: string; readonly subnetwork: string };
};

export const ALIGO_KAKAO_CLOUD_FUNCTIONS_VPC_EGRESS_OPTS: AligoKakaoCloudFunctionVpcEgressOpts = omitDirectVpcForDeploy
  ? { region: ALIGO_KAKAO_NAT_REGION }
  : {
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

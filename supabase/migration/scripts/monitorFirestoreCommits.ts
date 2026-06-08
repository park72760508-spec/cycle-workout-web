/**
 * Phase 4-3 — Firestore commit·트리거 부하 모니터링 (일 1,000건 이하 목표).
 *
 * gcloud logging으로 최근 24h onUserLogWritten·stravaDualWrite shadow 로그 건수 추정.
 *
 *   cd supabase/migration
 *   npx tsx scripts/monitorFirestoreCommits.ts
 */
import { execFileSync } from "node:child_process";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "stelvio-ai";
const TARGET_DAILY = 1000;

function countLogs(filter: string): number {
  try {
    const out = execFileSync(
      "gcloud",
      [
        "logging",
        "read",
        filter,
        `--project=${PROJECT}`,
        "--freshness=24h",
        "--format=value(insertId)",
        "--limit=10000",
      ],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    const lines = out.trim().split(/\r?\n/).filter(Boolean);
    return lines.length;
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    console.warn("[monitor] gcloud 실패:", err.stderr || err.message);
    return -1;
  }
}

function main() {
  const onUserLogWritten = countLogs(
    'resource.type="cloud_function" AND resource.labels.function_name="onUserLogWritten" AND textPayload:"Function execution started"'
  );
  const shadowWrites = countLogs(
    'textPayload:"Firestore shadow/fallback OK" OR textPayload:"Supabase primary OK, Firestore shadow skipped"'
  );
  const indoorReward = countLogs(
    'resource.type="cloud_function" AND resource.labels.function_name="onIndoorLogCreatedReward" AND textPayload:"Function execution started"'
  );

  const estimatedTriggerInvocations =
    (onUserLogWritten >= 0 ? onUserLogWritten : 0) + (indoorReward >= 0 ? indoorReward : 0);

  const report = {
    window: "24h",
    project: PROJECT,
    targetDailyCommits: TARGET_DAILY,
    onUserLogWrittenExecutions24h: onUserLogWritten,
    stravaShadowRelatedLogs24h: shadowWrites,
    onIndoorLogCreatedRewardExecutions24h: indoorReward,
    estimatedLogTriggerInvocations24h: estimatedTriggerInvocations,
    withinTarget: estimatedTriggerInvocations <= TARGET_DAILY,
    note:
      "정확한 Firestore commit 수는 GCP Console > Firestore > Usage에서 확인. Phase 4 후 onUserLogWritten=0 목표.",
  };

  console.log(JSON.stringify(report, null, 2));
}

main();

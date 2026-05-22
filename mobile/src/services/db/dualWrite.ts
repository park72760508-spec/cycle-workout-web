import type { DualWriteOperation } from "./types";

export interface DualWriteReporter {
  onSecondaryFailure: (
    operation: DualWriteOperation,
    error: unknown
  ) => void;
}

/**
 * Strangler Fig — 병렬 dual-write.
 * Firebase(0) 실패 시 예외 전파, Supabase(1) 실패는 격리·리포트만.
 */
export async function executeParallelDualWrite<T>(
  operation: DualWriteOperation,
  firebaseTask: () => Promise<T>,
  supabaseTask: () => Promise<void>,
  reporter: DualWriteReporter,
  dualWriteEnabled: boolean
): Promise<T> {
  if (!dualWriteEnabled) {
    return firebaseTask();
  }

  const settled = await Promise.allSettled([
    firebaseTask(),
    supabaseTask(),
  ]);

  const firebaseOutcome = settled[0];
  const supabaseOutcome = settled[1];

  if (supabaseOutcome.status === "rejected") {
    reporter.onSecondaryFailure(operation, supabaseOutcome.reason);
  }

  if (firebaseOutcome.status === "fulfilled") {
    return firebaseOutcome.value;
  }

  throw firebaseOutcome.reason;
}

/**
 * Firestore 트랜잭션 등 primary 결과가 필요한 쓰기.
 * Primary 완료 후 Supabase를 allSettled로 1회 시도 (실패 격리).
 */
export async function executePrimaryThenSecondaryDualWrite<T>(
  operation: DualWriteOperation,
  firebaseTask: () => Promise<T>,
  supabaseTask: (primaryResult: T) => Promise<void>,
  reporter: DualWriteReporter,
  dualWriteEnabled: boolean
): Promise<T> {
  const primaryResult = await firebaseTask();

  if (!dualWriteEnabled) {
    return primaryResult;
  }

  const [secondary] = await Promise.allSettled([
    supabaseTask(primaryResult),
  ]);

  if (secondary.status === "rejected") {
    reporter.onSecondaryFailure(operation, secondary.reason);
  }

  return primaryResult;
}

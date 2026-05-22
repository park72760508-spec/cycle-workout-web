import { shouldRunSupabaseDualWrite } from "./DualRunManager";
import type { DualWriteOperation, FirebaseUserId } from "./types";

export interface DualWriteReporter {
  onSecondaryFailure: (
    operation: DualWriteOperation,
    error: unknown
  ) => void;
}

/**
 * Strangler Fig — 병렬 dual-write.
 * DualRunManager(Remote Config)가 Supabase 쓰기 허용 시에만 secondary 실행.
 */
export async function executeParallelDualWrite<T>(
  operation: DualWriteOperation,
  firebaseUserId: FirebaseUserId | undefined,
  firebaseTask: () => Promise<T>,
  supabaseTask: () => Promise<void>,
  reporter: DualWriteReporter
): Promise<T> {
  if (!shouldRunSupabaseDualWrite(firebaseUserId)) {
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
 */
export async function executePrimaryThenSecondaryDualWrite<T>(
  operation: DualWriteOperation,
  firebaseUserId: FirebaseUserId | undefined,
  firebaseTask: () => Promise<T>,
  supabaseTask: (primaryResult: T) => Promise<void>,
  reporter: DualWriteReporter
): Promise<T> {
  const primaryResult = await firebaseTask();

  if (!shouldRunSupabaseDualWrite(firebaseUserId)) {
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

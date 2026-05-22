import type { ErrorReporter, SecondaryWriteFailureContext } from "./types";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/** 기본: 콘솔 + (설치 시) Sentry / Crashlytics 훅 */
export function createDefaultErrorReporter(hooks?: {
  sentry?: { captureException: (e: unknown, ctx?: Record<string, unknown>) => void };
  crashlytics?: { recordError: (e: Error) => void };
}): ErrorReporter {
  return {
    captureSecondaryFailure(ctx: SecondaryWriteFailureContext): void {
      const message = toErrorMessage(ctx.error);
      const payload = {
        operation: ctx.operation,
        message,
        firebaseUserId: ctx.firebaseUserId,
        supabaseUserId: ctx.supabaseUserId,
      };

      console.warn("[dbService] Supabase secondary write failed (isolated)", payload);

      const err =
        ctx.error instanceof Error
          ? ctx.error
          : new Error(`[${ctx.operation}] ${message}`);

      hooks?.sentry?.captureException(err, {
        tags: { layer: "dbService", dualWrite: "supabase" },
        extra: payload,
      });
      hooks?.crashlytics?.recordError(err);
    },
  };
}

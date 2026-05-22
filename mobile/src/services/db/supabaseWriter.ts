import type { RideInsertRow, UserUpdateRow } from "./types";
import type { UidResolverConfig } from "./uid";
import { resolveUserUuid } from "./uid";
import {
  getAuthenticatedSupabaseUserId,
  type StelvioSupabase,
} from "./supabaseClient";

export class SupabaseWriteSkippedError extends Error {
  readonly code = "SUPABASE_WRITE_SKIPPED" as const;
  constructor(reason: string) {
    super(reason);
    this.name = "SupabaseWriteSkippedError";
  }
}

function assertRlsUserMatch(
  sessionUserId: string,
  rowUserId: string,
  firebaseUid: string,
  uidConfig: UidResolverConfig
): void {
  const expected = resolveUserUuid(firebaseUid, uidConfig);
  if (!expected || expected !== sessionUserId || rowUserId !== sessionUserId) {
    throw new SupabaseWriteSkippedError(
      "Supabase session user does not match Firebase UID mapping"
    );
  }
}

export async function insertRide(
  supabase: StelvioSupabase,
  firebaseUid: string,
  row: RideInsertRow,
  uidConfig: UidResolverConfig
): Promise<void> {
  const sessionUserId = await getAuthenticatedSupabaseUserId(supabase);
  if (!sessionUserId) {
    throw new SupabaseWriteSkippedError("No Supabase auth session");
  }

  assertRlsUserMatch(sessionUserId, row.user_id, firebaseUid, uidConfig);

  const { error } = await supabase.from("rides").upsert(row, {
    onConflict: "user_id,activity_id",
    ignoreDuplicates: false,
  });

  if (error) {
    if (error.code === "23505") {
      return;
    }
    throw error;
  }
}

export async function updateUserRow(
  supabase: StelvioSupabase,
  firebaseUid: string,
  id: string,
  row: UserUpdateRow,
  uidConfig: UidResolverConfig
): Promise<void> {
  const sessionUserId = await getAuthenticatedSupabaseUserId(supabase);
  if (!sessionUserId) {
    throw new SupabaseWriteSkippedError("No Supabase auth session");
  }

  assertRlsUserMatch(sessionUserId, id, firebaseUid, uidConfig);

  const { error } = await supabase.from("users").update(row).eq("id", id);
  if (error) throw error;
}

export async function syncUserAfterTrainingSession(
  supabase: StelvioSupabase,
  firebaseUid: string,
  patch: UserUpdateRow,
  uidConfig: UidResolverConfig
): Promise<void> {
  const id = resolveUserUuid(firebaseUid, uidConfig);
  if (!id) {
    throw new SupabaseWriteSkippedError("Cannot resolve user uuid");
  }
  await updateUserRow(supabase, firebaseUid, id, patch, uidConfig);
}

export function isBenignSupabaseSkip(error: unknown): boolean {
  return error instanceof SupabaseWriteSkippedError;
}

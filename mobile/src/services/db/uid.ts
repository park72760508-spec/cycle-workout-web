import { v5 as uuidv5 } from "uuid";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DEFAULT_UID_NAMESPACE =
  "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

export function isUuidString(value: string): boolean {
  return UUID_RE.test(value);
}

export interface UidResolverConfig {
  uidMode: "v5" | "literal";
  uidNamespace: string;
}

/** Firebase UID → Supabase auth.users / public.users.id (마이그레이션과 동일) */
export function resolveUserUuid(
  firebaseUid: string,
  config: UidResolverConfig
): string | null {
  const raw = String(firebaseUid || "").trim();
  if (!raw) return null;

  if (config.uidMode === "literal" || isUuidString(raw)) {
    return raw.toLowerCase();
  }
  return uuidv5(raw, config.uidNamespace);
}

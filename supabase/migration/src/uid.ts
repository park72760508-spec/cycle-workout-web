import { v5 as uuidv5 } from "uuid";
import { isUuidString, type MigrationConfig } from "./config.js";

/** Firebase Auth UID / Firestore userId → PostgreSQL uuid */
export function resolveUserUuid(
  firebaseUid: string,
  config: MigrationConfig
): string | null {
  const raw = String(firebaseUid || "").trim();
  if (!raw) return null;

  if (config.uidMode === "literal" || isUuidString(raw)) {
    return raw.toLowerCase();
  }
  return uuidv5(raw, config.uidNamespace);
}

/** 오픈 라이딩 문서 ID → uuid */
export function resolveOpenRideUuid(
  firestoreDocId: string,
  config: MigrationConfig
): string {
  const key = `open_ride:${firestoreDocId}`;
  if (isUuidString(firestoreDocId)) {
    return firestoreDocId.toLowerCase();
  }
  return uuidv5(key, config.uidNamespace);
}

export function parseUserIdFromPath(path: string): string | null {
  const m = path.match(/^users\/([^/]+)\//);
  return m ? m[1] : null;
}

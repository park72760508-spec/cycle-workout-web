/**
 * Firebase Remote Config 기반 Dual-Write(Strangler Fig) 롤아웃 제어.
 *
 * Remote Config 키 (권장):
 *   dual_write_status       — OFF | SHADOW | CANARY | FULL (기본 OFF)
 *   dual_write_shadow_uids  — SHADOW 화이트리스트 Firebase UID (쉼표 구분)
 *   dual_write_canary_percent — CANARY 비율 0–100 (기본 10)
 */
import {
  createReactNativeRemoteConfigAdapter,
  type RemoteConfigAdapter,
} from "./dualRunRemoteConfig";
import type { FirebaseUserId } from "./types";

export type { RemoteConfigAdapter } from "./dualRunRemoteConfig";
export { createReactNativeRemoteConfigAdapter } from "./dualRunRemoteConfig";

export type DualWriteStatus = "OFF" | "SHADOW" | "CANARY" | "FULL";

export const REMOTE_CONFIG_KEY_STATUS = "dual_write_status";
export const REMOTE_CONFIG_KEY_SHADOW_UIDS = "dual_write_shadow_uids";
export const REMOTE_CONFIG_KEY_CANARY_PERCENT = "dual_write_canary_percent";

const VALID_STATUSES: readonly DualWriteStatus[] = [
  "OFF",
  "SHADOW",
  "CANARY",
  "FULL",
];

const DEFAULT_CANARY_PERCENT = 10;

/** Remote Config 미로드·오류 시 폴백 */
const DEFAULT_STATUS: DualWriteStatus = "OFF";

/**
 * SHADOW 기본 화이트리스트 (Remote Config `dual_write_shadow_uids` 가 우선).
 * 박지성 님 개발 계정 등 — 실제 UID로 교체하거나 RC에서만 관리하세요.
 */
const DEFAULT_SHADOW_WHITELIST: readonly string[] = [
  "Ys8GQZYyf3ZoEunSVGKnWNbtSkv2",
];

export interface RemoteConfigValues {
  status: DualWriteStatus;
  shadowUids: string[];
  canaryPercent: number;
}

export interface DualRunManagerConfig {
  /** Remote Config 어댑터 (미지정 시 RN Firebase Remote Config 시도) */
  remoteConfig?: RemoteConfigAdapter;
  /** 앱 로컬·테스트용 상태 고정 (Remote Config보다 우선) */
  localStatusOverride?: DualWriteStatus | null;
  /** SHADOW 추가 UID (Remote Config + 기본 목록에 합침) */
  extraShadowUids?: string[];
  /** CANARY 기본 비율 (Remote Config 0이면 사용) */
  defaultCanaryPercent?: number;
  /** fetch 최소 간격 ms (기본 5분) */
  minimumFetchIntervalMs?: number;
}

export interface DualWriteDecision {
  status: DualWriteStatus;
  executeSupabaseWrite: boolean;
  reason: string;
}

let instance: DualRunManager | null = null;

export function initDualRunManager(config: DualRunManagerConfig = {}): DualRunManager {
  instance = new DualRunManager(config);
  return instance;
}

export function getDualRunManager(): DualRunManager {
  if (!instance) {
    instance = new DualRunManager();
  }
  return instance;
}

export function resetDualRunManagerForTests(): void {
  instance = null;
}

export function parseDualWriteStatus(raw: string | null | undefined): DualWriteStatus {
  const normalized = String(raw ?? "")
    .trim()
    .toUpperCase();
  if ((VALID_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as DualWriteStatus;
  }
  return DEFAULT_STATUS;
}

export function parseShadowUidList(raw: string | null | undefined): string[] {
  if (!raw || !String(raw).trim()) return [];
  const trimmed = String(raw).trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((v) => String(v).trim())
          .filter((v) => v.length > 0);
      }
    } catch {
      /* fall through to comma split */
    }
  }
  return trimmed
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * CANARY 버킷: UID 문자열 해시 → 0..99, percent 미만이면 포함.
 * 동일 UID는 항상 같은 결과 (앱 재시작·기기 무관).
 */
export function isUidInCanaryPercent(
  firebaseUid: string,
  percent: number
): boolean {
  const uid = String(firebaseUid || "").trim();
  if (!uid) return false;
  const clamped = Math.min(100, Math.max(0, Math.trunc(percent)));
  if (clamped <= 0) return false;
  if (clamped >= 100) return true;

  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  }
  return hash % 100 < clamped;
}

export class DualRunManager {
  private readonly config: DualRunManagerConfig;
  private remoteConfig: RemoteConfigAdapter | null;
  private cached: RemoteConfigValues = {
    status: DEFAULT_STATUS,
    shadowUids: [...DEFAULT_SHADOW_WHITELIST],
    canaryPercent: DEFAULT_CANARY_PERCENT,
  };
  private lastFetchAt = 0;

  constructor(config: DualRunManagerConfig = {}) {
    this.config = config;
    this.remoteConfig = config.remoteConfig ?? null;
    if (config.localStatusOverride) {
      this.cached.status = config.localStatusOverride;
    }
    if (config.extraShadowUids?.length) {
      this.cached.shadowUids = mergeUidLists(
        this.cached.shadowUids,
        config.extraShadowUids
      );
    }
  }

  getStatus(): DualWriteStatus {
    if (this.config.localStatusOverride) {
      return this.config.localStatusOverride;
    }
    return this.cached.status;
  }

  getShadowWhitelist(): readonly string[] {
    return this.cached.shadowUids;
  }

  getCanaryPercent(): number {
    return this.cached.canaryPercent;
  }

  /**
   * Remote Config에서 dual_write_* 값을 가져와 캐시 갱신.
   * 앱 시작·포그라운드 복귀·주기적 refresh 시 호출.
   */
  async refreshFromRemoteConfig(force = false): Promise<RemoteConfigValues> {
    if (this.config.localStatusOverride) {
      return this.getCachedValues();
    }

    const adapter = await this.resolveRemoteConfigAdapter();
    if (!adapter) {
      return this.getCachedValues();
    }

    const minInterval =
      this.config.minimumFetchIntervalMs ?? 5 * 60 * 1000;
    const now = Date.now();
    if (!force && now - this.lastFetchAt < minInterval) {
      return this.getCachedValues();
    }

    await adapter.setDefaults({
      [REMOTE_CONFIG_KEY_STATUS]: DEFAULT_STATUS,
      [REMOTE_CONFIG_KEY_SHADOW_UIDS]: DEFAULT_SHADOW_WHITELIST.join(","),
      [REMOTE_CONFIG_KEY_CANARY_PERCENT]: DEFAULT_CANARY_PERCENT,
    });

    try {
      await adapter.fetchAndActivate();
    } catch (err) {
      console.warn("[DualRunManager] fetchAndActivate failed:", err);
      return this.getCachedValues();
    }

    this.lastFetchAt = now;

    const status = parseDualWriteStatus(
      adapter.getString(REMOTE_CONFIG_KEY_STATUS)
    );
    const rcShadow = parseShadowUidList(
      adapter.getString(REMOTE_CONFIG_KEY_SHADOW_UIDS)
    );
    const shadowUids = mergeUidLists(
      DEFAULT_SHADOW_WHITELIST,
      this.config.extraShadowUids ?? [],
      rcShadow
    );

    let canaryPercent = adapter.getNumber(
      REMOTE_CONFIG_KEY_CANARY_PERCENT
    );
    if (!Number.isFinite(canaryPercent) || canaryPercent <= 0) {
      canaryPercent =
        this.config.defaultCanaryPercent ?? DEFAULT_CANARY_PERCENT;
    }

    this.cached = {
      status,
      shadowUids,
      canaryPercent: Math.min(100, Math.max(0, Math.trunc(canaryPercent))),
    };

    return this.getCachedValues();
  }

  /**
   * Supabase secondary write 실행 여부 (dbService dual-write 최상단 게이트).
   */
  shouldExecuteSupabaseWrite(
    firebaseUserId: FirebaseUserId | undefined
  ): boolean {
    return this.evaluate(firebaseUserId).executeSupabaseWrite;
  }

  evaluate(firebaseUserId: FirebaseUserId | undefined): DualWriteDecision {
    const status = this.getStatus();
    const uid = String(firebaseUserId ?? "").trim();

    switch (status) {
      case "OFF":
        return {
          status,
          executeSupabaseWrite: false,
          reason: "dual_write_status=OFF",
        };
      case "FULL":
        return {
          status,
          executeSupabaseWrite: true,
          reason: "dual_write_status=FULL",
        };
      case "SHADOW": {
        const allowed = this.cached.shadowUids.includes(uid);
        return {
          status,
          executeSupabaseWrite: allowed,
          reason: allowed
            ? "dual_write_status=SHADOW, uid in whitelist"
            : "dual_write_status=SHADOW, uid not in whitelist",
        };
      }
      case "CANARY": {
        const inBucket = isUidInCanaryPercent(
          uid,
          this.cached.canaryPercent
        );
        return {
          status,
          executeSupabaseWrite: inBucket,
          reason: inBucket
            ? `dual_write_status=CANARY, bucket < ${this.cached.canaryPercent}%`
            : `dual_write_status=CANARY, bucket >= ${this.cached.canaryPercent}%`,
        };
      }
      default:
        return {
          status: DEFAULT_STATUS,
          executeSupabaseWrite: false,
          reason: "unknown status fallback OFF",
        };
    }
  }

  private getCachedValues(): RemoteConfigValues {
    return {
      status: this.cached.status,
      shadowUids: [...this.cached.shadowUids],
      canaryPercent: this.cached.canaryPercent,
    };
  }

  private async resolveRemoteConfigAdapter(): Promise<RemoteConfigAdapter | null> {
    if (this.remoteConfig) return this.remoteConfig;
    try {
      this.remoteConfig = createReactNativeRemoteConfigAdapter();
      return this.remoteConfig;
    } catch {
      return null;
    }
  }
}

function mergeUidLists(...lists: (readonly string[] | undefined)[]): string[] {
  const set = new Set<string>();
  for (const list of lists) {
    if (!list) continue;
    for (const uid of list) {
      const s = String(uid).trim();
      if (s) set.add(s);
    }
  }
  return [...set];
}

/** dualWrite.ts 에서 사용 */
export function shouldRunSupabaseDualWrite(
  firebaseUserId: FirebaseUserId | undefined
): boolean {
  return getDualRunManager().shouldExecuteSupabaseWrite(firebaseUserId);
}

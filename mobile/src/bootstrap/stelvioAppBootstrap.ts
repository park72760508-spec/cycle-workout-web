/**
 * Stelvio Dual-Run — 앱에 붙일 때 이 파일만 이해하면 됩니다.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  ① 앱 켜질 때 1번:  setupStelvioAppOnce()              │
 * │  ② 로그인 성공 시:  onStelvioFirebaseLogin()            │
 * │  ③ 저장할 때:      saveTrainingSession() 등 dbService   │
 * └─────────────────────────────────────────────────────────┘
 */
import { syncSupabaseAuth } from "../auth/syncSupabaseAuth";
import {
  getDualRunManager,
  initDbService,
  type DualRunManagerConfig,
  type DualWriteStatus,
  type FirebasePorts,
} from "../services/db";
import type { SupabaseClientOptions } from "../services/db/supabaseClient";
import type { FirebaseUserId } from "../services/db/types";

export interface StelvioEnvConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** https://us-central1-stelvio-ai.cloudfunctions.net/mintSupabaseSessionHttp */
  authBridgeUrl: string;
}

export interface StelvioBootstrapOptions {
  /** 기존 Firestore 저장/조회 로직 (firebasePorts.example 참고) */
  firebase: FirebasePorts;
  env: StelvioEnvConfig;
  authStorage?: SupabaseClientOptions["authStorage"];
  /** 로그인한 사용자 Firebase ID 토큰 */
  getFirebaseIdToken: () => Promise<string | null>;
  /** Remote Config SHADOW 추가 UID */
  extraShadowUids?: string[];
  /**
   * Remote Config 없이 강제 모드 (개발용).
   * 예: "SHADOW" — Console 설정 무시하고 항상 SHADOW
   */
  forceDualWriteStatus?: DualWriteStatus;
  /** true면 콘솔에 RC 상태 출력 (기본 true) */
  logStatus?: boolean;
}

let setupDone = false;
let appStateSub: { remove: () => void } | null = null;

function bindForegroundRemoteConfigRefresh(logStatus: boolean): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppState } = require("react-native") as {
      AppState: {
        addEventListener: (
          type: string,
          handler: (state: string) => void
        ) => { remove: () => void };
      };
    };
    if (appStateSub) return;
    appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void getDualRunManager()
          .refreshFromRemoteConfig()
          .then(() => {
            if (logStatus) {
              logDualWriteStatus(undefined, "RC refreshed (foreground)");
            }
          });
      }
    });
  } catch {
    /* RN 앱이 아니면 무시 */
  }
}

function logDualWriteStatus(uid: FirebaseUserId | undefined, label: string): void {
  const d = getDualRunManager().evaluate(uid);
  console.log(`[Stelvio] ${label}`, {
    status: d.status,
    supabaseWrite: d.executeSupabaseWrite,
    reason: d.reason,
  });
}

/**
 * ① 앱이 처음 켜질 때 **한 번만** 호출.
 * - dbService 초기화
 * - Firebase Remote Config 읽기 (dual_write_status 등)
 */
export async function setupStelvioAppOnce(
  options: StelvioBootstrapOptions
): Promise<void> {
  const dualRun: DualRunManagerConfig = {
    extraShadowUids: options.extraShadowUids,
  };
  if (options.forceDualWriteStatus) {
    dualRun.localStatusOverride = options.forceDualWriteStatus;
  }

  if (!setupDone) {
    initDbService({
      firebase: options.firebase,
      authStorage: options.authStorage,
      config: {
        supabaseUrl: options.env.supabaseUrl,
        supabaseAnonKey: options.env.supabaseAnonKey,
        uidNamespace: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      },
      dualRun,
    });

    bindForegroundRemoteConfigRefresh(options.logStatus !== false);
    setupDone = true;
  }

  await getDualRunManager().refreshFromRemoteConfig(true);

  if (options.logStatus !== false) {
    console.log("[Stelvio] setupStelvioAppOnce 완료", {
      status: getDualRunManager().getStatus(),
    });
  }
}

/**
 * ② Firebase 로그인 **성공 직후** 호출 (onAuthStateChanged 등).
 * - Auth Bridge → Supabase 세션
 */
export async function onStelvioFirebaseLogin(
  options: StelvioBootstrapOptions & {
    firebaseUid: FirebaseUserId;
  }
): Promise<void> {
  if (!setupDone) {
    await setupStelvioAppOnce(options);
  }

  try {
    await syncSupabaseAuth({
      authBridgeUrl: options.env.authBridgeUrl,
      supabaseUrl: options.env.supabaseUrl,
      supabaseAnonKey: options.env.supabaseAnonKey,
      authStorage: options.authStorage,
      getFirebaseIdToken: options.getFirebaseIdToken,
    });
  } catch (e) {
    console.warn("[Stelvio] Supabase 세션 실패 (Firebase는 계속 사용):", e);
  }

  if (options.logStatus !== false) {
    logDualWriteStatus(options.firebaseUid, "로그인 후 Dual-Write 상태");
  }
}

/** 테스트용: 지금 이 계정이 Supabase에도 쓸지 여부 */
export function debugStelvioDualWrite(firebaseUid: string): void {
  logDualWriteStatus(firebaseUid, "debug");
}

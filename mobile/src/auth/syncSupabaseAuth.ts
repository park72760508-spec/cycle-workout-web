import type { SupabaseClient, Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "../services/db/supabaseClient";
import type { SupabaseClientOptions } from "../services/db/supabaseClient";

export interface MintSupabaseSessionResponse {
  success: boolean;
  session: {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    /** Bridge 발급 알고리즘 (RS256) */
    signing_algorithm?: string;
    jwt_kid?: string;
    supabase_user_id: string;
    firebase_uid: string;
  };
}

export interface MintSupabaseSessionErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

export interface SyncSupabaseAuthConfig {
  /** Cloud Functions mintSupabaseSessionHttp URL */
  authBridgeUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** 이미 생성된 Supabase 클라이언트 (없으면 내부에서 생성) */
  supabase?: SupabaseClient;
  authStorage?: SupabaseClientOptions["authStorage"];
  /**
   * Firebase ID 토큰. 미지정 시 getFirebaseIdToken() 호출.
   * @example () => auth().currentUser?.getIdToken(true)
   */
  getFirebaseIdToken?: () => Promise<string | null>;
  /** true면 만료 임박 시에도 재발급 (기본 false) */
  forceRefresh?: boolean;
}

export class SupabaseAuthBridgeError extends Error {
  readonly code: string;
  readonly httpStatus?: number;

  constructor(code: string, message: string, httpStatus?: number) {
    super(message);
    this.name = "SupabaseAuthBridgeError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Firebase 로그인 직후 호출 — Bridge API로 RS256 Custom JWT를 받아 Supabase 세션 주입.
 *
 * 서버는 Legacy HS256이 아닌 Supabase JWT Signing Keys(RS256)용 Private Key로 서명합니다.
 * @see docs/SUPABASE_AUTH_BRIDGE.md
 */
export async function syncSupabaseAuth(
  config: SyncSupabaseAuthConfig
): Promise<Session> {
  const supabase =
    config.supabase ??
    getSupabaseClient(
      {
        supabaseUrl: config.supabaseUrl,
        supabaseAnonKey: config.supabaseAnonKey,
      },
      { authStorage: config.authStorage }
    );

  if (!config.forceRefresh) {
    const { data: existing } = await supabase.auth.getSession();
    if (existing.session?.access_token) {
      const expiresAt = existing.session.expires_at;
      const nowSec = Math.floor(Date.now() / 1000);
      if (expiresAt && expiresAt > nowSec + 120) {
        return existing.session;
      }
    }
  }

  const idToken = await resolveFirebaseIdToken(config);
  const minted = await fetchSupabaseSessionFromBridge(
    config.authBridgeUrl,
    idToken
  );

  const { data, error } = await supabase.auth.setSession({
    access_token: minted.access_token,
    refresh_token: minted.refresh_token,
  });

  if (error) {
    throw new SupabaseAuthBridgeError(
      "set-session-failed",
      error.message || "supabase.auth.setSession failed"
    );
  }

  if (!data.session) {
    throw new SupabaseAuthBridgeError(
      "set-session-empty",
      "Supabase session was not created"
    );
  }

  return data.session;
}

async function resolveFirebaseIdToken(
  config: SyncSupabaseAuthConfig
): Promise<string> {
  if (!config.getFirebaseIdToken) {
    throw new SupabaseAuthBridgeError(
      "missing-token-provider",
      "getFirebaseIdToken 콜백을 전달하세요 (예: Firebase Auth getIdToken)."
    );
  }
  const token = await config.getFirebaseIdToken();
  if (!token) {
    throw new SupabaseAuthBridgeError(
      "unauthenticated",
      "Firebase 로그인 세션이 없습니다."
    );
  }
  return token;
}

export async function fetchSupabaseSessionFromBridge(
  authBridgeUrl: string,
  firebaseIdToken: string
): Promise<MintSupabaseSessionResponse["session"]> {
  const url = authBridgeUrl.replace(/\/+$/, "");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firebaseIdToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({}),
  });

  let body: MintSupabaseSessionResponse | MintSupabaseSessionErrorBody = {};
  try {
    body = (await res.json()) as
      | MintSupabaseSessionResponse
      | MintSupabaseSessionErrorBody;
  } catch {
    body = {};
  }

  if (!res.ok) {
    const errBody = body as MintSupabaseSessionErrorBody;
    throw new SupabaseAuthBridgeError(
      errBody.error?.code ?? "bridge-http-error",
      errBody.error?.message ??
        `Auth bridge HTTP ${res.status}`,
      res.status
    );
  }

  const okBody = body as MintSupabaseSessionResponse;
  if (!okBody.success || !okBody.session?.access_token) {
    throw new SupabaseAuthBridgeError(
      "bridge-invalid-response",
      "Auth bridge 응답에 session.access_token이 없습니다."
    );
  }

  return okBody.session;
}

/**
 * Firebase onAuthStateChanged 에서 로그인 이벤트 시 연동.
 */
export function createSupabaseAuthSyncOnLogin(
  config: SyncSupabaseAuthConfig
): () => Promise<Session | null> {
  return async () => {
    try {
      return await syncSupabaseAuth(config);
    } catch (e) {
      if (e instanceof SupabaseAuthBridgeError && e.code === "unauthenticated") {
        return null;
      }
      console.warn("[syncSupabaseAuth] failed (Firebase UX unaffected):", e);
      return null;
    }
  };
}

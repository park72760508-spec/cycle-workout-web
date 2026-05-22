import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DbServiceConfig } from "./types";

export type StelvioSupabase = SupabaseClient;

let client: StelvioSupabase | null = null;

export interface SupabaseClientOptions {
  /** React Native: @react-native-async-storage/async-storage */
  authStorage?: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
  };
}

export function getSupabaseClient(
  config: Pick<DbServiceConfig, "supabaseUrl" | "supabaseAnonKey">,
  options?: SupabaseClientOptions
): StelvioSupabase {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: options?.authStorage
        ? {
            storage: options.authStorage,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false,
          }
        : {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
    });
  }
  return client;
}

export function resetSupabaseClientForTests(): void {
  client = null;
}

/** RLS 쓰기에 필요 — Supabase Auth 세션의 user.id (uuid) */
export async function getAuthenticatedSupabaseUserId(
  supabase: StelvioSupabase
): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) return null;
  return data.user.id;
}

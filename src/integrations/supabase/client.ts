/* eslint-disable @typescript-eslint/no-explicit-any */
// MindSpace Stage 8 — Client Supabase & Local Auth Fallback Bridge.
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import type { Database } from "./types";
import { brokeredPreviewStorage } from "./previewAuthStorage";
import {
  loadClientSession,
  setClientSession,
  clearClientSession,
  onAuthChange,
  getClientSession,
} from "@/lib/auth-client";
import { authSignIn, authSignUp, authSignOut } from "@/lib/auth.functions";
import type { MindSpaceSession } from "@/lib/auth.server";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function toSupabaseSession(session: MindSpaceSession | null): Session | null {
  if (!session) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: "bearer",
    user: {
      id: session.user.id,
      email: session.user.email,
      app_metadata: { role: session.user.role },
      user_metadata: { full_name: session.user.full_name },
      aud: "authenticated",
      created_at: session.user.created_at,
    },
  } as unknown as Session;
}

function createFallbackQueryBuilder(table: string) {
  const defaultResult = { data: [] as unknown[], error: null, count: 0 };
  const createProxy = (
    state: { data?: unknown; error?: unknown; count?: number } = defaultResult,
  ): any => {
    return new Proxy(
      {},
      {
        get(_target, prop: string | symbol) {
          if (prop === "table") return table;
          if (prop === "then") {
            return (resolve: (arg: unknown) => unknown) => resolve(state);
          }
          if (prop === "catch") {
            return (reject: (arg: unknown) => unknown) => Promise.resolve(state).catch(reject);
          }
          if (prop === "single" || prop === "maybeSingle") {
            return () => Promise.resolve({ data: null, error: null });
          }
          if (prop === "insert" || prop === "upsert") {
            return (values: unknown) => {
              const inserted = Array.isArray(values) ? values : [values];
              const singleVal = Array.isArray(values) ? values[0] : values;
              return new Proxy(
                {},
                {
                  get(_itarget, iprop: string | symbol) {
                    if (iprop === "select") {
                      return () =>
                        createProxy({ data: inserted, error: null, count: inserted.length });
                    }
                    if (iprop === "single" || iprop === "maybeSingle") {
                      return () => Promise.resolve({ data: singleVal ?? null, error: null });
                    }
                    if (iprop === "then") {
                      return (res: (arg: unknown) => unknown) =>
                        res({ data: inserted, error: null });
                    }
                    if (iprop === "catch") {
                      return (rej: (arg: unknown) => unknown) =>
                        Promise.resolve({ data: inserted, error: null }).catch(rej);
                    }
                    return () => createProxy({ data: inserted, error: null });
                  },
                },
              );
            };
          }
          // Any chained query filter/modifier returns a fresh proxy
          return (..._args: unknown[]) => createProxy(state);
        },
      },
    );
  };
  return createProxy();
}

function createSupabaseFallback() {
  return {
    from: (table: string) => createFallbackQueryBuilder(table),
    rpc: (_fnName: string, _args?: Record<string, unknown>) =>
      Promise.resolve({ data: [], error: null }),
    auth: {
      async getSession() {
        const local = getClientSession() || (await loadClientSession());
        return { data: { session: toSupabaseSession(local) }, error: null } as const;
      },
      onAuthStateChange(callback: (event: string, session: Session | null) => void) {
        const unsubscribe = onAuthChange((next) => {
          callback(next ? "SIGNED_IN" : "SIGNED_OUT", toSupabaseSession(next));
        });
        return {
          data: {
            subscription: {
              unsubscribe,
            },
          },
        } as const;
      },
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        try {
          const res = await authSignIn({ data: { email, password, rememberMe: true } });
          await setClientSession(res.session, true);
          const sbSession = toSupabaseSession(res.session);
          return { data: { session: sbSession, user: sbSession?.user || null }, error: null };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Sign-in failed. Please verify credentials.";
          return { data: { session: null, user: null }, error: { message } };
        }
      },
      async signUp({
        email,
        password,
        options,
      }: {
        email: string;
        password: string;
        options?: { data?: { full_name?: string } };
      }) {
        try {
          const fullName = options?.data?.full_name || email.split("@")[0] || "User";
          const res = await authSignUp({ data: { email, password, fullName } });
          await setClientSession(res.session, true);
          const sbSession = toSupabaseSession(res.session);
          return { data: { session: sbSession, user: sbSession?.user || null }, error: null };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Sign-up failed.";
          return { data: { session: null, user: null }, error: { message } };
        }
      },
      async signInWithOAuth() {
        return {
          data: { provider: null, url: null },
          error: {
            message:
              "Direct Google sign-in without a password requires Supabase or Google Cloud configuration. Please use email/password sign-in or Connected Accounts.",
          },
        } as const;
      },
      async signOut() {
        try {
          const current = getClientSession();
          await authSignOut({
            data: current?.refresh_token ? { refreshToken: current.refresh_token } : {},
          });
        } catch {
          // Ignore
        }
        await clearClientSession();
        return { error: null } as const;
      },
      async getClaims() {
        const current = getClientSession();
        return {
          data: { claims: current ? { sub: current.user.id, email: current.user.email } : null },
          error: null,
        } as const;
      },
    },
  } as unknown as SupabaseClient<Database>;
}

function isConfiguredSupabase(url?: string, key?: string): boolean {
  if (!url || !key) return false;
  if (url.includes("your-project.supabase.co")) return false;
  if (key === "your-anon-key" || key === "your_supabase_anon_key") return false;
  return true;
}

function createSupabaseClient() {
  const SUPABASE_URL = import.meta.env["VITE_SUPABASE_URL"] || process.env["SUPABASE_URL"];
  const SUPABASE_PUBLISHABLE_KEY =
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_PUBLISHABLE_KEY"];

  if (!isConfiguredSupabase(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)) {
    return createSupabaseFallback();
  }

  return createClient<Database>(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    global: {
      fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY!),
    },
    auth: {
      storage: brokeredPreviewStorage(),
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});

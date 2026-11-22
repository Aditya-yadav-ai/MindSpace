// MindSpace Stage 8 — Unified Authentication Middleware.
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { JwtPayload } from "@supabase/supabase-js";
import type { Database } from "./types";
import { verifyJwt } from "@/lib/auth.server";

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

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();

    const authHeader = request?.headers ? request.headers.get("authorization") : null;
    const token =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.replace("Bearer ", "").trim()
        : null;

    // 1. Try verifying as MindSpace Enterprise JWT token
    if (token && token.split(".").length === 3) {
      try {
        const payload = verifyJwt(token);
        if (payload && payload.sub) {
          const claims = {
            ...payload,
            sub: payload.sub,
            email: payload.email,
            role: payload.role,
          } as unknown as JwtPayload;

          return next({
            context: {
              supabase: createClient<Database>("http://127.0.0.1:54321", "local-key"),
              userId: payload.sub,
              email: payload.email || "",
              claims,
            },
          });
        }
      } catch {
        // Not a valid MindSpace token or signature mismatch; fall through to Supabase
      }
    }

    // 2. Try verifying with Supabase if configured
    const SUPABASE_URL = process.env["SUPABASE_URL"];
    const SUPABASE_PUBLISHABLE_KEY = process.env["SUPABASE_PUBLISHABLE_KEY"];

    if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && token) {
      try {
        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: {
            fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
            headers: { Authorization: `Bearer ${token}` },
          },
          auth: {
            storage: undefined,
            persistSession: false,
            autoRefreshToken: false,
          },
        });

        const { data, error } = await supabase.auth.getClaims(token);
        if (!error && data?.claims?.sub) {
          return next({
            context: {
              supabase,
              userId: data.claims.sub,
              email: (data.claims.email as string) || "",
              claims: data.claims,
            },
          });
        }
      } catch {
        // Fall through
      }
    }

    // 3. If token was provided but failed verification
    if (token) {
      throw new Error("Unauthorized: Invalid or expired authentication token.");
    }

    // 4. No token provided: fail closed in production
    const isProd =
      process.env["ENVIRONMENT"] === "production" || process.env.NODE_ENV === "production";
    if (isProd) {
      throw new Error(
        "Unauthorized: Authentication required. Please sign in to MindSpace to continue.",
      );
    }

    // 5. Development/demo mode fallback context
    return next({
      context: {
        supabase: createClient<Database>("http://127.0.0.1:54321", "demo-key"),
        userId: "demo_evaluator",
        email: "demo@mindspace.local",
        claims: { sub: "demo_evaluator", email: "demo@mindspace.local" } as unknown as JwtPayload,
      },
    });
  },
);

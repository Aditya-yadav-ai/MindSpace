// MindSpace Stage 8 — Global Client Function Middleware for Authentication.
import { createMiddleware } from "@tanstack/react-start";
import { getActiveBearerToken } from "@/lib/auth-client";
import { supabase } from "./client";

// Must be registered as a global `functionMiddleware` in `src/start.ts`;
// automatically attaches the verified bearer token to every serverFn RPC.
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    // 1. Prioritize MindSpace unified auth bearer token
    let token = getActiveBearerToken();

    // 2. Fall back to Supabase auth session if present
    if (!token) {
      try {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token || null;
      } catch {
        // Ignore Supabase client error
      }
    }

    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);

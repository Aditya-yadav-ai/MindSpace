/**
 * MindSpace Stage 8 — Authentication Server Functions.
 * Exposes type-safe RPCs for login, signup, password reset, and session validation.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import {
  signInUser,
  signUpUser,
  requestPasswordReset,
  resetPasswordWithToken,
  refreshUserSession,
  signOutSession,
  verifyJwt,
  createSessionForUser,
  getUserById,
  type MindSpaceSession,
  type UserProfile,
} from "./auth.server";

export const authSignUp = createServerFn({ method: "POST" })
  .validator((d: { email: string; password: string; fullName?: string }) => d)
  .handler(async ({ data }): Promise<{ session: MindSpaceSession }> => {
    const session = await signUpUser(data.email, data.password, data.fullName || "");
    return { session };
  });

export const authSignIn = createServerFn({ method: "POST" })
  .validator((d: { email: string; password: string; rememberMe?: boolean }) => d)
  .handler(async ({ data }): Promise<{ session: MindSpaceSession }> => {
    const session = await signInUser(data.email, data.password, data.rememberMe ?? true);
    return { session };
  });

export const authForgotPassword = createServerFn({ method: "POST" })
  .validator((d: { email: string }) => d)
  .handler(async ({ data }): Promise<{ success: boolean; message: string }> => {
    return requestPasswordReset(data.email);
  });

export const authResetPassword = createServerFn({ method: "POST" })
  .validator((d: { token: string; newPassword: string }) => d)
  .handler(async ({ data }): Promise<{ success: boolean; message: string }> => {
    return resetPasswordWithToken(data.token, data.newPassword);
  });

export const authRefresh = createServerFn({ method: "POST" })
  .validator((d: { refreshToken: string }) => d)
  .handler(async ({ data }): Promise<{ session: MindSpaceSession }> => {
    const session = await refreshUserSession(data.refreshToken);
    return { session };
  });

export const authSignOut = createServerFn({ method: "POST" })
  .validator((d: { refreshToken?: string } | undefined) => d ?? {})
  .handler(async ({ data }): Promise<{ success: true }> => {
    await signOutSession(data?.refreshToken);
    return { success: true };
  });

export const authGetSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ user: UserProfile | null }> => {
    const request = getRequest();
    if (!request?.headers) return { user: null };
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return { user: null };

    const token = authHeader.replace("Bearer ", "").trim();
    try {
      const payload = verifyJwt(token);
      const user = await getUserById(payload.sub);
      return {
        user: user || {
          id: payload.sub,
          email: payload.email,
          full_name: payload.email.split("@")[0] || "User",
          role: payload.role,
          created_at: new Date(payload.iat * 1000).toISOString(),
        },
      };
    } catch {
      return { user: null };
    }
  },
);

/**
 * Creates an explicitly labeled local demo session for offline evaluation.
 * Never connects real Google services or treats demo data as authenticated user records.
 */
export const authCreateDemoSession = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ session: MindSpaceSession }> => {
    const demoUser: UserProfile = {
      id: "usr_demo_workspace_evaluator",
      email: "demo@mindspace.local",
      full_name: "Demo Evaluator",
      role: "demo",
      created_at: new Date().toISOString(),
    };
    const session = createSessionForUser(demoUser, false);
    return { session };
  },
);

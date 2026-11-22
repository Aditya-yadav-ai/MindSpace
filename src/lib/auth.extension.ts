/**
 * MindSpace Stage 8 — Extension Client Auth Functions.
 *
 * Provides client-side RPC replacements for the Chromium Extension side panel,
 * executing against the browser Web Crypto engine and local extension storage.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  signInUser,
  signUpUser,
  requestPasswordReset,
  resetPasswordWithToken,
  refreshUserSession,
  signOutSession,
  createSessionForUser,
  type MindSpaceSession,
  type UserProfile,
} from "./auth.browser-shim";
import { getClientSession, loadClientSession } from "./auth-client";

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
    const session = getClientSession() || (await loadClientSession());
    return { user: session?.user || null };
  },
);

/**
 * Creates an explicitly labeled local demo session for offline evaluation.
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

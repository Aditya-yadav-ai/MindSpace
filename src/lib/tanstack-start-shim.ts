/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Client shim for @tanstack/react-start for self-contained extension builds.
 * Implements createServerFn, useServerFn, and createMiddleware so components
 * can run client-side without requiring a Node.js SSR runtime.
 */

export function createServerFn(options?: Record<string, unknown>) {
  let registeredHandler:
    ((ctx: { data: unknown; context: Record<string, unknown> }) => Promise<unknown>) | null = null;

  const fn: any = async (payload?: any) => {
    if (registeredHandler) {
      try {
        const inputData =
          payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
        return await registeredHandler({ data: inputData, context: { userId: "local-user" } });
      } catch (err) {
        console.warn("[Extension client] serverFn execution failed:", err);
        return null;
      }
    }
    return null;
  };

  fn.middleware = () => fn;
  fn.validator = () => fn;
  fn.inputValidator = () => fn;
  fn.handler = (handler: any) => {
    registeredHandler = handler;
    return fn;
  };

  return fn;
}

export function createMiddleware() {
  const mw: any = {
    server: () => mw,
    client: () => mw,
  };
  return mw;
}

export function useServerFn(serverFn: any) {
  return async (args?: any) => {
    if (typeof serverFn === "function") {
      return serverFn(args);
    }
    return null;
  };
}

export function createStart() {
  return {};
}

export function createCsrfMiddleware() {
  return () => ({});
}

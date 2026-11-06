/**
 * Stage 5 — Connected Services card: Google OAuth status, connect/disconnect,
 * and what MindSpace can do once connected. Never touches or displays a
 * token — only the metadata `getGoogleStatus` returns.
 */
import { useServerFn } from "@tanstack/react-start";
import { CircleCheck, ShieldCheck, TriangleAlert, Unplug } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { disconnectGoogleAccount, getGoogleAuthUrl, getGoogleStatus } from "@/lib/google.functions";
import { GOOGLE_SERVICE_CAPABILITIES } from "@/lib/google/capabilities";
import type { GoogleConnectionStatus } from "@/lib/google/types";
import { cn } from "@/lib/utils";

type Notice = { kind: "connected" | "error"; detail?: string } | null;

function readGoogleNotice(): Notice {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const google = params.get("google");
  if (google !== "connected" && google !== "error") return null;
  const detail = params.get("detail");
  return detail ? { kind: google, detail } : { kind: google };
}

function clearGoogleNotice() {
  const url = new URL(window.location.href);
  url.searchParams.delete("google");
  url.searchParams.delete("detail");
  window.history.replaceState({}, "", url.toString());
}

export function ConnectedServices({ signedIn }: { signedIn: boolean }) {
  const fetchStatus = useServerFn(getGoogleStatus);
  const fetchAuthUrl = useServerFn(getGoogleAuthUrl);
  const disconnect = useServerFn(disconnectGoogleAccount);

  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    setNotice(readGoogleNotice());
    clearGoogleNotice();
    void fetchStatus({})
      .then(setStatus)
      .catch(() => setStatus({ connected: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  if (!signedIn) return null;

  async function connect() {
    setLoading(true);
    setError(null);
    try {
      const { url } = await fetchAuthUrl({});
      window.location.href = url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start Google Sign-In.");
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setLoading(true);
    setError(null);
    try {
      await disconnect({});
      setStatus({ connected: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect Google.");
    } finally {
      setLoading(false);
    }
  }

  const connected = status?.connected === true;

  return (
    <div className="mt-6 rounded-lg bg-card p-5 ring-1 ring-border">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-primary" />
        <p className="text-sm font-medium">Connected services</p>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Google Sign-In lets the Gmail, Calendar and Drive agents read your account and prepare
        drafts, events and files. Nothing writes to your real account without your explicit approval
        first.
      </p>

      {notice?.kind === "connected" && (
        <p className="mt-3 flex items-center gap-1.5 rounded-md bg-positive/10 px-3 py-2 text-xs text-positive">
          <CircleCheck className="size-3.5 shrink-0" /> Google connected.
        </p>
      )}
      {notice?.kind === "error" && (
        <p className="mt-3 flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="size-3.5 shrink-0" /> Couldn't connect Google
          {notice.detail ? `: ${notice.detail}` : "."}
        </p>
      )}
      {error && (
        <p className="mt-3 flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="size-3.5 shrink-0" /> {error}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-4 rounded-md bg-background p-3.5 ring-1 ring-border">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {connected ? (status.googleEmail ?? "Google account") : "Not connected"}
          </p>
          {connected && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Gmail · Calendar · Drive{status.expiresSoon ? " · refreshing access shortly" : ""}
            </p>
          )}
        </div>
        {connected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleDisconnect()}
            disabled={loading}
          >
            <Unplug /> Disconnect
          </Button>
        ) : (
          <Button size="sm" onClick={() => void connect()} disabled={loading}>
            Connect Google
          </Button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-5 gap-1.5 text-center text-[10.5px] text-muted-foreground">
        {GOOGLE_SERVICE_CAPABILITIES.map((service) => (
          <div key={service.id} className="rounded-md bg-background p-2 ring-1 ring-border">
            <p className="truncate font-medium text-foreground/70">{service.label}</p>
            <p className={cn("mt-1", connected ? "text-positive" : "text-muted-foreground")}>
              {connected ? "ready" : "not connected"}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {service.writes ? (service.reads ? "read/write" : "write") : "read-only"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

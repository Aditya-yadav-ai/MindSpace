import * as React from "react";
import {
  Calendar,
  CheckCircle2,
  CheckSquare,
  Compass,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  GraduationCap,
  KeyRound,
  Layers,
  Link2,
  Mail,
  MapPin,
  MessageSquare,
  Presentation,
  Radio,
  RefreshCw,
  Shield,
  ShieldCheck,
  Unplug,
  Users,
  Video,
  Youtube,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button3D } from "@/components/ui/button-3d";
import { Card3D } from "@/components/ui/card-3d";
import { Button } from "@/components/ui/button";
import { ConnectedServices } from "@/components/mindspace/connected-services";
import { GOOGLE_SERVICE_CAPABILITIES } from "@/lib/google/capabilities";
import { getGoogleAuthUrl, getGoogleStatus } from "@/lib/google.functions";
import type { GoogleConnectionStatus, ServiceCategory } from "@/lib/google/types";

export function ConnectedAccountsView({
  signedIn,
  userEmail,
}: {
  signedIn: boolean;
  userEmail?: string | undefined;
}) {
  const fetchStatus = useServerFn(getGoogleStatus);
  const fetchAuthUrl = useServerFn(getGoogleAuthUrl);

  const [connectionStatus, setConnectionStatus] = React.useState<GoogleConnectionStatus | null>(
    null,
  );
  const [activeCategory, setActiveCategory] = React.useState<ServiceCategory | "all">("all");
  const [loadingService, setLoadingService] = React.useState<string | null>(null);
  const [serviceError, setServiceError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!signedIn) return;
    let active = true;
    const refresh = () => {
      void fetchStatus({})
        .then((status) => {
          if (active) setConnectionStatus(status);
        })
        .catch(() => {
          if (active) setConnectionStatus({ connected: false });
        });
    };
    refresh();

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [signedIn, fetchStatus]);

  const isConnected = connectionStatus?.connected === true;

  const handleConnectService = async (serviceId: string, scopes: readonly string[]) => {
    setLoadingService(serviceId);
    setServiceError(null);
    try {
      const fullScopes = scopes.map((s) =>
        s.startsWith("https://") ? s : `https://www.googleapis.com/auth/${s}`,
      );
      const { url } = await fetchAuthUrl({ data: { scopes: fullScopes } });
      if (typeof chrome !== "undefined" && chrome.tabs && typeof chrome.tabs.create === "function") {
        chrome.tabs.create({ url });
      } else {
        window.open(url, "_blank");
      }
    } catch (err) {
      setServiceError(
        err instanceof Error ? err.message : `Failed to initiate authorization for ${serviceId}`,
      );
    } finally {
      setLoadingService(null);
    }
  };

  const getServiceIcon = (id: string) => {
    switch (id) {
      case "gmail":
        return <Mail className="size-4 text-red-500" />;
      case "calendar":
        return <Calendar className="size-4 text-blue-500" />;
      case "drive":
        return <FolderOpen className="size-4 text-amber-500" />;
      case "docs":
        return <FileText className="size-4 text-blue-600" />;
      case "sheets":
        return <FileSpreadsheet className="size-4 text-emerald-600" />;
      case "slides":
        return <Presentation className="size-4 text-amber-600" />;
      case "forms":
        return <FileText className="size-4 text-purple-600" />;
      case "meet":
        return <Video className="size-4 text-emerald-500" />;
      case "classroom":
        return <GraduationCap className="size-4 text-emerald-700" />;
      case "chat":
        return <MessageSquare className="size-4 text-teal-600" />;
      case "tasks":
        return <CheckSquare className="size-4 text-blue-500" />;
      case "contacts":
        return <Users className="size-4 text-cyan-600" />;
      case "maps":
        return <MapPin className="size-4 text-rose-500" />;
      case "youtube":
        return <Youtube className="size-4 text-red-600" />;
      default:
        return <Link2 className="size-4 text-primary" />;
    }
  };

  const categories: { id: ServiceCategory | "all"; label: string; count: number }[] = [
    { id: "all", label: "All Services", count: GOOGLE_SERVICE_CAPABILITIES.length },
    {
      id: "communication",
      label: "Communication",
      count: GOOGLE_SERVICE_CAPABILITIES.filter((s) => s.category === "communication").length,
    },
    {
      id: "productivity",
      label: "Productivity",
      count: GOOGLE_SERVICE_CAPABILITIES.filter((s) => s.category === "productivity").length,
    },
    {
      id: "education",
      label: "Education",
      count: GOOGLE_SERVICE_CAPABILITIES.filter((s) => s.category === "education").length,
    },
    {
      id: "location",
      label: "Location",
      count: GOOGLE_SERVICE_CAPABILITIES.filter((s) => s.category === "location").length,
    },
  ];

  const filteredServices =
    activeCategory === "all"
      ? GOOGLE_SERVICE_CAPABILITIES
      : GOOGLE_SERVICE_CAPABILITIES.filter((s) => s.category === activeCategory);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-600 dark:text-blue-400">
            <Link2 className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Google Workspace & Services
            </h1>
            <p className="text-xs text-muted-foreground">
              Unified 14-service registry with least-privilege scopes and encrypted credentials
              isolation
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            14 Official Adapters Active
          </span>
        </div>
      </div>

      {/* Main Connection Controls Card */}
      <Card3D className="p-6">
        <ConnectedServices signedIn={signedIn} userEmail={userEmail} />
      </Card3D>

      {serviceError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive flex items-center justify-between">
          <span>{serviceError}</span>
          <button
            type="button"
            onClick={() => setServiceError(null)}
            className="text-xs underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Category Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCategory(cat.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              activeCategory === cat.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {cat.label} ({cat.count})
          </button>
        ))}
      </div>

      {/* 14 Services Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredServices.map((service) => {
          const authorizedServices = connectionStatus?.connected
            ? connectionStatus.authorizedServices || []
            : [];
          const serviceActive =
            service.requiresApiKey || authorizedServices.includes(service.id);
          const isWriting = service.writes;
          const isLoading = loadingService === service.id;

          return (
            <Card3D
              key={service.id}
              className="flex flex-col justify-between p-4 space-y-4 border-border/70 hover:border-primary/40 transition-colors"
            >
              <div className="space-y-3">
                {/* Service Header & Status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg bg-muted/70 p-2 shrink-0">
                      {getServiceIcon(service.id)}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground">{service.label}</h3>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {service.category}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        serviceActive
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {service.requiresApiKey
                        ? "API Key Managed"
                        : serviceActive
                          ? "Authorized"
                          : "Needs Authorization"}
                    </span>
                    <span
                      className={`text-[9px] font-medium uppercase ${
                        isWriting ? "text-amber-500" : "text-blue-500"
                      }`}
                    >
                      {isWriting ? (service.reads ? "Read + Write" : "Write-only") : "Read-only"}
                    </span>
                  </div>
                </div>

                {/* Available Operations */}
                <div className="space-y-1.5">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Available Operations:
                  </span>
                  <ul className="space-y-1 text-[11px] text-foreground/80">
                    {service.operations.map((op) => (
                      <li key={op} className="flex items-center gap-1.5">
                        <CheckCircle2 className="size-3 text-primary/70 shrink-0" />
                        <span className="truncate">{op}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Scopes & Permissions */}
                <div className="space-y-1 pt-1 border-t border-border/30">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    {service.requiresApiKey ? "Auth Mechanism:" : "Required Scopes:"}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {service.requiresApiKey ? (
                      <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                        Backend API Key (Protected)
                      </span>
                    ) : (
                      service.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground"
                        >
                          {scope}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Actions & Security Metadata */}
              <div className="space-y-2 pt-2 border-t border-border/40">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="size-3 text-emerald-500" />
                    <span>{isWriting ? "Confirmation Gated" : "Auto-Executable"}</span>
                  </span>
                  <span className="text-[10px] font-mono">
                    {serviceActive ? "Sync: Ready" : "Simulated/Offline"}
                  </span>
                </div>

                {!service.requiresApiKey && !serviceActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs h-7"
                    disabled={isLoading}
                    onClick={() => void handleConnectService(service.id, service.scopes)}
                  >
                    {isLoading ? "Starting..." : `Authorize ${service.label}`}
                  </Button>
                )}
              </div>
            </Card3D>
          );
        })}
      </div>

      {/* Security Architecture Notice */}
      <Card3D className="border-border/60 bg-muted/20 p-5">
        <div className="flex items-start gap-3">
          <KeyRound className="size-5 text-primary shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <h4 className="font-semibold text-foreground">
              AES-256-GCM Token Encryption & Least-Privilege Scoping
            </h4>
            <p className="text-muted-foreground leading-relaxed">
              MindSpace secures all 14 Google services using isolated OAuth 2.0 PKCE handshakes and
              encrypts refresh and access tokens server-side with AES-256-GCM. Consequential write
              operations (drafting emails, creating files, scheduling meetings, updating tasks) are
              guaranteed to halt for human-in-the-loop approval before executing on real Google
              APIs.
            </p>
          </div>
        </div>
      </Card3D>
    </div>
  );
}

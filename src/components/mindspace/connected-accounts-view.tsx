import * as React from "react";
import {
  Calendar,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  GraduationCap,
  KeyRound,
  Link2,
  Mail,
  MessageSquare,
  Presentation,
  Shield,
  ShieldCheck,
  Video,
} from "lucide-react";
import { Button3D } from "@/components/ui/button-3d";
import { Card3D, Card3DContent, Card3DHeader, Card3DTitle } from "@/components/ui/card-3d";
import { ConnectedServices } from "@/components/mindspace/connected-services";
import { GOOGLE_SERVICE_CAPABILITIES } from "@/lib/google/capabilities";

export function ConnectedAccountsView({ signedIn }: { signedIn: boolean }) {
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
      default:
        return <Link2 className="size-4 text-primary" />;
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-600 dark:text-blue-400">
          <Link2 className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Connected Accounts & Services
          </h1>
          <p className="text-xs text-muted-foreground">
            Modular Google Workspace service registry and credentials isolation
          </p>
        </div>
      </div>

      {/* Main Connection Controls Card */}
      <Card3D className="p-6">
        <ConnectedServices signedIn={signedIn} />
      </Card3D>

      {/* Modular Registry Breakdown */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Supported Google Workspace Services (10)
          </h2>
          <span className="text-xs text-muted-foreground">All adapters active</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GOOGLE_SERVICE_CAPABILITIES.map((service) => (
            <Card3D key={service.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-muted/60 p-2">{getServiceIcon(service.id)}</div>
                  <h3 className="text-sm font-bold text-foreground">{service.label}</h3>
                </div>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    service.writes
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                  }`}
                >
                  {service.writes ? "Read + Write" : "Read-only"}
                </span>
              </div>

              {/* Scopes */}
              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  Required Scopes:
                </span>
                <div className="flex flex-wrap gap-1">
                  {service.scopes.map((scope) => (
                    <span
                      key={scope}
                      className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {scope}
                    </span>
                  ))}
                </div>
              </div>

              {/* Security Boundary */}
              <div className="border-t border-border/40 pt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="size-3 text-emerald-500" />
                  <span>Approval gated</span>
                </span>
                <span className="font-mono text-[10px]">Adapter Contract: Registered</span>
              </div>
            </Card3D>
          ))}
        </div>
      </div>

      {/* Security Architecture Notice */}
      <Card3D className="border-border/60 bg-muted/20 p-5">
        <div className="flex items-start gap-3">
          <KeyRound className="size-5 text-primary shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <h4 className="font-semibold text-foreground">
              Token Encryption & Zero Server Secret Exposure
            </h4>
            <p className="text-muted-foreground leading-relaxed">
              Google OAuth access tokens are encrypted with AES-256-GCM using a server-side
              encryption key. Tokens are refreshed lazily only near expiration and are never sent to
              the browser or logged in telemetries.
            </p>
          </div>
        </div>
      </Card3D>
    </div>
  );
}

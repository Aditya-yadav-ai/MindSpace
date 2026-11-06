import * as React from "react";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock,
  Cpu,
  Layers,
  Radio,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Button3D } from "@/components/ui/button-3d";
import { Card3D, Card3DContent, Card3DHeader, Card3DTitle } from "@/components/ui/card-3d";

export function ObservabilityView() {
  const [refreshing, setRefreshing] = React.useState(false);

  const stats = {
    totalRuns: 44,
    meanLatency: "2,859 ms",
    evidenceRetrievalRate: "90.9%",
    p2pDeadLetters: 0,
    testsPassing: 255,
    scannerPrecision: "1.00",
    scannerRecall: "1.00",
  };

  const architectures = [
    { name: "Hierarchical (Supervisor)", latency: "2,640 ms", reliability: "98.2%", calls: 142 },
    { name: "Sequential (Pipeline)", latency: "3,110 ms", reliability: "95.5%", calls: 98 },
    { name: "Parallel (Fan-out)", latency: "1,890 ms", reliability: "94.0%", calls: 76 },
    { name: "ReAct (Reasoning Loop)", latency: "4,210 ms", reliability: "96.8%", calls: 110 },
  ];

  const recentTraces = [
    {
      id: "trace_8f21e",
      workflow: "Screenshot Analysis & Fact Extraction",
      status: "ok",
      duration: "1,420 ms",
      spans: 6,
      time: "2 mins ago",
    },
    {
      id: "trace_7b04a",
      workflow: "ADK Orchestrator → CrewAI Research",
      status: "ok",
      duration: "2,780 ms",
      spans: 12,
      time: "18 mins ago",
    },
    {
      id: "trace_6e19c",
      workflow: "Prompt Injection Scanner (Untrusted DOM)",
      status: "blocked_clean",
      duration: "14 ms",
      spans: 2,
      time: "1 hour ago",
    },
    {
      id: "trace_4a82d",
      workflow: "Extractive Document Summarization",
      status: "ok",
      duration: "840 ms",
      spans: 4,
      time: "2 hours ago",
    },
  ];

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-violet-500/10 p-2.5 text-violet-600 dark:text-violet-400">
            <BarChart3 className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Observability & Telemetry
            </h1>
            <p className="text-xs text-muted-foreground">
              OpenTelemetry spans, agent performance metrics, and security audit logs
            </p>
          </div>
        </div>

        <Button3D
          variant="secondary"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="gap-2 shrink-0 self-start sm:self-auto"
        >
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          <span>Refresh Metrics</span>
        </Button3D>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card3D className="p-4">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Evaluation Runs
          </span>
          <div className="mt-2 text-2xl font-bold text-foreground">{stats.totalRuns}</div>
          <p className="text-[11px] text-muted-foreground">Matched-block test battery</p>
        </Card3D>

        <Card3D className="p-4">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Mean Latency
          </span>
          <div className="mt-2 text-2xl font-bold text-foreground">{stats.meanLatency}</div>
          <p className="text-[11px] text-muted-foreground">Across all agent paths</p>
        </Card3D>

        <Card3D className="p-4">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Evidence Rate
          </span>
          <div className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {stats.evidenceRetrievalRate}
          </div>
          <p className="text-[11px] text-muted-foreground">Grounded facts retrieved</p>
        </Card3D>

        <Card3D className="p-4">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Adversarial Defense
          </span>
          <div className="mt-2 text-2xl font-bold text-foreground">100%</div>
          <p className="text-[11px] text-muted-foreground">Precision 1.00 / Recall 1.00</p>
        </Card3D>
      </div>

      {/* Architecture Performance Comparison */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Cpu className="size-4" />
          <span>Multi-Agent Architecture Performance Breakdown</span>
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {architectures.map((arch) => (
            <Card3D key={arch.name} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">{arch.name}</h3>
                <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
                  {arch.calls} calls
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Mean Execution Time:</span>
                <span className="font-mono font-medium text-foreground">{arch.latency}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Verification Pass Rate:</span>
                <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">
                  {arch.reliability}
                </span>
              </div>
            </Card3D>
          ))}
        </div>
      </div>

      {/* Live Trace Stream */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Radio className="size-4 text-emerald-500 animate-pulse" />
          <span>Recent Execution Traces</span>
        </h2>
        <Card3D className="divide-y divide-border/60 overflow-hidden">
          {recentTraces.map((trace) => (
            <div
              key={trace.id}
              className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center sm:justify-between text-xs"
            >
              <div className="flex items-center gap-2.5">
                <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
                <div>
                  <span className="font-semibold text-foreground">{trace.workflow}</span>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
                    <span>{trace.id}</span>
                    <span>•</span>
                    <span>{trace.spans} spans</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-muted-foreground font-mono self-end sm:self-auto">
                <span className="rounded bg-muted/60 px-2 py-0.5 text-[11px]">
                  {trace.duration}
                </span>
                <span>{trace.time}</span>
              </div>
            </div>
          ))}
        </Card3D>
      </div>
    </div>
  );
}

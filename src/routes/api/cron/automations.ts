/**
 * Stage 8 — the recurring-automations cron target. Lovable Cloud's
 * scheduler calls this on a fixed interval (e.g. every few minutes) with a
 * bearer token checked by `authenticateCronRequest`; this handler finds
 * every automation whose `next_run_at` has passed and runs each one
 * through the real agent framework via `runAutomation`, which also
 * advances `next_run_at` so the same automation isn't run twice.
 *
 * Unattended runs only ever pre-approve the tools the owning user chose at
 * creation time (`automations.approved_tools`) — see the migration's
 * comment and `automations.functions.ts`'s `APPROVABLE_AUTOMATION_TOOLS`.
 */
import { createFileRoute } from "@tanstack/react-router";

const MAX_AUTOMATIONS_PER_TICK = 25;

export const Route = createFileRoute("/api/cron/automations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authenticateCronRequest } = await import("@/integrations/supabase/cron-auth");
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAutomation, toAutomationRow } = await import("@/lib/automations-runner.server");

        const { data: due, error } = await supabaseAdmin
          .from("automations")
          .select(
            "id,user_id,name,goal,schedule_kind,schedule_hour,schedule_day_of_week,approved_tools,enabled",
          )
          .eq("enabled", true)
          .lte("next_run_at", new Date().toISOString())
          .limit(MAX_AUTOMATIONS_PER_TICK);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const results = await Promise.allSettled(
          (due ?? []).map((automation) => runAutomation(toAutomationRow(automation))),
        );
        const ran = results.filter((r) => r.status === "fulfilled").length;
        const failed = results.length - ran;

        return new Response(JSON.stringify({ checked: due?.length ?? 0, ran, failed }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

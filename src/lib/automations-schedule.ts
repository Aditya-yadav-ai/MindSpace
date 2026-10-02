/** Stage 8 — pure scheduling helper for recurring automations. No server imports, so it's easy to unit-test and safe to import anywhere. */

export type ScheduleKind = "hourly" | "daily" | "weekly";

export type Schedule = {
  kind: ScheduleKind;
  /** Hour of day (0-23) the run should land near, in UTC. Ignored for "hourly". */
  hour: number;
  /** 0 (Sunday) - 6 (Saturday), in UTC. Only used for "weekly". */
  dayOfWeek: number | null;
};

/** Next run time strictly after `from`, per `schedule`. Always returns a future instant. */
export function computeNextRun(schedule: Schedule, from: Date = new Date()): Date {
  const next = new Date(from);
  if (schedule.kind === "hourly") {
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }

  next.setUTCHours(schedule.hour, 0, 0, 0);
  if (schedule.kind === "daily") {
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  // weekly
  const target = schedule.dayOfWeek ?? 1;
  let delta = (target - next.getUTCDay() + 7) % 7;
  if (delta === 0 && next <= from) delta = 7;
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

export function describeSchedule(schedule: Schedule): string {
  const hh = String(schedule.hour).padStart(2, "0");
  if (schedule.kind === "hourly") return "Every hour";
  if (schedule.kind === "daily") return `Daily at ${hh}:00 UTC`;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return `Weekly on ${days[schedule.dayOfWeek ?? 1]} at ${hh}:00 UTC`;
}

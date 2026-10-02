-- Stage 8 — conversation history, agent/action history, user-controlled
-- memory, and recurring automations. Same RLS-owned pattern as every
-- earlier table: each row belongs to exactly one `user_id`, and only that
-- user (or the service role, for the cron worker) can read or write it.

-- ---------------------------------------------------------------------
-- Agent/action history — one row per completed `runWorkflow` call.
-- ---------------------------------------------------------------------
-- id is the agent framework's own run id (e.g. "run_abc123"), not a DB-generated
-- UUID, so a run can be looked up by the same id the UI/trace already uses.
CREATE TABLE public.agent_runs (
  id TEXT NOT NULL PRIMARY KEY,
  user_id UUID NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  verification_verdict TEXT,
  verification_score REAL,
  step_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification JSONB NOT NULL DEFAULT '{}'::jsonb,
  automation_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.agent_runs TO authenticated;
GRANT ALL ON public.agent_runs TO service_role;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own agent runs" ON public.agent_runs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert their own agent runs" ON public.agent_runs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete their own agent runs" ON public.agent_runs
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX agent_runs_user_id_created_at_idx ON public.agent_runs (user_id, created_at DESC);
CREATE INDEX agent_runs_goal_trgm_idx ON public.agent_runs USING gin (to_tsvector('english', goal));

-- ---------------------------------------------------------------------
-- Conversation history — durable log of chat turns (the live chat panel
-- itself still keeps its fast in-browser copy; this is what the History
-- view reads, and what lets a user search/export/delete past turns).
-- ---------------------------------------------------------------------
CREATE TABLE public.chat_turns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  page_title TEXT,
  page_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.chat_turns TO authenticated;
GRANT ALL ON public.chat_turns TO service_role;
ALTER TABLE public.chat_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own chat turns" ON public.chat_turns
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX chat_turns_user_id_created_at_idx ON public.chat_turns (user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- User-controlled memory — short notes the user explicitly saves (or asks
-- an agent to save) for later turns to draw on. Entirely user-managed:
-- nothing here is written without the user's own action.
-- ---------------------------------------------------------------------
CREATE TABLE public.user_memories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'agent')),
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_memories TO authenticated;
GRANT ALL ON public.user_memories TO service_role;
ALTER TABLE public.user_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own memories" ON public.user_memories
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX user_memories_user_id_idx ON public.user_memories (user_id, pinned DESC, updated_at DESC);

CREATE TRIGGER update_user_memories_updated_at
  BEFORE UPDATE ON public.user_memories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Recurring automations — a saved goal run on a schedule by the cron
-- worker (see src/routes/api/cron/automations.ts). Unattended runs may
-- only use tools the user pre-approved at creation time: `approved_tools`
-- is the explicit, advance consent the master prompt requires before any
-- consequential write happens without a human present at run time.
-- ---------------------------------------------------------------------
CREATE TABLE public.automations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  schedule_kind TEXT NOT NULL DEFAULT 'daily' CHECK (schedule_kind IN ('hourly', 'daily', 'weekly')),
  schedule_hour INTEGER NOT NULL DEFAULT 9 CHECK (schedule_hour BETWEEN 0 AND 23),
  schedule_day_of_week INTEGER CHECK (schedule_day_of_week BETWEEN 0 AND 6),
  approved_tools TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMP WITH TIME ZONE,
  next_run_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automations TO authenticated;
GRANT ALL ON public.automations TO service_role;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own automations" ON public.automations
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- The cron worker (service role) needs to find every user's due automations
-- in one query; authenticated users can only ever see their own (above).
CREATE INDEX automations_due_idx ON public.automations (enabled, next_run_at);

CREATE TRIGGER update_automations_updated_at
  BEFORE UPDATE ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.automation_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  automation_id UUID NOT NULL REFERENCES public.automations (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  agent_run_id TEXT REFERENCES public.agent_runs (id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  ran_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.automation_runs TO authenticated;
GRANT ALL ON public.automation_runs TO service_role;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own automation runs" ON public.automation_runs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX automation_runs_automation_id_idx ON public.automation_runs (automation_id, ran_at DESC);

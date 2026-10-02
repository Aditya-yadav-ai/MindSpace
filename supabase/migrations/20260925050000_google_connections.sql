-- Stage 5 — Google OAuth token storage.
-- These tables hold OAuth artifacts (encrypted tokens, PKCE verifiers), never
-- passwords. They are readable/writable ONLY by the service role: no policy
-- is created for `authenticated`, and RLS is enabled on top of that as a
-- second layer, so a client using the publishable key can never read or
-- write another user's (or their own) stored tokens directly. All access
-- goes through server functions using the service-role client.

CREATE TABLE public.google_connections (
  user_id UUID NOT NULL PRIMARY KEY,
  google_email TEXT,
  scope TEXT NOT NULL DEFAULT '',
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT ALL ON public.google_connections TO service_role;
ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;
-- No policies: authenticated/anon have zero access even though RLS alone
-- would already default-deny them; the missing GRANT is a second lock.

CREATE TABLE public.google_oauth_states (
  state TEXT NOT NULL PRIMARY KEY,
  user_id UUID NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

GRANT ALL ON public.google_oauth_states TO service_role;
ALTER TABLE public.google_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE INDEX google_oauth_states_expires_at_idx ON public.google_oauth_states (expires_at);

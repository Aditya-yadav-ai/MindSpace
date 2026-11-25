import test from "node:test";
import assert from "node:assert/strict";

import {
  BASE_IDENTITY_SCOPES,
  SERVICE_SCOPES,
  DEFAULT_WORKSPACE_SCOPES,
  normalizeScope,
  sanitizeScopesForGoogle,
  isServiceAuthorized,
  getAuthorizedServices,
  getPendingServices,
} from "../src/lib/google/scopes.ts";
import { createAuthorizationUrl } from "../src/lib/google/oauth.server.ts";

test("[CONTRACT] OAuth Scope Registry — Default Workspace Scopes", () => {
  // Default workspace scopes must not contain conflicting YouTube or Classroom scopes
  const hasYoutube = DEFAULT_WORKSPACE_SCOPES.some((s) => s.includes("youtube"));
  const hasClassroom = DEFAULT_WORKSPACE_SCOPES.some((s) => s.includes("classroom"));
  assert.equal(hasYoutube, false, "Default workspace scopes must not include YouTube (causes Error 400 with Drive)");
  assert.equal(hasClassroom, false, "Default workspace scopes must not include Classroom");

  // Must include base identity scopes
  assert.ok(DEFAULT_WORKSPACE_SCOPES.includes("openid"));
  assert.ok(DEFAULT_WORKSPACE_SCOPES.includes("https://www.googleapis.com/auth/userinfo.email"));
  assert.ok(DEFAULT_WORKSPACE_SCOPES.includes("https://www.googleapis.com/auth/userinfo.profile"));

  // Must include Gmail scopes
  assert.ok(DEFAULT_WORKSPACE_SCOPES.includes("https://www.googleapis.com/auth/gmail.readonly"));
  assert.ok(DEFAULT_WORKSPACE_SCOPES.includes("https://www.googleapis.com/auth/gmail.compose"));

  // Must include Drive file scope
  assert.ok(DEFAULT_WORKSPACE_SCOPES.includes("https://www.googleapis.com/auth/drive.file"));
});

test("[CONTRACT] OAuth Scope Registry — Scope Normalization", () => {
  assert.equal(normalizeScope("openid"), "openid");
  assert.equal(normalizeScope("email"), "https://www.googleapis.com/auth/userinfo.email");
  assert.equal(normalizeScope("gmail.readonly"), "https://www.googleapis.com/auth/gmail.readonly");
  assert.equal(normalizeScope("gmail.compose"), "https://www.googleapis.com/auth/gmail.compose");
  assert.equal(normalizeScope("https://www.googleapis.com/auth/calendar.events"), "https://www.googleapis.com/auth/calendar.events");
});

test("[CONTRACT] OAuth Scope Registry — Incompatible Scope Sanitization", () => {
  // 1. YouTube redundancy: youtube + youtube.readonly -> keeps only youtube.readonly
  const youtubeBoth = sanitizeScopesForGoogle([
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/youtube.readonly",
  ]);
  assert.ok(youtubeBoth.includes("https://www.googleapis.com/auth/youtube.readonly"));
  assert.ok(!youtubeBoth.includes("https://www.googleapis.com/auth/youtube"), "Broad youtube must be removed when readonly is requested");

  // 2. Drive vs YouTube conflict (Google Error 400: drive.file + youtube cannot be requested together)
  const driveAndYoutube = sanitizeScopesForGoogle([
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/youtube.readonly",
  ]);
  const hasDrive = driveAndYoutube.some((s) => s.includes("drive"));
  const hasYt = driveAndYoutube.some((s) => s.includes("youtube"));
  assert.ok(!(hasDrive && hasYt), "drive.file and youtube must never be in the same authorization request");

  // 3. YouTube-targeted authorization drops Drive
  const youtubeTargeted = sanitizeScopesForGoogle([
    "https://www.googleapis.com/auth/youtube.readonly",
  ]);
  assert.ok(youtubeTargeted.some((s) => s.includes("youtube.readonly")));
  assert.ok(!youtubeTargeted.some((s) => s.includes("drive")));

  // 4. Contacts redundancy: contacts + contacts.readonly -> keeps contacts
  const contactsBoth = sanitizeScopesForGoogle([
    "https://www.googleapis.com/auth/contacts",
    "https://www.googleapis.com/auth/contacts.readonly",
  ]);
  assert.ok(contactsBoth.includes("https://www.googleapis.com/auth/contacts"));
  assert.ok(!contactsBoth.includes("https://www.googleapis.com/auth/contacts.readonly"));
});

test("[CONTRACT] OAuth Scope Registry — Service Authorization Checks", () => {
  // Gmail requires both readonly and compose
  assert.equal(
    isServiceAuthorized("gmail", ["https://www.googleapis.com/auth/gmail.readonly"]),
    false,
    "Gmail should not be authorized without compose scope",
  );
  assert.equal(
    isServiceAuthorized("gmail", [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ]),
    true,
    "Gmail should be authorized with both scopes",
  );

  // Maps always authorized (API key)
  assert.equal(isServiceAuthorized("maps", []), true);

  // Drive requires drive.file
  assert.equal(isServiceAuthorized("drive", ["https://www.googleapis.com/auth/drive.file"]), true);
  assert.equal(isServiceAuthorized("drive", []), false);
});

test("[CONTRACT] OAuth Scope Registry — Service Partitioning and Incremental Accumulation", () => {
  const initialScopes = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
  ];

  const authorized = getAuthorizedServices(initialScopes);
  const pending = getPendingServices(initialScopes);

  assert.ok(authorized.includes("gmail"));
  assert.ok(authorized.includes("maps")); // API key
  assert.ok(pending.includes("calendar"));
  assert.ok(pending.includes("drive"));
  assert.ok(pending.includes("youtube"));

  // Incremental authorization step: User later authorizes Calendar
  const newlyGranted = [
    "https://www.googleapis.com/auth/calendar.events",
  ];
  const accumulated = Array.from(new Set([...initialScopes, ...newlyGranted]));

  const updatedAuthorized = getAuthorizedServices(accumulated);
  assert.ok(updatedAuthorized.includes("gmail"));
  assert.ok(updatedAuthorized.includes("calendar"));
  assert.ok(getPendingServices(accumulated).includes("drive"));
});

test("[CONTRACT] OAuth Runtime URL — Default Connect Google Excludes YouTube and Classroom", async () => {
  const authUrlStr = await createAuthorizationUrl("test-user-url");
  const parsed = new URL(authUrlStr);

  assert.equal(parsed.origin, "https://accounts.google.com");
  assert.equal(parsed.pathname, "/o/oauth2/v2/auth");
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("access_type"), "offline");
  assert.equal(parsed.searchParams.get("prompt"), "consent");
  assert.equal(parsed.searchParams.get("include_granted_scopes"), "true");
  assert.ok(parsed.searchParams.get("code_challenge"), "PKCE code challenge must be present");
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");

  const scopeParam = parsed.searchParams.get("scope") || "";
  const requestedScopes = scopeParam.split(" ");

  assert.ok(requestedScopes.includes("openid"));
  assert.ok(requestedScopes.includes("https://www.googleapis.com/auth/gmail.readonly"));
  assert.ok(requestedScopes.includes("https://www.googleapis.com/auth/drive.file"));

  // CRITICAL: Must not contain YouTube or Classroom
  const hasYoutube = requestedScopes.some((s) => s.includes("youtube"));
  const hasClassroom = requestedScopes.some((s) => s.includes("classroom"));
  assert.equal(hasYoutube, false, "Initial authorization must NOT contain YouTube scopes");
  assert.equal(hasClassroom, false, "Initial authorization must NOT contain Classroom scopes");
});

test("[CONTRACT] OAuth Runtime URL — Separate YouTube Incremental Authorization", async () => {
  const authUrlStr = await createAuthorizationUrl("test-user-yt", ["youtube.readonly"]);
  const parsed = new URL(authUrlStr);
  const scopeParam = parsed.searchParams.get("scope") || "";
  const requestedScopes = scopeParam.split(" ");

  assert.ok(requestedScopes.includes("https://www.googleapis.com/auth/youtube.readonly"));
  assert.ok(requestedScopes.includes("openid"));
  // Must NOT include Drive scopes in a YouTube-targeted request (prevents Google Error 400)
  assert.ok(!requestedScopes.some((s) => s.includes("drive")), "YouTube authorization must not bundle drive.file");
});

test("[CONTRACT] OAuth Runtime URL — Separate Classroom Incremental Authorization", async () => {
  const authUrlStr = await createAuthorizationUrl("test-user-cr", [
    "classroom.courses.readonly",
    "classroom.coursework.me",
  ]);
  const parsed = new URL(authUrlStr);
  const scopeParam = parsed.searchParams.get("scope") || "";
  const requestedScopes = scopeParam.split(" ");

  assert.ok(requestedScopes.includes("https://www.googleapis.com/auth/classroom.courses.readonly"));
  assert.ok(requestedScopes.includes("https://www.googleapis.com/auth/classroom.coursework.me"));
  assert.ok(!requestedScopes.some((s) => s.includes("youtube")), "Classroom authorization must not bundle youtube");
});

test("[REAL GOOGLE API] Google OAuth Client Secret & Token Endpoint Contract", async () => {
  // Test real Google token endpoint behavior when client secret is invalid
  const clientId = process.env.GOOGLE_CLIENT_ID || "211966563837-eoqbe52o6qlevkn5qmqgd3lu17a3ftln.apps.googleusercontent.com";
  const invalidSecret = "invalid_secret_placeholder";

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "invalid_test_code",
      redirect_uri: "http://localhost:8080/api/google/oauth-callback",
      client_id: clientId,
      client_secret: invalidSecret,
    }),
  });

  // Google responds with HTTP 401 invalid_client when client_secret does not match client_id
  assert.equal(response.status, 401);
  const data = await response.json();
  assert.equal(data.error, "invalid_client");
  assert.ok(data.error_description.includes("client secret is invalid"));
});

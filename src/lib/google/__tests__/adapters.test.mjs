/**
 * Comprehensive verification of MindSpace Google Workspace service adapters and OAuth encryption.
 * Run directly with: npx jiti src/lib/google/__tests__/adapters.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import { GOOGLE_SERVICE_CAPABILITIES } from "../capabilities.ts";
import { notConnectedGoogleServices } from "../not-connected.ts";
import { GoogleNotConnectedError } from "../types.ts";
import { encryptToken, decryptToken, TokenEncryptionError } from "../crypto.server.ts";

test("Google Service Capabilities Contract", async (t) => {
  await t.test("all 10 official Google services are registered", () => {
    const expected = [
      "gmail",
      "calendar",
      "drive",
      "docs",
      "sheets",
      "slides",
      "forms",
      "meet",
      "classroom",
      "chat",
    ];
    const registeredIds = GOOGLE_SERVICE_CAPABILITIES.map((s) => s.id);
    for (const serviceId of expected) {
      assert.ok(
        registeredIds.includes(serviceId),
        `Expected service ${serviceId} to be registered in GOOGLE_SERVICE_CAPABILITIES`,
      );
    }
    assert.equal(GOOGLE_SERVICE_CAPABILITIES.length, 10);
  });

  await t.test("each service declares valid read/write flags and scopes", () => {
    for (const service of GOOGLE_SERVICE_CAPABILITIES) {
      assert.ok(typeof service.label === "string" && service.label.length > 0);
      assert.ok(typeof service.reads === "boolean");
      assert.ok(typeof service.writes === "boolean");
      assert.ok(Array.isArray(service.scopes) && service.scopes.length > 0);
    }
  });
});

test("Default NotConnected Adapter Safety Gate", async (t) => {
  await t.test("is marked as connected=false", () => {
    assert.equal(notConnectedGoogleServices.connected, false);
  });

  await t.test("all operations reject with GoogleNotConnectedError", async () => {
    const operations = [
      () => notConnectedGoogleServices.listRecentEmails({ query: "", limit: 5 }),
      () =>
        notConnectedGoogleServices.createEmailDraft({
          to: "test@example.com",
          subject: "hi",
          body: "test",
        }),
      () => notConnectedGoogleServices.listUpcomingEvents({ maxResults: 5 }),
      () =>
        notConnectedGoogleServices.createCalendarEvent({
          summary: "sync",
          startIso: "2026-11-20T10:00:00Z",
          endIso: "2026-11-20T11:00:00Z",
        }),
      () => notConnectedGoogleServices.searchDriveFiles({ query: "doc", limit: 5 }),
      () => notConnectedGoogleServices.saveDriveFile({ name: "notes.txt", content: "test" }),
      () => notConnectedGoogleServices.readDocument("doc-123"),
      () => notConnectedGoogleServices.createDocument({ title: "New Doc" }),
      () => notConnectedGoogleServices.readSheetRange("sheet-123", "A1:B10"),
      () => notConnectedGoogleServices.createSpreadsheet({ title: "Budget" }),
      () =>
        notConnectedGoogleServices.appendSheetValues({
          spreadsheetId: "s-1",
          range: "A1",
          values: [["val"]],
        }),
      () => notConnectedGoogleServices.readPresentation("slide-123"),
      () => notConnectedGoogleServices.createPresentation({ title: "Deck" }),
      () => notConnectedGoogleServices.createForm({ title: "Survey" }),
      () => notConnectedGoogleServices.listFormResponses("form-123", 5),
      () => notConnectedGoogleServices.createMeetingSpace(),
      () => notConnectedGoogleServices.listClassroomCourses(5),
      () => notConnectedGoogleServices.listClassroomCourseWork("c-123", 5),
      () => notConnectedGoogleServices.listChatSpaces(5),
      () => notConnectedGoogleServices.sendChatMessage({ spaceId: "spaces/123", text: "Hello" }),
    ];

    for (const fn of operations) {
      await assert.rejects(fn, (err) => {
        assert.ok(err instanceof GoogleNotConnectedError);
        assert.ok(err.message.includes("Google is not connected"));
        return true;
      });
    }
  });
});

test("AES-256-GCM Token Encryption Security", async (t) => {
  const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = TEST_KEY;

  await t.test("encrypts and decrypts OAuth tokens accurately", () => {
    const sensitiveToken = "ya29.a0AfH6SMB_secret_google_oauth_token_1234567890";
    const encrypted = encryptToken(sensitiveToken);
    assert.notEqual(encrypted, sensitiveToken);

    const decrypted = decryptToken(encrypted);
    assert.equal(decrypted, sensitiveToken);
  });

  await t.test("tampered ciphertext fails decryption auth tag check", () => {
    const sensitiveToken = "token_to_tamper";
    const encrypted = encryptToken(sensitiveToken);
    const tampered = encrypted.slice(0, -3) + (encrypted.slice(-3) === "xyz" ? "abc" : "xyz");
    assert.throws(() => decryptToken(tampered));
  });

  await t.test("missing encryption key fails fast without storing plaintext", () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    assert.throws(
      () => encryptToken("test"),
      (err) => {
        assert.ok(err instanceof TokenEncryptionError);
        return true;
      },
    );
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = TEST_KEY;
  });
});

test("Google Adapter REST API Endpoints Verification", async (t) => {
  const calls = [];
  const mockAccessToken = "mock-valid-bearer-token";

  // Mock global fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: "res_123",
          message: { id: "msg_123" },
          documentId: "doc_123",
          spreadsheetId: "sheet_123",
          presentationId: "pres_123",
          formId: "form_123",
          name: "spaces/demo_meet",
          title: "Mock Title",
          items: [],
          files: [],
          courses: [],
          courseWork: [],
          spaces: [],
        };
      },
      async text() {
        return "";
      },
    };
  };

  try {
    const calendar = await import("../calendar.server.ts");
    const gmail = await import("../gmail.server.ts");
    const drive = await import("../drive.server.ts");
    const docs = await import("../docs.server.ts");
    const sheets = await import("../sheets.server.ts");
    const slides = await import("../slides.server.ts");
    const forms = await import("../forms.server.ts");
    const meet = await import("../meet.server.ts");
    const classroom = await import("../classroom.server.ts");
    const chat = await import("../chat.server.ts");

    // 1. Calendar
    await calendar.createEvent(mockAccessToken, {
      summary: "Sync Meeting",
      startIso: "2026-11-10T10:00:00Z",
      endIso: "2026-11-10T11:00:00Z",
    });
    const calCall = calls.pop();
    assert.ok(calCall.url.includes("googleapis.com/calendar/v3/calendars/primary/events"));
    assert.equal(calCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);

    // 2. Gmail
    await gmail.createDraft(mockAccessToken, {
      to: "client@example.com",
      subject: "Update",
      body: "Status update body",
    });
    const gmailCall = calls.pop();
    assert.ok(gmailCall.url.includes("gmail.googleapis.com/gmail/v1/users/me/drafts"));
    assert.equal(gmailCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);

    // 3. Drive
    await drive.searchFiles(mockAccessToken, { query: "finance", limit: 3 });
    const driveCall = calls.pop();
    assert.ok(driveCall.url.includes("googleapis.com/drive/v3/files"));
    assert.equal(driveCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);

    // 4. Docs
    await docs.createDocument(mockAccessToken, {
      title: "Executive Brief",
      body: "Initial brief content",
    });
    const docsCall = calls.pop();
    assert.ok(docsCall.url.includes("docs.googleapis.com/v1/documents"));
    assert.equal(docsCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);

    // 5. Sheets
    await sheets.createSpreadsheet(mockAccessToken, { title: "Q4 Model" });
    const sheetsCall = calls.pop();
    assert.ok(sheetsCall.url.includes("sheets.googleapis.com/v4/spreadsheets"));
    assert.equal(sheetsCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);

    // 6. Slides
    await slides.createPresentation(mockAccessToken, { title: "Keynote" });
    const slidesCall = calls.pop();
    assert.ok(slidesCall.url.includes("slides.googleapis.com/v1/presentations"));
    assert.equal(slidesCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);

    // 7. Forms
    await forms.createForm(mockAccessToken, {
      title: "Product Survey",
      description: "Customer feedback",
    });
    const formsCall = calls.pop();
    assert.ok(formsCall.url.includes("forms.googleapis.com/v1/forms"));
    assert.equal(formsCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);

    // 8. Meet
    await meet.createMeetingSpace(mockAccessToken);
    const meetCall = calls.pop();
    assert.ok(meetCall.url.includes("meet.googleapis.com/v2/spaces"));
    assert.equal(meetCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);

    // 9. Classroom
    await classroom.listCourses(mockAccessToken, 5);
    const classCall = calls.pop();
    assert.ok(classCall.url.includes("classroom.googleapis.com/v1/courses"));
    assert.equal(classCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);

    // 10. Chat
    await chat.sendMessage(mockAccessToken, { space: "demo", text: "Alert" });
    const chatCall = calls.pop();
    assert.ok(chatCall.url.includes("chat.googleapis.com/v1/spaces/demo/messages"));
    assert.equal(chatCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

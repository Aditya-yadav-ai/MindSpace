/**
 * Comprehensive verification of MindSpace Google 14 Services integrations,
 * adapters, OAuth encryption, and agent planning.
 * Run directly with: npx jiti src/lib/google/__tests__/adapters.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import { GOOGLE_SERVICE_CAPABILITIES } from "../capabilities.ts";
import { notConnectedGoogleServices } from "../not-connected.ts";
import { GoogleNotConnectedError } from "../types.ts";
import { encryptToken, decryptToken, TokenEncryptionError } from "../crypto.server.ts";
import { planGoal } from "../../agents/planner.ts";
import { buildMindSpaceAgents } from "../../agents/manager.ts";

test("Google Service Capabilities Contract (14 Services)", async (t) => {
  await t.test("all 14 official Google services are registered", () => {
    const expected = [
      "gmail",
      "calendar",
      "drive",
      "docs",
      "sheets",
      "slides",
      "meet",
      "forms",
      "tasks",
      "contacts",
      "chat",
      "maps",
      "classroom",
      "youtube",
    ];
    const registeredIds = GOOGLE_SERVICE_CAPABILITIES.map((s) => s.id);
    for (const serviceId of expected) {
      assert.ok(
        registeredIds.includes(serviceId),
        `Expected service ${serviceId} to be registered in GOOGLE_SERVICE_CAPABILITIES`,
      );
    }
    assert.equal(GOOGLE_SERVICE_CAPABILITIES.length, 14);
  });

  await t.test(
    "each service declares valid category, read/write flags, scopes, and operations",
    () => {
      const validCategories = new Set(["communication", "productivity", "education", "location"]);
      for (const service of GOOGLE_SERVICE_CAPABILITIES) {
        assert.ok(typeof service.label === "string" && service.label.length > 0);
        assert.ok(validCategories.has(service.category), `Invalid category: ${service.category}`);
        assert.ok(typeof service.reads === "boolean");
        assert.ok(typeof service.writes === "boolean");
        assert.ok(Array.isArray(service.scopes));
        assert.ok(Array.isArray(service.operations) && service.operations.length > 0);
      }
    },
  );

  await t.test("explicitly excludes Google Keep and Google Photos", () => {
    const registeredIds = GOOGLE_SERVICE_CAPABILITIES.map((s) => s.id.toLowerCase());
    assert.equal(registeredIds.includes("keep"), false);
    assert.equal(registeredIds.includes("photos"), false);
    assert.equal(registeredIds.includes("google_keep"), false);
    assert.equal(registeredIds.includes("google_photos"), false);
  });
});

test("Default NotConnected Adapter Safety Gate (All 14 Services)", async (t) => {
  await t.test("is marked as connected=false", () => {
    assert.equal(notConnectedGoogleServices.connected, false);
  });

  await t.test("all operations reject with GoogleNotConnectedError", async () => {
    const operations = [
      // 1. Gmail
      () => notConnectedGoogleServices.listRecentEmails({ query: "", limit: 5 }),
      () =>
        notConnectedGoogleServices.createEmailDraft({
          to: "test@example.com",
          subject: "hi",
          body: "test",
        }),
      // 2. Calendar
      () => notConnectedGoogleServices.listUpcomingEvents({ maxResults: 5 }),
      () =>
        notConnectedGoogleServices.createCalendarEvent({
          summary: "sync",
          description: "notes",
          location: "office",
          start: "2026-11-20T10:00:00Z",
          end: "2026-11-20T11:00:00Z",
        }),
      // 3. Drive
      () => notConnectedGoogleServices.searchDriveFiles({ query: "doc", limit: 5 }),
      () =>
        notConnectedGoogleServices.saveDriveFile({
          name: "notes.txt",
          content: "test",
          mimeType: "text/plain",
        }),
      // 4. Docs
      () => notConnectedGoogleServices.readDocument("doc-123"),
      () => notConnectedGoogleServices.createDocument({ title: "New Doc", body: "Hello" }),
      // 5. Sheets
      () => notConnectedGoogleServices.readSheetRange("sheet-123", "A1:B10"),
      () => notConnectedGoogleServices.createSpreadsheet({ title: "Budget" }),
      () =>
        notConnectedGoogleServices.appendSheetValues({
          spreadsheetId: "s-1",
          range: "A1",
          values: [["val"]],
        }),
      // 6. Slides
      () => notConnectedGoogleServices.readPresentation("slide-123"),
      () => notConnectedGoogleServices.createPresentation({ title: "Deck" }),
      // 7. Meet
      () => notConnectedGoogleServices.createMeetingSpace(),
      () => notConnectedGoogleServices.getMeetingSpace("spaces/123"),
      () => notConnectedGoogleServices.listConferenceRecords(5),
      () => notConnectedGoogleServices.listConferenceParticipants("rec-123", 5),
      // 8. Forms
      () => notConnectedGoogleServices.createForm({ title: "Survey", description: "Feedback" }),
      () => notConnectedGoogleServices.getForm("form-123"),
      () => notConnectedGoogleServices.getFormQuestions("form-123"),
      () => notConnectedGoogleServices.listFormResponses("form-123", 5),
      // 9. Tasks
      () => notConnectedGoogleServices.listTasks("@default", true, 5),
      () =>
        notConnectedGoogleServices.createTask({ title: "Finish paper", taskListId: "@default" }),
      () => notConnectedGoogleServices.completeTask("@default", "task-1"),
      () => notConnectedGoogleServices.deleteTask("@default", "task-1"),
      // 10. Contacts
      () => notConnectedGoogleServices.listContacts(5),
      () => notConnectedGoogleServices.searchContacts("Smith", 5),
      () =>
        notConnectedGoogleServices.createContact({
          givenName: "Alice",
          email: "alice@example.com",
        }),
      () => notConnectedGoogleServices.deleteContact("people/c123"),
      // 11. Chat
      () => notConnectedGoogleServices.listChatSpaces(5),
      () => notConnectedGoogleServices.getChatSpace("spaces/abc"),
      () => notConnectedGoogleServices.sendChatMessage({ space: "spaces/abc", text: "Hello team" }),
      // 12. Maps
      () => notConnectedGoogleServices.searchPlaces("cafe"),
      () => notConnectedGoogleServices.getPlaceDetails("place-123"),
      () => notConnectedGoogleServices.getDirections("A", "B"),
      // 13. Classroom
      () => notConnectedGoogleServices.listClassroomCourses(5),
      () => notConnectedGoogleServices.listClassroomCourseWork("c-123", 5),
      () => notConnectedGoogleServices.listClassroomAnnouncements("c-123", 5),
      // 14. YouTube
      () => notConnectedGoogleServices.searchYouTubeVideos("ML lecture", 5),
      () => notConnectedGoogleServices.getYouTubeVideoDetails("vid-123"),
      () => notConnectedGoogleServices.listYouTubePlaylists("mine", 5),
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

test("Google Adapter REST API Endpoints Verification (All 14 Services)", async (t) => {
  const calls = [];
  const mockAccessToken = "mock-valid-bearer-token";
  process.env.GOOGLE_MAPS_API_KEY = "mock-maps-key-12345";

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
          place_id: "place_123",
          status: "OK",
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
          results: [],
          connections: [],
          routes: [],
          rows: [],
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
    const tasks = await import("../tasks.server.ts");
    const contacts = await import("../contacts.server.ts");
    const maps = await import("../maps.server.ts");
    const youtube = await import("../youtube.server.ts");

    // 1. Calendar
    await calendar.createEvent(mockAccessToken, {
      summary: "Sync Meeting",
      description: "Discuss roadmap",
      location: "Room A",
      start: "2026-11-10T10:00:00Z",
      end: "2026-11-10T11:00:00Z",
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

    // 9. Tasks (NEW)
    await tasks.createTask(mockAccessToken, { title: "Review milestone", taskListId: "@default" });
    const taskCall = calls.pop();
    assert.ok(taskCall.url.includes("tasks.googleapis.com/tasks/v1/lists/%40default/tasks"));
    assert.equal(taskCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);

    // 10. Contacts (NEW)
    await contacts.listContacts(mockAccessToken, 5);
    const contactCall = calls.pop();
    assert.ok(contactCall.url.includes("people.googleapis.com/v1/people/me/connections"));
    assert.equal(contactCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);

    // 11. Chat
    await chat.sendMessage(mockAccessToken, { space: "spaces/demo", text: "Alert" });
    const chatCall = calls.pop();
    assert.ok(chatCall.url.includes("chat.googleapis.com/v1/spaces/demo/messages"));
    assert.equal(chatCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);

    // 12. Maps (NEW)
    await maps.searchPlaces("Stanford University");
    const mapsCall = calls.pop();
    assert.ok(mapsCall.url.includes("maps.googleapis.com/maps/api/place/textsearch/json"));
    assert.ok(mapsCall.url.includes("key=mock-maps-key-12345"));

    // 13. Classroom
    await classroom.listCourses(mockAccessToken, 5);
    const classCall = calls.pop();
    assert.ok(classCall.url.includes("classroom.googleapis.com/v1/courses"));
    assert.equal(classCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);

    // 14. YouTube (NEW)
    await youtube.searchVideos(mockAccessToken, "TypeScript Tutorial", 5);
    const ytCall = calls.pop();
    assert.ok(ytCall.url.includes("googleapis.com/youtube/v3/search"));
    assert.equal(ytCall.init.headers.Authorization, `Bearer ${mockAccessToken}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Multi-Agent Planning Intent Dispatching (14 Services)", async (t) => {
  const { registry } = buildMindSpaceAgents();

  await t.test("plans Tasks agent when user requests task creation", () => {
    const plan = planGoal("Add a task to complete my assignment", registry, false);
    assert.ok(plan.steps.some((s) => s.agent === "tasks"));
  });

  await t.test("plans Contacts agent when user searches people", () => {
    const plan = planGoal("Find my professor's contact", registry, false);
    assert.ok(plan.steps.some((s) => s.agent === "contacts"));
  });

  await t.test("plans Maps agent when user asks for places or routes", () => {
    const plan = planGoal("Find nearby libraries with Google Maps", registry, false);
    assert.ok(plan.steps.some((s) => s.agent === "maps"));
  });

  await t.test("plans YouTube agent when user asks for tutorials", () => {
    const plan = planGoal("Search YouTube for machine learning lectures", registry, false);
    assert.ok(plan.steps.some((s) => s.agent === "youtube"));
  });

  await t.test("plans Meet agent when user asks for video call", () => {
    const plan = planGoal("Create a Google Meet for tomorrow", registry, false);
    assert.ok(plan.steps.some((s) => s.agent === "meet"));
  });

  await t.test("plans Classroom agent when user checks assignments", () => {
    const plan = planGoal("Show my Classroom courses and coursework", registry, false);
    assert.ok(plan.steps.some((s) => s.agent === "classroom"));
  });
});

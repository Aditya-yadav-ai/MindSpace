/**
 * Stage 8 — Gmail Agent Execution & Planning Test
 * Validates that user goal prompts accurately extract recipient, subject, and body,
 * and dispatch end-to-end draft creation without confirmation blocks.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

const { planGoal } = jiti("../src/lib/agents/planner.ts");
const { GmailAgent } = jiti("../src/lib/agents/google-agents.ts");
const { gmailCreateDraftTool, gmailSendEmailTool } = jiti("../src/lib/agents/google-tools.ts");
const { AgentRegistry, createMessage } = jiti("../src/lib/agents/agent.ts");
const { ToolRegistry } = jiti("../src/lib/agents/tools.ts");
const { RunTracer } = jiti("../src/lib/agents/tracer.ts");

test("Gmail Multi-Agent Planning & Execution Pipeline", async (t) => {
  await t.test("1. Planner extracts recipient, subject, and body from prompt", async () => {
    const goal = "Send an email to aditya.yadav1.23cse@bmu.edu.in explaining the MindSpace project";
    const registry = new AgentRegistry();
    registry.register(new GmailAgent());
    const plan = planGoal(goal, registry, false);

    assert.ok(plan.steps.length >= 1, "Plan should produce at least 1 step");
    const gmailStep = plan.steps.find((s) => s.agent === "gmail");
    assert.ok(gmailStep, "Gmail agent step must be planned");

    assert.equal(gmailStep.input.action, "draft");
    assert.equal(gmailStep.input.to, "aditya.yadav1.23cse@bmu.edu.in");
    assert.ok(gmailStep.input.subject.includes("MindSpace"));
    assert.ok(gmailStep.input.body.includes("MindSpace project"));
  });

  await t.test("2. Gmail create draft tool is NOT blocked by confirmation gate", () => {
    assert.equal(
      gmailCreateDraftTool.requiresConfirmation,
      false,
      "Draft creation is non-destructive and must not be confirmation gated",
    );
    assert.equal(
      gmailSendEmailTool.requiresConfirmation,
      true,
      "Sending email is destructive and must require explicit user confirmation",
    );
  });

  await t.test("3. GmailAgent executes draft creation and returns webUrl & draftId", async () => {
    const agent = new GmailAgent();
    let invokedTool = "";
    let toolPayload = null;

    const toolRegistry = new ToolRegistry();
    toolRegistry.register({
      name: "gmail.create_draft",
      description: "Create draft",
      inputSchema: gmailCreateDraftTool.inputSchema,
      mock: false,
      requiresConfirmation: false,
      execute: async (input) => {
        invokedTool = "gmail.create_draft";
        toolPayload = input;
        return {
          draftId: "r-mock-draft-12345",
          messageId: "msg-9999",
          webUrl: "https://mail.google.com/mail/u/0/#drafts?compose=r-mock-draft-12345",
        };
      },
    });

    const taskMsg = createMessage({
      runId: "run-test-1",
      from: "manager",
      to: "gmail",
      type: "task",
      stepId: "s1",
      payload: {
        stepId: "s1",
        goal: "Prepare an email draft to aditya.yadav1.23cse@bmu.edu.in explaining the MindSpace project",
        input: {
          action: "draft",
          to: "aditya.yadav1.23cse@bmu.edu.in",
          subject: "MindSpace Project",
          body: "Project overview body.",
        },
        dependsOn: [],
      },
    });

    const ctx = {
      runId: "run-test-1",
      goal: "Prepare draft",
      page: { title: "MindSpace", url: "https://mindspace.ai", selection: "", text: "" },
      tracer: new RunTracer("run-test-1"),
      tools: toolRegistry,
      approvals: new Set(),
      google: { connected: true },
      tasks: {},
    };

    const reply = await agent.handle(taskMsg, ctx);

    assert.equal(reply.type, "result");
    assert.equal(invokedTool, "gmail.create_draft");
    assert.equal(toolPayload.to, "aditya.yadav1.23cse@bmu.edu.in");
    assert.equal(toolPayload.subject, "MindSpace Project");
    assert.ok(reply.payload.output.draft, "Output must contain draft");
    assert.equal(reply.payload.output.draftId, "r-mock-draft-12345");
    assert.ok(reply.payload.output.webUrl.includes("mail.google.com"));
    assert.ok(reply.payload.summary.includes("Created a Gmail draft"));
  });
});

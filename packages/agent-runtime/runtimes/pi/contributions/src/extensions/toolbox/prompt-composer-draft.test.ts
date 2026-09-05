import assert from "node:assert/strict";
import test from "node:test";
import { insertPromptDraft } from "./prompt-composer-draft";

test("inserts a template as a draft, preserves text, and protects an unsent draft during navigation", () => {
  let text = "Existing draft";
  let sessionId = "draft-1";
  let isNewThread = true;
  let created = 0;
  let sent = 0;
  const runtime = {
    current: { getSnapshot: () => ({ sessionId, isNewThread }) },
    session: () => ({
      snapshot: { getSnapshot: () => ({ composer: { text, attachments: [], phase: "idle" } }) },
      actions: {
        setComposerText: (next: string) => {
          text = next;
        },
        send: () => {
          sent++;
        },
      },
    }),
    createDraft: ({ workspaceId }: { workspaceId: string }) => {
      assert.equal(workspaceId, "project");
      created++;
      sessionId = "draft-2";
      return sessionId;
    },
    switchToThread: (id: string) => {
      sessionId = id;
      isNewThread = false;
    },
  } as unknown as Parameters<typeof insertPromptDraft>[0];
  insertPromptDraft(runtime, "draft:draft-1", "Review file.ts");
  assert.equal(text, "Existing draft\n\nReview file.ts");
  assert.throws(
    () => insertPromptDraft(runtime, "new", "Next", "project"),
    /prompt-existing-draft/,
  );
  assert.throws(() => insertPromptDraft(runtime, "other", "Next"), /prompt-existing-draft/);
  assert.equal(created, 0);
  text = "";
  insertPromptDraft(runtime, "new", "Review", "project");
  assert.equal(created, 1);
  assert.equal(text, "Review");
  assert.equal(sent, 0);
});

test("starts a prompt draft without selecting a project or changing the previous conversation", () => {
  let sessionId = "conversation";
  const drafts = new Map([[sessionId, "Unsent conversation input"]]);
  const runtime = {
    current: { getSnapshot: () => ({ sessionId, isNewThread: sessionId === "new-draft" }) },
    session: (id: string) => ({
      snapshot: {
        getSnapshot: () => ({
          composer: { text: drafts.get(id)!, attachments: [], phase: "idle" },
        }),
      },
      actions: {
        setComposerText: (content: string) => drafts.set(id, content),
        send: () => assert.fail("Using a template must not send it"),
      },
    }),
    createDraft: (options: { workspaceId?: string }) => {
      assert.equal(options.workspaceId, undefined);
      sessionId = "new-draft";
      drafts.set(sessionId, "");
      return sessionId;
    },
    switchToThread: () => assert.fail("Using a template must open the new conversation page"),
  } as unknown as Parameters<typeof insertPromptDraft>[0];

  insertPromptDraft(runtime, "new", "Create a Pi hook");
  assert.equal(sessionId, "new-draft");
  assert.equal(drafts.get(sessionId), "Create a Pi hook");
  assert.equal(drafts.get("conversation"), "Unsent conversation input");
});

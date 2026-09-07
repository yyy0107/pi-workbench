import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getComposerTextAttachmentStore } from "../../src/attachments/composer-text-attachments";
import {
  createSession,
  regenerateSession,
  getSessionHistory,
  submitPrompt,
  updatePromptQueueItem,
} from "../../src/sessions/session-registry";
import { parseWorkbenchComposerUserDetails } from "@workbench/contracts/composer/request";
import { PI_COMPOSER_MODEL_INPUT_CUSTOM_TYPE } from "../../src/commands/pi-composer-prompt";

test("attachment-only submissions, queue edits and steering retain trusted references in durable history", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pasted-text-submission-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousStateDir = process.env.PI_WORKBENCH_STATE_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  process.env.PI_WORKBENCH_STATE_DIR = path.join(root, "state");
  const host = await createSession(root, `text-submission-${randomUUID()}`);
  const model = host.session.model;
  assert.ok(model);
  host.session.modelRuntime.getAvailableSnapshot = () => [model];
  let releaseRun!: () => void;
  let forwarded = "";
  host.session.prompt = async (message, options) => {
    forwarded = message;
    options?.preflightResult?.(true);
    await new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
  };
  t.after(async () => {
    releaseRun?.();
    await host.shutdown();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousStateDir === undefined) delete process.env.PI_WORKBENCH_STATE_DIR;
    else process.env.PI_WORKBENCH_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  });
  const store = getComposerTextAttachmentStore();
  const text = "CONTENT_SENT_ONLY_DURING_UPLOAD\n".repeat(300);
  const attachment = await store.create({ id: randomUUID(), text });
  assert.deepEqual(
    await submitPrompt(host.id, "followUp", { message: "", textAttachmentIds: [attachment.id] }),
    { queued: false },
  );
  assert.ok(forwarded.includes(attachment.path));
  assert.equal(forwarded.includes(text), false);
  await store.discard({ id: attachment.id });
  assert.equal(await readFile(attachment.path, "utf8"), text);
  assert.deepEqual(
    await submitPrompt(
      host.id,
      "followUp",
      { message: "queued", textAttachmentIds: [attachment.id] },
      { rpcId: "text-queue" },
    ),
    { queued: true, queueItemId: "text-queue" },
  );
  await updatePromptQueueItem(host.id, "text-queue", {
    kind: "edit",
    prompt: { message: "edited text", textAttachmentIds: [attachment.id] },
  });
  assert.ok(host.followUpMessages[0]?.includes(attachment.path));
  assert.ok(host.followUpMessages[0]?.includes("edited text"));
  await updatePromptQueueItem(host.id, "text-queue", { kind: "steer" });
  assert.ok(host.steeringMessages[0]?.includes(attachment.path));
  const history = await getSessionHistory(host.id);
  const details = history.context.messages.flatMap((message) => {
    const parsed =
      message.role === "custom" ? parseWorkbenchComposerUserDetails(message.details) : undefined;
    return parsed ? [parsed] : [];
  });
  assert.deepEqual(details.at(-1)?.textAttachments, [attachment]);
  assert.equal(details.at(-1)?.sourceText, "edited text");
  assert.equal(JSON.stringify(history).includes(text), false);
  const persisted = SessionManager.open(host.session.sessionManager.getSessionFile()!);
  assert.ok(
    persisted
      .getBranch()
      .some(
        (entry) =>
          entry.type === "custom" &&
          entry.customType === PI_COMPOSER_MODEL_INPUT_CUSTOM_TYPE &&
          JSON.stringify(entry.data).includes("edited text"),
      ),
  );
  await updatePromptQueueItem(host.id, "text-queue", {
    kind: "edit",
    prompt: { message: "without files", textAttachmentIds: [] },
  });
  assert.equal(host.steeringMessages[0]?.includes(attachment.path), false);
  assert.ok(host.steeringMessages[0]?.includes("without files"));
  await updatePromptQueueItem(host.id, "text-queue", { kind: "remove" });
  await store.discard({ id: attachment.id });
  assert.equal(await readFile(attachment.path, "utf8"), text);
  const originalUser = host.session.sessionManager
    .getBranch()
    .find(
      (entry) =>
        entry.type === "custom_message" &&
        parseWorkbenchComposerUserDetails(entry.details)?.sourceText === "",
    );
  assert.ok(originalUser);
  releaseRun();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await regenerateSession(host.id, originalUser.id, "retry-text-attachment");
  assert.ok(forwarded.includes(attachment.path));
  assert.equal(forwarded.includes(text), false);
});

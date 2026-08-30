import assert from "node:assert/strict";
import test from "node:test";
import type { AppendMessage } from "@assistant-ui/react";

import type {
  PiQueuedPrompt,
  PiSessionSummary,
} from "@workbench/agent-runtime-pi-protocol/messages";
import type { SessionPromptValue } from "@workbench/agent-runtime-pi-protocol/rpc";
import type {
  PromptFeedbackClaim,
  PromptFeedbackPort,
} from "@workbench/agent-runtime-client/prompt-feedback";
import { PiSessionManager } from "../../src/runtime/manager";

const feedback = [
  { id: "feedback-1", kind: "diff-line", target: { line: 42 }, text: "Revise this." },
] as const;

function remoteSummary(): PiSessionSummary {
  return {
    id: "remote-thread",
    cwd: "/workspace",
    workspace: { id: "workspace-1", name: "Workspace", cwd: "/workspace" },
    created: "2026-08-23T00:00:00.000Z",
    modified: "2026-08-23T00:00:00.000Z",
    messageCount: 0,
    firstMessage: "",
    transient: false,
    running: false,
  };
}

function userMessage(text: string): AppendMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    attachments: [],
    createdAt: new Date(0),
    metadata: { custom: {} },
    parentId: null,
    runConfig: undefined,
    sourceId: null,
  };
}

function retryablePort() {
  let activeToken: string | undefined;
  let sequence = 0;
  const releases: string[] = [];
  const commits: string[] = [];
  const port: PromptFeedbackPort = {
    claimForThreads: () => {
      if (activeToken) return undefined;
      activeToken = `claim-${++sequence}`;
      return { token: activeToken, items: feedback };
    },
    commit: (token) => {
      commits.push(token);
      if (activeToken === token) activeToken = undefined;
    },
    release: (token) => {
      releases.push(token);
      if (activeToken === token) activeToken = undefined;
    },
  };
  return { port, commits, releases };
}

test("claims prompt feedback through the narrow port using local and remote thread aliases", (t) => {
  const claims: string[][] = [];
  const commits: string[] = [];
  const releases: string[] = [];
  const claim: PromptFeedbackClaim = { token: "claim-1", items: feedback };
  const manager = new PiSessionManager({
    promptFeedback: {
      claimForThreads: (threadIds) => {
        claims.push([...threadIds]);
        return claim;
      },
      commit: (token) => commits.push(token),
      release: (token) => releases.push(token),
    },
  });
  t.after(() => manager.dispose());

  assert.equal(manager.claimPromptFeedback("local-thread", "remote-thread"), claim);
  assert.deepEqual(claims, [["local-thread", "remote-thread"]]);

  manager.commitPromptFeedback(undefined);
  manager.releasePromptFeedback(undefined);
  assert.deepEqual(commits, []);
  assert.deepEqual(releases, []);

  manager.commitPromptFeedback(claim);
  manager.releasePromptFeedback(claim);
  assert.deepEqual(commits, ["claim-1"]);
  assert.deepEqual(releases, ["claim-1"]);
});

test("a failed send releases its feedback claim for retry", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    throw new Error("offline");
  };

  const { port, releases } = retryablePort();
  const manager = new PiSessionManager({ promptFeedback: port });
  t.after(() => manager.dispose());
  const managerInternals = manager as unknown as {
    ensureRemote(): Promise<PiSessionSummary>;
    connections: { ensureSessionEvents(): Promise<void> };
  };
  managerInternals.ensureRemote = async () => remoteSummary();
  managerInternals.connections.ensureSessionEvents = async () => undefined;
  const session = manager.getSession("local-thread", "remote-thread");

  await assert.rejects(session.send(userMessage("Please address the comment.")), /offline/);

  assert.deepEqual(releases, ["claim-1"]);
  assert.equal(manager.claimPromptFeedback("local-thread", "remote-thread")?.token, "claim-2");
});

test("a failed queue admission releases feedback and a retry commits a new claim", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let shouldFail = true;
  const requestBodies: string[] = [];
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(String(init?.body));
    if (shouldFail) throw new Error("queue offline");
    const request = JSON.parse(String(init?.body)) as { rpcId: string };
    return Response.json({
      type: "server-response",
      rpcId: request.rpcId,
      result: { ok: true, value: { accepted: true, queued: true } },
    });
  };

  const { port, commits, releases } = retryablePort();
  const manager = new PiSessionManager({ promptFeedback: port });
  t.after(() => manager.dispose());
  const session = manager.getSession("local-thread", "remote-thread");
  const managerInternals = manager as unknown as {
    connections: { ensureSessionEvents(): Promise<void> };
  };
  managerInternals.connections.ensureSessionEvents = async () => undefined;
  const sessionInternals = session as unknown as {
    queuePrompt(
      mode: "followUp",
      prompt: PiQueuedPrompt,
      rpcId: string,
    ): Promise<SessionPromptValue>;
  };

  await assert.rejects(
    sessionInternals.queuePrompt("followUp", { message: "Queue this." }, "prompt-1"),
    /queue offline/,
  );
  assert.deepEqual(releases, ["claim-1"]);

  shouldFail = false;
  await sessionInternals.queuePrompt("followUp", { message: "Queue this." }, "prompt-2");

  assert.deepEqual(commits, ["claim-2"]);
  assert.equal(requestBodies.length, 2);
  assert.ok(requestBodies.every((body) => body.includes("Revise this.")));
});

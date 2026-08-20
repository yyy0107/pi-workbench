import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import type { HostStreamPayload, MuxStreamPayload, ServerRequest } from "../../stream-contracts";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/.test(specifier) &&
      context.parentURL?.includes("/runtime/pi/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const {
  createSession,
  createDetachedSessionFork,
  getSessionEvents,
  getSessionHistory,
  listSessions,
  messagesHaveImages,
  renameSession,
  resolveWorkbenchComposerCommands,
  SerializedSessionMutations,
  sessionModifiedAt,
  submitPrompt,
} = (await import(
  new URL("./session-registry.ts", import.meta.url).href
)) as typeof import("./session-registry");
const { appendSessionEventJournal } = (await import(
  new URL("./session-event-journal.ts", import.meta.url).href
)) as typeof import("./session-event-journal");
const { createStreamHub, STREAM_HUB_SYMBOL } = (await import(
  new URL("../streams/stream-hub.ts", import.meta.url).href
)) as typeof import("../streams/stream-hub");
moduleHooks.deregister();

test("detects image content across durable session message roles", () => {
  assert.equal(messagesHaveImages([{ role: "user", content: "text only" }]), false);
  assert.equal(
    messagesHaveImages([
      {
        role: "toolResult",
        content: [
          { type: "text", text: "preview" },
          { type: "image", mimeType: "image/png", data: "image-data" },
        ],
      },
    ]),
    true,
  );
});

test("serializes prompt, queue, and model mutation admission through one tail", async () => {
  const mutations = new SerializedSessionMutations();
  const entered: string[] = [];
  let releaseFirst!: () => void;
  const first = mutations.run(async () => {
    entered.push("prompt");
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
  });
  const second = mutations.run(async () => {
    entered.push("select-model");
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(entered, ["prompt"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(entered, ["prompt", "select-model"]);
});

test("treats an extension command as one explicit agent turn without a second result prompt", async () => {
  const prompts: string[] = [];
  const session = {
    extensionRunner: {
      getRegisteredCommands: () => [{ invocationName: "review" }],
    },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    sessionManager: { buildSessionContext: () => ({ messages: [] }) },
    compact: async () => ({ summary: "compacted" }),
    reload: async () => undefined,
    prompt: async (text: string) => void prompts.push(text),
  } as unknown as Parameters<typeof resolveWorkbenchComposerCommands>[0];
  const submission = {
    version: 1 as const,
    sourceText: "tokens",
    text: "inspect concurrency",
    context: [],
    metadata: {},
    commands: [
      {
        id: "review",
        commandId: "review",
        label: "Review",
        scope: "message" as const,
        source: "pi" as const,
        args: "concurrency only",
      },
    ],
  };

  const resolved = await resolveWorkbenchComposerCommands(session, submission);

  assert.deepEqual(prompts, ["/review concurrency only"]);
  assert.equal(resolved.agentTurn, true);
  assert.deepEqual(resolved.request.commandTrace, [
    {
      source: "pi",
      commandId: "review",
      label: "Review",
      scope: "message",
      effect: "agent-turn",
      status: "success",
      args: "concurrency only",
    },
  ]);
});

test("loads an existing Skill as trusted instructions without starting an intermediate turn", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-composer-skill-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillFile = path.join(root, "SKILL.md");
  await writeFile(
    skillFile,
    "---\nname: create-skill\ndescription: Create skills\n---\nFollow the skill workflow.",
  );
  let promptCount = 0;
  const session = {
    extensionRunner: { getRegisteredCommands: () => [] },
    promptTemplates: [],
    resourceLoader: {
      getSkills: () => ({
        skills: [
          {
            name: "create-skill",
            description: "Create skills",
            filePath: skillFile,
            baseDir: root,
            disableModelInvocation: false,
            sourceInfo: {},
          },
        ],
      }),
    },
    sessionManager: { buildSessionContext: () => ({ messages: [] }) },
    compact: async () => undefined,
    reload: async () => undefined,
    prompt: async () => {
      promptCount += 1;
    },
  } as unknown as Parameters<typeof resolveWorkbenchComposerCommands>[0];

  const resolved = await resolveWorkbenchComposerCommands(session, {
    version: 1,
    sourceText: "tokens",
    text: "build a reusable workflow",
    context: [],
    metadata: {},
    commands: [
      {
        id: "skill",
        commandId: "skill:create-skill",
        label: "Create Skill",
        scope: "message",
        source: "pi",
      },
    ],
  });

  assert.equal(promptCount, 0);
  assert.equal(resolved.agentTurn, false);
  assert.match(resolved.request.instructions[0]?.content ?? "", /Follow the skill workflow\./);
  assert.deepEqual(
    resolved.request.commandTrace.map(({ commandId, effect, status }) => ({
      commandId,
      effect,
      status,
    })),
    [{ commandId: "skill:create-skill", effect: "instruction", status: "success" }],
  );
});

test("expands a prompt template into the single main request without an intermediate turn", async () => {
  let promptCount = 0;
  const session = {
    extensionRunner: { getRegisteredCommands: () => [] },
    promptTemplates: [
      {
        name: "review",
        description: "Review changes",
        content: "Review this carefully: $ARGUMENTS",
        filePath: "/prompts/review.md",
        sourceInfo: {},
      },
    ],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    sessionManager: { buildSessionContext: () => ({ messages: [] }) },
    compact: async () => undefined,
    reload: async () => undefined,
    prompt: async () => {
      promptCount += 1;
    },
  } as unknown as Parameters<typeof resolveWorkbenchComposerCommands>[0];

  const resolved = await resolveWorkbenchComposerCommands(session, {
    version: 1,
    sourceText: "tokens",
    text: "inspect concurrency",
    context: [],
    metadata: {},
    commands: [
      {
        id: "review",
        commandId: "review",
        label: "Review",
        scope: "message",
        source: "pi",
      },
    ],
  });

  assert.equal(promptCount, 0);
  assert.equal(resolved.request.userText, "Review this carefully: inspect concurrency");
  assert.equal(resolved.request.commandTrace[0]?.effect, "prompt-transform");
});

test("records a successful built-in command as a visible response outcome", async () => {
  let reloadCount = 0;
  const responseStatuses: string[] = [];
  const session = {
    extensionRunner: { getRegisteredCommands: () => [] },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    sessionManager: { buildSessionContext: () => ({ messages: [] }) },
    compact: async () => undefined,
    reload: async () => {
      reloadCount += 1;
    },
    prompt: async () => undefined,
  } as unknown as Parameters<typeof resolveWorkbenchComposerCommands>[0];

  const resolved = await resolveWorkbenchComposerCommands(
    session,
    {
      version: 1,
      sourceText: ":pi-command[reload|Reload] ",
      text: "",
      context: [],
      metadata: {},
      commands: [
        {
          id: "reload",
          commandId: "reload",
          label: "Reload",
          scope: "message",
          source: "pi",
        },
      ],
    },
    {
      onCommandResponse: (response) => responseStatuses.push(response.status),
    },
  );

  assert.equal(reloadCount, 1);
  assert.deepEqual(responseStatuses, ["running", "success"]);
  assert.deepEqual(resolved.commandResponses, [
    {
      source: "pi",
      commandId: "reload",
      label: "Reload",
      status: "success",
    },
  ]);
});

test("passes canonical compact custom instructions without starting a normal prompt", async () => {
  const compactInstructions: Array<string | undefined> = [];
  let promptCount = 0;
  const session = {
    extensionRunner: { getRegisteredCommands: () => [] },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    sessionManager: { buildSessionContext: () => ({ messages: [] }) },
    compact: async (instructions?: string) => {
      compactInstructions.push(instructions);
    },
    reload: async () => undefined,
    prompt: async () => {
      promptCount += 1;
    },
  } as unknown as Parameters<typeof resolveWorkbenchComposerCommands>[0];

  const resolved = await resolveWorkbenchComposerCommands(session, {
    version: 1,
    sourceText: ":pi-command[compact|Compact] Focus on concurrency changes",
    text: "",
    context: [],
    metadata: {},
    commands: [
      {
        id: "compact",
        commandId: "compact",
        label: "Compact",
        scope: "message",
        source: "pi",
        args: { customInstructions: "Focus on concurrency changes" },
      },
    ],
  });

  assert.deepEqual(compactInstructions, ["Focus on concurrency changes"]);
  assert.equal(promptCount, 0);
  assert.equal(resolved.request.userText, "");
  assert.deepEqual(resolved.request.commandTrace[0]?.args, {
    customInstructions: "Focus on concurrency changes",
  });
});

test("keeps ordinary prompt text separate from canonical compact arguments", async () => {
  const compactInstructions: Array<string | undefined> = [];
  const session = {
    extensionRunner: { getRegisteredCommands: () => [] },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    sessionManager: { buildSessionContext: () => ({ messages: [] }) },
    compact: async (instructions?: string) => {
      compactInstructions.push(instructions);
    },
    reload: async () => undefined,
    prompt: async () => undefined,
  } as unknown as Parameters<typeof resolveWorkbenchComposerCommands>[0];

  const resolved = await resolveWorkbenchComposerCommands(session, {
    version: 1,
    sourceText: ":pi-command[compact|Compact] keep decisions continue reviewing tests",
    text: "continue reviewing tests",
    context: [],
    metadata: {},
    commands: [
      {
        id: "compact",
        commandId: "compact",
        label: "Compact",
        scope: "message",
        source: "pi",
        args: { customInstructions: "keep decisions" },
      },
    ],
  });

  assert.deepEqual(compactInstructions, ["keep decisions"]);
  assert.equal(resolved.request.userText, "continue reviewing tests");
  assert.equal(resolved.request.commandTrace[0]?.status, "success");
});

test("keeps an ordinary prompt after an explicitly empty compact argument range", async () => {
  const compactInstructions: Array<string | undefined> = [];
  const session = {
    extensionRunner: { getRegisteredCommands: () => [] },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    sessionManager: { buildSessionContext: () => ({ messages: [] }) },
    compact: async (instructions?: string) => {
      compactInstructions.push(instructions);
    },
    reload: async () => undefined,
    prompt: async () => undefined,
  } as unknown as Parameters<typeof resolveWorkbenchComposerCommands>[0];

  const resolved = await resolveWorkbenchComposerCommands(session, {
    version: 1,
    sourceText: ":pi-command[compact|Compact] continue reviewing tests",
    text: "continue reviewing tests",
    context: [],
    metadata: {},
    commands: [
      {
        id: "compact",
        commandId: "compact",
        label: "Compact",
        scope: "message",
        source: "pi",
        args: {},
      },
    ],
  });

  assert.deepEqual(compactInstructions, [undefined]);
  assert.equal(resolved.request.userText, "continue reviewing tests");
});

test("records command execution failures as resolved outcomes instead of rejecting admission", async () => {
  const reported: Array<[string, unknown]> = [];
  const responseStatuses: string[] = [];
  const failure = new Error("Nothing to compact (session too small)");
  const session = {
    extensionRunner: { getRegisteredCommands: () => [] },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    sessionManager: { buildSessionContext: () => ({ messages: [] }) },
    compact: async () => {
      throw failure;
    },
    reload: async () => undefined,
    prompt: async () => undefined,
  } as unknown as Parameters<typeof resolveWorkbenchComposerCommands>[0];

  const resolved = await resolveWorkbenchComposerCommands(
    session,
    {
      version: 1,
      sourceText: ":pi-command[compact|Compact] ",
      text: "",
      context: [],
      metadata: {},
      commands: [
        {
          id: "compact",
          commandId: "compact",
          label: "Compact",
          scope: "message",
          source: "pi",
        },
      ],
    },
    {
      onCommandError: (command, error) => reported.push([command.commandId, error]),
      onCommandResponse: (response) => responseStatuses.push(response.status),
    },
  );

  assert.deepEqual(resolved.request.commandTrace, [
    {
      source: "pi",
      commandId: "compact",
      label: "Compact",
      scope: "message",
      effect: "session-action",
      status: "execution-failed",
    },
  ]);
  assert.deepEqual(resolved.commandResponses, [
    {
      source: "pi",
      commandId: "compact",
      label: "Compact",
      status: "execution-failed",
    },
  ]);
  assert.deepEqual(reported, [["compact", failure]]);
  assert.deepEqual(responseStatuses, ["running", "execution-failed"]);
});

test("keeps a durable token-only user message when its built-in command fails", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-composer-command-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const hub = createStreamHub({ createRpcId: () => "composer-command-failure-rpc" });
  const globals = globalThis as unknown as Record<PropertyKey, unknown>;
  const previousHub = globals[STREAM_HUB_SYMBOL];
  globals[STREAM_HUB_SYMBOL] = hub;
  t.after(() => {
    if (previousHub === undefined) delete globals[STREAM_HUB_SYMBOL];
    else globals[STREAM_HUB_SYMBOL] = previousHub;
  });
  const hostFrames: ServerRequest<HostStreamPayload>[] = [];
  const subscription = hub.subscribe("host", {
    onFrame: (frame) => hostFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => subscription.close());
  await subscription.ready;

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const host = await createSession(cwd, "composer-command-failure");
  const fakeAgent = host.session as unknown as {
    compact(instructions?: string): Promise<unknown>;
  };
  const originalCompact = fakeAgent.compact;
  fakeAgent.compact = async () => {
    throw new Error("Nothing to compact (session too small)");
  };
  t.after(() => {
    fakeAgent.compact = originalCompact;
    return host.shutdown();
  });

  const sourceText = ":pi-command[compact|Compact] ";
  await submitPrompt(
    host.id,
    "followUp",
    { message: "" },
    {
      rpcId: "compact-command-rpc",
      composer: {
        version: 1,
        document: [
          {
            type: "command",
            id: "command:pi:compact:0",
            commandId: "compact",
            label: "Compact",
            scope: "message",
            source: "pi",
          },
          { type: "text", text: " " },
        ],
        sourceText,
        text: "",
        context: [],
        metadata: {},
        commands: [
          {
            id: "command:pi:compact:0",
            commandId: "compact",
            label: "Compact",
            scope: "message",
            source: "pi",
          },
        ],
      },
    },
  );

  const history = await getSessionHistory(host.id);
  const marker = history.context.messages.find(
    (message) => message.role === "custom" && message.customType === "workbench.composer-user.v2",
  );
  assert.ok(marker);
  if (marker.role !== "custom") assert.fail("Expected a custom Composer marker");
  assert.deepEqual(marker.details, {
    version: 2,
    submissionId: (marker.details as { submissionId: string }).submissionId,
    sourceText,
    text: "",
    document: [
      {
        type: "command",
        id: "command:pi:compact:0",
        commandId: "compact",
        label: "Compact",
        scope: "message",
        source: "pi",
      },
      { type: "text", text: " " },
    ],
    commands: [
      {
        id: "command:pi:compact:0",
        commandId: "compact",
        label: "Compact",
        scope: "message",
        source: "pi",
      },
    ],
    composer: {
      version: 1,
      document: [
        {
          type: "command",
          id: "command:pi:compact:0",
          commandId: "compact",
          label: "Compact",
          scope: "message",
          source: "pi",
        },
        { type: "text", text: " " },
      ],
      sourceText,
      text: "",
      context: [],
      metadata: {},
      commands: [
        {
          id: "command:pi:compact:0",
          commandId: "compact",
          label: "Compact",
          scope: "message",
          source: "pi",
        },
      ],
    },
    status: "accepted",
  });
  const response = history.context.messages.find(
    (message) =>
      message.role === "custom" && message.customType === "workbench.composer-command-response.v1",
  );
  assert.ok(response);
  if (response.role !== "custom") assert.fail("Expected a custom command response");
  assert.equal(response.display, true);
  assert.deepEqual(response.details, {
    version: 1,
    submissionId: (marker.details as { submissionId: string }).submissionId,
    source: "pi",
    commandId: "compact",
    label: "Compact",
    status: "execution-failed",
  });
  assert.equal(
    host.session.sessionManager
      .buildSessionContext()
      .messages.some(
        (message) =>
          message.role === "custom" &&
          message.customType === "workbench.composer-command-response.v1",
      ),
    false,
    "a visible command response must not become later model context",
  );
  const events = await getSessionEvents(host.id);
  assert.deepEqual(
    events.flatMap((event) => {
      const data = event.data as { customType?: string; details?: { status?: string } };
      return event.type === "message" &&
        data.customType === "workbench.composer-command-response.v1" &&
        data.details?.status
        ? [data.details.status]
        : [];
    }),
    ["running", "execution-failed"],
  );
  assert.equal(
    events.at(-1)?.type,
    "command_error",
    "a token-only execution failure should settle the optimistic submission",
  );
  assert.equal(
    hostFrames.some((frame) => frame.payload.type === "host/agent-error"),
    false,
    "an expected command outcome must not be promoted to a global host failure",
  );
});

test("validates every Pi command before executing any Composer command", async () => {
  let promptCount = 0;
  const session = {
    extensionRunner: { getRegisteredCommands: () => [{ invocationName: "plan" }] },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    sessionManager: { buildSessionContext: () => ({ messages: [] }) },
    compact: async () => ({ summary: "compacted" }),
    reload: async () => undefined,
    prompt: async () => {
      promptCount += 1;
    },
  } as unknown as Parameters<typeof resolveWorkbenchComposerCommands>[0];

  await assert.rejects(
    resolveWorkbenchComposerCommands(session, {
      version: 1,
      sourceText: "tokens",
      text: "inspect",
      context: [],
      metadata: {},
      commands: [
        {
          id: "plan",
          commandId: "plan",
          label: "Plan",
          scope: "message",
          source: "pi",
        },
        {
          id: "missing",
          commandId: "missing",
          label: "Missing",
          scope: "message",
          source: "pi",
        },
      ],
    }),
    { code: "pi_command_not_found" },
  );
  assert.equal(promptCount, 0);
});

test("derives a live host timestamp from persisted branch metadata", () => {
  const modified = sessionModifiedAt({
    getBranch: () => [
      { timestamp: "2026-01-01T00:00:00.000Z" },
      { timestamp: "2026-02-03T04:05:06.000Z" },
      { timestamp: "not-a-timestamp" },
    ],
    getHeader: () => ({ timestamp: "2025-01-01T00:00:00.000Z" }),
    getSessionFile: () => null,
  });

  assert.equal(modified.toISOString(), "2026-02-03T04:05:06.000Z");
});

test("falls back to the persisted header without stamping the current time", () => {
  const modified = sessionModifiedAt({
    getBranch: () => [],
    getHeader: () => ({ timestamp: "2024-06-07T08:09:10.000Z" }),
    getSessionFile: () => null,
  });

  assert.equal(modified.toISOString(), "2024-06-07T08:09:10.000Z");
});

test("read-only journal migration does not refresh a cold session's modified time", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-metadata-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const manager = SessionManager.create(cwd, undefined, { id: "metadata-migration" });
  manager.appendMessage({
    role: "user",
    content: "durable activity",
    timestamp: Date.parse("2024-05-02T03:04:04.000Z"),
  });
  manager.appendMessage(
    assistantMessage("durable response", Date.parse("2024-05-02T03:04:05.000Z")),
  );
  const sessionPath = manager.getSessionFile();
  assert.ok(sessionPath);
  const entries = (await readFile(sessionPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  entries[0]!.timestamp = "2024-05-01T00:00:00.000Z";
  entries[1]!.timestamp = "2024-05-02T03:04:04.000Z";
  entries[2]!.timestamp = "2024-05-02T03:04:05.000Z";
  await writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

  const before = (await listSessions()).sessions.find(
    (session) => session.id === "metadata-migration",
  );
  assert.ok(before);
  assert.equal(before.modified, "2024-05-02T03:04:05.000Z");

  const events = await getSessionEvents("metadata-migration");
  assert.equal(events.at(-1)?.time, Date.parse(before.modified));
  const after = (await listSessions()).sessions.find(
    (session) => session.id === "metadata-migration",
  );
  assert.ok(after);
  assert.equal(after.modified, before.modified);
});

test("coalesces the initial scan and incrementally refreshes changed files", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const manager = SessionManager.create(cwd, undefined, { id: "metadata-cache" });
  const now = Date.now();
  manager.appendMessage({ role: "user", content: "cache me", timestamp: now });
  manager.appendMessage(assistantMessage("cached", now + 1));

  const originalListAll = SessionManager.listAll;
  let fullScanCount = 0;
  Object.defineProperty(SessionManager, "listAll", {
    configurable: true,
    value: async (...args: unknown[]) => {
      fullScanCount += 1;
      return Reflect.apply(originalListAll, SessionManager, args) as ReturnType<
        typeof SessionManager.listAll
      >;
    },
  });
  t.after(() => {
    Object.defineProperty(SessionManager, "listAll", {
      configurable: true,
      value: originalListAll,
    });
  });

  const [first, concurrent] = await Promise.all([listSessions(), listSessions()]);
  const repeated = await listSessions();
  assert.equal(first.sessions[0]?.id, "metadata-cache");
  assert.deepEqual(concurrent, first);
  assert.deepEqual(repeated, first);
  assert.equal(fullScanCount, 1);

  manager.appendMessage(assistantMessage("changed", now + 2));
  let changed = await listSessions();
  for (let attempt = 0; attempt < 20 && changed.sessions[0]?.messageCount !== 3; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    changed = await listSessions();
  }
  assert.equal(changed.sessions[0]?.messageCount, 3);
  assert.equal(fullScanCount, 1, "a changed JSONL file must not rebuild the complete index");
});

test("uses live host metadata when an active session file changes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-live-session-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const originalListAll = SessionManager.listAll;
  let fullScanCount = 0;
  Object.defineProperty(SessionManager, "listAll", {
    configurable: true,
    value: async (...args: unknown[]) => {
      fullScanCount += 1;
      return Reflect.apply(originalListAll, SessionManager, args) as ReturnType<
        typeof SessionManager.listAll
      >;
    },
  });
  t.after(() => {
    Object.defineProperty(SessionManager, "listAll", {
      configurable: true,
      value: originalListAll,
    });
  });

  const hub = createStreamHub({ createRpcId: () => "live-metadata-rpc" });
  const globals = globalThis as unknown as Record<PropertyKey, unknown>;
  const previousHub = globals[STREAM_HUB_SYMBOL];
  globals[STREAM_HUB_SYMBOL] = hub;
  t.after(() => {
    if (previousHub === undefined) delete globals[STREAM_HUB_SYMBOL];
    else globals[STREAM_HUB_SYMBOL] = previousHub;
  });
  const hostFrames: ServerRequest<HostStreamPayload>[] = [];
  const subscription = hub.subscribe("host", {
    onFrame: (frame) => hostFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => subscription.close());
  await subscription.ready;

  const host = await createSession(cwd, "live-metadata-cache");
  t.after(() => host.shutdown());
  const added = hostFrames.find((frame) => frame.payload.type === "host/session-added");
  assert.ok(added);
  if (added.payload.type !== "host/session-added") {
    assert.fail("Expected host/session-added frame");
  }
  assert.equal(added.payload.summary.id, host.id);
  assert.equal(added.payload.summary.cwd, cwd);
  await listSessions();
  assert.equal(fullScanCount, 1);

  host.rename("Live cache rename");
  const changed = hostFrames.find(
    (frame) =>
      frame.payload.type === "host/session-changed" &&
      frame.payload.summary.name === "Live cache rename",
  );
  assert.ok(changed, "a live rename must publish its updated summary");
  const afterRename = await listSessions();
  assert.equal(
    afterRename.sessions.find((session) => session.id === host.id)?.name,
    "Live cache rename",
  );
  assert.equal(fullScanCount, 1, "active file writes must not trigger a full JSONL rescan");
});

test("publishes prompt admission and retains the HTTP RPC id for queued follow-ups", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-prompt-admission-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const hub = createStreamHub({ createRpcId: () => "generated-rpc" });
  const globals = globalThis as unknown as Record<PropertyKey, unknown>;
  const previousHub = globals[STREAM_HUB_SYMBOL];
  globals[STREAM_HUB_SYMBOL] = hub;
  t.after(() => {
    if (previousHub === undefined) delete globals[STREAM_HUB_SYMBOL];
    else globals[STREAM_HUB_SYMBOL] = previousHub;
  });
  const muxFrames: ServerRequest<MuxStreamPayload>[] = [];
  const subscription = hub.subscribe("mux", {
    onFrame: (frame) => muxFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => subscription.close());
  await subscription.ready;

  const host = await createSession(cwd, "prompt-admission");
  let releaseRun!: () => void;
  const fakeAgent = host.session as unknown as {
    model?: unknown;
    modelRuntime: { getAvailableSnapshot(): unknown[] };
    prompt(
      message: string,
      options: { preflightResult?: (accepted: boolean) => void },
    ): Promise<void>;
  };
  const originalPrompt = fakeAgent.prompt;
  const originalAvailableSnapshot = fakeAgent.modelRuntime.getAvailableSnapshot;
  fakeAgent.modelRuntime.getAvailableSnapshot = () =>
    fakeAgent.model === undefined ? [] : [fakeAgent.model];
  fakeAgent.prompt = async (_message, options) => {
    options.preflightResult?.(true);
    await new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
  };
  t.after(() => {
    fakeAgent.prompt = originalPrompt;
    fakeAgent.modelRuntime.getAvailableSnapshot = originalAvailableSnapshot;
    releaseRun?.();
    return host.shutdown();
  });

  const initialAdmission = await submitPrompt(
    host.id,
    "followUp",
    { message: "admit this prompt" },
    { rpcId: "prompt-http-rpc", clientTimeZone: "America/Los_Angeles" },
  );
  assert.deepEqual(initialAdmission, { queued: false });

  const followUpAdmission = await submitPrompt(
    host.id,
    "followUp",
    { message: "queue this follow-up" },
    { rpcId: "follow-up-http-rpc", clientTimeZone: "America/Los_Angeles" },
  );
  assert.deepEqual(followUpAdmission, {
    queued: true,
    queueItemId: "follow-up-http-rpc",
  });

  const admission = muxFrames.find(
    (frame) =>
      frame.rpcId === "prompt-http-rpc" && frame.payload.type === "session/prompt-accepted",
  );
  assert.ok(admission);
  assert.equal(admission.rpcId, "prompt-http-rpc");
  assert.deepEqual(admission.payload, {
    type: "session/prompt-accepted",
    sessionId: host.id,
    mode: "queue",
    running: true,
  });
  const queueFrame = muxFrames.find(
    (frame) =>
      frame.payload.type === "session/queue" &&
      frame.payload.items.some((item) => item.id === "follow-up-http-rpc"),
  );
  assert.ok(queueFrame);
  releaseRun();
});

test("cold rename publishes its canonical event and retains the same lastSeq", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-cold-rename-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const manager = SessionManager.create(cwd, undefined, { id: "cold-rename" });
  manager.appendMessage({
    role: "user",
    content: "before rename",
    timestamp: Date.parse("2024-06-01T00:00:00.000Z"),
  });
  manager.appendMessage(assistantMessage("ready", Date.parse("2024-06-01T00:00:01.000Z")));
  const eventsBeforeRename = await getSessionEvents("cold-rename");

  const hub = createStreamHub({ createRpcId: () => "registry-metadata-rpc" });
  const globals = globalThis as unknown as Record<PropertyKey, unknown>;
  const previousHub = globals[STREAM_HUB_SYMBOL];
  globals[STREAM_HUB_SYMBOL] = hub;
  t.after(() => {
    if (previousHub === undefined) delete globals[STREAM_HUB_SYMBOL];
    else globals[STREAM_HUB_SYMBOL] = previousHub;
  });

  const liveFrames: ServerRequest<MuxStreamPayload>[] = [];
  const liveSubscription = hub.subscribe("mux", {
    onFrame: (frame) => liveFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => liveSubscription.close());
  await liveSubscription.ready;
  const hostFrames: ServerRequest<HostStreamPayload>[] = [];
  const hostSubscription = hub.subscribe("host", {
    onFrame: (frame) => hostFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => hostSubscription.close());
  await hostSubscription.ready;

  const seq = await renameSession("cold-rename", "Renamed while cold");
  assert.equal(seq, (eventsBeforeRename.at(-1)?.seq ?? -1) + 1);
  const eventFrame = liveFrames.find((frame) => frame.payload.type === "session/event");
  assert.ok(eventFrame);
  if (eventFrame.payload.type !== "session/event") assert.fail("Expected session/event frame");
  assert.equal(eventFrame.payload.sessionId, "cold-rename");
  assert.equal(eventFrame.payload.event.seq, seq);
  assert.equal(eventFrame.payload.event.type, "session_info_changed");
  const changedFrame = hostFrames.find((frame) => frame.payload.type === "host/session-changed");
  assert.ok(changedFrame);
  if (changedFrame.payload.type !== "host/session-changed") {
    assert.fail("Expected host/session-changed frame");
  }
  assert.equal(changedFrame.payload.sessionId, "cold-rename");
  assert.equal(changedFrame.payload.summary.name, "Renamed while cold");

  const reconnectFrames: ServerRequest<MuxStreamPayload>[] = [];
  const reconnectSubscription = hub.subscribe("mux", {
    onFrame: (frame) => reconnectFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => reconnectSubscription.close());
  await reconnectSubscription.ready;
  const retained = reconnectFrames.find(
    (frame) =>
      frame.payload.type === "session/subscribed" && frame.payload.sessionId === "cold-rename",
  );
  assert.ok(retained);
  if (retained.payload.type !== "session/subscribed") {
    assert.fail("Expected retained session/subscribed frame");
  }
  assert.equal(retained.payload.lastSeq, seq);
});

function assistantMessage(text: string, timestamp: number) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "anthropic-messages" as const,
    provider: "anthropic",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp,
  };
}

test("creates detached omitted and anchored forks without replacing the source", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-fork-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  await mkdir(cwd, { recursive: true });
  await mkdir(sessionDir, { recursive: true });

  const source = SessionManager.create(cwd, sessionDir, { id: "fork-source" });
  const user = { role: "user" as const, content: "hello", timestamp: 1 };
  const assistant = assistantMessage("world", 2);
  appendSessionEventJournal(source, {
    type: "turn_start",
    seq: 0,
    time: 1,
    data: { turnIndex: 0 },
  });
  appendSessionEventJournal(source, {
    type: "message_start",
    seq: 1,
    time: 2,
    data: { message: user },
  });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 2,
    time: 3,
    data: { message: user },
  });
  source.appendMessage(user);
  appendSessionEventJournal(source, {
    type: "message_start",
    seq: 3,
    time: 4,
    data: { message: assistant },
  });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 4,
    time: 5,
    data: { message: assistant },
  });
  source.appendMessage(assistant);
  appendSessionEventJournal(source, {
    type: "turn_end",
    seq: 5,
    time: 6,
    data: { turnIndex: 0 },
  });
  appendSessionEventJournal(source, {
    type: "agent_settled",
    seq: 6,
    time: 7,
    data: {},
  });
  const openTailUser = { role: "user" as const, content: "unfinished", timestamp: 3 };
  appendSessionEventJournal(source, {
    type: "turn_start",
    seq: 7,
    time: 8,
    data: { turnIndex: 1 },
  });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 8,
    time: 9,
    data: { message: openTailUser },
  });
  source.appendMessage(openTailUser);

  const sourcePath = source.getSessionFile();
  assert.ok(sourcePath);
  const sourceBefore = await readFile(sourcePath, "utf8");
  const sourceLeaf = source.getLeafId();

  const anchored = createDetachedSessionFork(sourcePath, 1);
  assert.notEqual(anchored.getSessionId(), source.getSessionId());
  assert.equal(anchored.getCwd(), source.getCwd());
  assert.equal(anchored.getHeader()?.parentSession, sourcePath);
  assert.deepEqual(anchored.buildSessionContext().messages, [user, assistant]);
  const anchoredTail = anchored.getLeafEntry();
  assert.equal(anchoredTail?.type, "custom");
  if (anchoredTail?.type === "custom") {
    const event = (anchoredTail.data as { event?: Record<string, unknown> }).event;
    assert.equal(event?.type, "session_forked");
    assert.equal(event?.seq, 6);
    assert.equal(typeof event?.time, "number");
    assert.deepEqual(event?.data, { sourceSessionId: "fork-source", sourceEventSeq: 5 });
  }

  const omitted = createDetachedSessionFork(sourcePath);
  const omittedTail = omitted.getLeafEntry();
  assert.equal(omittedTail?.type, "custom");
  if (omittedTail?.type === "custom") {
    const event = (omittedTail.data as { event?: Record<string, unknown> }).event;
    assert.equal(event?.type, "session_forked");
    assert.equal(event?.seq, 6);
    assert.equal(typeof event?.time, "number");
    assert.deepEqual(event?.data, { sourceSessionId: "fork-source", sourceEventSeq: 5 });
  }
  assert.throws(() => createDetachedSessionFork(sourcePath, 8), {
    code: "pi_fork_unavailable",
  });

  assert.equal(source.getSessionId(), "fork-source");
  assert.equal(source.getSessionFile(), sourcePath);
  assert.equal(source.getLeafId(), sourceLeaf);
  assert.equal(await readFile(sourcePath, "utf8"), sourceBefore);
});

test("forks sessions whose durable custom messages precede their lifecycle events", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-fork-custom-message-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  await mkdir(cwd, { recursive: true });
  await mkdir(sessionDir, { recursive: true });

  const source = SessionManager.create(cwd, sessionDir, { id: "fork-custom-source" });
  const composerMessage = {
    role: "custom" as const,
    customType: "workbench.composer-user.v2",
    content: "",
    display: false,
    details: { version: 2, submissionId: "submission-1" },
    timestamp: 1,
  };
  source.appendCustomMessageEntry(
    composerMessage.customType,
    composerMessage.content,
    composerMessage.display,
    composerMessage.details,
  );
  appendSessionEventJournal(source, {
    type: "message_start",
    seq: 0,
    time: 1,
    data: { message: composerMessage },
  });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 1,
    time: 2,
    data: { message: composerMessage },
  });

  const user = { role: "user" as const, content: "hello", timestamp: 2 };
  const assistant = assistantMessage("world", 3);
  appendSessionEventJournal(source, { type: "turn_start", seq: 2, time: 3, data: {} });
  appendSessionEventJournal(source, {
    type: "message_start",
    seq: 3,
    time: 4,
    data: { message: user },
  });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 4,
    time: 5,
    data: { message: user },
  });
  source.appendMessage(user);
  appendSessionEventJournal(source, {
    type: "message_start",
    seq: 5,
    time: 6,
    data: { message: assistant },
  });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 6,
    time: 7,
    data: { message: assistant },
  });
  source.appendMessage(assistant);
  appendSessionEventJournal(source, { type: "turn_end", seq: 7, time: 8, data: {} });

  const sourcePath = source.getSessionFile();
  assert.ok(sourcePath);
  const forked = createDetachedSessionFork(sourcePath, 6);
  const tail = forked.getLeafEntry();
  assert.equal(tail?.type, "custom");
  if (tail?.type !== "custom") return;
  const event = (tail.data as { event?: Record<string, unknown> }).event;
  assert.equal(event?.type, "session_forked");
  assert.equal(event?.seq, 8);
  assert.deepEqual(event?.data, {
    sourceSessionId: "fork-custom-source",
    sourceEventSeq: 7,
  });
});

test("rejects in-log anchors without a completed and reliably persisted turn", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-fork-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project");
  const sessionDir = path.join(root, "sessions");
  await mkdir(cwd, { recursive: true });
  await mkdir(sessionDir, { recursive: true });

  const source = SessionManager.create(cwd, sessionDir, { id: "fork-invalid-source" });
  const user = { role: "user" as const, content: "hello", timestamp: 1 };
  const assistant = assistantMessage("world", 2);
  appendSessionEventJournal(source, {
    type: "turn_start",
    seq: 0,
    time: 1,
    data: {},
  });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 1,
    time: 2,
    data: { message: user },
  });
  source.appendCustomEntry("interloper", {});
  source.appendMessage(user);
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 2,
    time: 3,
    data: { message: assistant },
  });
  source.appendMessage(assistant);
  appendSessionEventJournal(source, {
    type: "turn_end",
    seq: 3,
    time: 4,
    data: {},
  });
  appendSessionEventJournal(source, {
    type: "agent_settled",
    seq: 4,
    time: 5,
    data: {},
  });
  const sourcePath = source.getSessionFile();
  assert.ok(sourcePath);

  assert.throws(() => createDetachedSessionFork(sourcePath, 1), {
    code: "pi_fork_unavailable",
  });
  assert.throws(() => createDetachedSessionFork(sourcePath, 4), {
    code: "pi_fork_unavailable",
  });

  const legacy = SessionManager.create(cwd, sessionDir, { id: "fork-legacy-source" });
  legacy.appendMessage(user);
  legacy.appendMessage(assistant);
  appendSessionEventJournal(legacy, {
    type: "message",
    seq: 0,
    time: 1,
    data: user,
  });
  appendSessionEventJournal(legacy, {
    type: "message",
    seq: 1,
    time: 2,
    data: assistant,
  });
  appendSessionEventJournal(legacy, {
    type: "turn_start",
    seq: 2,
    time: 3,
    data: {},
  });
  appendSessionEventJournal(legacy, {
    type: "message_end",
    seq: 3,
    time: 4,
    data: { message: user },
  });
  legacy.appendMessage(user);
  appendSessionEventJournal(legacy, {
    type: "message_end",
    seq: 4,
    time: 5,
    data: { message: assistant },
  });
  legacy.appendMessage(assistant);
  appendSessionEventJournal(legacy, {
    type: "turn_end",
    seq: 5,
    time: 6,
    data: {},
  });
  const legacyPath = legacy.getSessionFile();
  assert.ok(legacyPath);
  assert.throws(() => createDetachedSessionFork(legacyPath, 0), {
    code: "pi_fork_unavailable",
  });
});

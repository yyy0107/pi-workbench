import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import type {
  HostStreamPayload,
  MuxStreamPayload,
  ServerRequest,
} from "@/runtime/pi/contracts/stream";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/.test(specifier) &&
      context.parentURL?.includes("/runtime/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const {
  cancelSession,
  compactAssistantMessageUpdate,
  createSession,
  createDetachedSessionFork,
  getSessionEventBranches,
  getSessionEvents,
  getSessionHistory,
  getOrStartSession,
  listSessions,
  messagesHaveImages,
  queuePrompt,
  regenerateSession,
  renameSession,
  replacePromptQueue,
  resolveWorkbenchComposerCommands,
  sendPrompt,
  SerializedSessionMutations,
  sessionModifiedAt,
  setPromptQueuePaused,
  steerQueuedPrompt,
  submitPrompt,
  textOnlyModelContext,
  updatePromptQueueItem,
} = (await import(
  new URL("./session-registry.ts", import.meta.url).href
)) as typeof import("./session-registry");
const { appendSessionEventJournal, initializeSessionEventJournal, SESSION_EVENT_CUSTOM_TYPE } =
  (await import(
    new URL("./session-event-journal.ts", import.meta.url).href
  )) as typeof import("./session-event-journal");
const { createStreamHub, STREAM_HUB_SYMBOL } = (await import(
  new URL("../streams/stream-hub.ts", import.meta.url).href
)) as typeof import("../streams/stream-hub");
const { getImageUnderstandingSettingsStore } = (await import(
  new URL("../attachment-understanding/registry.ts", import.meta.url).href
)) as typeof import("../attachment-understanding/registry");
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

test("projects historical images as placeholders for a text-only model without mutating history", () => {
  const durable = [
    {
      role: "user",
      content: [
        { type: "text", text: "Keep this text" },
        { type: "image", mimeType: "image/png", data: "private-image-data" },
      ],
    },
    {
      role: "toolResult",
      content: [{ type: "image", mimeType: "image/png", data: "second-private-image" }],
    },
  ];

  const projected = textOnlyModelContext(durable);

  assert.equal(messagesHaveImages(projected), false);
  assert.equal(messagesHaveImages(durable), true);
  assert.equal(JSON.stringify(projected).includes("private-image-data"), false);
  assert.match(JSON.stringify(projected), /Keep this text/);
  assert.match(JSON.stringify(projected), /historical image 1/);
  assert.match(JSON.stringify(projected), /historical image 2/);
  const textOnly = [{ role: "user", content: "text only" }];
  assert.equal(textOnlyModelContext(textOnly), textOnly);
});

test("projects Pi assistant updates into the compact public wire vocabulary", () => {
  assert.deepEqual(
    compactAssistantMessageUpdate({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done", textSignature: "" }],
      },
      assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "done" },
    }),
    { type: "text_end", contentIndex: 0, content: "done", contentSignature: "" },
  );
  assert.deepEqual(
    compactAssistantMessageUpdate({
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "[Reasoning redacted]",
            thinkingSignature: "opaque",
            redacted: true,
          },
        ],
      },
      assistantMessageEvent: {
        type: "thinking_end",
        contentIndex: 0,
        content: "[Reasoning redacted]",
      },
    }),
    {
      type: "thinking_end",
      contentIndex: 0,
      content: "[Reasoning redacted]",
      contentSignature: "opaque",
      redacted: true,
    },
  );
  assert.deepEqual(
    compactAssistantMessageUpdate({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "tool-1", name: "search", arguments: {} }],
      },
      assistantMessageEvent: { type: "toolcall_start", contentIndex: 0 },
    }),
    {
      type: "toolcall_start",
      contentIndex: 0,
      id: "tool-1",
      toolName: "search",
    },
  );
  assert.deepEqual(
    compactAssistantMessageUpdate({
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "search",
            arguments: { query: "hello" },
          },
        ],
      },
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          type: "toolCall",
          id: "tool-1",
          name: "search",
          arguments: { query: "hello" },
          thoughtSignature: "thought",
          namespace: "builtin",
          partialJson: "must not leak",
        },
      },
    }),
    {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: {
        type: "toolCall",
        id: "tool-1",
        name: "search",
        arguments: { query: "hello" },
        thoughtSignature: "thought",
        namespace: "builtin",
      },
    },
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
    version: 2 as const,
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
        source: "agent" as const,
        args: "concurrency only",
      },
    ],
  };

  const resolved = await resolveWorkbenchComposerCommands(session, submission);

  assert.deepEqual(prompts, ["/review concurrency only"]);
  assert.equal(resolved.agentTurn, true);
  assert.deepEqual(resolved.request.commandTrace, [
    {
      source: "agent",
      commandId: "review",
      label: "Review",
      scope: "message",
      effect: "agent-turn",
      status: "success",
      args: "concurrency only",
    },
  ]);
});

test("records an explicit Skill selection without reading its file or starting an intermediate turn", async () => {
  const root = "/skills/create-skill";
  const skillFile = `${root}/SKILL.md`;
  let promptCount = 0;
  const session = {
    getActiveToolNames: () => ["read", "bash"],
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
    version: 2,
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
        source: "agent",
      },
    ],
  });

  assert.equal(promptCount, 0);
  assert.equal(resolved.agentTurn, false);
  assert.deepEqual(resolved.request.selectedSkills, [
    {
      invocationName: "skill:create-skill",
      name: "create-skill",
      location: skillFile,
      baseDir: root,
      selectedBy: "user",
    },
  ]);
  assert.deepEqual(resolved.request.instructions, []);
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
    version: 2,
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
        source: "agent",
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
      version: 2,
      sourceText: ":agent-command[reload|Reload] ",
      text: "",
      context: [],
      metadata: {},
      commands: [
        {
          id: "reload",
          commandId: "reload",
          label: "Reload",
          scope: "message",
          source: "agent",
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
      source: "agent",
      commandId: "reload",
      label: "Reload",
      status: "success",
    },
  ]);
});

test("passes canonical compact custom instructions without starting a normal prompt", async () => {
  const compactInstructions: Array<string | undefined> = [];
  const publishedResponses: unknown[] = [];
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

  const resolved = await resolveWorkbenchComposerCommands(
    session,
    {
      version: 2,
      sourceText: ":agent-command[compact|Compact] Focus on concurrency changes",
      text: "",
      context: [],
      metadata: {},
      commands: [
        {
          id: "compact",
          commandId: "compact",
          label: "Compact",
          scope: "message",
          source: "agent",
          args: { customInstructions: "Focus on concurrency changes" },
        },
      ],
    },
    { onCommandResponse: (response) => publishedResponses.push(response) },
  );

  assert.deepEqual(compactInstructions, ["Focus on concurrency changes"]);
  assert.equal(promptCount, 0);
  assert.equal(resolved.request.userText, "");
  assert.deepEqual(resolved.request.commandTrace[0]?.args, {
    customInstructions: "Focus on concurrency changes",
  });
  assert.deepEqual(publishedResponses, [
    {
      source: "agent",
      commandId: "compact",
      label: "Compact",
      status: "running",
      args: { customInstructions: "Focus on concurrency changes" },
    },
    {
      source: "agent",
      commandId: "compact",
      label: "Compact",
      status: "success",
      args: { customInstructions: "Focus on concurrency changes" },
    },
  ]);
  assert.deepEqual(resolved.commandResponses, [publishedResponses[1]]);
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
    version: 2,
    sourceText: ":agent-command[compact|Compact] keep decisions continue reviewing tests",
    text: "continue reviewing tests",
    context: [],
    metadata: {},
    commands: [
      {
        id: "compact",
        commandId: "compact",
        label: "Compact",
        scope: "message",
        source: "agent",
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
    version: 2,
    sourceText: ":agent-command[compact|Compact] continue reviewing tests",
    text: "continue reviewing tests",
    context: [],
    metadata: {},
    commands: [
      {
        id: "compact",
        commandId: "compact",
        label: "Compact",
        scope: "message",
        source: "agent",
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
      version: 2,
      sourceText: ":agent-command[compact|Compact] ",
      text: "",
      context: [],
      metadata: {},
      commands: [
        {
          id: "compact",
          commandId: "compact",
          label: "Compact",
          scope: "message",
          source: "agent",
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
      source: "agent",
      commandId: "compact",
      label: "Compact",
      scope: "message",
      effect: "session-action",
      status: "execution-failed",
      failureReason: "context-too-small",
    },
  ]);
  assert.deepEqual(resolved.commandResponses, [
    {
      source: "agent",
      commandId: "compact",
      label: "Compact",
      status: "execution-failed",
      failureReason: "context-too-small",
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

  const sourceText = ":agent-command[compact|Compact] ";
  const command = {
    id: "command:agent:compact:0",
    commandId: "compact",
    label: "Compact",
    scope: "message",
    source: "agent",
    args: { customInstructions: "Keep the command arguments" },
  } as const;
  const document = [
    { type: "command", ...command },
    { type: "text", text: " " },
  ] as const;
  await submitPrompt(
    host.id,
    "followUp",
    { message: "" },
    {
      rpcId: "compact-command-rpc",
      composer: {
        version: 2,
        document,
        sourceText,
        text: "",
        context: [],
        metadata: {},
        commands: [command],
      },
    },
  );

  const history = await getSessionHistory(host.id);
  const marker = history.context.messages.find(
    (message) => message.role === "custom" && message.customType === "workbench.composer-user.v3",
  );
  assert.ok(marker);
  if (marker.role !== "custom") assert.fail("Expected a custom Composer marker");
  assert.deepEqual(marker.details, {
    version: 3,
    submissionId: (marker.details as { submissionId: string }).submissionId,
    sourceText,
    text: "",
    document,
    commands: [command],
    composer: {
      version: 2,
      document,
      sourceText,
      text: "",
      context: [],
      metadata: {},
      commands: [command],
    },
    status: "accepted",
  });
  const response = history.context.messages.find(
    (message) =>
      message.role === "custom" && message.customType === "workbench.composer-command-response.v2",
  );
  assert.ok(response);
  if (response.role !== "custom") assert.fail("Expected a custom command response");
  assert.equal(response.display, true);
  assert.deepEqual(response.details, {
    version: 2,
    submissionId: (marker.details as { submissionId: string }).submissionId,
    source: "agent",
    commandId: "compact",
    label: "Compact",
    status: "execution-failed",
    args: { customInstructions: "Keep the command arguments" },
    failureReason: "context-too-small",
  });
  assert.equal(
    host.session.sessionManager
      .buildSessionContext()
      .messages.some(
        (message) =>
          message.role === "custom" &&
          message.customType === "workbench.composer-command-response.v2",
      ),
    false,
    "a visible command response must not become later model context",
  );
  const events = await getSessionEvents(host.id);
  assert.deepEqual(
    events.flatMap((event) => {
      const data = event.data as {
        customType?: string;
        details?: { status?: string; args?: unknown; failureReason?: string };
      };
      return event.type === "message" &&
        data.customType === "workbench.composer-command-response.v2" &&
        data.details?.status
        ? [
            {
              status: data.details.status,
              args: data.details.args,
              failureReason: data.details.failureReason,
            },
          ]
        : [];
    }),
    [
      {
        status: "running",
        args: { customInstructions: "Keep the command arguments" },
        failureReason: undefined,
      },
      {
        status: "execution-failed",
        args: { customInstructions: "Keep the command arguments" },
        failureReason: "context-too-small",
      },
    ],
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

test("keeps the model turn alive when attachment preprocessing fails", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-image-understanding-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousStateDir = process.env.PI_WORKBENCH_STATE_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  process.env.PI_WORKBENCH_STATE_DIR = path.join(root, "state");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousStateDir === undefined) delete process.env.PI_WORKBENCH_STATE_DIR;
    else process.env.PI_WORKBENCH_STATE_DIR = previousStateDir;
  });

  await getImageUnderstandingSettingsStore().update({
    patch: { routing: "always-preprocess", engine: "ocr", ocrProvider: "glm-ocr" },
  });
  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const host = await createSession(cwd, "image-understanding-missing-credential");
  const fakeAgent = host.session as unknown as {
    model?: unknown;
    modelRuntime: { getAvailableSnapshot(): unknown[] };
    prompt(
      message: string,
      options: { images?: unknown[]; preflightResult?: (accepted: boolean) => void },
    ): Promise<void>;
  };
  const originalPrompt = fakeAgent.prompt;
  const originalAvailableSnapshot = fakeAgent.modelRuntime.getAvailableSnapshot;
  let forwardedPrompt = "";
  let forwardedImages: unknown[] | undefined;
  fakeAgent.modelRuntime.getAvailableSnapshot = () =>
    fakeAgent.model === undefined ? [] : [fakeAgent.model];
  fakeAgent.prompt = async (message, options) => {
    forwardedPrompt = message;
    forwardedImages = options.images;
    options.preflightResult?.(true);
  };
  t.after(() => {
    fakeAgent.prompt = originalPrompt;
    fakeAgent.modelRuntime.getAvailableSnapshot = originalAvailableSnapshot;
    return host.shutdown();
  });

  await submitPrompt(
    host.id,
    "followUp",
    {
      message: "Read the image",
      images: [
        {
          type: "image",
          mimeType: "image/png",
          data: "iVBORw0KGgo=",
          name: "scan.png",
        },
      ],
    },
    { rpcId: "image-recognition-rpc" },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  const history = await getSessionHistory(host.id);
  const marker = history.context.messages.find(
    (message) => message.role === "custom" && message.customType === "workbench.composer-user.v3",
  );
  assert.ok(marker && marker.role === "custom");
  assert.deepEqual((marker.details as { attachments?: unknown }).attachments, [
    { data: "iVBORw0KGgo=", mimeType: "image/png", name: "scan.png" },
  ]);
  const events = await getSessionEvents(host.id);
  const recognitionStates = events.flatMap((event) => {
    const data = event.data as {
      customType?: string;
      details?: { status?: string; errorCode?: string; rpcId?: string };
    };
    return event.type === "message" &&
      data.customType === "workbench.attachment-recognition.v1" &&
      data.details?.status
      ? [data.details]
      : [];
  });
  assert.deepEqual(
    recognitionStates.map(({ status }) => status),
    ["pending", "running", "failed"],
  );
  assert.equal(recognitionStates.at(-1)?.errorCode, "preprocessor-not-configured");
  assert.equal(recognitionStates.at(-1)?.rpcId, "image-recognition-rpc");
  assert.equal(
    events.some((event) => event.type === "command_error"),
    false,
    "a recoverable attachment failure must not settle the whole prompt as failed",
  );
  assert.equal(forwardedImages, undefined, "unrecognized attachments must not reach a text model");
  assert.match(forwardedPrompt, /Read the image/);
  assert.match(forwardedPrompt, /"source":"workbench\.attachment-understanding-status"/);
  assert.match(forwardedPrompt, /"status":"failed"/);
  assert.match(forwardedPrompt, /"errorCode":"preprocessor-not-configured"/);
  assert.match(forwardedPrompt, /"attachmentId":"image-1","kind":"image","sequence":1/);
  assert.equal(forwardedPrompt.includes("iVBORw0KGgo="), false);
  assert.equal(host.isRunning, false);
  assert.equal(
    host.session.sessionManager
      .buildSessionContext()
      .messages.some(
        (message) =>
          message.role === "custom" && message.customType === "workbench.attachment-recognition.v1",
      ),
    false,
  );

  forwardedPrompt = "";
  forwardedImages = undefined;
  await submitPrompt(
    host.id,
    "followUp",
    { message: "Hello after the failed attachment" },
    { rpcId: "text-after-failed-recognition-rpc" },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(forwardedImages, undefined);
  assert.match(forwardedPrompt, /Hello after the failed attachment/);
  assert.equal(
    host.session.sessionManager
      .buildSessionContext()
      .messages.some(
        (message) =>
          message.role === "user" &&
          Array.isArray(message.content) &&
          message.content.some((part) => part.type === "image"),
      ),
    false,
    "a failed preprocessing turn must not leave a durable image in model context",
  );
});

test("bypasses attachment understanding for model-native image inputs", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-native-image-references-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousStateDir = process.env.PI_WORKBENCH_STATE_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  process.env.PI_WORKBENCH_STATE_DIR = path.join(root, "state");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousStateDir === undefined) delete process.env.PI_WORKBENCH_STATE_DIR;
    else process.env.PI_WORKBENCH_STATE_DIR = previousStateDir;
  });

  await getImageUnderstandingSettingsStore().update({ patch: { routing: "native-only" } });
  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const host = await createSession(cwd, "native-image-references");
  const fakeAgent = host.session as unknown as {
    model?: { provider: string; id: string; input: readonly string[] } & Record<string, unknown>;
    modelRuntime: { getAvailableSnapshot(): unknown[] };
    prompt(
      message: string,
      options: { images?: unknown[]; preflightResult?: (accepted: boolean) => void },
    ): Promise<void>;
  };
  const originalModel = fakeAgent.model;
  const originalPrompt = fakeAgent.prompt;
  const originalAvailableSnapshot = fakeAgent.modelRuntime.getAvailableSnapshot;
  assert.ok(originalModel);
  const visionModel = { ...originalModel, input: ["text", "image"] };
  Object.defineProperty(fakeAgent, "model", { configurable: true, value: visionModel });
  fakeAgent.modelRuntime.getAvailableSnapshot = () => [visionModel];
  let forwardedPrompt = "";
  let forwardedImages: unknown[] | undefined;
  fakeAgent.prompt = async (message, options) => {
    forwardedPrompt = message;
    forwardedImages = options.images;
    options.preflightResult?.(true);
  };
  t.after(async () => {
    Reflect.deleteProperty(fakeAgent, "model");
    fakeAgent.prompt = originalPrompt;
    fakeAgent.modelRuntime.getAvailableSnapshot = originalAvailableSnapshot;
    await host.shutdown();
  });

  const admission = await submitPrompt(
    host.id,
    "followUp",
    {
      message: "Compare image one with image two",
      images: [
        { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=", name: "one.png" },
        { type: "image", mimeType: "image/jpeg", data: "/9j/", name: "two.jpg" },
      ],
    },
    {
      rpcId: "native-image-reference-rpc",
      composer: {
        version: 2,
        document: [{ type: "text", text: "Compare image one with image two" }],
        sourceText: "Compare image one with image two",
        text: "Compare image one with image two",
        context: [],
        metadata: {},
        commands: [],
      },
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(admission, { queued: false });
  assert.equal(forwardedImages?.length, 2);
  assert.match(forwardedPrompt, /"attachmentId":"image-1","kind":"image","sequence":1/);
  assert.match(forwardedPrompt, /"attachmentId":"image-2","kind":"image","sequence":2/);
  const recognitionStates = (await getSessionEvents(host.id)).flatMap((event) => {
    const data = event.data as { customType?: string; details?: { status?: string } };
    return event.type === "message" &&
      data.customType === "workbench.attachment-recognition.v1" &&
      data.details?.status
      ? [data.details.status]
      : [];
  });
  assert.deepEqual(recognitionStates, []);
});

test("records a durable in-thread failure when a text-only model receives a native image", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-native-image-unsupported-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousStateDir = process.env.PI_WORKBENCH_STATE_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  process.env.PI_WORKBENCH_STATE_DIR = path.join(root, "state");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousStateDir === undefined) delete process.env.PI_WORKBENCH_STATE_DIR;
    else process.env.PI_WORKBENCH_STATE_DIR = previousStateDir;
  });

  await getImageUnderstandingSettingsStore().update({ patch: { routing: "native-only" } });
  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const host = await createSession(cwd, "native-image-unsupported");
  const fakeAgent = host.session as unknown as {
    model?: { provider: string; id: string; input: readonly string[] } & Record<string, unknown>;
    modelRuntime: { getAvailableSnapshot(): unknown[] };
    prompt(
      message?: string,
      options?: { images?: unknown[]; preflightResult?: (accepted: boolean) => void },
    ): Promise<void>;
  };
  const originalPrompt = fakeAgent.prompt;
  const originalAvailableSnapshot = fakeAgent.modelRuntime.getAvailableSnapshot;
  assert.ok(fakeAgent.model);
  const textModel = { ...fakeAgent.model, input: ["text"] };
  Object.defineProperty(fakeAgent, "model", { configurable: true, value: textModel });
  fakeAgent.modelRuntime.getAvailableSnapshot = () => [textModel];
  let providerCalled = false;
  fakeAgent.prompt = async () => {
    providerCalled = true;
  };
  t.after(async () => {
    Reflect.deleteProperty(fakeAgent, "model");
    fakeAgent.prompt = originalPrompt;
    fakeAgent.modelRuntime.getAvailableSnapshot = originalAvailableSnapshot;
    await host.shutdown();
  });

  const admission = await submitPrompt(
    host.id,
    "followUp",
    {
      message: "Read the image natively",
      images: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }],
    },
    {
      rpcId: "native-image-unsupported-rpc",
      composer: {
        version: 2,
        document: [{ type: "text", text: "Read the image natively" }],
        sourceText: "Read the image natively",
        text: "Read the image natively",
        context: [],
        metadata: {},
        commands: [],
      },
    },
  );

  assert.deepEqual(admission, { queued: false });
  assert.equal(providerCalled, false, "an unsupported native image must not reach Pi");

  const history = await getSessionHistory(host.id);
  const composerUser = history.context.messages.find(
    (message) => message.role === "custom" && message.customType === "workbench.composer-user.v3",
  );
  const promptFailure = history.context.messages.find(
    (message) => message.role === "custom" && message.customType === "workbench.prompt-failure.v1",
  );
  assert.equal(composerUser?.role, "custom");
  assert.equal(promptFailure?.role, "custom");
  let persistedUserEntryId: string | undefined;
  if (composerUser?.role === "custom" && promptFailure?.role === "custom") {
    const composerDetails = composerUser.details as { submissionId?: unknown };
    const failureDetails = promptFailure.details as {
      version?: unknown;
      submissionId?: unknown;
      code?: unknown;
      rpcId?: unknown;
      userEntryId?: unknown;
    };
    assert.equal(failureDetails.version, 1);
    assert.equal(failureDetails.submissionId, composerDetails.submissionId);
    assert.equal(typeof failureDetails.submissionId, "string");
    assert.equal(failureDetails.code, "image-input-unsupported");
    assert.equal(failureDetails.rpcId, "native-image-unsupported-rpc");
    const composerIndex = history.context.messages.indexOf(composerUser);
    assert.equal(failureDetails.userEntryId, history.context.entryIds?.[composerIndex]);
    if (typeof failureDetails.userEntryId === "string") {
      persistedUserEntryId = failureDetails.userEntryId;
    }
  }

  const events = await getSessionEvents(host.id);
  const recognitionStates = events.flatMap((event) => {
    const data = event.data as { customType?: string; details?: { status?: string } };
    return event.type === "message" &&
      data.customType === "workbench.attachment-recognition.v1" &&
      data.details?.status
      ? [data.details.status]
      : [];
  });
  assert.deepEqual(recognitionStates, []);
  assert.equal(
    events.some((event) => {
      const data = event.data as {
        customType?: string;
        message?: { role?: string; customType?: string };
      };
      return (
        (event.type === "message" && data.customType === "workbench.prompt-failure.v1") ||
        (event.type === "message_end" &&
          data.message?.role === "custom" &&
          data.message.customType === "workbench.prompt-failure.v1")
      );
    }),
    true,
  );

  assert.ok(persistedUserEntryId);
  await regenerateSession(host.id, persistedUserEntryId, "native-image-still-unsupported-rpc");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(providerCalled, false);
  assert.equal(
    host.session.sessionManager
      .getEntries()
      .filter(
        (entry) =>
          entry.type === "custom_message" && entry.customType === "workbench.composer-user.v3",
      ).length,
    1,
  );
  const retryFailures = host.session.sessionManager
    .getEntries()
    .filter(
      (entry) =>
        entry.type === "custom_message" && entry.customType === "workbench.prompt-failure.v1",
    );
  assert.equal(retryFailures.length, 2);
  assert.equal(
    retryFailures.every(
      (entry) =>
        entry.type === "custom_message" &&
        (entry.details as { userEntryId?: unknown }).userEntryId === persistedUserEntryId,
    ),
    true,
  );

  const visionModel = { ...textModel, input: ["text", "image"] };
  Object.defineProperty(fakeAgent, "model", { configurable: true, value: visionModel });
  fakeAgent.modelRuntime.getAvailableSnapshot = () => [visionModel];
  let retriedImages: unknown[] | undefined;
  fakeAgent.prompt = async (_message, options) => {
    providerCalled = true;
    retriedImages = options?.images;
    options?.preflightResult?.(true);
  };

  await regenerateSession(host.id, persistedUserEntryId, "native-image-unsupported-retry-rpc");
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(providerCalled, true);
  assert.equal(retriedImages?.length, 1);
  const persistedComposerUsers = host.session.sessionManager
    .getEntries()
    .filter(
      (entry) =>
        entry.type === "custom_message" && entry.customType === "workbench.composer-user.v3",
    );
  assert.equal(
    persistedComposerUsers.length,
    1,
    "retry must reuse the original user node so only assistant answers branch",
  );
  assert.equal(persistedComposerUsers[0]?.id, persistedUserEntryId);
});

test("injects image and PDF OCR as isolated context without forwarding attachments to the text model", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-image-understanding-success-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousStateDir = process.env.PI_WORKBENCH_STATE_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  process.env.PI_WORKBENCH_STATE_DIR = path.join(root, "state");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousStateDir === undefined) delete process.env.PI_WORKBENCH_STATE_DIR;
    else process.env.PI_WORKBENCH_STATE_DIR = previousStateDir;
  });

  const credential = "private-glm-credential";
  await getImageUnderstandingSettingsStore().update({
    patch: {
      routing: "always-preprocess",
      engine: "ocr",
      ocrProvider: "glm-ocr",
      glm: {
        endpoint: "https://ocr.example/layout",
        model: "glm-ocr",
        apiKey: credential,
      },
    },
  });

  const originalFetch = globalThis.fetch;
  const submittedFiles: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://ocr.example/layout");
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${credential}`);
    const body = JSON.parse(String(init?.body)) as { file?: string; model?: string };
    assert.equal(body.model, "glm-ocr");
    assert.ok(body.file);
    submittedFiles.push(body.file);
    if (body.file.startsWith("data:application/pdf;base64,")) {
      return new Response(JSON.stringify({ md_results: "PDF reference: A-17" }));
    }
    assert.match(body.file, /^data:image\/png;base64,/);
    return new Response(JSON.stringify({ md_results: "Image total: 42" }));
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const host = await createSession(cwd, "image-understanding-success");
  const fakeAgent = host.session as unknown as {
    model?: unknown;
    modelRuntime: { getAvailableSnapshot(): unknown[] };
    prompt(
      message: string,
      options: {
        images?: unknown[];
        preflightResult?: (accepted: boolean) => void;
      },
    ): Promise<void>;
  };
  const originalPrompt = fakeAgent.prompt;
  const originalAvailableSnapshot = fakeAgent.modelRuntime.getAvailableSnapshot;
  let forwardedPrompt = "";
  let forwardedImages: unknown[] | undefined;
  fakeAgent.modelRuntime.getAvailableSnapshot = () =>
    fakeAgent.model === undefined ? [] : [fakeAgent.model];
  fakeAgent.prompt = async (message, options) => {
    forwardedPrompt = message;
    forwardedImages = options.images;
    options.preflightResult?.(true);
  };
  t.after(() => {
    fakeAgent.prompt = originalPrompt;
    fakeAgent.modelRuntime.getAvailableSnapshot = originalAvailableSnapshot;
    return host.shutdown();
  });

  const admission = await submitPrompt(
    host.id,
    "followUp",
    {
      message: "Read the invoice",
      images: [
        {
          type: "image",
          mimeType: "image/png",
          data: "iVBORw0KGgo=",
          name: "invoice.png",
        },
      ],
      documents: [
        {
          type: "file",
          mimeType: "application/pdf",
          data: Buffer.from("%PDF-1.7\ninvoice fixture").toString("base64"),
          name: "invoice.pdf",
        },
      ],
    },
    {
      rpcId: "image-recognition-success-rpc",
      composer: {
        version: 2,
        document: [{ type: "text", text: "Read the invoice" }],
        sourceText: "Read the invoice",
        text: "Read the invoice",
        context: [],
        metadata: {},
        commands: [],
      },
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(admission, { queued: false });
  assert.equal(forwardedImages, undefined, "a text-model prompt must not retain attachment parts");
  assert.match(forwardedPrompt, /<workbench-untrusted-context>/);
  assert.match(forwardedPrompt, /"source":"workbench\.attachment-references"/);
  assert.match(forwardedPrompt, /"attachmentId":"image-1","kind":"image","sequence":1/);
  assert.match(forwardedPrompt, /"attachmentId":"pdf-1","kind":"pdf","sequence":1/);
  assert.match(forwardedPrompt, /Image total: 42/);
  assert.match(forwardedPrompt, /PDF reference: A-17/);
  assert.match(forwardedPrompt, /Read the invoice/);
  assert.equal(forwardedPrompt.includes(credential), false);
  assert.deepEqual(
    submittedFiles.map((file) => file.slice(5, file.indexOf(";"))),
    ["image/png", "application/pdf"],
  );

  const events = await getSessionEvents(host.id);
  const recognitionStates = events.flatMap((event) => {
    const data = event.data as {
      customType?: string;
      details?: {
        status?: string;
        stage?: string;
        rpcId?: string;
        results?: unknown;
      };
    };
    return event.type === "message" &&
      data.customType === "workbench.attachment-recognition.v1" &&
      data.details?.status
      ? [data.details]
      : [];
  });
  assert.deepEqual(
    recognitionStates.map(({ status, stage }) => ({ status, stage })),
    [
      { status: "pending", stage: undefined },
      { status: "running", stage: "routing" },
      { status: "running", stage: "submitting" },
      { status: "running", stage: "recognizing" },
      { status: "running", stage: "normalizing" },
      { status: "succeeded", stage: undefined },
    ],
  );
  assert.equal(recognitionStates.at(-1)?.rpcId, "image-recognition-success-rpc");
  assert.deepEqual(recognitionStates.at(-1)?.results, [
    {
      attachmentId: "image-1",
      format: "markdown",
      text: "Image total: 42",
    },
    {
      attachmentId: "pdf-1",
      format: "markdown",
      text: "PDF reference: A-17",
    },
  ]);
  assert.equal(JSON.stringify(recognitionStates).includes(credential), false);
});

test("routes exported sendPrompt images through recognition before calling a text-only agent", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-legacy-direct-image-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousStateDir = process.env.PI_WORKBENCH_STATE_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  process.env.PI_WORKBENCH_STATE_DIR = path.join(root, "state");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousStateDir === undefined) delete process.env.PI_WORKBENCH_STATE_DIR;
    else process.env.PI_WORKBENCH_STATE_DIR = previousStateDir;
  });

  await getImageUnderstandingSettingsStore().update({
    patch: {
      routing: "always-preprocess",
      engine: "ocr",
      ocrProvider: "glm-ocr",
      glm: { apiKey: "legacy-direct-private-credential" },
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ md_results: "Recognized by the legacy direct path" }));
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const host = await createSession(cwd, "legacy-direct-image");
  const fakeAgent = host.session as unknown as {
    model?: { input?: string[] };
    modelRuntime: { getAvailableSnapshot(): unknown[] };
    prompt(
      message: string,
      options: {
        images?: unknown[];
        preflightResult?: (accepted: boolean) => void;
      },
    ): Promise<void>;
    followUp(message: string, images?: unknown[]): Promise<void>;
  };
  assert.equal(fakeAgent.model?.input?.includes("image") ?? false, false);
  const originalPrompt = fakeAgent.prompt;
  const originalFollowUp = fakeAgent.followUp;
  const originalAvailableSnapshot = fakeAgent.modelRuntime.getAvailableSnapshot;
  let releaseRun: (() => void) | undefined;
  let forwardedPrompt = "";
  let forwardedImages: unknown[] | undefined;
  fakeAgent.modelRuntime.getAvailableSnapshot = () =>
    fakeAgent.model === undefined ? [] : [fakeAgent.model];
  fakeAgent.prompt = async (message, options) => {
    forwardedPrompt = message;
    forwardedImages = options.images;
    options.preflightResult?.(true);
  };
  t.after(() => {
    releaseRun?.();
    fakeAgent.prompt = originalPrompt;
    fakeAgent.followUp = originalFollowUp;
    fakeAgent.modelRuntime.getAvailableSnapshot = originalAvailableSnapshot;
    return host.shutdown();
  });

  await sendPrompt(host.id, "Read this legacy image", [
    {
      type: "image",
      mimeType: "image/png",
      data: "iVBORw0KGgo=",
      name: "legacy.png",
    },
  ]);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(forwardedImages, undefined, "the text-only agent must never receive image parts");
  assert.match(forwardedPrompt, /Recognized by the legacy direct path/);
  assert.match(forwardedPrompt, /Read this legacy image/);
  const recognitionStates = (await getSessionEvents(host.id)).flatMap((event) => {
    const data = event.data as {
      customType?: string;
      details?: { status?: string };
    };
    return event.type === "message" &&
      data.customType === "workbench.attachment-recognition.v1" &&
      data.details?.status
      ? [data.details.status]
      : [];
  });
  assert.deepEqual(recognitionStates, [
    "pending",
    "running",
    "running",
    "running",
    "running",
    "succeeded",
  ]);

  let queuedPrompt = "";
  let queuedImages: unknown[] | undefined;
  fakeAgent.prompt = async (_message, options) => {
    options.preflightResult?.(true);
    await new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
  };
  fakeAgent.followUp = async (message, images) => {
    queuedPrompt = message;
    queuedImages = images;
  };
  await sendPrompt(host.id, "Hold an active text-only turn");
  await queuePrompt(host.id, "followUp", {
    message: "Read this queued legacy image",
    images: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }],
  });
  assert.equal(queuedImages, undefined, "a queued text-only turn must not receive image parts");
  assert.match(queuedPrompt, /Recognized by the legacy direct path/);
  assert.match(queuedPrompt, /Read this queued legacy image/);
  const queuedRecognitionStates = (await getSessionEvents(host.id)).flatMap((event) => {
    const data = event.data as {
      customType?: string;
      details?: { status?: string };
    };
    return event.type === "message" &&
      data.customType === "workbench.attachment-recognition.v1" &&
      data.details?.status
      ? [data.details.status]
      : [];
  });
  assert.deepEqual(queuedRecognitionStates.slice(-6), recognitionStates);
  releaseRun?.();
});

test("rejects image-bearing legacy queue snapshots before mutating a text-only agent queue", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-legacy-image-queue-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const host = await createSession(cwd, "legacy-image-queue");
  const fakeAgent = host.session as unknown as {
    model?: { input?: string[] };
    modelRuntime: { getAvailableSnapshot(): unknown[] };
    prompt(
      message: string,
      options: { preflightResult?: (accepted: boolean) => void },
    ): Promise<void>;
  };
  const originalAvailableSnapshot = fakeAgent.modelRuntime.getAvailableSnapshot;
  const originalPrompt = fakeAgent.prompt;
  let releaseRun: (() => void) | undefined;
  fakeAgent.modelRuntime.getAvailableSnapshot = () =>
    fakeAgent.model === undefined ? [] : [fakeAgent.model];
  fakeAgent.prompt = async (_message, options) => {
    options.preflightResult?.(true);
    await new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
  };
  t.after(() => {
    releaseRun?.();
    fakeAgent.prompt = originalPrompt;
    fakeAgent.modelRuntime.getAvailableSnapshot = originalAvailableSnapshot;
    return host.shutdown();
  });
  const model = fakeAgent.model;
  assert.equal(model?.input?.includes("image") ?? false, false);
  const imagePrompt = {
    message: "queued image",
    images: [{ type: "image" as const, mimeType: "image/png", data: "iVBORw0KGgo=" }],
  };
  const rejectedWithoutMutation = async (operation: () => Promise<void>) => {
    await assert.rejects(operation(), {
      code: "pi_model_image_unsupported",
      status: 400,
    });
    assert.deepEqual(host.steeringMessages, []);
    assert.deepEqual(host.followUpMessages, []);
  };

  await rejectedWithoutMutation(() => replacePromptQueue(host.id, [], [imagePrompt]));
  await rejectedWithoutMutation(() => setPromptQueuePaused(host.id, true, [], [imagePrompt]));
  await rejectedWithoutMutation(() => steerQueuedPrompt(host.id, imagePrompt, [], []));

  await submitPrompt(host.id, "followUp", { message: "hold the active run" });
  const queued = await submitPrompt(
    host.id,
    "followUp",
    { message: "safe queued text" },
    { rpcId: "legacy-image-edit" },
  );
  assert.deepEqual(queued, { queued: true, queueItemId: "legacy-image-edit" });
  await assert.rejects(
    updatePromptQueueItem(host.id, "legacy-image-edit", {
      kind: "edit",
      prompt: imagePrompt,
    }),
    { code: "pi_model_image_unsupported", status: 400 },
  );
  assert.equal(host.followUpMessages.includes("safe queued text"), true);
  assert.equal(host.followUpMessages.includes("queued image"), false);
  releaseRun?.();
});

test("continues text-only prompts while retaining native image history for the UI", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-native-image-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const host = await createSession(cwd, "native-image-history");
  host.session.sessionManager.appendMessage({
    role: "user",
    content: [
      { type: "text", text: "Previous native image" },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ],
    timestamp: Date.now(),
  });
  const fakeAgent = host.session as unknown as {
    model?: { provider: string; id: string; input: string[] };
    modelRuntime: { getAvailableSnapshot(): unknown[] };
    prompt(
      message: string,
      options: { preflightResult?: (accepted: boolean) => void },
    ): Promise<void>;
    setModel(model: { provider: string; id: string; input: string[] }): Promise<void>;
  };
  const originalAvailableSnapshot = fakeAgent.modelRuntime.getAvailableSnapshot;
  const originalPrompt = fakeAgent.prompt;
  const originalSetModel = fakeAgent.setModel;
  const selectedTextModel = {
    provider: "test-provider",
    id: "selected-text-only",
    input: ["text"],
  };
  const selectedVisionModel = {
    provider: "test-provider",
    id: "selected-vision",
    input: ["text", "image"],
  };
  fakeAgent.modelRuntime.getAvailableSnapshot = () => [
    ...(fakeAgent.model === undefined ||
    fakeAgent.model.id === selectedTextModel.id ||
    fakeAgent.model.id === selectedVisionModel.id
      ? []
      : [{ ...fakeAgent.model, input: ["text"] }]),
    selectedTextModel,
    selectedVisionModel,
  ];
  const promptContexts: unknown[][] = [];
  fakeAgent.prompt = async (_message, options) => {
    promptContexts.push(structuredClone(host.session.agent.state.messages));
    options.preflightResult?.(true);
  };
  fakeAgent.setModel = async (model) => {
    (host.session.agent.state as { model: typeof model }).model = model;
  };
  t.after(() => {
    fakeAgent.modelRuntime.getAvailableSnapshot = originalAvailableSnapshot;
    fakeAgent.prompt = originalPrompt;
    fakeAgent.setModel = originalSetModel;
    return host.shutdown();
  });

  await sendPrompt(host.id, "Continue after the image");
  await sendPrompt(host.id, "Switch and continue", undefined, {
    provider: selectedTextModel.provider,
    modelId: selectedTextModel.id,
  });

  assert.equal(promptContexts.length, 2);
  for (const context of promptContexts) {
    assert.equal(messagesHaveImages(context), false);
    assert.match(JSON.stringify(context), /Previous native image/);
    assert.match(JSON.stringify(context), /historical image 1/);
    assert.equal(JSON.stringify(context).includes("iVBORw0KGgo="), false);
  }
  assert.equal(
    messagesHaveImages(host.session.sessionManager.buildSessionContext().messages),
    true,
    "the durable history remains unchanged so the UI and future vision models keep the image",
  );

  await sendPrompt(host.id, "Switch back to vision", undefined, {
    provider: selectedVisionModel.provider,
    modelId: selectedVisionModel.id,
  });
  assert.equal(promptContexts.length, 3);
  assert.equal(messagesHaveImages(promptContexts[2] ?? []), true);
  assert.match(JSON.stringify(promptContexts[2]), /iVBORw0KGgo=/);
});

test("cancels in-flight recognition and retries it with freshly loaded routing", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-image-understanding-cancel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousStateDir = process.env.PI_WORKBENCH_STATE_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  process.env.PI_WORKBENCH_STATE_DIR = path.join(root, "state");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousStateDir === undefined) delete process.env.PI_WORKBENCH_STATE_DIR;
    else process.env.PI_WORKBENCH_STATE_DIR = previousStateDir;
  });

  await getImageUnderstandingSettingsStore().update({
    patch: {
      routing: "always-preprocess",
      engine: "ocr",
      ocrProvider: "glm-ocr",
      glm: { apiKey: "private-glm-credential" },
    },
  });

  let reportFetchStarted!: () => void;
  const fetchStarted = new Promise<void>((resolve) => {
    reportFetchStarted = resolve;
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    reportFetchStarted();
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException("aborted", "AbortError"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const host = await createSession(cwd, "image-understanding-cancel");
  const fakeAgent = host.session as unknown as {
    agent: { state: { model?: { provider: string; id: string; input: string[] } } };
    model?: { provider: string; id: string; input: string[] };
    modelRuntime: { getAvailableSnapshot(): unknown[] };
    prompt(
      message: string,
      options: {
        images?: unknown[];
        preflightResult?: (accepted: boolean) => void;
      },
    ): Promise<void>;
  };
  const originalPrompt = fakeAgent.prompt;
  const originalAvailableSnapshot = fakeAgent.modelRuntime.getAvailableSnapshot;
  fakeAgent.prompt = async () => assert.fail("cancelled recognition must not start the model");
  t.after(() => {
    fakeAgent.prompt = originalPrompt;
    fakeAgent.modelRuntime.getAvailableSnapshot = originalAvailableSnapshot;
    return host.shutdown();
  });

  const submission = submitPrompt(
    host.id,
    "followUp",
    {
      message: "Read the image",
      images: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }],
    },
    {
      rpcId: "image-recognition-cancel-rpc",
      composer: {
        version: 2,
        document: [{ type: "text", text: "Read the image" }],
        sourceText: "Read the image",
        text: "Read the image",
        context: [],
        metadata: {},
        commands: [],
      },
    },
  );
  await fetchStarted;
  await cancelSession(host.id);
  assert.deepEqual(await submission, { queued: false });

  const events = await getSessionEvents(host.id);
  const recognitionStates = events.flatMap((event) => {
    const data = event.data as {
      customType?: string;
      details?: { status?: string; rpcId?: string };
    };
    return event.type === "message" &&
      data.customType === "workbench.attachment-recognition.v1" &&
      data.details?.status
      ? [data.details]
      : [];
  });
  assert.equal(recognitionStates.at(-1)?.status, "cancelled");
  assert.equal(recognitionStates.at(-1)?.rpcId, "image-recognition-cancel-rpc");
  assert.equal(events.at(-1)?.type, "command_error");
  assert.equal(host.isRunning, false);

  const cancelledMarker = host.session.sessionManager
    .getBranch()
    .find(
      (entry) =>
        entry.type === "custom_message" && entry.customType === "workbench.composer-user.v3",
    );
  assert.ok(cancelledMarker);
  assert.ok(fakeAgent.model);
  const visionModel = { ...fakeAgent.model, input: ["text", "image"] };
  fakeAgent.modelRuntime.getAvailableSnapshot = () => [visionModel];
  fakeAgent.agent.state.model = visionModel;
  await getImageUnderstandingSettingsStore().update({ patch: { routing: "native-only" } });

  let retriedImages: unknown[] | undefined;
  fakeAgent.prompt = async (_message, options) => {
    retriedImages = options.images;
    options.preflightResult?.(true);
  };
  let retriedOcr = false;
  globalThis.fetch = async () => {
    retriedOcr = true;
    throw new Error("native retry must not call the old OCR provider");
  };

  await regenerateSession(host.id, cancelledMarker.id, "attachment-native-retry-rpc");
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(retriedOcr, false);
  assert.equal(retriedImages?.length, 1);
  const retriedRecognitionStates = (await getSessionEvents(host.id)).flatMap((event) => {
    const data = event.data as {
      customType?: string;
      details?: { status?: string; method?: string; rpcId?: string };
    };
    return event.type === "message" &&
      data.customType === "workbench.attachment-recognition.v1" &&
      data.details?.rpcId === "attachment-native-retry-rpc"
      ? [data.details]
      : [];
  });
  assert.deepEqual(retriedRecognitionStates, []);
});

test("keeps cancellation authoritative during the recognition-to-prompt handoff", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-image-handoff-cancel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousStateDir = process.env.PI_WORKBENCH_STATE_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  process.env.PI_WORKBENCH_STATE_DIR = path.join(root, "state");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousStateDir === undefined) delete process.env.PI_WORKBENCH_STATE_DIR;
    else process.env.PI_WORKBENCH_STATE_DIR = previousStateDir;
  });

  await getImageUnderstandingSettingsStore().update({
    patch: {
      routing: "always-preprocess",
      engine: "ocr",
      ocrProvider: "glm-ocr",
      glm: { apiKey: "private-glm-credential" },
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ md_results: "handoff OCR result" }));
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const host = await createSession(cwd, "image-understanding-handoff-cancel");
  let reportResolutionReached!: () => void;
  let releaseResolution!: () => void;
  const resolutionReached = new Promise<void>((resolve) => {
    reportResolutionReached = resolve;
  });
  const resolutionGate = new Promise<void>((resolve) => {
    releaseResolution = resolve;
  });
  const fakeAgent = host.session as unknown as {
    prompt(): Promise<void>;
    sendCustomMessage(
      message: { customType: string; content: unknown; display: boolean; details?: unknown },
      options?: { triggerTurn?: boolean },
    ): Promise<void>;
  };
  const originalPrompt = fakeAgent.prompt;
  const originalSendCustomMessage = fakeAgent.sendCustomMessage;
  let promptCalled = false;
  fakeAgent.prompt = async () => {
    promptCalled = true;
  };
  fakeAgent.sendCustomMessage = async (message, options) => {
    if (message.customType === "workbench.composer-resolution.v2") {
      reportResolutionReached();
      await resolutionGate;
    }
    await originalSendCustomMessage.call(host.session, message, options);
  };
  t.after(() => {
    fakeAgent.prompt = originalPrompt;
    fakeAgent.sendCustomMessage = originalSendCustomMessage;
    releaseResolution?.();
    return host.shutdown();
  });

  const submission = submitPrompt(
    host.id,
    "followUp",
    {
      message: "Read the image",
      images: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }],
    },
    {
      rpcId: "image-handoff-cancel-rpc",
      composer: {
        version: 2,
        document: [{ type: "text", text: "Read the image" }],
        sourceText: "Read the image",
        text: "Read the image",
        context: [],
        metadata: {},
        commands: [],
      },
    },
  );
  await resolutionReached;
  assert.equal(host.isRunning, false, "attachment preparation is not a Pi agent run");
  assert.equal(host.isBusy, true, "the Workbench host still owns the in-flight submission");
  const cancellation = cancelSession(host.id);
  releaseResolution();
  await Promise.all([cancellation, submission]);

  assert.equal(promptCalled, false);
  assert.equal(host.isRunning, false);
  assert.equal(host.isBusy, false);
  const events = await getSessionEvents(host.id);
  assert.equal(events.at(-1)?.type, "command_error");
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
      version: 2,
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
          source: "agent",
        },
        {
          id: "missing",
          commandId: "missing",
          label: "Missing",
          scope: "message",
          source: "agent",
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

test("discovers sibling assistant branches with stable shared user events", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-branches-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const manager = SessionManager.create(cwd, undefined, { id: "assistant-branches" });
  initializeSessionEventJournal(manager, []);
  const user = { role: "user" as const, content: "Explain branches", timestamp: 1 };
  const userEvent = appendSessionEventJournal(manager, {
    type: "message_end",
    seq: 0,
    time: 1,
    data: { message: user },
  });
  const userEntryId = manager.appendMessage(user);

  const appendAssistantBranch = (text: string, timestamp: number) => {
    const assistant = assistantMessage(text, timestamp);
    const assistantEvent = appendSessionEventJournal(manager, {
      type: "message_end",
      seq: 1,
      time: timestamp,
      data: { message: assistant },
    });
    manager.appendMessage(assistant);
    const settled = appendSessionEventJournal(manager, {
      type: "command_done",
      seq: 2,
      time: timestamp + 1,
      data: {},
    });
    return { assistantEvent, leafId: settled.entryId! };
  };

  const first = appendAssistantBranch("First answer", 2);
  manager.branch(userEntryId);
  const second = appendAssistantBranch("Second answer", 3);
  const branches = await getSessionEventBranches("assistant-branches");

  assert.equal(branches.headLeafId, second.leafId);
  assert.equal(branches.items.length, 2);
  assert.deepEqual(
    branches.items.map((branch) => branch.events[0]?.event.entryId),
    [userEvent.entryId, userEvent.entryId],
  );
  assert.deepEqual(
    new Set(branches.items.map((branch) => branch.events[1]?.event.entryId)),
    new Set([first.assistantEvent.entryId, second.assistantEvent.entryId]),
  );
});

test("projects legacy retry branches from shared Pi context entry ids", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-legacy-branches-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const manager = SessionManager.create(cwd, undefined, { id: "legacy-assistant-branches" });
  const user = { role: "user" as const, content: "Legacy question", timestamp: 1 };
  const firstAssistant = assistantMessage("First legacy answer", 2);
  const userEntryId = manager.appendMessage(user);
  const firstAssistantEntryId = manager.appendMessage(firstAssistant);
  initializeSessionEventJournal(manager, [
    { type: "message", seq: 0, time: 1, data: user },
    { type: "message", seq: 1, time: 2, data: firstAssistant },
  ]);

  manager.branch(userEntryId);
  initializeSessionEventJournal(manager, [{ type: "message", seq: 0, time: 1, data: user }]);
  const secondAssistant = assistantMessage("Second legacy answer", 3);
  appendSessionEventJournal(manager, {
    type: "message_end",
    seq: 1,
    time: 3,
    data: { message: secondAssistant },
  });
  const secondAssistantEntryId = manager.appendMessage(secondAssistant);
  appendSessionEventJournal(manager, { type: "command_done", seq: 2, time: 4, data: {} });

  const branches = await getSessionEventBranches("legacy-assistant-branches");
  assert.equal(branches.items.length, 2);
  assert.deepEqual(
    branches.items.map((branch) => branch.events[0]?.event.entryId),
    [userEntryId, userEntryId],
  );
  assert.deepEqual(
    new Set(branches.items.map((branch) => branch.events[1]?.event.entryId)),
    new Set([firstAssistantEntryId, secondAssistantEntryId]),
  );
});

test("keeps Composer correlation when branch history falls back to Pi context entries", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-composer-context-branch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const manager = SessionManager.create(cwd, undefined, { id: "composer-context-branch" });
  manager.appendCustomMessageEntry("workbench.composer-user.v2", "", false, {
    version: 2,
    submissionId: "submission-context-branch",
    sourceText: "Read the image",
    text: "Read the image",
    document: [{ type: "text", text: "Read the image" }],
    commands: [],
    composer: {
      version: 1,
      sourceText: "Read the image",
      text: "Read the image",
      document: [{ type: "text", text: "Read the image" }],
      context: [],
      metadata: {},
      commands: [],
    },
    images: [{ data: "iVBORw0KGgo=", mimeType: "image/png", name: "scan.png" }],
    status: "accepted",
  });
  manager.appendCustomEntry("workbench.attachment-recognition.v1", {
    version: 1,
    operationId: "operation-context-branch",
    submissionId: "submission-context-branch",
    revision: 1,
    status: "succeeded",
    method: "ocr",
    providerId: "glm-ocr",
    attachmentCount: 1,
    completedCount: 1,
    progress: 1,
  });
  manager.appendCustomMessageEntry("workbench.composer-resolution.v1", "", false, {
    version: 1,
    submissionId: "submission-context-branch",
    status: "resolved",
    commandTrace: [],
  });
  const compiledPrompt =
    "<workbench-untrusted-context>OCR 42</workbench-untrusted-context>\n<user-request>Read the image</user-request>";
  manager.appendMessage({ role: "user", content: compiledPrompt, timestamp: 2_000 });
  manager.appendMessage(assistantMessage("Done", 2_001));
  initializeSessionEventJournal(manager, [
    { type: "message", seq: 0, time: 2_000, data: { role: "user", content: compiledPrompt } },
  ]);

  const branches = await getSessionEventBranches("composer-context-branch");
  const userEvents = branches.items[0]?.events.filter(({ event }) => {
    const data = event.data as { role?: string };
    return event.type === "message" && data.role === "user";
  });
  assert.equal(userEvents?.length, 1);
  const projected = userEvents?.[0]?.event.data as {
    content?: string;
    workbenchComposer?: { submissionId?: string; sourceText?: string };
  };
  assert.equal(projected.content, compiledPrompt);
  assert.deepEqual(projected.workbenchComposer, {
    version: 2,
    submissionId: "submission-context-branch",
    sourceText: "Read the image",
    document: [{ type: "text", text: "Read the image" }],
    hidden: true,
  });
});

test("reconciles an interrupted image-recognition operation when a session reopens", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-interrupted-recognition-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const manager = SessionManager.create(cwd, undefined, { id: "interrupted-recognition" });
  const user = { role: "user" as const, content: "Read", timestamp: 1_000 };
  const assistant = assistantMessage("Previous answer", 1_001);
  manager.appendMessage(user);
  manager.appendMessage(assistant);
  manager.appendCustomMessageEntry("workbench.composer-user.v2", "", false, {
    version: 2,
    submissionId: "interrupted-submission",
    sourceText: "Old image request",
    text: "Old image request",
    document: [{ type: "text", text: "Old image request" }],
    commands: [],
    status: "accepted",
  });
  initializeSessionEventJournal(manager, [
    { type: "message", seq: 0, time: 1_000, data: user },
    { type: "message", seq: 1, time: 1_001, data: assistant },
    {
      type: "message",
      seq: 2,
      time: 1_002,
      data: {
        role: "custom",
        customType: "workbench.attachment-recognition.v1",
        content: "",
        display: true,
        details: {
          version: 1,
          operationId: "interrupted-operation",
          submissionId: "interrupted-submission",
          revision: 0,
          status: "pending",
          method: "ocr",
          providerId: "glm-ocr",
          attachmentCount: 1,
          completedCount: 0,
          progress: 0,
          timestamps: { createdAt: 1_002, updatedAt: 1_002 },
        },
      },
    },
  ]);

  const host = await getOrStartSession("interrupted-recognition");
  t.after(() => host.shutdown());
  const events = await getSessionEvents(host.id);
  const snapshots = events.flatMap((event) => {
    const data = event.data as {
      customType?: string;
      details?: { status?: string; stage?: string; errorCode?: string };
    };
    return event.type === "message" &&
      data.customType === "workbench.attachment-recognition.v1" &&
      data.details?.status
      ? [data.details]
      : [];
  });
  assert.deepEqual(
    snapshots.map(({ status, stage, errorCode }) => ({ status, stage, errorCode })),
    [
      { status: "pending", stage: undefined, errorCode: undefined },
      { status: "running", stage: "fallback", errorCode: undefined },
      { status: "failed", stage: undefined, errorCode: "recognition-interrupted" },
    ],
  );

  const resolutions = events.flatMap((event) => {
    const data = event.data as {
      customType?: string;
      details?: { submissionId?: string; status?: string; commandTrace?: unknown[] };
    };
    return event.type === "message" &&
      data.customType === "workbench.composer-resolution.v2" &&
      data.details?.submissionId === "interrupted-submission"
      ? [data.details]
      : [];
  });
  assert.deepEqual(resolutions, [
    {
      version: 2,
      submissionId: "interrupted-submission",
      status: "command_error",
      commandTrace: [],
    },
  ]);

  await host.shutdown();
  const sessionFile = manager.getSessionFile();
  assert.ok(sessionFile);
  const reopened = SessionManager.open(sessionFile);
  reopened.appendCustomMessageEntry("workbench.composer-user.v2", "", false, {
    version: 2,
    submissionId: "next-command-submission",
    sourceText: "New command request",
    text: "New command request",
    document: [{ type: "text", text: "New command request" }],
    commands: [],
    status: "accepted",
  });
  reopened.appendMessage({
    role: "user",
    content: "/plan New command request",
    timestamp: 2_000,
  });
  reopened.appendMessage(assistantMessage("New command answer", 2_001));
  reopened.appendCustomMessageEntry("workbench.composer-resolution.v1", "", false, {
    version: 1,
    submissionId: "next-command-submission",
    status: "completed",
    commandTrace: [],
  });

  const branches = await getSessionEventBranches("interrupted-recognition");
  const projectedNextUser = branches.items[0]?.events.find(({ event }) => {
    const data = event.data as { role?: string; content?: string };
    return (
      event.type === "message" &&
      data.role === "user" &&
      data.content === "/plan New command request"
    );
  })?.event.data as
    | {
        workbenchComposer?: { submissionId?: string; sourceText?: string };
      }
    | undefined;
  assert.deepEqual(projectedNextUser?.workbenchComposer, {
    version: 2,
    submissionId: "next-command-submission",
    sourceText: "New command request",
    document: [{ type: "text", text: "New command request" }],
    hidden: true,
  });
});

test("lists sessions by creation time instead of modified activity", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-creation-order-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const originalListAll = SessionManager.listAll;
  Object.defineProperty(SessionManager, "listAll", {
    configurable: true,
    value: async () => [
      {
        path: path.join(root, "older-active.jsonl"),
        id: "older-active",
        cwd: root,
        created: new Date("2026-01-01T00:00:00.000Z"),
        modified: new Date("2026-03-01T00:00:00.000Z"),
        messageCount: 2,
        firstMessage: "older but active",
        allMessagesText: "older but active",
      },
      {
        path: path.join(root, "newer-idle.jsonl"),
        id: "newer-idle",
        cwd: root,
        created: new Date("2026-02-01T00:00:00.000Z"),
        modified: new Date("2026-02-01T00:00:00.000Z"),
        messageCount: 0,
        firstMessage: "",
        allMessagesText: "",
      },
    ],
  });
  t.after(() => {
    Object.defineProperty(SessionManager, "listAll", {
      configurable: true,
      value: originalListAll,
    });
  });

  const listed = await listSessions();
  assert.deepEqual(
    listed.sessions.map((session) => session.id),
    ["newer-idle", "older-active"],
  );
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
    // listSessions deliberately refreshes cold files in the background. Give the filesystem scan
    // real wall-clock progress even when the full test runner is saturating the event loop.
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
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
    readonly isStreaming: boolean;
    model?: unknown;
    modelRuntime: { getAvailableSnapshot(): unknown[] };
    prompt(
      message: string,
      options: { preflightResult?: (accepted: boolean) => void },
    ): Promise<void>;
  };
  const originalPrompt = fakeAgent.prompt;
  const originalAvailableSnapshot = fakeAgent.modelRuntime.getAvailableSnapshot;
  const originalIsStreaming = Object.getOwnPropertyDescriptor(fakeAgent, "isStreaming");
  let piStreaming = false;
  Object.defineProperty(fakeAgent, "isStreaming", {
    configurable: true,
    get: () => piStreaming,
  });
  fakeAgent.modelRuntime.getAvailableSnapshot = () =>
    fakeAgent.model === undefined ? [] : [fakeAgent.model];
  fakeAgent.prompt = async (_message, options) => {
    piStreaming = true;
    options.preflightResult?.(true);
    await new Promise<void>((resolve) => {
      releaseRun = () => {
        piStreaming = false;
        resolve();
      };
    });
  };
  t.after(() => {
    fakeAgent.prompt = originalPrompt;
    fakeAgent.modelRuntime.getAvailableSnapshot = originalAvailableSnapshot;
    if (originalIsStreaming) {
      Object.defineProperty(fakeAgent, "isStreaming", originalIsStreaming);
    } else {
      delete (fakeAgent as { isStreaming?: boolean }).isStreaming;
    }
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

  await updatePromptQueueItem(host.id, "cancelled-follow-up-rpc", { kind: "remove" });
  const cancelledAdmission = await submitPrompt(
    host.id,
    "followUp",
    { message: "must never be consumed" },
    { rpcId: "cancelled-follow-up-rpc" },
  );
  assert.deepEqual(cancelledAdmission, { queued: false });
  assert.equal(host.followUpMessages.includes("must never be consumed"), false);

  const admission = muxFrames.find(
    (frame) =>
      frame.rpcId === "prompt-http-rpc" && frame.payload.type === "session/prompt-accepted",
  );
  assert.ok(admission);
  assert.equal(admission.rpcId, "prompt-http-rpc");
  if (admission.payload.type !== "session/prompt-accepted") {
    assert.fail("Expected a session/prompt-accepted payload.");
  }
  assert.equal(admission.payload.sessionId, host.id);
  assert.equal(admission.payload.mode, "queue");
  assert.equal(admission.payload.running, true);
  assert.equal(typeof admission.payload.runTiming?.startedAt, "number");
  assert.equal(typeof admission.payload.runTiming?.elapsedMs, "number");
  const runningSummary = (await listSessions()).sessions.find((session) => session.id === host.id);
  assert.equal(runningSummary?.running, true);
  assert.equal(runningSummary?.runTiming?.startedAt, admission.payload.runTiming?.startedAt);
  assert.equal(typeof runningSummary?.runTiming?.elapsedMs, "number");
  const queueFrame = muxFrames.find(
    (frame) =>
      frame.payload.type === "session/queue" &&
      frame.payload.items.some((item) => item.id === "follow-up-http-rpc"),
  );
  assert.ok(queueFrame);
  releaseRun();
});

test("publishes a background prompt user message over mux and waits for its assistant turn", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-background-prompt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const hub = createStreamHub({ createRpcId: () => "background-prompt-rpc" });
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

  const host = await createSession(cwd, "background-prompt");
  const fakeAgent = host.session as unknown as {
    model?: unknown;
    modelRuntime: { getAvailableSnapshot(): unknown[] };
    prompt(
      message: string,
      options: { preflightResult?: (accepted: boolean) => void },
    ): Promise<void>;
    _handleAgentEvent(event: Record<string, unknown>): Promise<void>;
  };
  const originalPrompt = fakeAgent.prompt;
  const originalAvailableSnapshot = fakeAgent.modelRuntime.getAvailableSnapshot;
  fakeAgent.modelRuntime.getAvailableSnapshot = () =>
    fakeAgent.model === undefined ? [] : [fakeAgent.model];

  let userPublished!: () => void;
  const userWasPublished = new Promise<void>((resolve) => {
    userPublished = resolve;
  });
  let releaseRun!: () => void;
  const runCanFinish = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  fakeAgent.prompt = async (message, options) => {
    options.preflightResult?.(true);
    const timestamp = Date.now();
    const userMessage = {
      role: "user",
      content: [{ type: "text", text: message }],
      timestamp,
    };
    await fakeAgent._handleAgentEvent({ type: "agent_start" });
    await fakeAgent._handleAgentEvent({ type: "message_start", message: userMessage });
    await fakeAgent._handleAgentEvent({ type: "message_end", message: userMessage });
    userPublished();
    await runCanFinish;
    const assistant = assistantMessage("Automation complete", timestamp + 1);
    await fakeAgent._handleAgentEvent({ type: "message_start", message: assistant });
    await fakeAgent._handleAgentEvent({ type: "message_end", message: assistant });
    await fakeAgent._handleAgentEvent({ type: "agent_end", messages: [assistant] });
    await fakeAgent._handleAgentEvent({ type: "agent_settled" });
  };
  t.after(() => {
    fakeAgent.prompt = originalPrompt;
    fakeAgent.modelRuntime.getAvailableSnapshot = originalAvailableSnapshot;
    releaseRun?.();
    return host.shutdown();
  });

  let completed = false;
  const run = submitPrompt(
    host.id,
    "followUp",
    { message: "Automation user prompt" },
    { rpcId: "automation-prompt-rpc" },
  )
    .then(() => host.waitForCurrentPrompt())
    .then(() => {
      completed = true;
    });
  await userWasPublished;

  assert.equal(completed, false, "the background caller must still wait for the assistant turn");
  const userEvents = muxFrames.flatMap((frame) => {
    if (frame.payload.type !== "session/event") return [];
    const data = frame.payload.event.data as { message?: { role?: string; content?: unknown } };
    return data.message?.role === "user"
      ? [{ type: frame.payload.event.type, message: data.message }]
      : [];
  });
  assert.deepEqual(
    userEvents.map((event) => event.type),
    ["message_start", "message_end"],
  );
  assert.deepEqual(userEvents.at(-1)?.message.content, [
    { type: "text", text: "Automation user prompt" },
  ]);
  assert.equal(
    muxFrames.some(
      (frame) =>
        frame.rpcId === "automation-prompt-rpc" && frame.payload.type === "session/prompt-accepted",
    ),
    true,
    "the automation submission must publish the standard prompt acknowledgement",
  );

  releaseRun();
  await run;
  assert.equal(completed, true);
  assert.equal(
    muxFrames.some((frame) => {
      if (frame.payload.type !== "session/event") return false;
      const data = frame.payload.event.data as { message?: { role?: string } };
      return frame.payload.event.type === "message_end" && data.message?.role === "assistant";
    }),
    true,
    "the assistant completion must use the same canonical mux stream",
  );
});

test("projects Pi running state without waiting for Workbench prompt cleanup", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-pi-authoritative-running-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const hub = createStreamHub({ createRpcId: () => "pi-authoritative-running-rpc" });
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
  const host = await createSession(cwd, "pi-authoritative-running");
  const fakeAgent = host.session as unknown as {
    readonly isStreaming: boolean;
    _emit(event: { type: "agent_start" | "agent_settled" }): void;
  };
  const hostInternals = host as unknown as { promptTask?: Promise<void> };
  const originalIsStreaming = Object.getOwnPropertyDescriptor(fakeAgent, "isStreaming");
  let piStreaming = true;
  Object.defineProperty(fakeAgent, "isStreaming", {
    configurable: true,
    get: () => piStreaming,
  });
  hostInternals.promptTask = new Promise<void>(() => undefined);
  t.after(() => {
    hostInternals.promptTask = undefined;
    if (originalIsStreaming) {
      Object.defineProperty(fakeAgent, "isStreaming", originalIsStreaming);
    } else {
      delete (fakeAgent as { isStreaming?: boolean }).isStreaming;
    }
    return host.shutdown();
  });

  fakeAgent._emit({ type: "agent_start" });
  assert.equal(host.isRunning, true);
  assert.equal(host.isBusy, true);

  piStreaming = false;
  fakeAgent._emit({ type: "agent_settled" });

  assert.equal(host.isRunning, false);
  assert.equal(host.isBusy, true, "Workbench cleanup remains pending after Pi has settled");
  const listed = (await listSessions()).sessions.find((session) => session.id === host.id);
  assert.equal(listed?.running, false);
  assert.equal(listed?.runTiming, undefined);
  assert.deepEqual(
    hostFrames.flatMap((frame) =>
      frame.payload.type === "host/session-status" && frame.payload.sessionId === host.id
        ? [frame.payload.running]
        : [],
    ),
    [true, false],
  );
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

test("keeps legacy updates cumulative while mux deltas and the durable journal stay linear", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-transient-message-updates-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const hub = createStreamHub({ createRpcId: () => "transient-update-rpc" });
  const globals = globalThis as unknown as Record<PropertyKey, unknown>;
  const previousHub = globals[STREAM_HUB_SYMBOL];
  globals[STREAM_HUB_SYMBOL] = hub;
  t.after(() => {
    if (previousHub === undefined) delete globals[STREAM_HUB_SYMBOL];
    else globals[STREAM_HUB_SYMBOL] = previousHub;
  });

  const muxFrames: ServerRequest<MuxStreamPayload>[] = [];
  const muxSubscription = hub.subscribe("mux", {
    onFrame: (frame) => muxFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => muxSubscription.close());
  await muxSubscription.ready;

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const host = await createSession(cwd, "transient-message-updates");
  t.after(() => host.shutdown());
  const legacyEvents: Array<{ type: string; sequence?: number; [key: string]: unknown }> = [];
  const unsubscribeLegacy = host.subscribe((event) => legacyEvents.push(event));
  t.after(() => {
    unsubscribeLegacy();
  });
  muxFrames.length = 0;

  const eventSink = host.session as unknown as {
    _handleAgentEvent(event: Record<string, unknown>): Promise<void>;
  };
  const startedAt = 1_725_000_000_000;
  const initialMessage = {
    ...assistantMessage("", startedAt),
    content: [],
    stopReason: "pending",
  };
  await eventSink._handleAgentEvent({ type: "message_start", message: initialMessage });
  const preTokenFrames: ServerRequest<MuxStreamPayload>[] = [];
  const preTokenReconnect = hub.subscribe("mux", {
    onFrame: (frame) => preTokenFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => preTokenReconnect.close());
  await preTokenReconnect.ready;
  const preTokenSnapshot = preTokenFrames.find(
    (frame) =>
      frame.payload.type === "session/message-snapshot" && frame.payload.sessionId === host.id,
  )?.payload;
  assert.ok(preTokenSnapshot?.type === "session/message-snapshot");
  assert.equal(preTokenSnapshot.revision, 0);
  assert.equal(preTokenSnapshot.startSeq, 0);
  assert.deepEqual(preTokenSnapshot.message.content, []);

  const chunk = "0123456789abcdef";
  const updateCount = 128;
  const emptyPartial = {
    ...assistantMessage("", startedAt),
    stopReason: "pending",
  };
  await eventSink._handleAgentEvent({
    type: "message_update",
    message: emptyPartial,
    assistantMessageEvent: {
      type: "text_start",
      contentIndex: 0,
      partial: emptyPartial,
    },
  });
  let text = "";
  for (let index = 0; index < updateCount; index += 1) {
    text += chunk;
    const partial = {
      ...assistantMessage(text, startedAt),
      stopReason: "pending",
    };
    await eventSink._handleAgentEvent({
      type: "message_update",
      message: partial,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: chunk,
        partial,
      },
    });
  }

  const activeReconnectFrames: ServerRequest<MuxStreamPayload>[] = [];
  const activeReconnect = hub.subscribe("mux", {
    onFrame: (frame) => activeReconnectFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => activeReconnect.close());
  await activeReconnect.ready;
  const activeSnapshot = activeReconnectFrames.find(
    (frame) =>
      frame.payload.type === "session/message-snapshot" && frame.payload.sessionId === host.id,
  )?.payload;
  assert.ok(activeSnapshot?.type === "session/message-snapshot");
  assert.equal(activeSnapshot.revision, updateCount + 1);
  assert.equal(activeSnapshot.startSeq, 0);
  assert.equal(activeSnapshot.message.content[0]?.type, "text");
  assert.equal(
    activeSnapshot.message.content[0]?.type === "text"
      ? activeSnapshot.message.content[0].text
      : undefined,
    text,
  );

  const finalMessage = assistantMessage(text, startedAt);
  await eventSink._handleAgentEvent({ type: "message_end", message: finalMessage });

  const durableEvents = await getSessionEvents(host.id);
  assert.deepEqual(
    durableEvents.map((event) => [event.seq, event.type]),
    [
      [0, "message_start"],
      [1, "message_end"],
    ],
  );
  assert.equal(host.currentSequence, 1);
  assert.equal(host.canonicalEvents.length, 2);
  assert.equal(
    host.session.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "custom" && entry.customType === SESSION_EVENT_CUSTOM_TYPE)
      .length,
    2,
  );
  const completionData = durableEvents[1]?.data as {
    workbenchTiming?: { firstTokenAt?: number };
  };
  assert.equal(typeof completionData.workbenchTiming?.firstTokenAt, "number");

  const legacyUpdates = legacyEvents.filter((event) => event.type === "message_update");
  assert.equal(legacyUpdates.length, updateCount + 1);
  assert.ok(legacyUpdates.every((event) => event.sequence === undefined));
  const lastLegacyMessage = legacyUpdates.at(-1)?.message as {
    content?: Array<{ type?: string; text?: string }>;
  };
  assert.equal(lastLegacyMessage.content?.[0]?.text, text);

  const transientFrames = muxFrames.filter(
    (frame) => frame.payload.type === "session/message-update",
  );
  assert.equal(transientFrames.length, updateCount + 1);
  const lastTransient = transientFrames.at(-1)?.payload;
  assert.ok(lastTransient?.type === "session/message-update");
  assert.equal(lastTransient.revision, updateCount + 1);
  assert.equal(lastTransient.startSeq, 0);
  assert.equal(lastTransient.format, "pi-messages-v1");
  assert.equal(Object.hasOwn(lastTransient.message, "content"), false);
  assert.deepEqual(lastTransient.update, {
    type: "text_delta",
    contentIndex: 0,
    delta: chunk,
  });
  assert.ok(
    transientFrames.every(
      (frame) =>
        frame.payload.type === "session/message-update" &&
        frame.payload.streamId === lastTransient.streamId &&
        !Object.hasOwn(frame.payload.message, "content") &&
        !Object.hasOwn(frame.payload.update, "partial"),
    ),
  );
  const frameSizes = transientFrames
    .filter(
      (frame) =>
        frame.payload.type === "session/message-update" &&
        frame.payload.update.type === "text_delta",
    )
    .map((frame) => Buffer.byteLength(JSON.stringify(frame.payload)));
  assert.ok(Math.max(...frameSizes) - Math.min(...frameSizes) < 16);
  const firstHalfBytes = frameSizes
    .slice(0, updateCount / 2)
    .reduce((total, size) => total + size, 0);
  const secondHalfBytes = frameSizes
    .slice(updateCount / 2)
    .reduce((total, size) => total + size, 0);
  assert.ok(secondHalfBytes <= firstHalfBytes * 1.05);

  const reconnectFrames: ServerRequest<MuxStreamPayload>[] = [];
  const reconnect = hub.subscribe("mux", {
    onFrame: (frame) => reconnectFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => reconnect.close());
  await reconnect.ready;
  assert.equal(
    reconnectFrames.some(
      (frame) =>
        frame.payload.type === "session/message-update" ||
        frame.payload.type === "session/message-snapshot",
    ),
    false,
  );
  const retained = reconnectFrames.find(
    (frame) => frame.payload.type === "session/subscribed" && frame.payload.sessionId === host.id,
  );
  assert.ok(retained?.payload.type === "session/subscribed");
  assert.equal(retained.payload.lastSeq, 1);

  const history = await getSessionHistory(host.id);
  assert.equal(history.context.messages.length, 1);
  const completedMessage = history.context.messages[0];
  assert.equal(completedMessage?.role, "assistant");
  assert.equal(
    completedMessage?.role === "assistant" && completedMessage.content[0]?.type === "text"
      ? completedMessage.content[0].text
      : undefined,
    text,
  );

  const toolStartedAt = startedAt + 10_000;
  const toolInitial = {
    ...assistantMessage("", toolStartedAt),
    content: [],
    stopReason: "pending",
  };
  await eventSink._handleAgentEvent({ type: "message_start", message: toolInitial });
  const toolStartPartial = {
    ...toolInitial,
    content: [{ type: "toolCall", id: "tool-1", name: "search", arguments: {} }],
  };
  await eventSink._handleAgentEvent({
    type: "message_update",
    message: toolStartPartial,
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 0,
      partial: toolStartPartial,
    },
  });
  const toolDeltaPartial = {
    ...toolInitial,
    content: [{ type: "toolCall", id: "tool-1", name: "search", arguments: { query: "hel" } }],
  };
  await eventSink._handleAgentEvent({
    type: "message_update",
    message: toolDeltaPartial,
    assistantMessageEvent: {
      type: "toolcall_delta",
      contentIndex: 0,
      delta: '{"query":"hel',
      partial: toolDeltaPartial,
    },
  });

  const toolReconnectFrames: ServerRequest<MuxStreamPayload>[] = [];
  const toolReconnect = hub.subscribe("mux", {
    onFrame: (frame) => toolReconnectFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => toolReconnect.close());
  await toolReconnect.ready;
  const toolSnapshot = toolReconnectFrames.find(
    (frame) =>
      frame.payload.type === "session/message-snapshot" && frame.payload.sessionId === host.id,
  )?.payload;
  assert.ok(toolSnapshot?.type === "session/message-snapshot");
  assert.notEqual(toolSnapshot.streamId, lastTransient.streamId);
  assert.equal(toolSnapshot.revision, 2);
  assert.equal(toolSnapshot.startSeq, 2);
  assert.deepEqual(toolSnapshot.toolCallJson, { "0": '{"query":"hel' });

  await renameSession(host.id, "Renamed during tool stream");
  const finalToolCall = {
    type: "toolCall" as const,
    id: "tool-1",
    name: "search",
    arguments: { query: "hello" },
  };
  const toolCompletePartial = { ...toolInitial, content: [finalToolCall] };
  await eventSink._handleAgentEvent({
    type: "message_update",
    message: toolCompletePartial,
    assistantMessageEvent: {
      type: "toolcall_delta",
      contentIndex: 0,
      delta: 'lo"}',
      partial: toolCompletePartial,
    },
  });
  const renamedReconnectFrames: ServerRequest<MuxStreamPayload>[] = [];
  const renamedReconnect = hub.subscribe("mux", {
    onFrame: (frame) => renamedReconnectFrames.push(frame),
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => renamedReconnect.close());
  await renamedReconnect.ready;
  const renamedSnapshot = renamedReconnectFrames.find(
    (frame) =>
      frame.payload.type === "session/message-snapshot" && frame.payload.sessionId === host.id,
  )?.payload;
  assert.ok(renamedSnapshot?.type === "session/message-snapshot");
  assert.equal(renamedSnapshot.startSeq, 2);
  assert.equal(renamedSnapshot.revision, 3);
  const renamedWatermark = renamedReconnectFrames.find(
    (frame) => frame.payload.type === "session/subscribed" && frame.payload.sessionId === host.id,
  )?.payload;
  assert.ok(renamedWatermark?.type === "session/subscribed");
  assert.equal(renamedWatermark.lastSeq, 3);

  await eventSink._handleAgentEvent({
    type: "message_update",
    message: toolCompletePartial,
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: finalToolCall,
      partial: toolCompletePartial,
    },
  });
  await eventSink._handleAgentEvent({
    type: "message_end",
    message: { ...toolCompletePartial, stopReason: "toolUse" },
  });
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
  const openTailAssistant = {
    ...assistantMessage("starting a tool", 4),
    content: [
      { type: "text" as const, text: "starting a tool" },
      {
        type: "toolCall" as const,
        id: "unfinished-tool",
        name: "read",
        arguments: { path: "unfinished.ts" },
      },
    ],
    stopReason: "toolUse" as const,
  };
  appendSessionEventJournal(source, {
    type: "message_start",
    seq: 9,
    time: 10,
    data: { message: openTailAssistant },
  });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 10,
    time: 11,
    data: { message: openTailAssistant },
  });
  source.appendMessage(openTailAssistant);
  source.appendCustomEntry("workbench.session-context-policy.v1", {
    version: 1,
    policy: { mode: "custom", desiredContextTokens: 80_000 },
  });

  const sourcePath = source.getSessionFile();
  assert.ok(sourcePath);
  const sourceBefore = await readFile(sourcePath, "utf8");
  const sourceLeaf = source.getLeafId();

  const anchored = createDetachedSessionFork(sourcePath, 1);
  assert.notEqual(anchored.getSessionId(), source.getSessionId());
  assert.equal(anchored.getCwd(), source.getCwd());
  assert.equal(anchored.getHeader()?.parentSession, sourcePath);
  assert.deepEqual(anchored.buildSessionContext().messages, [user, assistant]);
  const inheritedContextPolicy = anchored
    .getBranch()
    .findLast(
      (entry) =>
        entry.type === "custom" && entry.customType === "workbench.session-context-policy.v1",
    );
  assert.equal(inheritedContextPolicy?.type, "custom");
  assert.deepEqual(
    inheritedContextPolicy?.type === "custom" ? inheritedContextPolicy.data : undefined,
    { version: 1, policy: { mode: "custom", desiredContextTokens: 80_000 } },
  );
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

  const messageAnchored = createDetachedSessionFork(sourcePath, 10);
  assert.deepEqual(messageAnchored.buildSessionContext().messages, [
    user,
    assistant,
    openTailUser,
    openTailAssistant,
  ]);
  const messageAnchoredTail = messageAnchored.getLeafEntry();
  assert.equal(messageAnchoredTail?.type, "custom");
  if (messageAnchoredTail?.type === "custom") {
    const event = (messageAnchoredTail.data as { event?: Record<string, unknown> }).event;
    assert.equal(event?.type, "session_forked");
    assert.equal(event?.seq, 11);
    assert.deepEqual(event?.data, { sourceSessionId: "fork-source", sourceEventSeq: 10 });
  }

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
  assert.equal(event?.seq, 7);
  assert.deepEqual(event?.data, {
    sourceSessionId: "fork-custom-source",
    sourceEventSeq: 6,
  });
});

test("rejects in-log anchors without a reliably persisted message boundary", async (t) => {
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

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Type } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai/providers/faux";

import { convertToLlm, detectCacheMiss, SessionManager } from "@earendil-works/pi-coding-agent";

import type {
  HostStreamPayload,
  MuxStreamPayload,
  ServerRequest,
} from "@workbench/agent-runtime-pi-protocol/stream";

const {
  cancelSession,
  compactAssistantMessageUpdate,
  createScratchSession,
  createSession,
  createDetachedSessionFork,
  forkSession,
  getLoadedSessions,
  getSessionEventBranches,
  getSessionEvents,
  getSessionHistory,
  getSessionResumeState,
  getOrStartSession,
  getScratchSessionRecord,
  listSessions,
  messagesHaveImages,
  promoteScratchSession,
  regenerateSession,
  renameSession,
  replacePromptQueue,
  releaseScratchSession,
  resolveWorkbenchComposerCommands,
  selectSessionModel,
  sendPrompt,
  SerializedSessionMutations,
  sessionModifiedAt,
  setPromptQueuePaused,
  steerQueuedPrompt,
  submitPrompt,
  textOnlyModelContext,
  updatePromptQueueItem,
} = (await import(
  new URL("../../src/sessions/session-registry.ts", import.meta.url).href
)) as typeof import("../../src/sessions/session-registry");
const { appendSessionEventJournal, initializeSessionEventJournal, SESSION_EVENT_CUSTOM_TYPE } =
  (await import(
    new URL("../../src/sessions/session-event-journal.ts", import.meta.url).href
  )) as typeof import("../../src/sessions/session-event-journal");
const { createStreamHub, STREAM_HUB_SYMBOL } = (await import(
  new URL("../../src/streams/stream-hub.ts", import.meta.url).href
)) as typeof import("../../src/streams/stream-hub");
import { createWorkspaceFileService } from "@workbench/workspace-server/files";
import {
  bindPiAgentHostBindings,
  getPiAgentHostBindings,
} from "../../src/agent-runtime/pi-agent-host-bindings";
import { resolvePiWorkspaceRoot } from "../../src/workspaces/workspace-service-bindings";
import { projectPiComposerContext } from "../../src/internal-extensions/composer-context";
import { createPiAutomationRuntimeBindings } from "../../src/automations/pi-automation-service";
import { getWorkspaceStore } from "../../src/workspaces/workspace-registry";

bindPiAgentHostBindings({
  workspaceFiles: createWorkspaceFileService({ resolveWorkspaceRoot: resolvePiWorkspaceRoot }),
});

test("AgentSession tools and prompt share one shell snapshot across reload and cold reopen", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-shell-"));
  const agentDir = path.join(root, "agent");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousStateDir = process.env.PI_WORKBENCH_STATE_DIR;
  const bindings = getPiAgentHostBindings();
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_WORKBENCH_STATE_DIR = path.join(root, "state");
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, "SYSTEM.md"), "{{pi.terminal_environment}}");
  const hosts: Awaited<ReturnType<typeof createSession>>[] = [];
  t.after(async () => {
    for (const host of hosts) await host.shutdown();
    bindPiAgentHostBindings(bindings);
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousStateDir === undefined) delete process.env.PI_WORKBENCH_STATE_DIR;
    else process.env.PI_WORKBENCH_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  });
  let defaultShell = "/bin/bash";
  let enhancedSearch = false;
  const chosen: string[] = [];
  bindPiAgentHostBindings({
    ...bindings,
    getDefaultTerminalShell: () => defaultShell,
    readSessionPreferences: async () => ({ enhancedSearch, retainAllModelIO: false }),
    createBashToolOverride: ({ shellPath }) => {
      chosen.push(shellPath!);
      return {
        name: "bash",
        label: "Bash",
        description: "Test shell snapshot",
        parameters: Type.Object({}),
        async execute() {
          return { content: [{ type: "text", text: shellPath! }], details: {} };
        },
      };
    },
  });
  const first = await createSession(root, "shell-first");
  hosts.push(first);
  const runBash = async (host: typeof first) => {
    const tool = host.session.agent.state.tools.find((tool) => tool.name === "bash");
    assert.ok(tool);
    return (await tool.execute("shell-probe", {}, undefined)).content;
  };
  defaultShell = "/bin/sh";
  enhancedSearch = true;
  const second = await createSession(root, "shell-second");
  hosts.push(second);
  await first.session.reload();
  assert.equal(first.workbenchToolSources.get("bash"), "workbench.terminal");
  assert.equal(first.workbenchToolSources.has("grep"), false);
  assert.equal(second.workbenchToolSources.get("grep"), "workbench.enhanced-search");
  first.session.setActiveToolsByName(["bash"]);
  assert.match(first.session.systemPrompt, /shell: \/bin\/bash/);
  assert.match(second.session.systemPrompt, /shell: \/bin\/sh/);
  assert.deepEqual(await runBash(first), [{ type: "text", text: "/bin/bash" }]);
  assert.deepEqual(await runBash(second), [{ type: "text", text: "/bin/sh" }]);
  await first.shutdown();
  const reopened = await getOrStartSession(first.id);
  hosts.push(reopened);
  assert.notEqual(reopened, first);
  assert.equal(reopened.workbenchToolSources.get("grep"), "workbench.enhanced-search");
  assert.match(reopened.session.systemPrompt, /shell: \/bin\/sh/);
  assert.deepEqual(await runBash(reopened), [{ type: "text", text: "/bin/sh" }]);
  await writeFile(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ shellPath: "/explicit/shell" }),
  );
  const explicit = await createSession(root, "shell-explicit");
  hosts.push(explicit);
  assert.match(explicit.session.systemPrompt, /shell: \/explicit\/shell/);
  assert.deepEqual(await runBash(explicit), [{ type: "text", text: "/explicit/shell" }]);
  assert.deepEqual(chosen, ["/bin/bash", "/bin/sh", "/bin/sh", "/explicit/shell"]);
});

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

test("keeps model selections session-local across prompts, cold reopen, and automation launches", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-model-defaults-"));
  const agentDir = path.join(root, "agent");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousStateDir = process.env.PI_WORKBENCH_STATE_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_WORKBENCH_STATE_DIR = path.join(root, "state");
  const hosts: Awaited<ReturnType<typeof createSession>>[] = [];
  t.after(async () => {
    for (const host of hosts) await host.shutdown();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousStateDir === undefined) delete process.env.PI_WORKBENCH_STATE_DIR;
    else process.env.PI_WORKBENCH_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(agentDir, { recursive: true });
  const defaults = {
    defaultProvider: "selection-test",
    defaultModel: "default",
    defaultThinkingLevel: "medium",
  };
  const settingsPath = path.join(agentDir, "settings.json");
  await writeFile(settingsPath, JSON.stringify(defaults));
  await writeFile(
    path.join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "selection-test": {
          api: "openai-completions",
          baseUrl: "http://127.0.0.1:1/v1",
          apiKey: "test-only-key",
          models: ["default", "selected", "prompt"].map((id) => ({
            id,
            name: id,
            reasoning: true,
            input: ["text"],
            contextWindow: 128_000,
            maxTokens: 1_000,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          })),
        },
      },
    }),
  );
  const first = await createSession(root, "model-defaults-first");
  const second = await createSession(root, "model-defaults-second");
  hosts.push(first, second);
  first.session.sessionManager.appendMessage({ role: "user", content: "Saved task", timestamp: 1 });
  first.session.sessionManager.appendMessage(assistantMessage("Saved answer", 2));
  const assertSelection = (host: typeof first, model: string, effort: string) => {
    assert.equal(host.session.model?.id, model);
    assert.equal(host.session.thinkingLevel, effort);
  };
  await selectSessionModel(first.id, {
    provider: "selection-test",
    model: "selected",
    reasoningEffort: "high",
  });
  assertSelection(first, "selected", "high");
  assertSelection(second, "default", "medium");
  await first.session.settingsManager.flush();
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), defaults);
  await first.shutdown();
  const reopened = await getOrStartSession(first.id);
  hosts.push(reopened);
  assertSelection(reopened, "selected", "high");

  t.mock.method(
    reopened.session,
    "prompt",
    async (_message: string, options?: Parameters<typeof reopened.session.prompt>[1]) => {
      options?.preflightResult?.(true);
    },
  );
  await sendPrompt(reopened.id, "Use this model for the task", undefined, {
    provider: "selection-test",
    modelId: "prompt",
    thinkingLevel: "low",
  });
  assertSelection(reopened, "prompt", "low");
  await reopened.session.settingsManager.flush();
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), defaults);

  const { workspace } = await getWorkspaceStore().create({ path: root });
  const submitted: string[] = [];
  const automation = createPiAutomationRuntimeBindings({
    agentExecution: {
      async cancel() {},
      async submit({ threadId }) {
        submitted.push(threadId);
        return { kind: "started" };
      },
    },
  });
  const definition = {
    schemaVersion: 1 as const,
    id: "selection-automation",
    revision: 1,
    name: "Selection automation",
    prompt: "Run the configured task",
    workspaceId: workspace.workspaceId,
    schedule: { cron: "0 9 * * *", timezone: "UTC" },
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    sessions: [],
  };
  const target = { workspaceId: workspace.workspaceId, path: root };
  for (const model of [
    undefined,
    { provider: "selection-test", model: "selected", reasoningEffort: "high" },
  ]) {
    const id = await automation.launch({ ...definition, model }, target, "schedule", 1_000);
    const host = await getOrStartSession(id);
    hosts.push(host);
    assertSelection(host, model?.model ?? "default", model?.reasoningEffort ?? "medium");
    await host.session.settingsManager.flush();
  }
  assert.equal(submitted.length, 2);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), defaults);
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

test("snapshots an explicit Skill without a read tool or an intermediate turn and reports missing files", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-selected-skill-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillFile = `${root}/SKILL.md`;
  const content = "---\nname: create-skill\n---\n\n# Create Skill\nRead references/example.md.\n";
  await writeFile(skillFile, content);
  let promptCount = 0;
  const session = {
    getActiveToolNames: () => ["bash"],
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

  const submission = {
    version: 2 as const,
    sourceText: "tokens",
    text: "build a reusable workflow",
    context: [],
    metadata: {},
    commands: [
      {
        id: "skill",
        commandId: "skill:create-skill",
        label: "Create Skill",
        scope: "message" as const,
        source: "agent" as const,
      },
    ],
  };
  const resolved = await resolveWorkbenchComposerCommands(session, submission);

  assert.equal(promptCount, 0);
  assert.equal(resolved.agentTurn, false);
  assert.deepEqual(resolved.request.selectedSkills, [
    {
      invocationName: "skill:create-skill",
      name: "create-skill",
      location: skillFile,
      baseDir: root,
      selectedBy: "user",
      content,
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
  await rm(skillFile);
  const failed = await resolveWorkbenchComposerCommands(session, submission);
  assert.deepEqual(failed.request.selectedSkills, []);
  assert.equal(failed.request.commandTrace[0]?.status, "execution-failed");
  assert.equal(promptCount, 0);
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
  const resourceLoader = {
    getExtensions: () => ({
      extensions: [
        { path: "/project/.pi/extensions/review.ts" },
        { path: "workbench.internal", hidden: true },
      ],
    }),
    getSkills: () => ({ skills: [{ name: "react" }] }),
    getPrompts: () => ({ prompts: [{ name: "review" }] }),
    getSystemPromptSource: () => ({ path: "/project/.pi/SYSTEM.md" }),
    getAppendSystemPromptSources: () => [{ path: "/project/.pi/APPEND_SYSTEM.md" }],
    getAgentsFiles: () => ({ agentsFiles: [{ path: "/project/AGENTS.md" }] }),
  };
  const session = {
    extensionRunner: { getRegisteredCommands: () => [] },
    promptTemplates: [],
    resourceLoader,
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
      reloadConfiguration: {
        extensions: ["/project/.pi/extensions/review.ts"],
        skills: ["react"],
        prompts: ["review"],
        contextFiles: [
          "/project/.pi/SYSTEM.md",
          "/project/.pi/APPEND_SYSTEM.md",
          "/project/AGENTS.md",
        ],
      },
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

test("executes session commands once and sends only remaining text to the model", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-composer-command-context-"));
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
  const host = await createSession(root, "composer-command-context");
  const originalPrompt = host.session.prompt;
  const originalReload = host.session.reload;
  const originalAvailableSnapshot = host.session.modelRuntime.getAvailableSnapshot;
  const model = host.session.model;
  assert.ok(model);
  host.session.modelRuntime.getAvailableSnapshot = () => [model];
  const actions: string[] = [];
  let failCommand = false;
  let forwardedPrompt = "";
  host.session.reload = async () => {
    actions.push("reload");
    if (failCommand) throw new Error("Reload failed");
  };
  host.session.prompt = async (text, options) => {
    actions.push("prompt");
    forwardedPrompt = text;
    options?.preflightResult?.(true);
  };
  t.after(async () => {
    host.session.prompt = originalPrompt;
    host.session.reload = originalReload;
    host.session.modelRuntime.getAvailableSnapshot = originalAvailableSnapshot;
    await host.shutdown();
  });

  for (const text of ["", "/reload is literal follow-up text", "must not run after failure"]) {
    failCommand = text === "must not run after failure";
    await submitPrompt(
      host.id,
      "followUp",
      { message: text },
      {
        composer: {
          version: 2,
          sourceText: `:agent-command[reload|Reload] ${text}`,
          text,
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
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(actions, ["reload", "reload", "prompt", "reload"]);
  const messages = convertToLlm(
    projectPiComposerContext(
      [{ role: "user", content: forwardedPrompt, timestamp: 1 }],
      host.session.sessionManager.getBranch(),
    ),
  );
  assert.deepEqual(messages, [
    {
      role: "user",
      content: [{ type: "text", text: "/reload is literal follow-up text" }],
      timestamp: 1,
    },
  ]);
  assert.equal(
    forwardedPrompt.startsWith("/"),
    false,
    "Pi must not dispatch the remaining text as another command",
  );
});

test("forwards model-native image inputs", async (t) => {
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
  assert.doesNotMatch(forwardedPrompt, /attachment-references/);
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

test("cancels compaction before waiting for the agent to become idle", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-compaction-cancel-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  });
  const host = await createSession(root, "compaction-cancel");
  t.after(() => host.shutdown());
  const controller = new AbortController();
  t.mock.method(host.session, "abortCompaction", () => controller.abort());
  t.mock.method(host.session, "abort", async () => {
    assert.equal(controller.signal.aborted, true, "idle must not wait for uncancelled compaction");
  });

  await cancelSession(host.id);
  assert.equal(controller.signal.aborted, true);
});

test("compacts large tool results before the next model request and preserves context-only ordering", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-tool-result-compaction-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  let host: Awaited<ReturnType<typeof createSession>>;
  t.after(async () => {
    await host?.shutdown();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  });
  host = await createSession(root, "tool-result-compaction", undefined, {
    customTools: [
      {
        name: "large_result",
        label: "Large result",
        description: "Return a large tool result",
        parameters: Type.Object({}),
        async execute() {
          await host.session.sendCustomMessage(
            { customType: "test.context-only", content: "Preserve this context", display: false },
            { triggerTurn: false },
          );
          return { content: [{ type: "text", text: "x".repeat(80_000) }], details: {} };
        },
      },
    ],
  });
  const faux = fauxProvider({
    provider: "compaction-test",
    tokensPerSecond: 0,
    models: [{ id: "compaction-model", contextWindow: 16_000, maxTokens: 1_000 }],
  });
  host.session.modelRuntime.registerNativeProvider(faux.provider);
  await host.session.modelRuntime.setRuntimeApiKey(faux.getModel().provider, "test-only-key");
  await host.session.modelRuntime.getAvailable();
  await host.selectModel({ provider: faux.getModel().provider, model: faux.getModel().id });
  host.session.setActiveToolsByName(["large_result"]);
  await host.updateContextPolicy({
    mode: "custom",
    desiredContextTokens: 16_000,
    compaction: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 500 },
  });
  host.session.settingsManager.applyOverrides({ retry: { enabled: false } });
  const order: string[] = [];
  host.session.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "toolResult")
      order.push("tool-result");
    if (event.type === "message_end" && event.message.role === "custom") order.push("context-only");
    if (event.type === "compaction_start" || event.type === "compaction_end")
      order.push(event.type);
  });
  let requestedTool = false;
  const respond: FauxResponseFactory = (_context, options) => {
    if (options?.cacheRetention === "none") return fauxAssistantMessage("Previous work summarized");
    if (!requestedTool) {
      requestedTool = true;
      return fauxAssistantMessage(fauxToolCall("large_result", {}), { stopReason: "toolUse" });
    }
    order.push("next-model-request");
    return fauxAssistantMessage("Task completed");
  };
  faux.setResponses([respond, respond, respond, respond]);
  await sendPrompt(host.id, "Read the large result and finish");
  await host.waitForCurrentPrompt();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(order.filter((item) => item === "compaction_start").length, 1);
  assert.equal(order.filter((item) => item === "compaction_end").length, 1);
  assert.equal(order.filter((item) => item === "tool-result").length, 1);
  assert.equal(order.filter((item) => item === "context-only").length, 1);
  assert.equal(order.filter((item) => item === "next-model-request").length, 1);
  assert.ok(order.indexOf("tool-result") < order.indexOf("context-only"));
  assert.ok(order.indexOf("tool-result") < order.indexOf("compaction_start"));
  assert.ok(order.indexOf("compaction_end") < order.indexOf("next-model-request"));
  assert.equal(host.session.messages.at(-1)?.role, "assistant");
  assert.equal(JSON.stringify(host.session.messages.at(-1)).includes("Task completed"), true);
  assert.equal(host.isBusy, false);
  assert.equal(host.isRunning, false);
  assert.deepEqual(host.steeringMessages, []);
  assert.deepEqual(host.followUpMessages, []);
  assert.equal(
    host.session.sessionManager.getBranch().filter((entry) => entry.type === "compaction").length,
    1,
  );
});

test("shutdown waits for prompt completion and saves one interruption before a cold reopen", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-shutdown-interruption-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  });
  const host = await createSession(root, "shutdown-interruption");
  const sink = host.session as unknown as {
    _handleAgentEvent(event: Record<string, unknown>): Promise<void>;
  };
  await sink._handleAgentEvent({ type: "agent_start" });
  await sink._handleAgentEvent({
    type: "message_end",
    message: {
      role: "user",
      content: "Keep this task",
      timestamp: 1_000,
    },
  });
  await sink._handleAgentEvent({
    type: "message_start",
    message: assistantMessage("Partial answer", 1_001),
  });
  assert.equal(existsSync(host.session.sessionManager.getSessionFile()!), true);
  const compaction = t.mock.method(host.session, "abortCompaction");
  const summary = t.mock.method(host.session, "abortBranchSummary");
  t.mock.method(host.session, "abort", async () => undefined);
  let finish!: () => void;
  (host as unknown as { promptTask: Promise<void> }).promptTask = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const first = host.shutdown();
  const second = host.shutdown();
  assert.equal(first, second, "repeat shutdown calls must join the same completion");
  const hooks = (
    globalThis as unknown as Record<symbol, { hooks: Map<string, () => Promise<void>> }>
  )[Symbol.for("pi-workbench.shutdown-hooks.v1")];
  const shutdownHook = hooks?.hooks.get("pi-sessions");
  assert.ok(shutdownHook);
  const runtimeShutdown = shutdownHook();
  let runtimeClosed = false;
  void runtimeShutdown.then(() => {
    runtimeClosed = true;
  });
  let closed = false;
  void first.then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closed, false, "the active prompt still owns pending terminal events");
  assert.equal(runtimeClosed, false, "runtime shutdown must include sessions already closing");
  assert.equal(compaction.mock.callCount(), 1);
  assert.equal(summary.mock.callCount(), 1);
  finish();
  await Promise.all([first, runtimeShutdown]);
  const history = await getSessionHistory(host.id);
  assert.equal(history.context.messages.at(-1)?.role, "assistant");
  assert.match(JSON.stringify(history.context.messages.at(-1)), /Partial answer/);
  const resume = await getSessionResumeState(host.id);
  assert.equal(resume.checkpoint?.reason, "process-interrupted");
  assert.equal(resume.checkpoint?.capability, "ready");
  assert.deepEqual(await getSessionResumeState(host.id), resume);
});

test("cold history repairs a crashed first turn and the next hosted session sees the same checkpoint", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-cold-interruption-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  });
  const { ensureSessionPersistence } = await import("../../src/sessions/session-interruption");
  const manager = SessionManager.create(root, undefined, { id: "cold-interruption" });
  ensureSessionPersistence(manager);
  manager.appendThinkingLevelChange("off");
  initializeSessionEventJournal(manager, []);
  appendSessionEventJournal(manager, { type: "agent_start", seq: 0, time: 1_000, data: {} });
  const user = { role: "user" as const, content: "Recover me", timestamp: 1_001 };
  appendSessionEventJournal(manager, {
    type: "message_end",
    seq: 1,
    time: 1_001,
    data: { message: user },
  });
  manager.appendMessage(user);
  const events = await getSessionEvents("cold-interruption");
  assert.equal(events.at(-1)?.type, "agent_settled");
  const resume = await getSessionResumeState("cold-interruption");
  assert.equal(resume.checkpoint?.reason, "process-interrupted");
  const branches = await getSessionEventBranches("cold-interruption");
  assert.equal(branches.headLeafId, resume.checkpoint?.branchLeafId);
  const host = await getOrStartSession("cold-interruption");
  t.after(() => host.shutdown());
  assert.deepEqual(await getSessionEvents(host.id), events);
  assert.deepEqual(await getSessionResumeState(host.id), resume);
  assert.equal(host.session.agent.state.messages.at(-1)?.role, "assistant");
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
  manager.appendCustomMessageEntry("workbench.composer-resolution.v1", "", false, {
    version: 1,
    submissionId: "submission-context-branch",
    status: "resolved",
    commandTrace: [],
  });
  const compiledPrompt =
    "<workbench-untrusted-context>Reference 42</workbench-untrusted-context>\n<user-request>Read the image</user-request>";
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

test("packs assistant deltas into durable linear-size chunks while legacy updates stay cumulative", async (t) => {
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
  t.mock.timers.enable({ apis: ["setTimeout"] });
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
    // Tokens arriving on separate frames must still share the same durable chunk.
    if (index < 9) t.mock.timers.tick(10);
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
  t.mock.timers.tick(9);
  assert.equal(host.currentSequence, 0, "buffer token arrivals until the 100 ms boundary");
  t.mock.timers.tick(1);

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
      [1, "message_update"],
      [2, "message_end"],
    ],
  );
  assert.equal(host.currentSequence, 2);
  assert.equal(host.canonicalEvents.length, 3);
  assert.equal(
    host.session.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "custom" && entry.customType === SESSION_EVENT_CUSTOM_TYPE)
      .length,
    3,
  );
  const completionData = durableEvents[2]?.data as {
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

  const chunkFrames = muxFrames.filter(
    (frame) =>
      frame.payload.type === "session/event" && frame.payload.event.type === "message_update",
  );
  assert.equal(chunkFrames.length, 1);
  const durableChunk = durableEvents[1]?.data as {
    format?: string;
    firstRevision?: number;
    revision?: number;
    startSeq?: number;
    message?: Record<string, unknown>;
    updates?: Array<{ type?: string; contentIndex?: number; delta?: string }>;
  };
  assert.equal(durableChunk.format, "pi-messages-v1");
  assert.equal(durableChunk.firstRevision, 1);
  assert.equal(durableChunk.revision, updateCount + 1);
  assert.equal(durableChunk.startSeq, 0);
  assert.equal(Object.hasOwn(durableChunk.message ?? {}, "content"), false);
  assert.deepEqual(durableChunk.updates, [
    { type: "text_start", contentIndex: 0 },
    { type: "text_delta", contentIndex: 0, delta: chunk.repeat(updateCount) },
  ]);
  assert.ok(Buffer.byteLength(JSON.stringify(durableChunk)) < text.length + 1_024);

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
  assert.equal(retained.payload.lastSeq, 2);

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
  t.mock.timers.tick(100);

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
  assert.notEqual(toolSnapshot.streamId, activeSnapshot.streamId);
  assert.equal(toolSnapshot.revision, 2);
  assert.equal(toolSnapshot.startSeq, 3);
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
  t.mock.timers.tick(100);
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
  assert.equal(renamedSnapshot.startSeq, 3);
  assert.equal(renamedSnapshot.revision, 3);
  const renamedWatermark = renamedReconnectFrames.find(
    (frame) => frame.payload.type === "session/subscribed" && frame.payload.sessionId === host.id,
  )?.payload;
  assert.ok(renamedWatermark?.type === "session/subscribed");
  assert.equal(renamedWatermark.lastSeq, 6);

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
  assert.equal(host.canonicalEvents.at(-2)?.type, "message_update");
  assert.equal(host.canonicalEvents.at(-1)?.type, "message_end");
  t.mock.timers.reset();
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

test("detached forks retain compacted context when the kept boundary is a label", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-compacted-fork-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = SessionManager.create(root, root);
  source.appendMessage({ role: "user", content: "Old task", timestamp: 1 });
  const oldAnswer = source.appendMessage(assistantMessage("Old answer", 2));
  const label = source.appendLabelChange(oldAnswer, "Summary boundary");
  const keptUser = { role: "user" as const, content: "Keep this task", timestamp: 3 };
  const keptEntryId = source.appendMessage(keptUser);
  source.appendMessage(assistantMessage("Keep this answer", 4));
  source.appendCompaction("Earlier work summarized", label, 20_000);
  const nextUser = { role: "user" as const, content: "Continue the task", timestamp: 5 };
  const nextAnswer = {
    ...assistantMessage("Continuing from the summary", 6),
    providerThinkingLevel: "high",
    content: [
      {
        type: "thinking" as const,
        thinking: "Kept reasoning",
        thinkingSignature: "provider-signature",
      },
      { type: "text" as const, text: "Continuing from the summary" },
    ],
  };
  appendSessionEventJournal(source, { type: "turn_start", seq: 0, time: 5, data: {} });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 1,
    time: 5,
    data: { message: nextUser },
  });
  source.appendMessage(nextUser);
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 2,
    time: 6,
    data: { message: nextAnswer },
  });
  source.appendMessage(nextAnswer);
  appendSessionEventJournal(source, { type: "turn_end", seq: 3, time: 7, data: {} });
  const sourcePath = source.getSessionFile()!;
  const sourceBefore = await readFile(sourcePath, "utf8");
  const context = source.buildSessionContext().messages;
  assert.equal(context[0]?.role, "compactionSummary");
  assert.deepEqual(context[1], keptUser);

  for (const atSeq of [undefined, 2]) {
    const child = createDetachedSessionFork(sourcePath, atSeq, root);
    const compaction = child.getBranch().findLast((entry) => entry.type === "compaction");
    assert.equal(compaction?.firstKeptEntryId, keptEntryId);
    assert.deepEqual(child.buildSessionContext().messages, context);
    const restored = SessionManager.open(child.getSessionFile()!).buildSessionContext().messages;
    assert.deepEqual(restored, context);
    assert.deepEqual(restored.at(-1), nextAnswer);
  }
  assert.equal(await readFile(sourcePath, "utf8"), sourceBefore);
});

test("keeps a formal fork cold until execution needs a host", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-cold-fork-"));
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

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const source = await createSession(cwd, "cold-fork-source");
  t.after(() => source.shutdown());
  const manager = source.session.sessionManager;
  const user = { role: "user" as const, content: "main context", timestamp: 1 };
  const assistant = assistantMessage("main answer", 2);
  appendSessionEventJournal(manager, { type: "turn_start", seq: 0, time: 1, data: {} });
  appendSessionEventJournal(manager, {
    type: "message_end",
    seq: 1,
    time: 2,
    data: { message: user },
  });
  manager.appendMessage(user);
  appendSessionEventJournal(manager, {
    type: "message_end",
    seq: 2,
    time: 3,
    data: { message: assistant },
  });
  manager.appendMessage(assistant);
  appendSessionEventJournal(manager, { type: "turn_end", seq: 3, time: 4, data: {} });

  const forked = await forkSession(source.id, 2);
  assert.equal(
    getLoadedSessions().some((host) => host.id === forked.id),
    false,
  );
  assert.equal(
    (await listSessions()).sessions.some((session) => session.id === forked.id),
    true,
  );
  assert.deepEqual((await getSessionHistory(forked.id)).context.messages, [user, assistant]);

  const child = await getOrStartSession(forked.id);
  t.after(() => child.shutdown());
  assert.equal(
    getLoadedSessions().some((host) => host.id === forked.id),
    true,
  );
});

test("keeps scratch sessions hidden, releases their files, and promotes them explicitly", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-scratch-session-"));
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

  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const source = await createSession(cwd, "scratch-source");
  const manager = source.session.sessionManager;
  const user = { role: "user" as const, content: "main context", timestamp: 1 };
  const assistant = assistantMessage("main answer", 2);
  appendSessionEventJournal(manager, { type: "turn_start", seq: 0, time: 1, data: {} });
  appendSessionEventJournal(manager, {
    type: "message_end",
    seq: 1,
    time: 2,
    data: { message: user },
  });
  manager.appendMessage(user);
  appendSessionEventJournal(manager, {
    type: "message_end",
    seq: 2,
    time: 3,
    data: { message: assistant },
  });
  manager.appendMessage(assistant);
  appendSessionEventJournal(manager, { type: "turn_end", seq: 3, time: 4, data: {} });

  const first = await createScratchSession(source.id, undefined, {
    workspaceId: "workspace-1",
    ttlMs: 60_000,
  });
  const firstFile = first.record.filePath;
  assert.equal(existsSync(firstFile), true);
  assert.equal(first.record.expiresAt > Date.now(), true);
  assert.equal(getScratchSessionRecord(first.host.id)?.sourceSessionId, source.id);
  assert.equal(
    (await listSessions()).sessions.some((session) => session.id === first.host.id),
    false,
  );
  assert.deepEqual((await getSessionHistory(first.host.id)).context.messages, [user, assistant]);

  appendSessionEventJournal(manager, { type: "turn_start", seq: 4, time: 5, data: {} });
  const pendingUser = { role: "user" as const, content: "still running", timestamp: 6 };
  appendSessionEventJournal(manager, {
    type: "message_end",
    seq: 5,
    time: 6,
    data: { message: pendingUser },
  });
  manager.appendMessage(pendingUser);
  const sourcePath = manager.getSessionFile()!;
  const sourceBefore = await readFile(sourcePath, "utf8");
  const busy = t.mock.getter(source, "isBusy", () => true);
  const runningScratch = await createScratchSession(source.id);
  assert.deepEqual((await getSessionHistory(runningScratch.host.id)).context.messages, [
    user,
    assistant,
  ]);
  assert.equal(source.isBusy, true);
  assert.equal(await readFile(sourcePath, "utf8"), sourceBefore);
  busy.mock.restore();
  await releaseScratchSession(runningScratch.host.id);

  await releaseScratchSession(first.host.id);
  assert.equal(existsSync(firstFile), false);
  assert.equal(getScratchSessionRecord(first.host.id), undefined);
  await assert.rejects(getOrStartSession(first.host.id), { code: "pi_session_not_found" });

  const second = await createScratchSession(source.id, 2, {
    workspaceId: "workspace-1",
    ttlMs: 60_000,
  });
  const promoted = await promoteScratchSession(second.host.id, "Promoted side chat");
  assert.equal(promoted.sourceSessionId, source.id);
  assert.equal(promoted.workspaceId, "workspace-1");
  assert.equal(getScratchSessionRecord(second.host.id), undefined);
  const listed = await listSessions();
  assert.equal(
    listed.sessions.some((session) => session.id === second.host.id),
    false,
  );
  assert.equal(
    listed.sessions.some((session) => session.id === promoted.host.id),
    true,
  );
  assert.equal(promoted.host.summary().name, "Promoted side chat");

  await promoted.host.shutdown();
  await source.shutdown();
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

test("forks cache-miss projections while still rejecting changed message content", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-cache-miss-fork-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = SessionManager.create(root, root);
  const assistant = assistantMessage("answer", 1);
  appendSessionEventJournal(source, { type: "turn_start", seq: 0, time: 1, data: {} });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 1,
    time: 2,
    data: { message: { ...assistant, workbenchCacheMiss: { cacheMissTokens: 1000 } } },
  });
  source.appendMessage(assistant);
  appendSessionEventJournal(source, { type: "turn_end", seq: 2, time: 3, data: {} });
  const sourcePath = source.getSessionFile()!;
  const before = await readFile(sourcePath, "utf8");
  for (const atSeq of [undefined, 1]) {
    const child = createDetachedSessionFork(sourcePath, atSeq, root);
    assert.deepEqual(child.buildSessionContext().messages, [assistant]);
    assert.notEqual(child.getSessionId(), source.getSessionId());
  }
  assert.equal(await readFile(sourcePath, "utf8"), before);

  appendSessionEventJournal(source, { type: "turn_start", seq: 3, time: 4, data: {} });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 4,
    time: 5,
    data: { message: { ...assistant, workbenchCacheMiss: { cacheMissTokens: 1000 } } },
  });
  source.appendMessage(assistantMessage("different answer", 1));
  appendSessionEventJournal(source, { type: "turn_end", seq: 5, time: 6, data: {} });
  for (const atSeq of [undefined, 4]) {
    assert.throws(() => createDetachedSessionFork(sourcePath, atSeq, root), {
      code: "pi_fork_unavailable",
    });
  }
});

test("forks a regenerated branch after a new agent run completes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-session-fork-regenerated-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = SessionManager.create(root, root, { id: "fork-regenerated-source" });
  const user = { role: "user" as const, content: "hello", timestamp: 1 };
  const original = assistantMessage("original", 2);
  const regenerated = assistantMessage("regenerated", 3);

  appendSessionEventJournal(source, { type: "agent_start", seq: 0, time: 1, data: {} });
  appendSessionEventJournal(source, { type: "turn_start", seq: 1, time: 2, data: {} });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 2,
    time: 3,
    data: { message: user },
  });
  const userEntryId = source.appendMessage(user);
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 3,
    time: 4,
    data: { message: original },
  });
  source.appendMessage(original);
  appendSessionEventJournal(source, { type: "turn_end", seq: 4, time: 5, data: {} });

  // Regeneration retains the user entry and its open turn, but replaces the original answer.
  source.branch(userEntryId);
  appendSessionEventJournal(source, { type: "agent_start", seq: 3, time: 6, data: {} });
  appendSessionEventJournal(source, { type: "turn_start", seq: 4, time: 7, data: {} });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 5,
    time: 8,
    data: { message: regenerated },
  });
  source.appendMessage(regenerated);
  appendSessionEventJournal(source, { type: "turn_end", seq: 6, time: 9, data: {} });

  const sourcePath = source.getSessionFile();
  assert.ok(sourcePath);
  const before = await readFile(sourcePath, "utf8");
  for (const atSeq of [undefined, 6]) {
    const forked = createDetachedSessionFork(sourcePath, atSeq);
    assert.notEqual(forked.getSessionId(), source.getSessionId());
    assert.deepEqual(forked.buildSessionContext().messages, [user, regenerated]);
  }
  assert.equal(await readFile(sourcePath, "utf8"), before);

  // A second turn_start in the same run is still invalid.
  source.branch(userEntryId);
  appendSessionEventJournal(source, { type: "turn_start", seq: 3, time: 10, data: {} });
  appendSessionEventJournal(source, {
    type: "message_end",
    seq: 4,
    time: 11,
    data: { message: regenerated },
  });
  source.appendMessage(regenerated);
  appendSessionEventJournal(source, { type: "turn_end", seq: 5, time: 12, data: {} });
  assert.throws(() => createDetachedSessionFork(sourcePath), { code: "pi_fork_unavailable" });
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

test("Composer reads file references through the installed shared Workspace service", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-composer-files-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousBindings = getPiAgentHostBindings();
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  await writeFile(path.join(cwd, "example.txt"), "Shared workspace file content");
  const files = createWorkspaceFileService({
    resolveWorkspaceRoot: async (id) => (id === "workspace-1" ? cwd : undefined),
  });
  const reads = t.mock.method(files, "readFile");
  bindPiAgentHostBindings({ ...previousBindings, workspaceFiles: files });
  const host = await createSession(cwd, "composer-shared-file-service");
  t.mock.method(host.session.modelRuntime, "getAvailableSnapshot", () =>
    host.session.model ? [host.session.model] : [],
  );
  t.after(async () => {
    await host.shutdown();
    bindPiAgentHostBindings(previousBindings);
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  });
  let forwardedPrompt = "";
  t.mock.method(
    host.session,
    "prompt",
    async (message: string, options?: { preflightResult?: (accepted: boolean) => void }) => {
      forwardedPrompt = message;
      options?.preflightResult?.(true);
    },
  );
  await submitPrompt(
    host.id,
    "followUp",
    { message: "Read this file" },
    {
      composer: {
        version: 2,
        text: "Read this file",
        sourceText: "Read this file",
        commands: [],
        metadata: {},
        context: [
          {
            type: "workbench.workspace-file",
            value: {
              version: 1,
              workspaceId: "workspace-1",
              relativePath: "example.txt",
              name: "example.txt",
            },
          },
        ],
      },
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(getPiAgentHostBindings().workspaceFiles, files);
  assert.equal(reads.mock.callCount(), 1);
  assert.deepEqual(reads.mock.calls[0]?.arguments, [
    { workspaceId: "workspace-1", relativePath: "example.txt" },
  ]);
  assert.match(forwardedPrompt, /Shared workspace file content/);
  assert.match(forwardedPrompt, /untrusted-context/);
});

test("cache miss notices use Pi accounting, honor the setting, and persist only in the event projection", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-cache-miss-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  const hosts: Awaited<ReturnType<typeof createSession>>[] = [];
  t.after(async () => {
    for (const host of hosts) await host.shutdown();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  });
  const host = await createSession(root, "cache-miss-notices");
  hosts.push(host);
  const sink = host.session as unknown as {
    _handleAgentEvent(event: Record<string, unknown>): Promise<void>;
  };
  let timestamp = Date.now();
  async function complete(input: number, cacheRead: number, model = "test") {
    const message = {
      ...assistantMessage("response", timestamp),
      model,
      usage: {
        input,
        cacheRead,
        cacheWrite: 0,
        output: 1,
        totalTokens: input + cacheRead + 1,
        cost: {
          input: input * 0.000003,
          cacheRead: cacheRead * 0.0000003,
          cacheWrite: 0,
          output: 0,
          total: input * 0.000003 + cacheRead * 0.0000003,
        },
      },
    };
    timestamp += 360_000;
    await sink._handleAgentEvent({ type: "message_start", message });
    await sink._handleAgentEvent({ type: "message_end", message });
    assert.equal("workbenchCacheMiss" in message, false);
    const event = (await getSessionEvents(host.id)).findLast(
      (entry) => entry.type === "message_end",
    );
    const data = event?.data as {
      message: {
        workbenchCacheMiss?: {
          missedTokens: number;
          missedCost: number;
          idleMs: number;
          modelChanged: boolean;
        };
      };
    };
    return data.message.workbenchCacheMiss;
  }
  host.session.settingsManager.applyOverrides({ showCacheMissNotices: true });
  assert.equal(await complete(0, 12_000), undefined, "first request is not a cache miss");
  assert.equal(await complete(0, 12_000), undefined, "full cache hits do not warn");
  assert.equal(await complete(500, 11_500), undefined, "breakpoint noise is ignored");
  const miss = await complete(10_000, 2_000, "other-model");
  assert.ok(miss);
  assert.equal(miss.missedTokens, 10_000);
  assert.ok(Math.abs(miss.missedCost - 0.027) < 1e-9);
  assert.equal(miss.idleMs, 360_000);
  assert.equal(miss.modelChanged, true);
  host.session.settingsManager.applyOverrides({ showCacheMissNotices: false });
  assert.equal(await complete(10_000, 2_000), undefined, "disabled notices stay hidden");
  assert.equal(
    host.session.sessionManager
      .getBranch()
      .some((entry) => entry.type === "message" && "workbenchCacheMiss" in entry.message),
    false,
  );
  const before = await getSessionEvents(host.id);
  await host.shutdown();
  assert.deepEqual(
    await getSessionEvents(host.id),
    before,
    "cold history preserves journal notices",
  );
});

test("cache miss notices detect a cold model switch when caching has known discounted pricing", () => {
  const session = SessionManager.inMemory();
  const first = assistantMessage("First response", 1_000);
  first.usage = {
    input: 12_957,
    output: 26,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 12_983,
    cost: { input: 0.0025914, output: 0.0000312, cacheRead: 0, cacheWrite: 0, total: 0.0026226 },
  };
  const next = {
    ...assistantMessage("Switched response", 69_489),
    model: "deepseek-v4-flash",
    usage: {
      input: 15_785,
      output: 14,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15_799,
      cost: {
        input: 0.0034727,
        output: 0.00000924,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.00348194,
      },
    },
  };
  const models = { getModel: () => ({ cost: { cacheRead: 0.007 } }) };
  assert.equal(detectCacheMiss(session.getBranch(), first, models), undefined);
  session.appendMessage(first);
  const miss = detectCacheMiss(session.getBranch(), next, models);
  assert.ok(miss, "a cold first request must not suppress a later cache miss");
  assert.equal(miss.missedTokens, 12_957);
  assert.ok(Math.abs(miss.missedCost - 0.002759841) < 1e-12);
  assert.equal(miss.modelChanged, true);
  const idle = detectCacheMiss(
    session.getBranch(),
    { ...next, model: first.model, timestamp: first.timestamp + 360_000 },
    models,
  );
  assert.equal(idle?.modelChanged, false);
  assert.equal(idle?.idleMs, 360_000);
  assert.equal(
    detectCacheMiss(session.getBranch(), next, { getModel: () => ({ cost: { cacheRead: 0.22 } }) }),
    undefined,
  );
  assert.equal(
    detectCacheMiss(session.getBranch(), next, { getModel: () => undefined }),
    undefined,
  );
  assert.equal(
    detectCacheMiss(session.getBranch(), next, { getModel: () => ({ cost: { cacheRead: 0 } }) }),
    undefined,
  );
});

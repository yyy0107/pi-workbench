import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { InMemoryCredentialStore, Type } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createAgentSession,
  DefaultResourceLoader,
  getDocsPath,
  getExamplesPath,
  getReadmePath,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { installSystemPromptPlaceholders } from "../../src/sessions/system-prompt-placeholders";
import { AgentSettingsService } from "../../src/settings/agent-settings-service";

test("expands scoped prompt files through Pi tool changes, reload, and continuation without rewriting resources", async (t) => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "workbench-prompt-placeholders-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const cwd = path.join(agentDir, "project");
  await mkdir(path.join(cwd, ".pi"), { recursive: true });
  const template = [
    "Workspace: {{pi.cwd}}",
    "Environment: {{pi.terminal_environment}}",
    "Tools:\n{{pi.tools}}",
    "Guidelines:\n{{pi.tool_guidelines}}",
    "Docs: {{pi.readme}} | {{pi.docs}} | {{pi.examples}}",
    "Unknown: {{pi.unknown}} {{pi.__proto__}} {{other.value}}",
  ].join("\n\n");
  await writeFile(path.join(agentDir, "SYSTEM.md"), template);
  await writeFile(path.join(agentDir, "APPEND_SYSTEM.md"), "Append: {{pi.cwd}}");
  await writeFile(path.join(cwd, "AGENTS.md"), "Context literal: {{pi.docs}}");
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const faux = fauxProvider({ tokensPerSecond: Infinity });
  modelRuntime.registerNativeProvider(faux.provider);

  const createSession = async (directory: string) => {
    const settingsManager = SettingsManager.inMemory(
      { compaction: { enabled: false }, retry: { enabled: false } },
      { projectTrusted: true },
    );
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: directory,
      agentDir,
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(directory),
      modelRuntime,
      model: faux.getModel(),
      customTools: [
        {
          name: "probe",
          label: "Probe",
          description: "Probe description",
          promptSnippet: "Keep {{pi.docs}} literal",
          promptGuidelines: ["Use probe carefully", " Use probe carefully ", ""],
          parameters: Type.Object({}),
          async execute() {
            session.setActiveToolsByName(["read"]);
            return { content: [{ type: "text", text: "Done" }], details: {} };
          },
        },
      ],
    });
    t.after(() => session.dispose());
    installSystemPromptPlaceholders(session, {
      environment: {
        PI_WORKBENCH_TERMINAL_SHELL: "cmd.exe",
        WORKBENCH_TERMINAL_SHELL: "powershell.exe",
      },
      platform: "win32",
    });
    await session.bindExtensions({ mode: "rpc" });
    return session;
  };
  const session = await createSession(cwd);
  const prompt = session.systemPrompt;
  assert.ok(prompt.includes(`Workspace: ${cwd}`));
  assert.ok(prompt.includes("Environment: Windows native; shell: cmd.exe"));
  assert.ok(prompt.includes(`Append: ${cwd}`));
  assert.ok(prompt.includes(`Docs: ${getReadmePath()} | ${getDocsPath()} | ${getExamplesPath()}`));
  assert.ok(prompt.includes("- probe: Keep {{pi.docs}} literal"));
  assert.equal(prompt.match(/- Use probe carefully/gu)?.length, 1);
  assert.ok(prompt.includes("Unknown: {{pi.unknown}} {{pi.__proto__}} {{other.value}}"));
  assert.ok(prompt.includes("Context literal: {{pi.docs}}"));
  assert.equal(prompt.match(/<project_context>/gu)?.length, 1);

  const received: string[] = [];
  faux.setResponses([
    (context) => {
      received.push(context.systemPrompt ?? "");
      return fauxAssistantMessage(fauxToolCall("probe", {}));
    },
    (context) => {
      received.push(context.systemPrompt ?? "");
      return fauxAssistantMessage("Finished");
    },
  ]);
  await session.prompt("Check placeholders");
  assert.equal(received.length, 2);
  assert.ok(received[0]!.includes("- probe:"));
  assert.ok(received[1]!.includes("- read:"));
  assert.ok(!received[1]!.includes("- probe:"));
  assert.ok(!received[1]!.includes("Use probe carefully"));
  assert.equal(await readFile(path.join(agentDir, "SYSTEM.md"), "utf8"), template);
  assert.equal(
    await readFile(path.join(agentDir, "APPEND_SYSTEM.md"), "utf8"),
    "Append: {{pi.cwd}}",
  );

  const projectPrompt = path.join(cwd, ".pi", "SYSTEM.md");
  await writeFile(projectPrompt, "Project: {{pi.cwd}}\n{{pi.tools}}");
  await writeFile(path.join(cwd, ".pi", "APPEND_SYSTEM.md"), "Project append: {{pi.docs}}");
  await session.reload();
  assert.ok(session.systemPrompt.startsWith(`Project: ${cwd}`));
  assert.ok(session.systemPrompt.includes(`Project append: ${getDocsPath()}`));
  assert.ok(!session.systemPrompt.includes("Workspace:"));
  assert.equal(await readFile(projectPrompt, "utf8"), "Project: {{pi.cwd}}\n{{pi.tools}}");
  session.setActiveToolsByName([]);
  assert.ok(session.systemPrompt.includes("\n(none)"));
  faux.setResponses([
    (context) => {
      received.push(context.systemPrompt ?? "");
      return fauxAssistantMessage("Continued");
    },
  ]);
  session.agent.state.messages = [{ role: "user", content: "Resume", timestamp: Date.now() }];
  await session.agent.continue();
  assert.equal(received.length, 3);
  assert.ok(received[2]!.startsWith(`Project: ${cwd}`));
  assert.ok(received[2]!.includes(`Project append: ${getDocsPath()}`));

  await rm(projectPrompt);
  await session.reload();
  assert.ok(session.systemPrompt.startsWith(`Workspace: ${cwd}`));
  const secondCwd = path.join(agentDir, "second-project");
  await mkdir(secondCwd);
  const restored = await createSession(secondCwd);
  assert.ok(restored.systemPrompt.startsWith(`Workspace: ${secondCwd}`));
  assert.ok(!restored.systemPrompt.includes(`Workspace: ${cwd}`));
  await rm(path.join(agentDir, "SYSTEM.md"));
  await restored.reload();
  assert.match(restored.systemPrompt, /Available tools:/u);
  assert.ok(restored.systemPrompt.includes(`Append: ${secondCwd}`));

  // Copying the builtin preview into SYSTEM.md preserves Pi's rules as active tools change.
  const toolSelections = [["read", "bash", "edit", "write"], ["read"], ["bash", "grep"], []];
  const normalize = (prompt: string) => prompt.split("\n").filter(Boolean).join("\n");
  const expected = toolSelections.map((names) => {
    restored.setActiveToolsByName(names);
    return normalize(restored.systemPrompt);
  });
  const builtin = (await new AgentSettingsService({ agentDir }).describe()).namespaces[0]!
    .builtinSystemPrompt;
  assert.ok(builtin);
  await writeFile(path.join(agentDir, "SYSTEM.md"), builtin);
  await restored.reload();
  for (const [index, names] of toolSelections.entries()) {
    restored.setActiveToolsByName(names);
    assert.equal(normalize(restored.systemPrompt), expected[index]);
  }
});

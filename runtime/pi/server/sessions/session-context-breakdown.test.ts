import assert from "node:assert/strict";
import test from "node:test";
import {
  createSyntheticSourceInfo,
  formatSkillsForPrompt,
  type AgentSession,
  type Skill,
  type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

import type { SessionContextBreakdownCategory } from "@/runtime/pi/contracts/rpc";
import { estimateContextBreakdown } from "./session-context-breakdown";

function item(
  breakdown: ReturnType<typeof estimateContextBreakdown>,
  category: SessionContextBreakdownCategory,
) {
  const result = breakdown.items.find((candidate) => candidate.category === category);
  assert.ok(result);
  return result;
}

function tool(name: string, source: string): ToolInfo {
  return {
    name,
    description: `${name} description`,
    parameters: Type.Object({ query: Type.String() }),
    sourceInfo: createSyntheticSourceInfo(`<${source}:${name}>`, { source }),
  };
}

test("breaks the current model input into instructions, tools, and conversation", () => {
  const skills: Skill[] = [
    {
      name: "review",
      description: "Review a change",
      filePath: "/skills/review/SKILL.md",
      baseDir: "/skills/review",
      sourceInfo: createSyntheticSourceInfo("/skills/review/SKILL.md", { source: "user" }),
      disableModelInvocation: false,
    },
  ];
  const contextFiles = [{ path: "/project/AGENTS.md", content: "Project instructions" }];
  const contextBlock =
    '\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n<project_instructions path="/project/AGENTS.md">\nProject instructions\n</project_instructions>\n\n</project_context>\n';
  const messages = [
    {
      role: "user",
      content:
        '<workbench-untrusted-context>\n[{"file":"notes.md"}]\n</workbench-untrusted-context>\n\n<user-request>\nExplain this\n</user-request>',
      timestamp: 1,
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "An answer" }],
      timestamp: 2,
      api: "openai-completions",
      provider: "test",
      model: "test-model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
    },
  ] as unknown as AgentSession["messages"];
  const tools = [
    tool("read", "builtin"),
    tool("search", "npm:mcp-search"),
    tool("ask_user", "workbench"),
  ];

  const breakdown = estimateContextBreakdown({
    systemPrompt: `Base system prompt${contextBlock}${formatSkillsForPrompt(skills)}`,
    skills,
    contextFiles,
    tools,
    activeToolNames: tools.map(({ name }) => name),
    messages,
    contextTokens: 1_000,
  });

  assert.equal(breakdown.basis, "provider-reconciled");
  assert.equal(breakdown.totalTokens, 1_000);
  assert.equal(
    breakdown.items.reduce((sum, candidate) => sum + candidate.tokens, 0),
    1_000,
  );
  assert.ok(item(breakdown, "system-prompt").tokens > 0);
  assert.ok(item(breakdown, "skills").tokens > 0);
  assert.ok(item(breakdown, "context-files").tokens > 0);
  assert.equal(item(breakdown, "builtin-tools").count, 1);
  assert.equal(item(breakdown, "mcp-tools").count, 1);
  assert.equal(item(breakdown, "extension-tools").count, 1);
  assert.ok(item(breakdown, "user-input").tokens > 0);
  assert.ok(item(breakdown, "assistant-history").tokens > 0);
});

test("uses the local four-characters-per-token estimate when provider usage is unavailable", () => {
  const breakdown = estimateContextBreakdown({
    systemPrompt: "12345678",
    skills: [],
    contextFiles: [],
    tools: [],
    activeToolNames: [],
    messages: [],
    contextTokens: null,
  });

  assert.equal(breakdown.basis, "heuristic");
  assert.equal(breakdown.totalTokens, 2);
  assert.equal(item(breakdown, "system-prompt").tokens, 2);
});

test("keeps an authoritative total visible even when no category can be inspected", () => {
  const breakdown = estimateContextBreakdown({
    systemPrompt: "",
    skills: [],
    contextFiles: [],
    tools: [],
    activeToolNames: [],
    messages: [],
    contextTokens: 7,
  });

  assert.equal(item(breakdown, "other").tokens, 7);
  assert.equal(
    breakdown.items.reduce((sum, candidate) => sum + candidate.tokens, 0),
    breakdown.totalTokens,
  );
});

import {
  convertToLlm,
  formatSkillsForPrompt,
  type AgentSession,
  type Skill,
  type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";

import type {
  SessionContextBreakdown,
  SessionContextBreakdownCategory,
  SessionContextBreakdownItem,
} from "@workbench/agent-runtime-pi-protocol/rpc";

const IMAGE_CHARACTER_WEIGHT = 4_800;
const CHARACTERS_PER_TOKEN = 4;

const CATEGORY_ORDER = [
  "system-prompt",
  "skills",
  "context-files",
  "builtin-tools",
  "mcp-tools",
  "extension-tools",
  "user-input",
  "assistant-history",
  "tool-results",
  "other",
] as const satisfies readonly SessionContextBreakdownCategory[];

interface WeightedCategory {
  characters: number;
  count: number;
}

interface ContextBreakdownInput {
  systemPrompt: string;
  skills: readonly Skill[];
  contextFiles: ReadonlyArray<{ path: string; content: string }>;
  tools: readonly ToolInfo[];
  activeToolNames: readonly string[];
  messages: AgentSession["messages"];
  contextTokens: number | null;
}

const TAGGED_USER_SECTIONS: ReadonlyArray<{
  category: SessionContextBreakdownCategory;
  pattern: RegExp;
}> = [
  {
    category: "other",
    pattern: /<workbench-request-config>[\s\S]*?<\/workbench-request-config>/gu,
  },
  {
    category: "skills",
    pattern: /<workbench-trusted-instructions>[\s\S]*?<\/workbench-trusted-instructions>/gu,
  },
  {
    category: "context-files",
    pattern: /<workbench-trusted-context>[\s\S]*?<\/workbench-trusted-context>/gu,
  },
  {
    category: "context-files",
    pattern: /<workbench-untrusted-context>[\s\S]*?<\/workbench-untrusted-context>/gu,
  },
  {
    category: "context-files",
    pattern: /<workbench-attachment-results>[\s\S]*?<\/workbench-attachment-results>/gu,
  },
  {
    category: "user-input",
    pattern: /<user-request>[\s\S]*?<\/user-request>/gu,
  },
];

function categories(): Record<SessionContextBreakdownCategory, WeightedCategory> {
  return Object.fromEntries(
    CATEGORY_ORDER.map((category) => [category, { characters: 0, count: 0 }]),
  ) as Record<SessionContextBreakdownCategory, WeightedCategory>;
}

function addCharacters(
  target: Record<SessionContextBreakdownCategory, WeightedCategory>,
  category: SessionContextBreakdownCategory,
  characters: number,
  count = 0,
): void {
  const item = target[category];
  item.characters += Math.max(0, characters);
  item.count += Math.max(0, count);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

function contextFilesBlock(files: ReadonlyArray<{ path: string; content: string }>): string {
  if (files.length === 0) return "";
  let block = "\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n";
  for (const file of files) {
    block += `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`;
  }
  return `${block}</project_context>\n`;
}

function removeLastExactBlock(text: string, block: string): { text: string; removed: boolean } {
  if (!block) return { text, removed: false };
  const index = text.lastIndexOf(block);
  if (index < 0) return { text, removed: false };
  return {
    text: text.slice(0, index) + text.slice(index + block.length),
    removed: true,
  };
}

function isMcpTool(tool: ToolInfo): boolean {
  const source = [
    tool.name,
    tool.sourceInfo.source,
    tool.sourceInfo.path,
    tool.sourceInfo.baseDir ?? "",
  ]
    .join("/")
    .toLowerCase();
  return (
    /(?:^|[^a-z0-9])mcp(?:$|[^a-z0-9])/u.test(source) || source.includes("model-context-protocol")
  );
}

function toolCategory(tool: ToolInfo): SessionContextBreakdownCategory {
  if (tool.sourceInfo.source === "builtin") return "builtin-tools";
  return isMcpTool(tool) ? "mcp-tools" : "extension-tools";
}

function classifyUserText(
  target: Record<SessionContextBreakdownCategory, WeightedCategory>,
  text: string,
): void {
  let remaining = text;
  let tagged = false;
  for (const section of TAGGED_USER_SECTIONS) {
    section.pattern.lastIndex = 0;
    remaining = remaining.replace(section.pattern, (match) => {
      tagged = true;
      addCharacters(
        target,
        section.category,
        match.length,
        section.category === "user-input" ? 0 : 1,
      );
      return "";
    });
  }
  if (remaining.length > 0) {
    addCharacters(target, tagged ? "other" : "user-input", remaining.length);
  }
}

function classifyUserMessage(
  target: Record<SessionContextBreakdownCategory, WeightedCategory>,
  message: Extract<Message, { role: "user" }>,
): void {
  if (typeof message.content === "string") {
    classifyUserText(target, message.content);
    return;
  }
  for (const block of message.content) {
    if (block.type === "text") classifyUserText(target, block.text);
    else addCharacters(target, "user-input", IMAGE_CHARACTER_WEIGHT);
  }
}

function messageCharacterWeight(message: Message): number {
  if (message.role === "user" || message.role === "toolResult") {
    if (typeof message.content === "string") return message.content.length;
    return message.content.reduce(
      (sum, block) => sum + (block.type === "text" ? block.text.length : IMAGE_CHARACTER_WEIGHT),
      0,
    );
  }
  return message.content.reduce((sum, block) => {
    if (block.type === "text") return sum + block.text.length;
    if (block.type === "thinking") return sum + block.thinking.length;
    return sum + block.name.length + safeJson(block.arguments).length;
  }, 0);
}

function classifyMessages(
  target: Record<SessionContextBreakdownCategory, WeightedCategory>,
  messages: AgentSession["messages"],
): void {
  for (const original of messages) {
    let converted: Message[];
    try {
      converted = convertToLlm([original]);
    } catch {
      addCharacters(target, "other", safeJson(original).length, 1);
      continue;
    }
    for (const message of converted) {
      if (original.role === "branchSummary" || original.role === "compactionSummary") {
        addCharacters(target, "other", messageCharacterWeight(message), 1);
      } else if (original.role === "bashExecution" || message.role === "toolResult") {
        addCharacters(target, "tool-results", messageCharacterWeight(message), 1);
      } else if (original.role === "custom") {
        addCharacters(target, "other", messageCharacterWeight(message), 1);
      } else if (message.role === "user") {
        target["user-input"].count += 1;
        classifyUserMessage(target, message);
      } else if (message.role === "assistant") {
        addCharacters(target, "assistant-history", messageCharacterWeight(message), 1);
      }
    }
  }
}

function allocateTokens(
  weighted: Record<SessionContextBreakdownCategory, WeightedCategory>,
  totalTokens: number,
): SessionContextBreakdownItem[] {
  const totalCharacters = CATEGORY_ORDER.reduce(
    (sum, category) => sum + weighted[category].characters,
    0,
  );
  if (totalCharacters <= 0) {
    return CATEGORY_ORDER.map((category) => ({
      category,
      tokens: category === "other" ? totalTokens : 0,
      count: weighted[category].count,
    }));
  }
  const allocations = CATEGORY_ORDER.map((category) => {
    const exact = (weighted[category].characters / totalCharacters) * totalTokens;
    const tokens = Math.floor(exact);
    return { category, tokens, remainder: exact - tokens };
  });
  let remaining = totalTokens - allocations.reduce((sum, item) => sum + item.tokens, 0);
  for (const item of [...allocations].sort((left, right) => right.remainder - left.remainder)) {
    if (remaining <= 0) break;
    item.tokens += 1;
    remaining -= 1;
  }
  return allocations.map(({ category, tokens }) => ({
    category,
    tokens,
    count: weighted[category].count,
  }));
}

export function estimateContextBreakdown(input: ContextBreakdownInput): SessionContextBreakdown {
  const weighted = categories();
  let remainingSystemPrompt = input.systemPrompt;

  const invocableSkills = input.skills.filter((skill) => !skill.disableModelInvocation);
  const skillsBlock = formatSkillsForPrompt(invocableSkills);
  const withoutSkills = removeLastExactBlock(remainingSystemPrompt, skillsBlock);
  remainingSystemPrompt = withoutSkills.text;
  if (withoutSkills.removed) {
    addCharacters(weighted, "skills", skillsBlock.length, invocableSkills.length);
  }

  const filesBlock = contextFilesBlock(input.contextFiles);
  const withoutFiles = removeLastExactBlock(remainingSystemPrompt, filesBlock);
  remainingSystemPrompt = withoutFiles.text;
  if (withoutFiles.removed) {
    addCharacters(weighted, "context-files", filesBlock.length, input.contextFiles.length);
  }

  addCharacters(
    weighted,
    "system-prompt",
    remainingSystemPrompt.length,
    remainingSystemPrompt ? 1 : 0,
  );

  const activeTools = new Set(input.activeToolNames);
  for (const tool of input.tools) {
    if (!activeTools.has(tool.name)) continue;
    addCharacters(
      weighted,
      toolCategory(tool),
      safeJson({ name: tool.name, description: tool.description, parameters: tool.parameters })
        .length,
      1,
    );
  }

  classifyMessages(weighted, input.messages);

  const heuristicTotal = Math.ceil(
    CATEGORY_ORDER.reduce((sum, category) => sum + weighted[category].characters, 0) /
      CHARACTERS_PER_TOKEN,
  );
  const providerTotal = input.contextTokens;
  const totalTokens =
    providerTotal !== null && Number.isFinite(providerTotal) && providerTotal >= 0
      ? Math.round(providerTotal)
      : heuristicTotal;
  return {
    basis: providerTotal === null ? "heuristic" : "provider-reconciled",
    totalTokens,
    items: allocateTokens(weighted, totalTokens),
  };
}

export function estimateSessionContextBreakdown(
  session: Pick<
    AgentSession,
    "systemPrompt" | "messages" | "resourceLoader" | "getActiveToolNames" | "getAllTools"
  >,
  contextTokens: number | null,
): SessionContextBreakdown {
  return estimateContextBreakdown({
    systemPrompt: session.systemPrompt,
    skills: session.resourceLoader.getSkills().skills,
    contextFiles: session.resourceLoader.getAgentsFiles().agentsFiles,
    tools: session.getAllTools(),
    activeToolNames: session.getActiveToolNames(),
    messages: session.messages,
    contextTokens,
  });
}

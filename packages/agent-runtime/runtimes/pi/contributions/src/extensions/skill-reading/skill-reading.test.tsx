import assert from "node:assert/strict";
import test from "node:test";
import { WrenchIcon } from "lucide-react";
import type {
  AssistantMessageNode,
  DataBlock,
  ToolCallBlock,
} from "@workbench/agent-runtime-contracts/conversation";
import { ExtensionManager } from "@workbench/extension-sdk/internal";
import { WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME } from "@workbench/agent-runtime-pi-client/context-trace";
import { createPiI18n } from "../../i18n";
import { skillReadingForCall } from "./skill-reading-state";
import { skillReadingExtension, skillReadingPresentation } from "./extension";

const skillPath = "/workspace/.pi/skills/review/SKILL.md";
const catalog: DataBlock = {
  key: "catalog",
  kind: "data",
  name: WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME,
  data: {
    version: 1,
    event: {
      schemaVersion: 1,
      traceId: "trace",
      sessionId: "session",
      activationId: "activation",
      seq: 1,
      time: 1,
      kind: "prompt-composition",
      promptResources: {
        cwd: "/workspace",
        skills: [{ name: "Review changes", filePath: skillPath, disableModelInvocation: false }],
      },
    },
  },
};

function read(
  path: string,
  status: ToolCallBlock["status"] = "running",
  extra: Partial<ToolCallBlock> = {},
): ToolCallBlock {
  return {
    kind: "tool-call",
    key: path,
    callId: path,
    toolName: "read",
    arguments: { path },
    argumentsText: "",
    status,
    ...(status === "complete" ? { result: "Skill instructions" } : {}),
    ...extra,
  };
}

function node(
  blocks: AssistantMessageNode["blocks"],
  status: AssistantMessageNode["status"] = "running",
): AssistantMessageNode {
  return { kind: "assistant", key: "assistant", status, blocks: [catalog, ...blocks] };
}

test("labels the live read tool row before either the result or assistant turn completes", () => {
  const block = read(skillPath);
  const owner = node([block]);
  const presentation = skillReadingPresentation.resolve?.(block, owner);
  const label = presentation?.activeLabel;
  assert.ok(label);
  assert.equal(createPiI18n("zh-CN").text(label), "正在读取 Review changes 技能");
  assert.equal(createPiI18n("en-US").text(label), "Reading Review changes skill");
  assert.equal(
    skillReadingForCall(block, { ...owner, status: "complete" })?.status,
    "loading",
    "the call's own execution state is authoritative",
  );
  assert.equal(presentation?.summarize?.(block), "");
  assert.equal(presentation?.icon, WrenchIcon);
  assert.equal(presentation?.compact, true);
  const complete = read(skillPath, "complete");
  assert.equal(
    createPiI18n("zh-CN").text(
      skillReadingPresentation.resolve!(complete, node([complete]))!.label,
    ),
    "已读取 Review changes 技能",
  );
});

test("labels each progressive resource on its original tool row without regressing the document", () => {
  const document = read(skillPath, "complete");
  const resource = read(".pi/skills/review/references/navigation.md");
  const owner = node([document, resource]);
  assert.equal(skillReadingForCall(document, owner)?.status, "read");
  assert.equal(
    createPiI18n("zh-CN").text(skillReadingPresentation.resolve!(resource, owner)!.activeLabel),
    "正在读取 Review changes 技能资料",
  );
  assert.equal(
    skillReadingPresentation.resolve?.(resource, owner)?.summarize?.(resource),
    "references/navigation.md",
  );
  assert.equal(skillReadingForCall(resource, owner)?.isDocument, false);
  const failed = { ...resource, status: "error" as const };
  assert.equal(
    createPiI18n("zh-CN").text(skillReadingPresentation.resolve!(failed, owner)!.terminalLabel!),
    "Review changes 技能资料读取失败",
  );
});

test("matches catalog paths, boundaries and Windows identities, preserving ordinary read fallback", () => {
  for (const path of [
    "src/SKILL.md",
    ".pi/skills/review-other/SKILL.md",
    ".pi/skills/review/../../outside.md",
  ]) {
    const block = read(path);
    assert.equal(skillReadingForCall(block, node([block])), undefined);
    assert.equal(skillReadingPresentation.resolve?.(block, node([block])), undefined);
  }
  const partial = read("ignored", "running", { arguments: {}, argumentsText: '{"path":' });
  assert.equal(skillReadingForCall(partial, node([partial])), undefined);
  assert.equal(skillReadingForCall(read(skillPath)), undefined);
  const windows = JSON.parse(
    JSON.stringify(catalog).replaceAll("/workspace", "C:/workspace"),
  ) as DataBlock;
  const block = read("c:\\WORKSPACE\\.pi\\skills\\review\\skill.md", "complete");
  assert.equal(
    skillReadingForCall(block, { ...node([]), blocks: [windows, block] })?.isDocument,
    true,
  );
});

test("keeps partial, failed, cancelled and waiting calls distinct from successful reads", () => {
  const segmented = read(skillPath, "complete", { arguments: { path: skillPath, limit: 10 } });
  assert.equal(skillReadingForCall(segmented, node([segmented]))?.status, "partial");
  for (const [status, expected] of [
    ["error", "error"],
    ["incomplete", "cancelled"],
    ["requires-action", "waiting"],
  ] as const) {
    const block = read(skillPath, status, { incompleteReason: "cancelled" });
    assert.equal(skillReadingForCall(block, node([block]))?.status, expected);
  }
  const interrupted = read(skillPath, "incomplete", { incompleteReason: "length" });
  assert.equal(skillReadingForCall(interrupted, node([interrupted]))?.status, "error");
  const empty = read(skillPath, "complete", {
    result: {
      text: "Use bash",
      details: { truncation: { truncated: true, firstLineExceedsLimit: true } },
    },
  });
  assert.equal(skillReadingForCall(empty, node([empty]))?.status, "empty");
});

test("registers on read tool presentation and removes the detached message card", () => {
  const manager = new ExtensionManager();
  const activation = manager.activate(skillReadingExtension);
  assert.ok(manager.renderers.toolPresentations.get("read"));
  assert.equal(manager.slots.get("message.before").length, 0);
  activation.dispose();
  assert.equal(manager.renderers.toolPresentations.get("read"), undefined);
});

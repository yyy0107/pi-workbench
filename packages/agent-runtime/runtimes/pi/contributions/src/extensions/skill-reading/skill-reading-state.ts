import type { MessageBlockNode } from "@workbench/extension-sdk";
import { toolResultText, toolStringArg } from "@workbench/agent-runtime-client";
import type { ToolCallBlock } from "@workbench/agent-runtime-contracts/conversation";
import {
  parsePiContextTraceData,
  WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME,
} from "@workbench/agent-runtime-pi-client/context-trace";

export type SkillFileReadStatus =
  | "loading"
  | "read"
  | "partial"
  | "empty"
  | "error"
  | "cancelled"
  | "waiting";

export interface SkillReadingState {
  name: string;
  path: string;
  isDocument: boolean;
  status: SkillFileReadStatus;
}

// ponytail: match catalog paths lexically; filesystem aliases need canonical runtime identities.
function absolutePath(value: string, cwd?: string): string | undefined {
  const path = value.replaceAll("\\", "/");
  if (path.startsWith("~")) return undefined;
  const absolute = path.startsWith("/") || /^[a-z]:\//i.test(path);
  if (!absolute && !cwd) return undefined;
  const joined = absolute ? path : `${cwd!.replaceAll("\\", "/")}/${path}`;
  const prefix = joined.startsWith("//") ? "//" : joined.startsWith("/") ? "/" : "";
  const segments: string[] = [];
  for (const segment of joined.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length && !/^[a-z]:$/i.test(segments.at(-1)!)) segments.pop();
    } else segments.push(segment);
  }
  return prefix + segments.join("/");
}

function pathKey(path: string): string {
  return /^[a-z]:\//i.test(path) || path.startsWith("//") ? path.toLowerCase() : path;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readStatus(block: ToolCallBlock): SkillFileReadStatus {
  if (block.status === "running") return "loading";
  if (block.status === "requires-action") return "waiting";
  if (block.status === "error") return "error";
  if (block.status === "incomplete")
    return block.incompleteReason === "cancelled" ? "cancelled" : "error";
  const args = record(block.arguments);
  const truncation = record(record(record(block.result)?.details)?.truncation);
  if (truncation?.firstLineExceedsLimit === true || !toolResultText(block.result)?.trim())
    return "empty";
  return (typeof args?.offset === "number" && args.offset > 1) ||
    args?.limit !== undefined ||
    truncation?.truncated === true
    ? "partial"
    : "read";
}

/** Match the running call itself; do not wait for an assistant turn or tool result to complete. */
export function skillReadingForCall(
  block: ToolCallBlock,
  node?: MessageBlockNode,
): SkillReadingState | undefined {
  if (block.toolName !== "read" || !node) return undefined;
  const argument = toolStringArg(block.arguments, "path");
  if (!argument) return undefined;
  let match: SkillReadingState | undefined;
  let matchedRootLength = -1;
  for (const part of node.blocks) {
    if (part.kind !== "data" || part.name !== WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME) continue;
    const resources = parsePiContextTraceData(part.data)?.event.promptResources;
    if (!resources || !Array.isArray(resources.skills)) continue;
    const cwd = typeof resources.cwd === "string" ? resources.cwd : undefined;
    const path = absolutePath(argument, cwd);
    if (!path) continue;
    for (const skill of resources.skills) {
      if (!skill || typeof skill.name !== "string" || typeof skill.filePath !== "string") continue;
      const filePath = absolutePath(skill.filePath, cwd);
      if (!filePath) continue;
      const root = filePath.slice(0, filePath.lastIndexOf("/") + 1);
      if (root.length < matchedRootLength || !pathKey(path).startsWith(pathKey(root))) continue;
      matchedRootLength = root.length;
      match = {
        name: skill.name,
        path: path.slice(root.length),
        isDocument: pathKey(path) === pathKey(filePath),
        status: readStatus(block),
      };
    }
  }
  return match;
}

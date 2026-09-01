import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import type {
  AssistantMessage,
  Message,
  TextContent,
  ThinkingContent,
  ToolCall,
  Usage,
} from "@earendil-works/pi-ai";

import { deriveSessionDisplayTitle } from "@workbench/agent-runtime-pi-shared/sessions";

const MAX_DISCOVERED_FILES = 5_000;
const MAX_JSONL_LINE_BYTES = 32 * 1024 * 1024;
const MAX_IMPORTED_TEXT_CHARACTERS = 1_000_000;

export async function mapSettledWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  worker: (item: Input, index: number) => Promise<Output>,
): Promise<Array<PromiseSettledResult<Output>>> {
  const results: Array<PromiseSettledResult<Output>> = [];
  let nextIndex = 0;
  const run = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => run()),
  );
  return results;
}

export const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function timestamp(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function boundedText(value: unknown): string {
  if (typeof value !== "string") return "";
  if (value.length <= MAX_IMPORTED_TEXT_CHARACTERS) return value;
  return `${value.slice(0, MAX_IMPORTED_TEXT_CHARACTERS)}\n\n[Imported content truncated]`;
}

export function titleFromText(value: unknown, fallback: string): string {
  const title = deriveSessionDisplayTitle(boundedText(value));
  return title || fallback;
}

export function parseArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return { input: boundedText(value) };
  }
}

export function textBlocks(value: unknown): TextContent[] {
  if (typeof value === "string") {
    const text = boundedText(value);
    return text ? [{ type: "text", text }] : [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): TextContent[] => {
    if (typeof item === "string") {
      const text = boundedText(item);
      return text ? [{ type: "text", text }] : [];
    }
    if (!isRecord(item)) return [];
    const text = boundedText(item.text ?? item.content);
    return text ? [{ type: "text", text }] : [];
  });
}

export function assistantMessage(options: {
  content: Array<TextContent | ThinkingContent | ToolCall>;
  timestamp: number;
  provider: string;
  model: string;
  api: "anthropic-messages" | "openai-responses";
  usage?: Usage;
  stopReason?: AssistantMessage["stopReason"];
  errorMessage?: string;
}): AssistantMessage {
  return {
    role: "assistant",
    content: options.content,
    api: options.api,
    provider: options.provider,
    model: options.model,
    usage: options.usage ?? ZERO_USAGE,
    stopReason: options.stopReason ?? "stop",
    ...(options.errorMessage ? { errorMessage: options.errorMessage } : {}),
    timestamp: options.timestamp,
  };
}

export function hasAssistantMessage(messages: readonly Message[]): boolean {
  return messages.some((message) => message.role === "assistant");
}

export function importedSessionId(source: string, sourceSessionId: string): string {
  const digest = createHash("sha256")
    .update(source)
    .update("\0")
    .update(sourceSessionId)
    .digest("hex");
  return `import-${source}-${digest.slice(0, 32)}`;
}

export async function jsonlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (files.length >= MAX_DISCOVERED_FILES) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= MAX_DISCOVERED_FILES || entry.isSymbolicLink()) break;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(entryPath);
    }
  };
  await visit(root);
  return files;
}

export interface ReadJsonlOptions {
  maxRecords?: number;
  stop?(record: Record<string, unknown>, recordCount: number): boolean;
}

export async function readJsonl(
  filePath: string,
  consume: (record: Record<string, unknown>) => void,
  options: ReadJsonlOptions = {},
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let recordCount = 0;
  try {
    for await (const line of lines) {
      if (!line || Buffer.byteLength(line) > MAX_JSONL_LINE_BYTES) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(parsed)) continue;
      recordCount += 1;
      consume(parsed);
      if (options.stop?.(parsed, recordCount) || recordCount >= (options.maxRecords ?? Infinity)) {
        break;
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

export async function fileTimes(
  filePath: string,
): Promise<{ createdAt: number; updatedAt: number }> {
  const metadata = await stat(filePath);
  return {
    createdAt: metadata.birthtimeMs || metadata.ctimeMs || metadata.mtimeMs,
    updatedAt: metadata.mtimeMs,
  };
}

export async function workspaceIssue(
  cwd: string,
): Promise<"workspace-missing" | "workspace-not-directory" | undefined> {
  if (!cwd) return "workspace-missing";
  try {
    const metadata = await stat(cwd);
    return metadata.isDirectory() ? undefined : "workspace-not-directory";
  } catch {
    return "workspace-missing";
  }
}

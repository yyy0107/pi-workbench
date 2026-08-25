import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { SessionManager, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";

import { fetchProgressiveSessionHistory } from "../../client/sessions/session-history-loader";
import type { SessionEvent } from "../../rpc-contracts";

import { ColdSessionEventCache } from "./cold-session-event-cache";
import { initializeSessionEventJournal } from "./session-event-journal";
import { SessionRpcService, type SessionRpcWorkspaceStore } from "./session-rpc-service";

const HISTORY_SIZES = [1_000, 10_000] as const;

interface BenchmarkResult {
  source: "active" | "cold";
  messages: number;
  rpcPages: number;
  physicalColdLoads: number;
  durationMs: number;
  peakHeapDeltaMiB: number;
}

const workspaceStore: SessionRpcWorkspaceStore = {
  list: async () => ({ items: [] }),
  attachSession: async () => {
    throw new Error("The history benchmark never attaches sessions.");
  },
  reconcile: async () => ({ items: [] }),
};

function activeEvents(messageCount: number): SessionEvent[] {
  return Array.from({ length: messageCount }, (_, seq) => ({
    type: "message" as const,
    seq,
    time: seq + 1,
    data: { role: "user" as const, content: `message ${seq}`, timestamp: seq + 1 },
  }));
}

async function createColdSession(root: string, messageCount: number): Promise<string> {
  const sessionDir = path.join(root, `sessions-${messageCount}`);
  await mkdir(sessionDir, { recursive: true });
  const manager = SessionManager.create(root, sessionDir, {
    id: `history-benchmark-${messageCount}`,
  });
  for (let index = 0; index < messageCount; index += 1) {
    // Pi defers a user-only session file until an assistant message exists. Starting with one
    // completed assistant entry makes the remaining fixture append to a real cold JSONL file.
    if (index === 0) {
      manager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "message 0" }],
        api: "anthropic-messages",
        provider: "benchmark",
        model: "benchmark",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 1,
      });
    } else {
      manager.appendMessage({
        role: "user",
        content: `message ${index}`,
        timestamp: index + 1,
      });
    }
  }
  const sessionFile = manager.getSessionFile();
  assert.ok(sessionFile, "The persisted benchmark session must have a JSONL file.");
  return sessionFile;
}

function coldEvents(sessionFile: string): SessionEvent[] {
  const manager = SessionManager.open(sessionFile);
  let seq = 0;
  const legacyEvents = manager.buildContextEntries().flatMap((entry) =>
    sessionEntryToContextMessages(entry).map((message) => ({
      type: "message" as const,
      seq: seq++,
      time: typeof message.timestamp === "number" ? message.timestamp : 0,
      data: message,
    })),
  );
  const initialized = initializeSessionEventJournal(manager, legacyEvents);
  if (initialized.error !== undefined) throw initialized.error;
  return initialized.events;
}

async function runScenario(
  source: BenchmarkResult["source"],
  messageCount: number,
  loadEvents: (canonicalPath?: string) => readonly SessionEvent[],
  coldSessionFile?: string,
): Promise<BenchmarkResult> {
  let rpcPages = 0;
  let physicalColdLoads = 0;
  const coldCache = new ColdSessionEventCache();
  const heapBefore = process.memoryUsage().heapUsed;
  let peakHeapUsed = heapBefore;
  const sampleHeap = () => {
    peakHeapUsed = Math.max(peakHeapUsed, process.memoryUsage().heapUsed);
  };
  const service = new SessionRpcService({
    workspaceStore,
    dependencies: {
      getSessionEvents: async () => {
        let events: SessionEvent[];
        if (coldSessionFile) {
          events = await coldCache.load(coldSessionFile, (canonicalPath) => {
            physicalColdLoads += 1;
            return loadEvents(canonicalPath);
          });
        } else {
          const active = loadEvents();
          events = [...active];
        }
        sampleHeap();
        return events;
      },
    },
  });
  const startedAt = performance.now();
  const history = await fetchProgressiveSessionHistory("history-benchmark", async (payload) => {
    rpcPages += 1;
    const page = await service.history(payload);
    sampleHeap();
    return page;
  });
  const durationMs = performance.now() - startedAt;
  sampleHeap();
  const peakHeapDeltaMiB = (peakHeapUsed - heapBefore) / (1024 * 1024);

  assert.equal(history.events.length, messageCount);
  assert.equal(history.events[0]?.event.seq, 0);
  assert.equal(history.events.at(-1)?.event.seq, messageCount - 1);
  return {
    source,
    messages: messageCount,
    rpcPages,
    physicalColdLoads,
    durationMs: Number(durationMs.toFixed(1)),
    peakHeapDeltaMiB: Number(peakHeapDeltaMiB.toFixed(1)),
  };
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-history-benchmark-"));
  const results: BenchmarkResult[] = [];
  try {
    for (const messageCount of HISTORY_SIZES) {
      const active = activeEvents(messageCount);
      results.push(await runScenario("active", messageCount, () => [...active]));

      const sessionFile = await createColdSession(root, messageCount);
      results.push(
        await runScenario(
          "cold",
          messageCount,
          (canonicalPath) => coldEvents(canonicalPath ?? sessionFile),
          sessionFile,
        ),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.table(results);
}

await main();

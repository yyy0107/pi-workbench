import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseSessionEntries,
  SessionManager,
  type FileEntry,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import {
  aggregateUsageStatistics,
  readUsageStatistics,
  usageMessages,
} from "../../src/sessions/usage-statistics";
import { getLoadedSessions } from "../../src/sessions/session-registry";
import { createUsageStatisticsRpcRoutes } from "../../src/transport/routes/usage-statistics-rpc-routes";

function message(
  id: string,
  timestamp: string,
  role: "user" | "assistant" = "assistant",
  provider = "provider-a",
) {
  const common = { timestamp: Date.parse(timestamp), content: [] };
  return {
    type: "message",
    id,
    parentId: null,
    timestamp,
    message:
      role === "user"
        ? { ...common, role }
        : {
            ...common,
            role,
            api: "openai-completions",
            provider,
            model: "model-a",
            stopReason: "stop",
            usage: {
              input: 10,
              output: 20,
              cacheRead: 30,
              cacheWrite: 40,
              totalTokens: 100,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          },
  } satisfies SessionMessageEntry;
}

async function* sessions(...values: FileEntry[][]) {
  for (const entries of values) yield usageMessages(entries);
}

test("reads and refreshes native persisted sessions without starting hosts or changing their files", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "workbench-usage-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
  const globals = globalThis as typeof globalThis & { __workbenchPiRegistry?: unknown };
  delete globals.__workbenchPiRegistry;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    delete globals.__workbenchPiRegistry;
    await rm(root, { recursive: true, force: true });
  });
  const cwd = path.join(root, "project");
  await mkdir(cwd);
  const manager = SessionManager.create(cwd);
  manager.appendMessage(message("user", "2026-01-01T00:00:00Z", "user").message);
  manager.appendMessage(message("assistant", "2026-01-01T00:01:00Z").message);
  const file = manager.getSessionFile()!;
  const before = await readFile(file, "utf8");
  const first = await readUsageStatistics({ timeZone: "UTC" }, new AbortController().signal);
  assert.equal(first.totalTokens, 100);
  assert.equal(first.longestChatMs, 60_000);
  assert.equal(getLoadedSessions().length, 0);
  assert.equal(await readFile(file, "utf8"), before);
  let reads = 0;
  const originalReadFile = fs.readFile;
  const readMock = t.mock.method(fs, "readFile", (...args: Parameters<typeof fs.readFile>) => {
    if (args[0] === file) reads++;
    return originalReadFile(...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    readMock.mock.restore();
    syncBuiltinESMExports();
  });
  const cached = await readUsageStatistics({ timeZone: "UTC" }, new AbortController().signal);
  assert.deepEqual(cached.days, first.days);
  assert.equal(reads, 0, "unchanged session files must not be read again");
  const localized = await readUsageStatistics(
    { timeZone: "America/Los_Angeles" },
    new AbortController().signal,
  );
  assert.equal(localized.days[0]!.date, "2025-12-31");
  assert.equal(reads, 0, "changing timezone reuses message statistics without reading the file");
  manager.appendMessage(message("next", "2026-01-02T00:01:00Z").message);
  const refreshed = await readUsageStatistics({ timeZone: "UTC" }, new AbortController().signal);
  assert.equal(refreshed.totalTokens, 200);
  assert.equal(refreshed.longestStreak, 2);
  assert.ok(reads > 0, "changed files must be read again");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readUsageStatistics({ timeZone: "UTC" }, controller.signal), {
    name: "AbortError",
  });
  await rm(file);
  const deleted = await readUsageStatistics({ timeZone: "UTC" }, new AbortController().signal);
  assert.equal(deleted.totalTokens, 0);
  assert.deepEqual(deleted.days, []);
});

test("aggregates real messages across branches, local dates and DST without counting copied journals", async () => {
  const inherited = message("inherited", "2026-03-08T07:55:00Z"); // March 7 in Los Angeles
  const first = message("first", "2026-03-08T08:01:00Z", "user");
  const last = message("last", "2026-03-08T10:01:00Z"); // DST jump, two elapsed hours
  const otherProvider = message("provider-b", "2026-03-08T10:02:00Z", "assistant", "provider-b");
  const journal = {
    type: "custom",
    id: "journal",
    parentId: null,
    timestamp: last.timestamp,
    customType: "workbench.session-event.v1",
    data: { event: { data: { message: last.message } } },
  } satisfies FileEntry;
  const result = await aggregateUsageStatistics(
    sessions(
      [inherited],
      [first, last, otherProvider, journal],
      [inherited, message("fork-new", "2026-03-08T10:02:00Z")],
      parseSessionEntries(
        'null\n{"type":"message","message":{"role":"assistant","timestamp":-1}}\n{"incomplete"',
      ),
    ),
    "America/Los_Angeles",
    new Date("2026-03-09T12:00:00Z"),
  );
  assert.equal(result.totalTokens, 400);
  assert.equal(result.peakDailyTokens, 300);
  assert.deepEqual(
    result.days.map(({ date, tokens, messages }) => ({ date, tokens, messages })),
    [
      { date: "2026-03-07", tokens: 100, messages: 1 },
      { date: "2026-03-08", tokens: 300, messages: 4 },
    ],
  );
  assert.equal(result.days[1]!.models.length, 2);
  assert.equal(result.days[1]!.models[0]!.tokens, 200);
  assert.equal(result.currentStreak, 2); // Yesterday counts until today finishes.
  assert.equal(result.longestStreak, 2);
  assert.equal(
    result.longestChatMs,
    Date.parse("2026-03-08T10:02:00Z") - Date.parse(inherited.timestamp),
  );
});

test("handles gaps, empty history, unknown usage and future timestamps", async () => {
  const now = new Date("2026-09-06T12:00:00Z");
  const empty = await aggregateUsageStatistics(sessions([]), "UTC", now);
  assert.equal(empty.totalTokens, 0);
  assert.equal(empty.currentStreak, 0);
  assert.equal(empty.longestStreak, 0);
  assert.equal(empty.longestChatMs, 0);
  const missingUsage = message("missing", "2026-09-02T00:00:00Z");
  if (missingUsage.message.role === "assistant") missingUsage.message.usage.input = NaN;
  const result = await aggregateUsageStatistics(
    sessions([
      message("a", "2026-09-01T00:00:00Z"),
      missingUsage,
      message("b", "2026-09-04T00:00:00Z"),
      message("future", "2026-09-07T00:00:00Z"),
    ]),
    "UTC",
    now,
  );
  assert.equal(result.totalTokens, 200);
  assert.equal(result.currentStreak, 0);
  assert.equal(result.longestStreak, 2);
});

test("usage RPC validates timezone before reading and returns the standard RPC envelope", async () => {
  let calls = 0;
  const routes = createUsageStatisticsRpcRoutes({
    readUsage: async ({ timeZone }) => {
      calls += 1;
      return aggregateUsageStatistics(sessions([]), timeZone, new Date("2026-09-06T12:00:00Z"));
    },
  });
  const request = (timeZone: unknown) =>
    new Request("http://127.0.0.1:3000/api/usage.statistics", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId: "usage-1",
        method: "usage.statistics",
        payload: { timeZone },
      }),
    });
  for (const timeZone of ["invalid/timezone", null, ""]) {
    const response = await routes.handle(request(timeZone), "usage.statistics")!;
    assert.equal((await response.json()).result.ok, false);
  }
  assert.equal(calls, 0);
  const response = await routes.handle(request("America/Los_Angeles"), "usage.statistics")!;
  const body = await response.json();
  assert.equal(body.rpcId, "usage-1");
  assert.equal(body.result.ok, true);
  assert.equal(body.result.value.timeZone, "America/Los_Angeles");
  assert.equal(calls, 1);
  assert.equal(routes.handle(request("UTC"), "session.list"), undefined);
});

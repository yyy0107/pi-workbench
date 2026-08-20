import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerHooks } from "node:module";
import test, { type TestContext } from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/.test(specifier) &&
      context.parentURL?.includes("/runtime/pi/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { handleSessionExportRequest } = (await import(
  new URL("./session-export.ts", import.meta.url).href
)) as typeof import("./session-export");
moduleHooks.deregister();

type SessionExportDependencies = import("./session-export").SessionExportDependencies;
type SessionExportSessionInfo = import("./session-export").SessionExportSessionInfo;

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

interface StoredZipEntry {
  bytes: Uint8Array;
  crc32: number;
  flags: number;
  method: number;
}

const testCrcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = (testCrcTable[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function parseStoredZip(bytes: Uint8Array): Map<string, StoredZipEntry> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = buffer.byteLength - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      endOffset = offset;
      break;
    }
  }
  assert.notEqual(endOffset, -1, "missing ZIP end-of-central-directory record");
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);
  assert.equal(centralDirectoryOffset + centralDirectorySize, endOffset);

  const files = new Map<string, StoredZipEntry>();
  let centralOffset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(centralOffset), ZIP_CENTRAL_DIRECTORY_SIGNATURE);
    const flags = buffer.readUInt16LE(centralOffset + 8);
    const method = buffer.readUInt16LE(centralOffset + 10);
    const expectedCrc32 = buffer.readUInt32LE(centralOffset + 16);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const name = buffer
      .subarray(centralOffset + 46, centralOffset + 46 + nameLength)
      .toString("utf8");

    assert.equal(method, 0, "session export must use the store method");
    assert.equal(compressedSize, uncompressedSize);
    assert.equal(buffer.readUInt32LE(localOffset), ZIP_LOCAL_FILE_HEADER_SIGNATURE);
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    assert.equal(localFlags, flags);
    assert.equal(localMethod, method);
    assert.equal(
      buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8"),
      name,
    );
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const fileBytes = buffer.subarray(dataOffset, dataOffset + uncompressedSize);
    const descriptorOffset = dataOffset + uncompressedSize;
    assert.equal(buffer.readUInt32LE(descriptorOffset), ZIP_DATA_DESCRIPTOR_SIGNATURE);
    assert.equal(buffer.readUInt32LE(descriptorOffset + 4), expectedCrc32);
    assert.equal(buffer.readUInt32LE(descriptorOffset + 8), uncompressedSize);
    assert.equal(buffer.readUInt32LE(descriptorOffset + 12), uncompressedSize);
    assert.equal(crc32(fileBytes), expectedCrc32);
    assert.equal(files.has(name), false, `duplicate ZIP path: ${name}`);
    files.set(name, {
      bytes: Uint8Array.from(fileBytes),
      crc32: expectedCrc32,
      flags,
      method,
    });

    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(centralOffset, endOffset);
  return files;
}

function trustedRequest(query: string, method: "GET" | "HEAD" = "GET"): Request {
  return new Request(`http://127.0.0.1:3000/api/session.export${query}`, {
    method,
    headers: { host: "127.0.0.1:3000" },
  });
}

function testDependencies(
  sessions: readonly SessionExportSessionInfo[],
  knownIds: readonly string[] = sessions.map((session) => session.id),
  overrides: Partial<SessionExportDependencies> = {},
): SessionExportDependencies {
  return {
    async listRawSessions(signal) {
      signal.throwIfAborted();
      return sessions;
    },
    async listKnownSessionIds(signal) {
      signal.throwIfAborted();
      return knownIds;
    },
    async inspectRawArtifact(path, signal) {
      signal.throwIfAborted();
      const info = await stat(path);
      signal.throwIfAborted();
      return { byteLength: info.size, regularFile: info.isFile() };
    },
    async *readRawArtifact(path, signal) {
      signal.throwIfAborted();
      const content = await readFile(path, { signal });
      for (let offset = 0; offset < content.byteLength; offset += 7) {
        signal.throwIfAborted();
        yield content.subarray(offset, Math.min(offset + 7, content.byteLength));
      }
    },
    ...overrides,
  };
}

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "workbench-session-export-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("streams a store-only ZIP containing the Pi JSONL bytes verbatim", async (t) => {
  const directory = await temporaryDirectory(t);
  const path = join(directory, "raw-root.jsonl");
  const raw = Buffer.concat([
    Buffer.from('{"type":"session","id":"root.with.dots"}\r\n', "utf8"),
    Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d, 0x0a]),
  ]);
  await writeFile(path, raw);
  const dependencies = testDependencies([{ id: "root.with.dots", path }]);

  const response = await handleSessionExportRequest(
    trustedRequest("?sessionId=root.with.dots"),
    dependencies,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="dsh-session-root_with_dots.zip"',
  );
  const files = parseStoredZip(new Uint8Array(await response.arrayBuffer()));
  assert.deepEqual([...files.keys()], ["session.jsonl"]);
  assert.deepEqual(files.get("session.jsonl")?.bytes, Uint8Array.from(raw));
  assert.equal((files.get("session.jsonl")?.flags ?? 0) & 0x0008, 0x0008);
});

test("recursively includes descendants under traversal-safe, unique ZIP paths", async (t) => {
  const directory = await temporaryDirectory(t);
  const rootPath = join(directory, "root.jsonl");
  const childPath = join(directory, "child.jsonl");
  const collidingChildPath = join(directory, "child-collision.jsonl");
  const grandchildPath = join(directory, "grandchild.jsonl");
  const unrelatedPath = join(directory, "unrelated.jsonl");
  await Promise.all([
    writeFile(rootPath, "root\n"),
    writeFile(childPath, "child\n"),
    writeFile(collidingChildPath, "collision\n"),
    writeFile(grandchildPath, "grandchild\n"),
    writeFile(unrelatedPath, "unrelated\n"),
  ]);
  const sessions: SessionExportSessionInfo[] = [
    { id: "root", path: rootPath },
    { id: "../child", path: childPath, parentSessionPath: rootPath },
    { id: "___child", path: collidingChildPath, parentSessionPath: rootPath },
    { id: "grand.child", path: grandchildPath, parentSessionPath: childPath },
    { id: "unrelated", path: unrelatedPath },
  ];
  const dependencies = testDependencies(sessions);

  const rootOnly = await handleSessionExportRequest(
    trustedRequest("?sessionId=root"),
    dependencies,
  );
  assert.deepEqual(
    [...parseStoredZip(new Uint8Array(await rootOnly.arrayBuffer())).keys()],
    ["session.jsonl"],
  );

  const withDescendants = await handleSessionExportRequest(
    trustedRequest("?sessionId=root&includeDescendants=true"),
    dependencies,
  );
  const files = parseStoredZip(new Uint8Array(await withDescendants.arrayBuffer()));
  assert.deepEqual(
    [...files.keys()],
    [
      "session.jsonl",
      "subagents/___child/session.jsonl",
      "subagents/grand_child/session.jsonl",
      "subagents/___child_2/session.jsonl",
    ],
  );
  assert.deepEqual(
    files.get("subagents/___child/session.jsonl")?.bytes,
    Uint8Array.from(Buffer.from("child\n")),
  );
  for (const path of files.keys()) {
    assert.equal(path.startsWith("/"), false);
    assert.equal(path.includes("\\"), false);
    assert.equal(path.split("/").includes(".."), false);
  }
});

test("HEAD preflights the same result and headers without returning a body", async (t) => {
  const directory = await temporaryDirectory(t);
  const path = join(directory, "root.jsonl");
  await writeFile(path, "root\n");
  const dependencies = testDependencies([{ id: "root", path }]);

  const getResponse = await handleSessionExportRequest(
    trustedRequest("?sessionId=root"),
    dependencies,
  );
  const headResponse = await handleSessionExportRequest(
    trustedRequest("?sessionId=root", "HEAD"),
    dependencies,
  );
  assert.equal(headResponse.status, getResponse.status);
  assert.deepEqual([...headResponse.headers], [...getResponse.headers]);
  assert.equal(headResponse.body, null);
  assert.equal((await headResponse.arrayBuffer()).byteLength, 0);

  const missingGet = await handleSessionExportRequest(
    trustedRequest("?sessionId=missing"),
    testDependencies([]),
  );
  const missingHead = await handleSessionExportRequest(
    trustedRequest("?sessionId=missing", "HEAD"),
    testDependencies([]),
  );
  assert.equal(missingHead.status, 404);
  assert.deepEqual([...missingHead.headers], [...missingGet.headers]);
  assert.equal(missingHead.body, null);
  await getResponse.body?.cancel();
});

test("strictly validates the session export query", async (t) => {
  const neverCalled: SessionExportDependencies = testDependencies([], [], {
    async listRawSessions() {
      assert.fail("invalid query reached session lookup");
    },
  });
  const invalidQueries = [
    "",
    "?includeDescendants=true",
    "?sessionId=",
    "?sessionId=one&sessionId=two",
    "?sessionId=one&includeDescendants=1",
    "?sessionId=one&includeDescendants=TRUE",
    "?sessionId=one&includeDescendants=true&includeDescendants=false",
    "?sessionId=one&unknown=value",
  ];

  for (const query of invalidQueries) {
    await t.test(query || "no query", async () => {
      const response = await handleSessionExportRequest(trustedRequest(query), neverCalled);
      assert.equal(response.status, 400);
      assert.equal(await response.text(), "missing or invalid sessionId query parameter");
    });
  }
});

test("distinguishes missing, raw-unavailable, ZIP64, and preparation failures", async (t) => {
  await t.test("missing session", async () => {
    const response = await handleSessionExportRequest(
      trustedRequest("?sessionId=missing"),
      testDependencies([]),
    );
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "session not found");
  });

  await t.test("known session without raw artifact", async () => {
    const response = await handleSessionExportRequest(
      trustedRequest("?sessionId=live-only"),
      testDependencies([], ["live-only"]),
    );
    assert.equal(response.status, 501);
    assert.equal(await response.text(), "session raw artifact is unavailable");
  });

  await t.test("raw backend is not a regular file", async () => {
    const response = await handleSessionExportRequest(
      trustedRequest("?sessionId=root"),
      testDependencies([{ id: "root", path: "/not-used" }], ["root"], {
        async inspectRawArtifact() {
          return { byteLength: 0, regularFile: false };
        },
      }),
    );
    assert.equal(response.status, 501);
  });

  await t.test("classic ZIP cannot represent the raw artifact", async () => {
    const response = await handleSessionExportRequest(
      trustedRequest("?sessionId=root"),
      testDependencies([{ id: "root", path: "/not-used" }], ["root"], {
        async inspectRawArtifact() {
          return { byteLength: 0xffffffff, regularFile: true };
        },
      }),
    );
    assert.equal(response.status, 501);
  });

  await t.test("preparation error does not leak its path", async () => {
    const response = await handleSessionExportRequest(
      trustedRequest("?sessionId=root"),
      testDependencies([{ id: "root", path: "/private/raw.jsonl" }], ["root"], {
        async inspectRawArtifact() {
          throw new Error("EACCES /private/raw.jsonl");
        },
      }),
    );
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.equal(body, "session log export failed to prepare the stored artifact");
    assert.equal(body.includes("/private/"), false);
  });
});

test("applies the configured API trust fence before query or storage work", async () => {
  let lookups = 0;
  const dependencies = testDependencies([], [], {
    async listRawSessions() {
      lookups += 1;
      return [];
    },
  });
  const request = new Request("http://127.0.0.1:3000/api/session.export?sessionId=root", {
    headers: { host: "attacker.example" },
  });
  const response = await handleSessionExportRequest(request, dependencies);
  assert.equal(response.status, 403);
  assert.equal(await response.text(), "Forbidden");
  assert.equal(lookups, 0);

  const head = await handleSessionExportRequest(
    new Request("http://127.0.0.1:3000/api/session.export?sessionId=root", {
      method: "HEAD",
      headers: { host: "attacker.example" },
    }),
    dependencies,
  );
  assert.equal(head.status, 403);
  assert.equal(head.body, null);
  assert.equal(lookups, 0);
});

test("consumer cancellation aborts an in-flight raw artifact producer", async () => {
  let reportStarted!: (signal: AbortSignal) => void;
  const started = new Promise<AbortSignal>((resolve) => {
    reportStarted = resolve;
  });
  const dependencies = testDependencies([{ id: "root", path: "/virtual/root.jsonl" }], ["root"], {
    async inspectRawArtifact() {
      return { byteLength: 2, regularFile: true };
    },
    async *readRawArtifact(_path, signal) {
      reportStarted(signal);
      yield Uint8Array.of(1);
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      yield Uint8Array.of(2);
    },
  });
  const response = await handleSessionExportRequest(
    trustedRequest("?sessionId=root"),
    dependencies,
  );
  const reader = response.body?.getReader();
  assert.ok(reader);
  await reader.read();
  const producerSignal = await started;
  const reason = new Error("download consumer left");
  await reader.cancel(reason);
  assert.equal(producerSignal.aborted, true);
  assert.equal(producerSignal.reason, reason);
});

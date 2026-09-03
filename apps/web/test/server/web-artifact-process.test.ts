import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build, type Plugin } from "esbuild";

import {
  WEB_ARTIFACT_KIND,
  WEB_ARTIFACT_MANIFEST_FILENAME,
  WEB_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  WEB_ARTIFACT_PRIMARY_ENTRYPOINT,
} from "@workbench/host-contracts/web-artifact-manifest";
import { RUNTIME_HOST_PROTOCOL_VERSION } from "@workbench/host-contracts/runtime-host-control";
import {
  WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS,
  WEB_HOST_CONTROL_TRANSPORT,
  WEB_HOST_CONTROL_VERSION,
  WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE,
  WEB_HOST_SHUTDOWN_FRAME_TYPE,
  WebHostShutdownReason,
  createWebHostShutdownFrame,
  createWebHostStartFrame,
  encodeWebHostControlInputFrame,
  parseWebHostControlOutputFrame,
  type WebHostReadyFrame,
} from "@workbench/host-contracts/web-host-control";

const WEB_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PRIMARY_SOURCE_ENTRY = path.join(WEB_ROOT, "src", "server", "web-artifact-main.ts");
const RELATIVE_APP_DIRECTORY = "apps/web";
const REQUIRED_SERVER_FILES = `${RELATIVE_APP_DIRECTORY}/.next/required-server-files.json`;
const BUILD_ID_PATH = `${RELATIVE_APP_DIRECTORY}/.next/BUILD_ID`;
const BUILD_ID = "process-fixture";

async function record(root: string, relativePath: string) {
  const filename = path.join(root, ...relativePath.split("/"));
  const [stats, bytes] = await Promise.all([lstat(filename), readFile(filename)]);
  return {
    path: relativePath,
    size: stats.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mode: stats.mode & 0o777,
  };
}

function fixtureNextPlugin(): Plugin {
  return {
    name: "fixture-next-web-handler",
    setup(buildApi) {
      buildApi.onResolve(
        { filter: /^(?:\.\/next-web-handler|@\/server\/next-web-handler)$/ },
        () => ({
          namespace: "fixture-next",
          path: "next-web-handler",
        }),
      );
      buildApi.onResolve({ filter: /^next$/ }, () => ({
        namespace: "fixture-next-package",
        path: "next",
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "fixture-next" }, () => ({
        loader: "ts",
        contents: `
          export async function createNextWebHandler(options) {
            let closed = false;
            return Object.freeze({
              requestHandler(request, response) {
                response.statusCode = 200;
                response.setHeader("Content-Type", "text/plain; charset=utf-8");
                response.end("fixture Next on " + options.port);
              },
              upgradeRelay: Object.freeze({
                emit(_event, _request, socket) {
                  if (closed) return false;
                  socket.write("HTTP/1.1 101 Switching Protocols\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\n\\r\\n");
                  return true;
                },
              }),
              async close() { closed = true; },
            });
          }
        `,
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "fixture-next-package" }, () => ({
        loader: "ts",
        contents: `
          export default function next(options) {
            let closed = false;
            return Object.freeze({
              getRequestHandler() {
                return async function requestHandler(_request, response) {
                  response.statusCode = 200;
                  response.setHeader("Content-Type", "text/plain; charset=utf-8");
                  response.end("fixture Next on " + options.port);
                };
              },
              getUpgradeHandler() {
                return async function handleUpgrade(_request, socket) {
                  if (closed) return;
                  socket.write("HTTP/1.1 101 Switching Protocols\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\n\\r\\n");
                };
              },
              async prepare() {},
              async close() { closed = true; },
            });
          }
        `,
      }));
    },
  };
}

async function createArtifact(): Promise<{ artifactRoot: string; parent: string }> {
  const parent = await mkdtemp(path.join(os.tmpdir(), "workbench-web-process-"));
  const artifactRoot = path.join(parent, "artifact");
  await mkdir(path.join(artifactRoot, RELATIVE_APP_DIRECTORY, ".next"), { recursive: true });
  await build({
    absWorkingDir: WEB_ROOT,
    bundle: true,
    entryPoints: [PRIMARY_SOURCE_ENTRY],
    format: "esm",
    logLevel: "silent",
    outfile: path.join(artifactRoot, WEB_ARTIFACT_PRIMARY_ENTRYPOINT),
    platform: "node",
    plugins: [fixtureNextPlugin()],
    sourcemap: false,
    target: "node24",
  });
  await chmod(path.join(artifactRoot, WEB_ARTIFACT_PRIMARY_ENTRYPOINT), 0o755);
  await writeFile(path.join(artifactRoot, BUILD_ID_PATH), BUILD_ID);
  await writeFile(
    path.join(artifactRoot, REQUIRED_SERVER_FILES),
    `${JSON.stringify({
      config: { output: "standalone" },
      relativeAppDir: RELATIVE_APP_DIRECTORY,
    })}\n`,
  );
  const files = await Promise.all(
    [BUILD_ID_PATH, REQUIRED_SERVER_FILES, WEB_ARTIFACT_PRIMARY_ENTRYPOINT]
      .sort()
      .map((relativePath) => record(artifactRoot, relativePath)),
  );
  const manifest = {
    schemaVersion: WEB_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    artifactKind: WEB_ARTIFACT_KIND,
    buildId: BUILD_ID,
    relativeAppDir: RELATIVE_APP_DIRECTORY,
    requiredServerFiles: REQUIRED_SERVER_FILES,
    entrypoint: WEB_ARTIFACT_PRIMARY_ENTRYPOINT,
    externalPackages: ["next"],
    controlVersion: WEB_HOST_CONTROL_VERSION,
    requiredRuntimeHostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
    shutdownContract: {
      transport: WEB_HOST_CONTROL_TRANSPORT,
      requestType: WEB_HOST_SHUTDOWN_FRAME_TYPE,
      acknowledgementType: WEB_HOST_SHUTDOWN_ACK_FRAME_TYPE,
      maximumDeadlineMs: WEB_HOST_CONTROL_MAX_SHUTDOWN_DEADLINE_MS,
    },
    resources: files
      .map((file) => file.path)
      .filter((relativePath) => relativePath !== WEB_ARTIFACT_PRIMARY_ENTRYPOINT),
    files,
    links: [],
  };
  await writeFile(
    path.join(artifactRoot, WEB_ARTIFACT_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { artifactRoot, parent };
}

function writeControl(child: ChildProcessWithoutNullStreams, frame: unknown): Promise<void> {
  const encoded = encodeWebHostControlInputFrame(frame);
  return new Promise((resolve, reject) => {
    child.stdin.write(encoded, (error) => (error ? reject(error) : resolve()));
  });
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function startPrimaryProcess(
  artifactRoot: string,
  cwd: string,
): Promise<{
  readonly child: ChildProcessWithoutNullStreams;
  readonly stderrChunks: Buffer[];
  readonly stdoutChunks: Buffer[];
  readonly ready: WebHostReadyFrame;
}> {
  const child = spawn(
    process.execPath,
    [path.join(artifactRoot, WEB_ARTIFACT_PRIMARY_ENTRYPOINT)],
    {
      cwd,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const lineIterator = lines[Symbol.asyncIterator]();
  await writeControl(child, createWebHostStartFrame({ host: "127.0.0.1", port: 0 }));
  const readyLine = await bounded(lineIterator.next(), 10_000, "Web Host ready");
  assert.equal(readyLine.done, false, Buffer.concat(stderrChunks).toString());
  const ready = parseWebHostControlOutputFrame(JSON.parse(readyLine.value!));
  assert.equal(ready?.type, "ready", Buffer.concat(stderrChunks).toString());
  if (ready?.type !== "ready") assert.fail("expected Web Host ready");
  assert.equal(ready.pid, child.pid);
  return { child, stderrChunks, stdoutChunks, ready };
}

async function assertPrimaryExitZero(
  child: ChildProcessWithoutNullStreams,
  stderrChunks: readonly Buffer[],
): Promise<void> {
  const [exitCode, signal] = (await bounded(
    once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>,
    10_000,
    "Web Host exit",
  )) as [number | null, NodeJS.Signals | null];
  assert.equal(exitCode, 0, Buffer.concat(stderrChunks).toString());
  assert.equal(signal, null);
}

function outputFrameTypes(chunks: readonly Buffer[]): Array<string | undefined> {
  const output = Buffer.concat(chunks).toString().trim();
  return output
    ? output.split("\n").map((line) => parseWebHostControlOutputFrame(JSON.parse(line))?.type)
    : [];
}

test("the bundled primary process runs control and HTTP from an arbitrary cwd", async (t) => {
  const fixture = await createArtifact();
  const arbitraryCwd = await mkdtemp(path.join(os.tmpdir(), "workbench-web-process-cwd-"));
  t.after(() => rm(fixture.parent, { force: true, recursive: true }));
  t.after(() => rm(arbitraryCwd, { force: true, recursive: true }));
  const child = spawn(
    process.execPath,
    [path.join(fixture.artifactRoot, WEB_ARTIFACT_PRIMARY_ENTRYPOINT)],
    {
      cwd: arbitraryCwd,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const lineIterator = lines[Symbol.asyncIterator]();

  await writeControl(child, createWebHostStartFrame({ host: "127.0.0.1", port: 0 }));
  const readyLine = await bounded(lineIterator.next(), 10_000, "Web Host ready");
  assert.equal(readyLine.done, false);
  const ready = parseWebHostControlOutputFrame(JSON.parse(readyLine.value!));
  assert.equal(ready?.type, "ready", Buffer.concat(stderrChunks).toString());
  if (ready?.type !== "ready") assert.fail("expected Web Host ready");
  assert.equal(ready.pid, child.pid);

  const page = await fetch(`${ready.httpOrigin}/`);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), `fixture Next on ${new URL(ready.httpOrigin).port}`);
  const api = await fetch(`${ready.httpOrigin}/api/host.describe`);
  assert.equal(api.status, 503);
  assert.equal(api.headers.get("cache-control"), "no-store");
  assert.equal(await api.text(), "Runtime unavailable.");

  await writeControl(
    child,
    createWebHostShutdownFrame({
      reason: WebHostShutdownReason.requested,
      deadlineMs: 5_000,
    }),
  );
  const ackLine = await bounded(lineIterator.next(), 10_000, "Web Host shutdown ack");
  assert.equal(ackLine.done, false);
  assert.equal(parseWebHostControlOutputFrame(JSON.parse(ackLine.value!))?.type, "shutdown-ack");
  const [exitCode, signal] = (await bounded(
    once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>,
    10_000,
    "Web Host exit",
  )) as [number | null, NodeJS.Signals | null];
  assert.equal(exitCode, 0, Buffer.concat(stderrChunks).toString());
  assert.equal(signal, null);
  assert.deepEqual(
    Buffer.concat(stdoutChunks)
      .toString()
      .trim()
      .split("\n")
      .map((line) => parseWebHostControlOutputFrame(JSON.parse(line))?.type),
    ["ready", "shutdown-ack"],
  );
  assert.equal(Buffer.concat(stderrChunks).toString().includes('"type":"ready"'), false);
});

test("the bundled primary process exits zero after control disconnect or a process signal", async (t) => {
  const fixture = await createArtifact();
  const arbitraryCwd = await mkdtemp(path.join(os.tmpdir(), "workbench-web-process-cwd-"));
  t.after(() => rm(fixture.parent, { force: true, recursive: true }));
  t.after(() => rm(arbitraryCwd, { force: true, recursive: true }));

  for (const termination of ["disconnect", "SIGINT", "SIGTERM"] as const) {
    await t.test(
      termination,
      { skip: process.platform === "win32" && termination !== "disconnect" },
      async (t) => {
        const running = await startPrimaryProcess(fixture.artifactRoot, arbitraryCwd);
        t.after(() => {
          if (running.child.exitCode === null && running.child.signalCode === null) {
            running.child.kill("SIGKILL");
          }
        });

        if (termination === "disconnect") running.child.stdin.end();
        else assert.equal(running.child.kill(termination), true);

        await assertPrimaryExitZero(running.child, running.stderrChunks);
        assert.deepEqual(outputFrameTypes(running.stdoutChunks), ["ready"]);
      },
    );
  }
});

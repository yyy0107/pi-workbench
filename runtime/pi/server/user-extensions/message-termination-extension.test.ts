import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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

const {
  ensureWorkbenchMessageTerminationExtension,
  WORKBENCH_MESSAGE_TERMINATION_EXTENSION_FILE,
  workbenchMessageTerminationExtensionSource,
} = await import("./message-termination-extension");

test.after(() => moduleHooks.deregister());

type MessageEndHandler = (event: unknown, context: unknown) => unknown | Promise<unknown>;

async function captureMessageEndHandler(): Promise<MessageEndHandler> {
  let messageEndHandler: MessageEndHandler | undefined;
  const pi = {
    on(event: string, handler: MessageEndHandler) {
      if (event === "message_end") messageEndHandler = handler;
    },
  };
  const source = workbenchMessageTerminationExtensionSource();
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const installed = (await import(moduleUrl)) as { default: (pi: unknown) => void };
  installed.default(pi);
  assert.ok(messageEndHandler);
  return messageEndHandler;
}

test("installs the user extension once without rewriting it", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "workbench-pi-extension-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));

  const installed = await ensureWorkbenchMessageTerminationExtension(agentDir);
  const present = await ensureWorkbenchMessageTerminationExtension(agentDir);
  const extensionPath = join(agentDir, "extensions", WORKBENCH_MESSAGE_TERMINATION_EXTENSION_FILE);

  assert.deepEqual(installed, { path: extensionPath, status: "installed" });
  assert.deepEqual(present, { path: extensionPath, status: "present" });
  assert.equal(await readFile(extensionPath, "utf8"), workbenchMessageTerminationExtensionSource());
});

test("does not overwrite a user-owned extension with the managed filename", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "workbench-pi-extension-conflict-"));
  const extensionDirectory = join(agentDir, "extensions");
  const extensionPath = join(extensionDirectory, WORKBENCH_MESSAGE_TERMINATION_EXTENSION_FILE);
  t.after(() => rm(agentDir, { recursive: true, force: true }));

  await ensureWorkbenchMessageTerminationExtension(agentDir);
  await writeFile(extensionPath, "export default function userExtension() {}\n", "utf8");

  assert.deepEqual(await ensureWorkbenchMessageTerminationExtension(agentDir), {
    path: extensionPath,
    status: "conflict",
  });
  assert.equal(
    await readFile(extensionPath, "utf8"),
    "export default function userExtension() {}\n",
  );
});

test("records an explicit Workbench cancellation on the assistant message", async () => {
  const handler = await captureMessageEndHandler();
  const result = (await handler(
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "aborted",
        timestamp: 1_000,
        diagnostics: [],
      },
    },
    {
      sessionManager: {
        getBranch: () => [
          {
            type: "custom",
            customType: "workbench.cancel-intent.v1",
            data: { requestedAt: 1_500, source: "workbench" },
          },
        ],
      },
    },
  )) as {
    message: { diagnostics: Array<{ type: string; timestamp: number; details: unknown }> };
  };

  assert.deepEqual(result.message.diagnostics.at(-1), {
    type: "workbench.message-termination.v1",
    timestamp: result.message.diagnostics.at(-1)?.timestamp,
    details: {
      schemaVersion: 1,
      kind: "cancelled",
      stopReason: "aborted",
      source: "workbench",
    },
  });
});

test("classifies transport and response failures without discarding provider diagnostics", async () => {
  const handler = await captureMessageEndHandler();
  const networkDiagnostic = {
    type: "provider_transport_failure",
    timestamp: 2_000,
    error: { message: "socket closed", code: "ECONNRESET" },
  };
  const result = (await handler(
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "fetch failed",
        timestamp: 1_000,
        diagnostics: [networkDiagnostic],
      },
    },
    { sessionManager: { getBranch: () => [] } },
  )) as { message: { diagnostics: Array<{ type: string; details: unknown }> } };

  assert.deepEqual(result.message.diagnostics[0], networkDiagnostic);
  assert.deepEqual(result.message.diagnostics.at(-1)?.details, {
    schemaVersion: 1,
    kind: "network-error",
    stopReason: "error",
    errorMessage: "fetch failed",
  });
});

test("emits standalone JavaScript that Pi can import from the user extension directory", async () => {
  const source = workbenchMessageTerminationExtensionSource();
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const installed = (await import(moduleUrl)) as { default?: unknown };

  assert.equal(typeof installed.default, "function");
});

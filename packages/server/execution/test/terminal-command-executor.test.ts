import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";

import type { CommandNode } from "@workbench/execution-contracts";
import { bashCommandPolicy } from "@workbench/terminal-server/bash-command-policy";
import type {
  ToolTerminalExecutionOptions,
  ToolTerminalSessionManager,
} from "@workbench/terminal-server/tool-sessions";

import { ExecutionError } from "../src/errors";
import type { ExecutionNodeContext } from "../src/node-executor";
import { WorkbenchCommandExecutionNodeExecutor } from "../src/terminal-command-executor";

const MAX_INLINE_COMMAND_OUTPUT_BYTES = 1024 * 1024;

function command(commandText: string, timeoutSeconds?: number): CommandNode {
  return {
    id: "command-1",
    type: "command",
    name: "Run command",
    position: { x: 0, y: 0 },
    config: {
      command: commandText,
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
    },
  };
}

function context(node: CommandNode, workspacePath: string): ExecutionNodeContext {
  return {
    runId: "run-1",
    executionOrigin: {
      version: 1,
      origin: "execution",
      workflowId: "workflow-1",
      workflowName: "Terminal timeout regression",
      workflowKind: "workflow",
      runId: "run-1",
      nodeId: node.id,
      attempt: 1,
      source: "manual",
    },
    node,
    attempt: 1,
    workspaceId: "workspace-1",
    workspacePath,
    workflowDirectory: path.join(workspacePath, "workflow"),
    signal: new AbortController().signal,
    sessionDirectory: path.join(workspacePath, "sessions"),
    artifactDirectory: path.join(workspacePath, "artifacts"),
  };
}

function terminal(
  execute: (options: ToolTerminalExecutionOptions) => Promise<{ exitCode: number | null }>,
): ToolTerminalSessionManager {
  return { execute } as unknown as ToolTerminalSessionManager;
}

function artifact(
  error: unknown,
): { id: string; name: string; mediaType: string; size: number } | undefined {
  if (typeof error !== "object" || error === null || !("artifact" in error)) return undefined;
  return (error as { artifact?: { id: string; name: string; mediaType: string; size: number } })
    .artifact;
}

test("passes default, explicit, and Bash-policy timeouts to Terminal Server in seconds", async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "workbench-command-executor-"));
  t.after(() => rm(workspacePath, { recursive: true, force: true }));

  const requests: ToolTerminalExecutionOptions[] = [];
  const manager = {
    async execute(options: ToolTerminalExecutionOptions) {
      requests.push(options);
      return { exitCode: 0 };
    },
  } as unknown as ToolTerminalSessionManager;
  const executor = new WorkbenchCommandExecutionNodeExecutor({
    isWorkspaceTrusted: () => true,
    terminal: manager,
  });

  await executor.execute(context(command("printf default"), workspacePath));
  await executor.execute(context(command("printf explicit", 47), workspacePath));
  await executor.execute(
    context(
      command(
        'timeout 60 npx skills add https://github.com/NetEase/skills 2>&1 | head -50; echo "EXIT: $?"',
      ),
      workspacePath,
    ),
  );

  assert.deepEqual(
    requests.map((request) => request.timeout),
    [600, 47, 60],
    "the executor passes seconds; ToolTerminalSessionManager converts them to milliseconds once",
  );
});

test("does not start Terminal for an untrusted workspace", async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "workbench-command-untrusted-"));
  t.after(() => rm(workspacePath, { recursive: true, force: true }));

  let calls = 0;
  const executor = new WorkbenchCommandExecutionNodeExecutor({
    isWorkspaceTrusted: () => false,
    terminal: terminal(async () => {
      calls += 1;
      return { exitCode: 0 };
    }),
  });

  await assert.rejects(
    executor.execute(context(command("printf never"), workspacePath)),
    (error) => {
      assert.ok(error instanceof ExecutionError);
      assert.equal(error.code, "workspace-not-trusted");
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("rejects a command cwd that escapes the trusted workspace before starting Terminal", async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "workbench-command-cwd-"));
  t.after(() => rm(workspacePath, { recursive: true, force: true }));

  let calls = 0;
  const node = command("printf never");
  node.config.relativeCwd = "../outside";
  const executor = new WorkbenchCommandExecutionNodeExecutor({
    isWorkspaceTrusted: () => true,
    terminal: terminal(async () => {
      calls += 1;
      return { exitCode: 0 };
    }),
  });

  await assert.rejects(executor.execute(context(node, workspacePath)), (error) => {
    assert.ok(error instanceof ExecutionError);
    assert.equal(error.code, "cwd-outside-workspace");
    assert.deepEqual(error.details, { workspaceId: "workspace-1", relativeCwd: "../outside" });
    return true;
  });
  assert.equal(calls, 0);
});

test("does not start Terminal when Bash policy rejects a command", async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "workbench-command-policy-"));
  t.after(() => rm(workspacePath, { recursive: true, force: true }));

  const originalNormalize = bashCommandPolicy.normalize;
  bashCommandPolicy.normalize = (commandText) => ({
    action: "reject",
    originalCommand: commandText,
    command: commandText,
    executionMode: "pty",
    reason: "test-policy-rejection",
  });
  t.after(() => {
    bashCommandPolicy.normalize = originalNormalize;
  });

  let calls = 0;
  const executor = new WorkbenchCommandExecutionNodeExecutor({
    isWorkspaceTrusted: () => true,
    terminal: terminal(async () => {
      calls += 1;
      return { exitCode: 0 };
    }),
  });

  await assert.rejects(
    executor.execute(context(command("printf never"), workspacePath)),
    (error) => {
      assert.ok(error instanceof ExecutionError);
      assert.equal(error.code, "command-rejected");
      assert.deepEqual(error.details, {
        runId: "run-1",
        nodeId: "command-1",
        reason: "test-policy-rejection",
      });
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("returns small command output inline and removes its temporary artifact", async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "workbench-command-inline-"));
  t.after(() => rm(workspacePath, { recursive: true, force: true }));

  const executor = new WorkbenchCommandExecutionNodeExecutor({
    isWorkspaceTrusted: () => true,
    terminal: terminal(async (options) => {
      options.onData(Buffer.from("small terminal output"));
      return { exitCode: 0 };
    }),
  });
  const executionContext = context(command("printf small"), workspacePath);

  assert.deepEqual(await executor.execute(executionContext), {
    exitCode: 0,
    output: { exitCode: 0, output: "small terminal output", truncated: false },
  });
  assert.deepEqual(await readdir(executionContext.artifactDirectory), []);
});

test("truncates inline output while retaining the complete private artifact", async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "workbench-command-artifact-"));
  t.after(() => rm(workspacePath, { recursive: true, force: true }));

  const completeOutput = Buffer.alloc(MAX_INLINE_COMMAND_OUTPUT_BYTES + 17, "x");
  const executor = new WorkbenchCommandExecutionNodeExecutor({
    isWorkspaceTrusted: () => true,
    terminal: terminal(async (options) => {
      options.onData(completeOutput);
      return { exitCode: 0 };
    }),
  });
  const executionContext = context(command("printf large"), workspacePath);

  const result = await executor.execute(executionContext);
  const inlineOutput = result.output as { output: string; truncated: boolean };
  assert.equal(inlineOutput.truncated, true);
  assert.equal(inlineOutput.output.length, MAX_INLINE_COMMAND_OUTPUT_BYTES);
  assert.equal(typeof result.artifact?.id, "string");
  assert.deepEqual(
    {
      name: result.artifact?.name,
      mediaType: result.artifact?.mediaType,
      size: result.artifact?.size,
    },
    {
      name: "Run command.log",
      mediaType: "text/plain",
      size: completeOutput.byteLength,
    },
  );
  const [artifactFile] = await readdir(executionContext.artifactDirectory);
  assert.ok(artifactFile?.endsWith(".log"));
  assert.deepEqual(
    await readFile(path.join(executionContext.artifactDirectory, artifactFile)),
    completeOutput,
  );
  assert.equal(
    (await stat(path.join(executionContext.artifactDirectory, artifactFile))).mode & 0o777,
    0o600,
  );
});

test("attaches retained artifact metadata to nonzero Terminal results and manager failures", async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "workbench-command-errors-"));
  t.after(() => rm(workspacePath, { recursive: true, force: true }));

  const output = Buffer.alloc(MAX_INLINE_COMMAND_OUTPUT_BYTES + 1, "e");
  const nonzero = new WorkbenchCommandExecutionNodeExecutor({
    isWorkspaceTrusted: () => true,
    terminal: terminal(async (options) => {
      options.onData(output);
      return { exitCode: 23 };
    }),
  });
  await assert.rejects(nonzero.execute(context(command("exit 23"), workspacePath)), (error) => {
    assert.equal((error as { code?: unknown }).code, "command-nonzero-exit");
    assert.equal((error as { exitCode?: unknown }).exitCode, 23);
    assert.equal(artifact(error)?.size, output.byteLength);
    return true;
  });

  const managerFailure = new Error("manager failed");
  const rejected = new WorkbenchCommandExecutionNodeExecutor({
    isWorkspaceTrusted: () => true,
    terminal: terminal(async (options) => {
      options.onData(output);
      throw managerFailure;
    }),
  });
  await assert.rejects(
    rejected.execute(context(command("manager failure"), workspacePath)),
    (error) => {
      assert.equal(error, managerFailure);
      assert.equal(artifact(error)?.size, output.byteLength);
      return true;
    },
  );
});

test("passes the original AbortSignal and timeout seconds to Terminal without local conversion", async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "workbench-command-abort-"));
  t.after(() => rm(workspacePath, { recursive: true, force: true }));

  const controller = new AbortController();
  const abortFailure = new DOMException("Run cancelled", "AbortError");
  let received: ToolTerminalExecutionOptions | undefined;
  let started!: () => void;
  const startedExecution = new Promise<void>((resolve) => {
    started = resolve;
  });
  const executor = new WorkbenchCommandExecutionNodeExecutor({
    isWorkspaceTrusted: () => true,
    terminal: terminal(async (options) => {
      received = options;
      started();
      return await new Promise<never>((_, reject) => {
        options.signal?.addEventListener("abort", () => reject(abortFailure), { once: true });
      });
    }),
  });
  const executionContext = {
    ...context(command("sleep forever", 31), workspacePath),
    signal: controller.signal,
  };

  const pending = executor.execute(executionContext);
  await startedExecution;
  assert.equal(received?.signal, controller.signal);
  assert.equal(received?.timeout, 31);
  controller.abort();
  await assert.rejects(pending, (error) => error === abortFailure);
});

test("does not report success when artifact stream creation or writing fails", async (t) => {
  const workspacePath = await mkdtemp(
    path.join(os.tmpdir(), "workbench-command-artifact-failure-"),
  );
  t.after(() => rm(workspacePath, { recursive: true, force: true }));

  const originalCreateWriteStream = fs.createWriteStream;
  t.after(() => {
    fs.createWriteStream = originalCreateWriteStream;
    syncBuiltinESMExports();
  });

  const openFailure = new Error("artifact open failed");
  let terminalCalls = 0;
  fs.createWriteStream = (() => {
    throw openFailure;
  }) as typeof fs.createWriteStream;
  syncBuiltinESMExports();
  const executor = new WorkbenchCommandExecutionNodeExecutor({
    isWorkspaceTrusted: () => true,
    terminal: terminal(async () => {
      terminalCalls += 1;
      return { exitCode: 0 };
    }),
  });
  await assert.rejects(
    executor.execute(context(command("printf artifact open"), workspacePath)),
    (error) => error === openFailure,
  );
  assert.equal(terminalCalls, 0);

  const writeFailure = new Error("artifact write failed");
  fs.createWriteStream = (() =>
    new Writable({
      write(_chunk, _encoding, callback) {
        callback(writeFailure);
      },
    })) as unknown as typeof fs.createWriteStream;
  syncBuiltinESMExports();
  const writeExecutor = new WorkbenchCommandExecutionNodeExecutor({
    isWorkspaceTrusted: () => true,
    terminal: terminal(async (options) => {
      options.onData(Buffer.from("will not be persisted"));
      return { exitCode: 0 };
    }),
  });
  await assert.rejects(
    writeExecutor.execute(context(command("printf artifact write"), workspacePath)),
    (error) => error === writeFailure,
  );
});

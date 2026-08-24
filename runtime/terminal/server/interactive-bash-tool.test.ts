import assert from "node:assert/strict";
import test from "node:test";

import { createWorkbenchBashToolOverride } from "./interactive-bash-tool";
import type { ToolTerminalExecutionOptions } from "./tool-terminal-session-manager";

test("routes the Pi bash tool call through its addressable interactive terminal", async () => {
  let execution: ToolTerminalExecutionOptions | undefined;
  const tool = createWorkbenchBashToolOverride(
    "/workspace",
    "session-1",
    { commandPrefix: "source ~/.profile", shellPath: "/bin/zsh" },
    {
      async execute(options) {
        execution = options;
        options.onData(Buffer.from("live output"));
        return { exitCode: 0 };
      },
    },
  );

  assert.equal(tool.name, "bash");

  const result = await tool.execute(
    "call-9",
    { command: "echo ready" },
    undefined,
    undefined,
    undefined as never,
  );

  assert.equal(execution?.sessionId, "session-1");
  assert.equal(execution?.toolCallId, "call-9");
  assert.equal(execution?.command, "source ~/.profile\necho ready");
  assert.equal(execution?.cwd, "/workspace");
  assert.equal(execution?.shell, "/bin/zsh");
  assert.equal(result.content[0]?.type, "text");
  assert.equal(
    result.content[0]?.type === "text" ? result.content[0].text : undefined,
    "live output",
  );
});

test("normalizes redundant temp-log capture after the configured command prefix", async () => {
  let execution: ToolTerminalExecutionOptions | undefined;
  const tool = createWorkbenchBashToolOverride(
    "/workspace",
    "session-1",
    { commandPrefix: "source ~/.profile" },
    {
      async execute(options) {
        execution = options;
        return { exitCode: 0 };
      },
    },
  );

  await tool.execute(
    "call-10",
    {
      command:
        'npx skills add https://github.com/NetEase/skills > /tmp/skills_add.log 2>&1; echo "exit=$?"; tail -40 /tmp/skills_add.log',
    },
    undefined,
    undefined,
    undefined as never,
  );

  assert.equal(
    execution?.command,
    "source ~/.profile\nnpx skills add https://github.com/NetEase/skills",
  );
});

test("does not start a PTY when an injected command policy rejects execution", async () => {
  let executions = 0;
  const tool = createWorkbenchBashToolOverride(
    "/workspace",
    "session-1",
    {
      commandPolicy: {
        normalize(command) {
          return {
            action: "reject",
            originalCommand: command,
            command,
            executionMode: "pty",
            reason: "policy rejection",
          };
        },
      },
    },
    {
      async execute() {
        executions += 1;
        return { exitCode: 0 };
      },
    },
  );

  await assert.rejects(
    tool.execute("call-11", { command: "echo ready" }, undefined, undefined, undefined as never),
    /policy rejection/,
  );
  assert.equal(executions, 0);
});

test("uses the stricter structured timeout from the execution plan", async () => {
  let execution: ToolTerminalExecutionOptions | undefined;
  const tool = createWorkbenchBashToolOverride(
    "/workspace",
    "session-1",
    {},
    {
      async execute(options) {
        execution = options;
        return { exitCode: 0 };
      },
    },
  );

  await tool.execute(
    "call-timeout",
    {
      command: 'timeout 60 npx skills add example 2>&1 | head -50; echo "EXIT: $?"',
      timeout: 120,
    },
    undefined,
    undefined,
    undefined as never,
  );

  assert.equal(execution?.command, "npx skills add example");
  assert.equal(execution?.timeout, 60);
});

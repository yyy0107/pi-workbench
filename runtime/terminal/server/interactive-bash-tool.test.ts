import assert from "node:assert/strict";
import test from "node:test";

import { createInteractiveBashTool } from "./interactive-bash-tool";
import type { ToolTerminalExecutionOptions } from "./tool-terminal-session-manager";

test("routes the Pi bash tool call through its addressable interactive terminal", async () => {
  let execution: ToolTerminalExecutionOptions | undefined;
  const tool = createInteractiveBashTool(
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

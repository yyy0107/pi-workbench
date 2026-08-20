import { AsyncLocalStorage } from "node:async_hooks";

import { createBashToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";

import {
  getToolTerminalSessionManager,
  type ToolTerminalSessionManager,
} from "./tool-terminal-session-manager";

type ToolTerminalExecutor = Pick<ToolTerminalSessionManager, "execute">;

export interface InteractiveBashToolOptions {
  commandPrefix?: string;
  shellPath?: string;
}

export function createInteractiveBashTool(
  cwd: string,
  sessionId: string,
  toolOptions: InteractiveBashToolOptions = {},
  terminals: ToolTerminalExecutor = getToolTerminalSessionManager(),
) {
  const executionContext = new AsyncLocalStorage<{ toolCallId: string }>();
  const base = createBashToolDefinition(cwd, {
    ...(toolOptions.commandPrefix ? { commandPrefix: toolOptions.commandPrefix } : {}),
    ...(toolOptions.shellPath ? { shellPath: toolOptions.shellPath } : {}),
    operations: {
      exec(command, executionCwd, executionOptions) {
        const execution = executionContext.getStore();
        if (!execution) throw new Error("Interactive bash execution context is unavailable.");
        return terminals.execute({
          sessionId,
          toolCallId: execution.toolCallId,
          command,
          cwd: executionCwd,
          onData: executionOptions.onData,
          ...(executionOptions.signal ? { signal: executionOptions.signal } : {}),
          ...(executionOptions.timeout === undefined ? {} : { timeout: executionOptions.timeout }),
          ...(executionOptions.env ? { env: executionOptions.env } : {}),
          ...(toolOptions.shellPath ? { shell: toolOptions.shellPath } : {}),
        });
      },
    },
  });
  const execute = base.execute.bind(base);

  const interactive: typeof base = {
    ...base,
    execute(toolCallId, params, signal, onUpdate, context) {
      return executionContext.run({ toolCallId }, () =>
        execute(toolCallId, params, signal, onUpdate, context),
      );
    },
  };
  return defineTool(interactive);
}

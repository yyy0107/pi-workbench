import { AsyncLocalStorage } from "node:async_hooks";

import { createBashToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";

import {
  bashCommandPolicy,
  type BashCommandPolicy,
  type BashCommandPolicyResult,
} from "./bash-command-policy";
import {
  getToolTerminalSessionManager,
  type ToolTerminalSessionManager,
} from "./tool-terminal-session-manager";

type ToolTerminalExecutor = Pick<ToolTerminalSessionManager, "execute">;

export interface InteractiveBashToolOptions {
  commandPrefix?: string;
  shellPath?: string;
  commandPolicy?: Pick<BashCommandPolicy, "normalize">;
}

function normalizedResolvedCommand(
  command: string,
  commandPrefix: string | undefined,
  policy: Pick<BashCommandPolicy, "normalize">,
): BashCommandPolicyResult {
  const prefix = commandPrefix === undefined ? undefined : `${commandPrefix}\n`;
  const hasPrefix = prefix !== undefined && command.startsWith(prefix);
  const policyCommand = hasPrefix ? command.slice(prefix.length) : command;
  const result = policy.normalize(policyCommand);
  if (result.action === "reject") {
    throw new Error(result.reason || "Bash command rejected by runtime policy.");
  }
  return {
    ...result,
    command: hasPrefix ? `${prefix}${result.command}` : result.command,
  };
}

function effectiveTimeout(
  requested: number | undefined,
  planned: number | undefined,
): number | undefined {
  if (requested === undefined) return planned;
  if (planned === undefined) return requested;
  return Math.min(requested, planned);
}

/** Creates the Workbench-owned `bash` definition that overrides Pi's built-in tool by name. */
export function createWorkbenchBashToolOverride(
  cwd: string,
  sessionId: string,
  toolOptions: InteractiveBashToolOptions = {},
  terminals: ToolTerminalExecutor = getToolTerminalSessionManager(),
) {
  const executionContext = new AsyncLocalStorage<{ toolCallId: string }>();
  const commandPolicy = toolOptions.commandPolicy ?? bashCommandPolicy;
  const base = createBashToolDefinition(cwd, {
    ...(toolOptions.commandPrefix ? { commandPrefix: toolOptions.commandPrefix } : {}),
    ...(toolOptions.shellPath ? { shellPath: toolOptions.shellPath } : {}),
    operations: {
      exec(command, executionCwd, executionOptions) {
        const execution = executionContext.getStore();
        if (!execution) throw new Error("Interactive bash execution context is unavailable.");
        const plan = normalizedResolvedCommand(command, toolOptions.commandPrefix, commandPolicy);
        return terminals.execute({
          sessionId,
          toolCallId: execution.toolCallId,
          command: plan.command,
          cwd: executionCwd,
          onData: executionOptions.onData,
          ...(executionOptions.signal ? { signal: executionOptions.signal } : {}),
          ...(effectiveTimeout(executionOptions.timeout, plan.timeoutSeconds) === undefined
            ? {}
            : { timeout: effectiveTimeout(executionOptions.timeout, plan.timeoutSeconds) }),
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

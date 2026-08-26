import { AsyncLocalStorage } from "node:async_hooks";

import {
  createBashToolDefinition,
  defineTool,
  type BashToolDetails,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { MAX_AGENT_BASH_INPUT_CHARACTERS, type WorkbenchBashInput } from "../bash-tool-input";

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

const bashInputSchema = Type.Optional(
  Type.Union(
    [
      Type.Object(
        {
          source: Type.Literal("agent", {
            description: "The agent can determine and safely provide the command's stdin.",
          }),
          data: Type.String({
            minLength: 1,
            maxLength: MAX_AGENT_BASH_INPUT_CHARACTERS,
            description:
              "Exact stdin to send after the PTY starts. Include every required newline or control character.",
          }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          source: Type.Literal("user", {
            description:
              "The user must provide input in the terminal because it is sensitive, preference-dependent, or cannot be predicted reliably.",
          }),
        },
        { additionalProperties: false },
      ),
    ],
    {
      description:
        "Declare this only when the command reads from stdin. Choose agent with exact data for safe, deterministic input; choose user to open the live terminal for manual input. Omit it when no stdin is required.",
    },
  ),
);

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
  const executionContext = new AsyncLocalStorage<{
    toolCallId: string;
    input?: WorkbenchBashInput;
  }>();
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
          ...(execution.input?.source === "agent" ? { initialInput: execution.input.data } : {}),
        });
      },
    },
  });
  const execute = base.execute.bind(base);
  const parameters = Type.Object(
    {
      ...base.parameters.properties,
      input: bashInputSchema,
    },
    { additionalProperties: false },
  );

  const interactive: ToolDefinition<typeof parameters, BashToolDetails | undefined> = {
    ...base,
    description: `${base.description} Before running a command that reads stdin, inspect what it asks for and declare input ownership: provide safe deterministic input as agent data, or delegate sensitive, preference-dependent, or uncertain input to the user.`,
    promptGuidelines: [
      ...(base.promptGuidelines ?? []),
      "Before calling bash, determine whether the command reads stdin. Omit input when it does not. Use input.source=agent with exact data only when the answer is safe and deterministic; include required newlines. Use input.source=user for secrets, choices, preferences, or prompts you cannot predict reliably, and do not invent that input.",
    ],
    parameters,
    execute(toolCallId, params, signal, onUpdate, context) {
      const execution = {
        toolCallId,
        ...(params.input ? { input: params.input } : {}),
      };
      return executionContext.run(execution, () =>
        execute(toolCallId, params, signal, onUpdate, context),
      );
    },
  };
  return defineTool(interactive);
}

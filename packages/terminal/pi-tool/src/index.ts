import { AsyncLocalStorage } from "node:async_hooks";

import {
  createBashToolDefinition,
  defineTool,
  type BashToolDetails,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

import {
  MAX_AGENT_BASH_INPUT_CHARACTERS,
  type WorkbenchBashInput,
} from "@workbench/terminal-contracts";

import {
  bashCommandPolicy,
  type BashCommandPolicy,
  type BashCommandPolicyResult,
} from "@workbench/terminal-server/bash-command-policy";
import {
  getToolTerminalSessionManager,
  type ToolTerminalSessionManager,
} from "@workbench/terminal-server/tool-sessions";

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
        const timeout = effectiveTimeout(executionOptions.timeout, plan.timeoutSeconds);
        return terminals.execute({
          sessionId,
          toolCallId: execution.toolCallId,
          command: plan.command,
          cwd: executionCwd,
          onData: executionOptions.onData,
          ...(executionOptions.signal ? { signal: executionOptions.signal } : {}),
          ...(timeout === undefined ? {} : { timeout }),
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
      command: Type.String({
        minLength: 1,
        pattern: "\\S",
        description:
          "Command for the current session's configured terminal shell. Use that shell's syntax and path format. Keep each call focused on one operation so failures can be located; preserve stderr during diagnosis. Exclude dependency/cache directories before recursive traversal, not by filtering results afterward.",
      }),
      timeout: Type.Number({
        exclusiveMinimum: 0,
        maximum: 2_147_483_647 / 1_000,
        description:
          "Required execution time limit in seconds. On expiry the runtime requests process termination and reports a timeout. Choose a budget for this command: typically 10–30 seconds for local diagnostics, longer for network operations, installations or builds. Include user response time for interactive commands. No implicit unlimited wait; do not automatically retry a timed-out operation with side effects.",
      }),
      input: bashInputSchema,
    },
    { additionalProperties: false },
  );

  const interactive: ToolDefinition<typeof parameters, BashToolDetails | undefined> = {
    ...base,
    description:
      "Execute a command in the current session's configured terminal shell and working directory. Returns captured stdout and stderr; large output is truncated with the full output saved to a file. A positive timeout in seconds is required for every call. Before running a command that reads stdin, inspect what it asks for and declare input ownership: provide safe deterministic input as agent data, or delegate sensitive, preference-dependent, or uncertain input to the user.",
    promptGuidelines: [
      ...(base.promptGuidelines ?? []),
      "Before calling bash, determine whether the command reads stdin. Omit input when it does not. Use input.source=agent with exact data only when the answer is safe and deterministic; include required newlines. Use input.source=user for secrets, choices, preferences, or prompts you cannot predict reliably, and do not invent that input.",
      "Set a finite timeout for diagnostic commands and network checks. Narrow recursive searches to relevant directories and exclude dependency/cache directories before traversal (for example, rg glob exclusions or grep --exclude-dir); piping results through grep -v or head does not bound the scan. Preserve stderr when diagnosing a failure.",
    ],
    parameters,
    prepareArguments: undefined,
    async execute(toolCallId, params, signal, onUpdate, context) {
      if (!Value.Check(parameters, params)) {
        throw new Error(
          "Invalid bash arguments: provide a non-empty command, a finite positive timeout in seconds within the supported limit, and valid input ownership. Unknown fields are not accepted.",
        );
      }
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

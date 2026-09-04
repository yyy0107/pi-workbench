import type { CommandView } from "@workbench/agent-runtime-pi-protocol/rpc";
import type {
  WorkbenchAgentCommand,
  WorkbenchAgentCommandSource,
} from "@workbench/agent-runtime-contracts/commands";

function projectPiCommandSource(
  command: Exclude<CommandView, { kind: "builtin" }>,
): WorkbenchAgentCommandSource {
  return Object.freeze({
    scope: command.scope,
    ...(command.origin === "package" && command.source !== "auto"
      ? {
          label: command.source.startsWith("npm:")
            ? command.source.slice("npm:".length)
            : command.source,
        }
      : {}),
  });
}

/** Strip Pi's RPC shape down to the stable command semantics consumed by Workbench. */
export function projectPiAgentCommand(command: CommandView): WorkbenchAgentCommand {
  const base = {
    name: command.name,
    invocationName: command.invocationName,
    effect: command.effect,
    exclusive: command.exclusive,
    ...(command.description === undefined ? {} : { description: command.description }),
    ...(command.argumentHint === undefined ? {} : { argumentHint: command.argumentHint }),
    ...(command.argsSchema === undefined ? {} : { argsSchema: command.argsSchema }),
    ...(command.argsBinding === undefined ? {} : { argsBinding: command.argsBinding }),
  };

  switch (command.kind) {
    case "builtin":
      return Object.freeze({ ...base, kind: command.kind });
    case "extension":
    case "prompt":
      return Object.freeze({
        ...base,
        kind: command.kind,
        source: projectPiCommandSource(command),
      });
    case "skill":
      return Object.freeze({
        ...base,
        kind: command.kind,
        source: projectPiCommandSource(command),
        modelInvocable: command.modelInvocable,
      });
  }
}

export function projectPiAgentCommands(
  commands: readonly CommandView[],
): readonly WorkbenchAgentCommand[] {
  return Object.freeze(commands.map(projectPiAgentCommand));
}

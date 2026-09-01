import { TerminalIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { defineMessage } from "@workbench/shell/i18n";
import { useCommandService } from "@workbench/extension-host";
import type { CommandDefinition } from "@workbench/extension-sdk";

import { definePiMessage } from "../../i18n";

import { TerminalWorkspaceService } from "./terminal-workspace-service";

export const TOGGLE_TERMINAL_COMMAND_ID = "terminal.toggle";

const terminalWorkspaceServices = new WeakMap<CommandDefinition["run"], TerminalWorkspaceService>();

/** Creates the command definition and binds it to this ExtensionHost installation only. */
export function createToggleTerminalCommand(
  service = new TerminalWorkspaceService(),
): CommandDefinition {
  const run: CommandDefinition["run"] = () => {
    service.toggle();
  };
  terminalWorkspaceServices.set(run, service);

  return {
    id: TOGGLE_TERMINAL_COMMAND_ID,
    title: definePiMessage("extensions.terminal.toggleTitle"),
    description: definePiMessage("extensions.terminal.toggleDescription"),
    category: defineMessage("extensions.shared.panelsCategory"),
    icon: TerminalIcon,
    run,
  };
}

/**
 * Finds the service paired with this host's registered command definition.
 *
 * Registries preserve the `run` callback while freezing a registration snapshot, so using the
 * callback as a WeakMap key keeps the lookup installation-scoped without retaining unmounted
 * ExtensionHosts or introducing a last-mounted global host.
 */
export function getTerminalWorkspaceService(
  command: CommandDefinition | undefined,
): TerminalWorkspaceService | undefined {
  return command ? terminalWorkspaceServices.get(command.run) : undefined;
}

export function useInstalledTerminalWorkspaceService(): TerminalWorkspaceService | undefined {
  const commands = useCommandService();
  const command = useSyncExternalStore(
    commands.subscribe,
    () => commands.get(TOGGLE_TERMINAL_COMMAND_ID),
    () => undefined,
  );
  return getTerminalWorkspaceService(command);
}

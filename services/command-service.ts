import type {
  CommandDefinition,
  CommandExecutionContext,
  CommandRegistry,
} from "@/platform/extensions/api/command";
import type { PanelService } from "@/services/panel-service";
import type { NavigationService } from "@/services/navigation-service";

export interface CommandServiceDependencies {
  panels: Pick<PanelService, "open" | "close" | "toggle">;
  navigation: Pick<NavigationService, "newThread" | "openThread">;
}

export class CommandService {
  readonly #registry: CommandRegistry;
  readonly #context: CommandExecutionContext;

  constructor(registry: CommandRegistry, dependencies: CommandServiceDependencies) {
    this.#registry = registry;
    this.#context = Object.freeze({
      panels: {
        open: dependencies.panels.open,
        close: dependencies.panels.close,
        toggle: dependencies.panels.toggle,
      },
      navigation: {
        newThread: dependencies.navigation.newThread,
        openThread: dependencies.navigation.openThread,
      },
    });
  }

  readonly execute = async (commandId: string): Promise<void> => {
    const command = this.#registry.get(commandId);
    if (!command) throw new Error(`Unknown command "${commandId}"`);
    await command.run(this.#context);
  };

  readonly get = (commandId: string): CommandDefinition | undefined => {
    return this.#registry.get(commandId);
  };

  readonly getAll = (): readonly CommandDefinition[] => {
    return this.#registry.getAll();
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    return this.#registry.subscribe(listener);
  };

  readonly findByKeyboardEvent = (event: KeyboardEvent): CommandDefinition | undefined => {
    return this.#registry
      .getAll()
      .find((command) => command.shortcut && matchesShortcut(event, command.shortcut));
  };
}

const MODIFIER_ALIASES = {
  alt: "alt",
  option: "alt",
  ctrl: "control",
  control: "control",
  cmd: "meta",
  command: "meta",
  meta: "meta",
  shift: "shift",
} as const;

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}

export function matchesShortcut(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
  shortcut: readonly string[],
): boolean {
  let expectsAlt = false;
  let expectsControl = false;
  let expectsMeta = false;
  let expectsShift = false;
  let expectedKey: string | undefined;

  for (const rawToken of shortcut) {
    const token = rawToken.trim().toLowerCase();
    if (!token) continue;

    if (token === "mod" || token === "cmdorctrl") {
      if (isMacPlatform()) expectsMeta = true;
      else expectsControl = true;
      continue;
    }

    const modifier = MODIFIER_ALIASES[token as keyof typeof MODIFIER_ALIASES];
    if (modifier === "alt") expectsAlt = true;
    else if (modifier === "control") expectsControl = true;
    else if (modifier === "meta") expectsMeta = true;
    else if (modifier === "shift") expectsShift = true;
    else if (expectedKey === undefined) expectedKey = token;
    else return false;
  }

  if (!expectedKey) return false;
  return (
    event.altKey === expectsAlt &&
    event.ctrlKey === expectsControl &&
    event.metaKey === expectsMeta &&
    event.shiftKey === expectsShift &&
    event.key.toLowerCase() === expectedKey
  );
}

export function formatShortcut(shortcut: readonly string[]): string {
  return shortcut.join("+");
}

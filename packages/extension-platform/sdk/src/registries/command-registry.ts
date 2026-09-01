import type { CommandDefinition, CommandRegistry } from "../api/command";
import { createDisposable } from "../api/disposable";
import { assertNonEmptyId, emitRegistryChange } from "./registry-utils";

const EMPTY_COMMANDS = Object.freeze([]) as readonly CommandDefinition[];

export class CommandRegistryImpl implements CommandRegistry {
  readonly #commands = new Map<string, CommandDefinition>();
  readonly #listeners = new Set<() => void>();
  #snapshot = EMPTY_COMMANDS;

  register(command: CommandDefinition) {
    assertNonEmptyId(command.id, "Command id");
    if (this.#commands.has(command.id)) {
      throw new Error(`Command "${command.id}" is already registered`);
    }

    const stored = Object.freeze({
      ...command,
      shortcut: command.shortcut ? Object.freeze([...command.shortcut]) : undefined,
    });
    this.#commands.set(command.id, stored);
    this.#updateSnapshot();

    return createDisposable(() => {
      if (this.#commands.get(command.id) !== stored) return;
      this.#commands.delete(command.id);
      this.#updateSnapshot();
    });
  }

  get(commandId: string): CommandDefinition | undefined {
    return this.#commands.get(commandId);
  }

  getAll(): readonly CommandDefinition[] {
    return this.#snapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #updateSnapshot(): void {
    this.#snapshot = Object.freeze(Array.from(this.#commands.values()));
    emitRegistryChange(this.#listeners);
  }
}

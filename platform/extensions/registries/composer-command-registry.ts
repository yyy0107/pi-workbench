import type { ComposerCommandDefinition, ComposerCommandRegistry } from "../api/composer-command";
import { createDisposable } from "../api/disposable";
import { assertNonEmptyId, emitRegistryChange } from "./registry-utils";

const EMPTY_COMMANDS = Object.freeze([]) as readonly ComposerCommandDefinition[];

function assertCommand(command: ComposerCommandDefinition): void {
  assertNonEmptyId(command.id, "Composer command id");
  if (command.composer.group !== undefined) {
    assertNonEmptyId(command.composer.group, `Composer command "${command.id}" group`);
  }
  if (command.composer.argsBinding !== undefined) {
    assertNonEmptyId(
      command.composer.argsBinding.field,
      `Composer command "${command.id}" argument field`,
    );
    if (!command.composer.argsSchema) {
      throw new Error(`Composer command "${command.id}" argument binding requires argsSchema`);
    }
    if (command.composer.exclusive !== true || command.composer.scope === "segment") {
      throw new Error(
        `Composer command "${command.id}" message-text arguments require an exclusive message-level command`,
      );
    }
  }
}

export class ComposerCommandRegistryImpl implements ComposerCommandRegistry {
  readonly #commands = new Map<string, ComposerCommandDefinition>();
  readonly #listeners = new Set<() => void>();
  #snapshot = EMPTY_COMMANDS;

  register(command: ComposerCommandDefinition) {
    assertCommand(command);
    if (this.#commands.has(command.id)) {
      throw new Error(`Composer command "${command.id}" is already registered`);
    }

    const stored = Object.freeze({
      ...command,
      composer: Object.freeze({
        ...command.composer,
        argsSchema: command.composer.argsSchema
          ? Object.freeze({ ...command.composer.argsSchema })
          : undefined,
        argsBinding: command.composer.argsBinding
          ? Object.freeze({ ...command.composer.argsBinding })
          : undefined,
      }),
    });
    this.#commands.set(command.id, stored);
    this.#updateSnapshot();

    return createDisposable(() => {
      if (this.#commands.get(command.id) !== stored) return;
      this.#commands.delete(command.id);
      this.#updateSnapshot();
    });
  }

  get(commandId: string): ComposerCommandDefinition | undefined {
    return this.#commands.get(commandId);
  }

  getAll(): readonly ComposerCommandDefinition[] {
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

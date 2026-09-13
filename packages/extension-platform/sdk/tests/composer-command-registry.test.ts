import assert from "node:assert/strict";
import test from "node:test";

import { ExtensionManager } from "../src/extension-manager";
import { ComposerCommandRegistryImpl } from "../src/registries/composer-command-registry";

const command = {
  id: "review",
  label: "Review",
  composer: {
    behavior: "modifier" as const,
    group: "task",
    argsSchema: { type: "object" },
    apply() {},
  },
};

test("composer command registry returns stable snapshots and disposes registrations", () => {
  const registry = new ComposerCommandRegistryImpl();
  const initial = registry.getAll();
  let notifications = 0;
  const unsubscribe = registry.subscribe(() => {
    notifications += 1;
  });

  const registration = registry.register(command);
  const stored = registry.get("review");
  assert.ok(stored);
  assert.notEqual(registry.getAll(), initial);
  assert.equal(Object.isFrozen(stored), true);
  assert.equal(Object.isFrozen(stored.composer), true);
  assert.equal(Object.isFrozen(stored.composer.argsSchema), true);
  assert.equal(notifications, 1);

  registration.dispose();
  assert.equal(registry.get("review"), undefined);
  assert.equal(notifications, 2);
  unsubscribe();
});

test("composer command registry validates and freezes message-text argument bindings", () => {
  const registry = new ComposerCommandRegistryImpl();
  const registration = registry.register({
    ...command,
    id: "compact",
    composer: {
      ...command.composer,
      exclusive: true,
      group: undefined,
      argsBinding: {
        kind: "message-text" as const,
        field: "customInstructions",
        consumeText: true,
      },
    },
  });

  assert.equal(Object.isFrozen(registry.get("compact")?.composer.argsBinding), true);
  registration.dispose();

  assert.throws(
    () =>
      registry.register({
        ...command,
        id: "missing-schema",
        composer: {
          behavior: "transform",
          exclusive: true,
          argsBinding: { kind: "message-text", field: "input", consumeText: true },
          apply() {},
        },
      }),
    /requires argsSchema/,
  );
  assert.throws(
    () =>
      registry.register({
        ...command,
        id: "ambiguous-binding",
        composer: {
          ...command.composer,
          argsBinding: { kind: "message-text", field: "input", consumeText: true },
        },
      }),
    /require an exclusive message-level command/,
  );
});

test("composer command registry rejects duplicate ids and empty groups", () => {
  const registry = new ComposerCommandRegistryImpl();
  registry.register(command);
  assert.throws(() => registry.register(command), /already registered/);
  assert.throws(
    () =>
      registry.register({
        ...command,
        id: "other",
        composer: { ...command.composer, group: " " },
      }),
    /group must be a non-empty string/,
  );
});

test("extension deactivation removes its composer command contributions", () => {
  const manager = new ExtensionManager();
  manager.activate({
    id: "workbench.fixture-composer-command",
    name: "Fixture Composer Command",
    version: "1.0.0",
    setup(context) {
      return context.composerCommands.register(command);
    },
  });

  assert.equal(manager.composerCommands.get("review")?.id, "review");
  manager.deactivate("workbench.fixture-composer-command");
  assert.equal(manager.composerCommands.get("review"), undefined);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { LocalizableMessageDescriptor, LocalizableText } from "../src/api/localizable-text";
import { createLocalizableMessageDescriptor } from "../src/internal";
import { CommandRegistryImpl } from "../src/registries/command-registry";

function typecheckOpaqueDescriptorContract(): void {
  // @ts-expect-error Only the infrastructure factory can supply the opaque brand.
  const rawDescriptor: LocalizableText = { key: "example.commands.open" };
  void rawDescriptor;
}
void typecheckOpaqueDescriptorContract;

const typedDescriptor = createLocalizableMessageDescriptor("example.items.count", { count: 2 });
const exactDescriptor: LocalizableMessageDescriptor<"example.items.count", { readonly count: 2 }> =
  typedDescriptor;
void exactDescriptor;

test("catalog-neutral descriptors keep key and values paired in registry snapshots", () => {
  const title = createLocalizableMessageDescriptor("example.commands.open");
  const description = createLocalizableMessageDescriptor("example.items.count", { count: 2 });
  const registry = new CommandRegistryImpl();

  registry.register({
    id: "example.open",
    title,
    description,
    run() {},
  });

  const stored = registry.get("example.open");
  assert.ok(stored);
  assert.strictEqual(stored.title, title);
  assert.strictEqual(stored.description, description);
  assert.deepEqual(JSON.parse(JSON.stringify(stored.description)), {
    key: "example.items.count",
    values: { count: 2 },
  });
  assert.equal(Object.isFrozen(title), true);
  assert.equal(Object.isFrozen(description), true);
});

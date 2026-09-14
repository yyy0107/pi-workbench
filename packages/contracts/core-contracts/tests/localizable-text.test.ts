import assert from "node:assert/strict";
import test from "node:test";

import type { LocalizableText } from "../src/localizable-text";
import { createLocalizableMessageDescriptor } from "../src/localizable-text-internal";

function typecheckOpaqueDescriptor(): void {
  // @ts-expect-error Raw objects cannot forge the cross-runtime descriptor brand.
  const raw: LocalizableText = { key: "remote.sessions.title" };
  void raw;
}
void typecheckOpaqueDescriptor;

test("creates frozen JSON-safe localizable descriptors without a React dependency", () => {
  const descriptor = createLocalizableMessageDescriptor("remote.sessions.count", { count: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(descriptor)), {
    key: "remote.sessions.count",
    values: { count: 2 },
  });
  assert.equal(Object.isFrozen(descriptor), true);
});

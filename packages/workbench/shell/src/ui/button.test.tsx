import assert from "node:assert/strict";
import test from "node:test";

import { buttonVariants } from "./button";

test("Button has no press movement", () => {
  const defaultClasses = buttonVariants();
  assert.doesNotMatch(defaultClasses, /scale|translate/u);
  assert.match(defaultClasses, /focus-visible:outline-ring/u);
});

test("Button text uses the Workbench UI font", () => {
  assert.match(buttonVariants(), /font-sans/u);
});

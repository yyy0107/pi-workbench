import assert from "node:assert/strict";
import test from "node:test";

import { buttonVariants } from "./button";

test("Button movement is opt-in", () => {
  const defaultClasses = buttonVariants();
  assert.doesNotMatch(defaultClasses, /translate-y/u);
  assert.match(defaultClasses, /focus-visible:outline-ring/u);
  assert.match(buttonVariants({ motion: "press" }), /active:not-aria-\[haspopup\]:translate-y-px/u);
});

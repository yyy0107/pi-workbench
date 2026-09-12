import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Button, buttonVariants } from "./button";

test("Button has no press movement", () => {
  const defaultClasses = buttonVariants();
  assert.doesNotMatch(defaultClasses, /scale|translate/u);
  assert.match(defaultClasses, /focus-visible:outline-ring/u);
});

test("Button text uses the Workbench UI font", () => {
  assert.match(buttonVariants(), /font-sans/u);
});

test("Button can disable transient interaction feedback without replacing the control", () => {
  const staticButton = renderToStaticMarkup(<Button interaction="static">Close</Button>);
  const defaultButton = renderToStaticMarkup(<Button>Close</Button>);

  assert.match(staticButton, /data-interaction="static"/u);
  assert.match(staticButton, /transition-none/u);
  assert.doesNotMatch(defaultButton, /data-interaction="/u);
  assert.match(
    buttonVariants({ variant: "ghost", size: "icon-sm" }),
    /not\(\[data-interaction=static\]\).*hover/u,
  );
});

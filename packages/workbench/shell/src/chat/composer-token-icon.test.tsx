import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ComposerCommandToken } from "../elements/composer";

import { ComposerTokenIcon } from "./composer-token-icon";

function renderToken(kind: "extension" | "skill" | "workspace-file"): string {
  return renderToStaticMarkup(
    <ComposerCommandToken icon={<ComposerTokenIcon kind={kind} />} label="fixture" />,
  );
}

test("distinguishes skill and extension command tokens by icon", () => {
  const skillMarkup = renderToken("skill");
  const extensionMarkup = renderToken("extension");

  assert.match(skillMarkup, /data-slot="composer-command-token-icon"/);
  assert.match(skillMarkup, /lucide-box/);
  assert.match(extensionMarkup, /lucide-puzzle/);
  assert.notEqual(skillMarkup, extensionMarkup);
});

test("renders Workspace file context tokens with a file icon", () => {
  assert.match(renderToken("workspace-file"), /lucide-file-text/);
});

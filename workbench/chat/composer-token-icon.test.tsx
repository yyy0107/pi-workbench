import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ComposerCommandToken } from "@/components/elements/composer";

import { ComposerTokenIcon } from "./composer-token-icon";

function renderToken(kind: "extension" | "skill"): string {
  return renderToStaticMarkup(
    <ComposerCommandToken icon={<ComposerTokenIcon kind={kind} />} label="fixture" />,
  );
}

test("distinguishes skill and extension command tokens by icon", () => {
  const skillMarkup = renderToken("skill");
  const extensionMarkup = renderToken("extension");

  assert.match(skillMarkup, /data-slot="composer-command-token-icon"/);
  assert.match(skillMarkup, /lucide-sparkles/);
  assert.match(extensionMarkup, /lucide-puzzle/);
  assert.notEqual(skillMarkup, extensionMarkup);
});

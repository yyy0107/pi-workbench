import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ComposerCommandToken } from "../elements/composer";

import { ComposerCommandIcon, ComposerTokenIcon } from "./composer-token-icon";

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

test("uses the same category icon for an extension command token as the command menu", () => {
  const markup = renderToStaticMarkup(
    <ComposerCommandToken icon={<ComposerCommandIcon kind="extension" />} label="fixture" />,
  );

  assert.match(markup, /lucide-plug/);
});

test("renders Workspace file context tokens with a file icon", () => {
  assert.match(renderToken("workspace-file"), /lucide-file-text/);
});

test("applies the theme accent color class to the composer input token icon", () => {
  const markup = renderToStaticMarkup(
    <ComposerCommandToken
      icon={<ComposerTokenIcon kind="extension" />}
      iconClassName="aui-composer-command-token-icon-accent"
      iconSize="md-lg"
      label="fixture"
    />,
  );

  assert.match(markup, /aui-composer-command-token-icon-accent/);
  assert.match(markup, /aui-composer-icon-size-md-lg/);
});

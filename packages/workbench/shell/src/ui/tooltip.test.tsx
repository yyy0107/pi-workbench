import assert from "node:assert/strict";
import test from "node:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Button } from "./button";
import { Input } from "./input";
import { TooltipIconButton } from "./tooltip-icon-button";
import { withTooltip } from "./tooltip";

test("native titles become tooltips on the original element with accessible labels", () => {
  const html = renderToStaticMarkup(
    <>
      <Button title="Refresh">
        <svg aria-hidden="true" />
      </Button>
      <Input title="Context size" aria-label="Context window" defaultValue="42" />
      {withTooltip(<span title="/workspace/full/path">path</span>)}
      {withTooltip(
        <button title="Details" aria-labelledby="name">
          open
        </button>,
      )}
    </>,
  );
  assert.doesNotMatch(html, /\stitle=/);
  assert.match(html, /<button[^>]*aria-label="Refresh"/);
  assert.match(html, /<input[^>]*aria-label="Context window"/);
  assert.match(html, /<span[^>]*data-base-ui-tooltip-trigger=""[^>]*>path<\/span>/);
  assert.match(html, /aria-labelledby="name"/);
  assert.doesNotMatch(html, /aria-label="Details"/);
  assert.equal((html.match(/data-base-ui-tooltip-trigger=""/g) ?? []).length, 4);
});

test("untitled elements stay untouched and existing tooltips do not get a second owner", () => {
  const plain = <button>Plain</button>;
  assert.equal(withTooltip(plain), plain);
  const html = renderToStaticMarkup(
    <TooltipIconButton tooltip="Copy" title="Old native copy">
      <svg aria-hidden="true" />
    </TooltipIconButton>,
  );
  assert.doesNotMatch(html, /\stitle=/);
  assert.doesNotMatch(html, /Old native copy/);
  assert.equal((html.match(/data-base-ui-tooltip-trigger=""/g) ?? []).length, 1);
});

test("action hints are immediate, informational hints inherit the delay, and overrides work", () => {
  const tooltips = [
    withTooltip(<span title="/workspace/full/path">path</span>),
    withTooltip(<span title="Connection lost" />, 0),
    Button({ title: "Refresh", size: "icon" }),
    Button({ title: "Copy", size: "icon-sm" }),
    Button({ title: "Full branch name" }),
    Button({ title: "Try again", tooltipDelay: 0 }),
    Button({ title: "Details", size: "icon", tooltipDelay: 800 }),
  ];
  const delays = tooltips.map(
    (tooltip) =>
      (tooltip as ReactElement<{ children: ReactElement<{ delay?: number }>[] }>).props.children[0]!
        .props.delay,
  );
  assert.deepEqual(delays, [undefined, 0, 0, 0, undefined, 0, 800]);
  assert.doesNotMatch(
    renderToStaticMarkup(<Button title="Details" tooltipDelay={800} />),
    /tooltipDelay=|\sdelay=/,
  );
});

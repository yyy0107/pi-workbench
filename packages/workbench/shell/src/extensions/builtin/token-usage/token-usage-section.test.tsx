import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { TokenUsageSection } from "./token-usage-section";

test("context sections disclose content through one accessible button", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  let section!: ReturnType<typeof TokenUsageSection>;
  function Probe() {
    section = TokenUsageSection({
      label: "Tools",
      value: "15K",
      children: <p>Tool definitions</p>,
    });
    return null;
  }
  try {
    await act(async () => root.render(<Probe />));
    for (const open of [false, true, false, true]) {
      await act(async () => section.props.onOpenChange(open));
      const html = renderToStaticMarkup(section);
      assert.equal((html.match(/<button\b/g) ?? []).length, 1);
      assert.ok(html.includes(`aria-expanded="${open}"`));
      assert.match(html, /Tools/);
      assert.match(html, /15K/);
      assert.equal(html.includes("Tool definitions"), open);
    }
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { installMinimalReactDomEnvironment } from "@workbench/ui-testkit";
import {
  MarkdownLinkAdapterProvider,
  useMarkdownLinkAdapter,
  type MarkdownFileLinkProps,
  type MarkdownLinkAdapter,
} from "../src/link-adapter";

function adapter(id: string, basename: string): MarkdownLinkAdapter {
  return {
    isLocalFileHref: (href) => href === basename + ".ts:9" || href === "./" + basename + ".ts:9",
    FileLink: ({ href, children, ...props }: MarkdownFileLinkProps) =>
      createElement("a", { ...props, href, "data-adapter": id }, children),
  };
}
test("a mounted installation retains its classifier/renderer pair when caller props change", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  const first = adapter("one", "first");
  const second = adapter("two", "second");
  let installed: MarkdownLinkAdapter | undefined;
  function Probe() {
    installed = useMarkdownLinkAdapter();
    return null;
  }
  const show = async (value: MarkdownLinkAdapter) => {
    await act(async () => {
      root.render(
        createElement(MarkdownLinkAdapterProvider, {
          adapter: value,
          children: createElement(Probe),
        }),
      );
    });
  };
  try {
    await show(first);
    const snapshot = installed;
    await show(second);
    assert.equal(installed, snapshot);
    assert.equal(Object.isFrozen(installed), true);
    assert.equal(installed?.isLocalFileHref("first.ts:9"), true);
    assert.equal(installed?.isLocalFileHref("second.ts:9"), false);
    assert.equal(installed?.FileLink, first.FileLink);
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
});

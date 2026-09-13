import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { installMinimalReactDomEnvironment } from "@workbench/ui-testkit";
import { WorkbenchSettingsProvider, type WorkbenchSettingsPort } from "@workbench/settings-runtime";
import type { CodeTheme } from "@workbench/appearance";
import {
  useWorkbenchHighlightedLines,
  type WorkbenchHighlightedLinesResult,
} from "../src/use-workbench-highlighted-lines";

const service: WorkbenchSettingsPort = {
  async load() {
    return {};
  },
  async update() {},
};
test("mounted code changes themes without displaying stale token colors or changing source", async () => {
  const environment = installMinimalReactDomEnvironment();
  Object.assign(window, { setTimeout, clearTimeout });
  const root = createRoot(environment.container);
  const code = 'const text = "中文";\n\n';
  let latest: WorkbenchHighlightedLinesResult | undefined;
  function Probe({ theme }: { theme: CodeTheme }) {
    latest = useWorkbenchHighlightedLines(code, "typescript", { theme });
    return null;
  }
  const show = async (theme: CodeTheme) => {
    await act(async () => {
      root.render(
        createElement(WorkbenchSettingsProvider, {
          service,
          children: createElement(Probe, { theme }),
        }),
      );
    });
  };
  const settle = async () => {
    const deadline = Date.now() + 10_000;
    while (!latest?.tokens && Date.now() < deadline)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
    assert.ok(latest?.tokens);
    assert.equal(
      latest.tokens.map((line) => line.map(({ content }) => content).join("")).join("\n"),
      code,
    );
    return latest.tokens;
  };
  try {
    await show("github-dark");
    const first = await settle();
    await show("dracula");
    assert.equal(latest?.tokens, null, "a previous theme must not flash while the new theme loads");
    const second = await settle();
    assert.notDeepEqual(second, first);
    await show("github-dark");
    assert.deepEqual(await settle(), first);
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RefObject } from "react";

import {
  WorkbenchPortalContainerProvider,
  useWorkbenchPortalContainer,
} from "./workbench-portal-container";

function PortalRefProbe({ expected }: { expected: RefObject<HTMLElement | null> }) {
  assert.equal(useWorkbenchPortalContainer(), expected);
  return null;
}

test("Workbench portal containers are isolated by installation", () => {
  const first = { current: null } satisfies RefObject<HTMLElement | null>;
  const second = { current: null } satisfies RefObject<HTMLElement | null>;

  renderToStaticMarkup(
    <>
      <WorkbenchPortalContainerProvider containerRef={first}>
        <PortalRefProbe expected={first} />
      </WorkbenchPortalContainerProvider>
      <WorkbenchPortalContainerProvider containerRef={second}>
        <PortalRefProbe expected={second} />
      </WorkbenchPortalContainerProvider>
    </>,
  );
});

test("every Shell floating primitive targets its installation portal container", async () => {
  const portalSources = [
    "context-menu.tsx",
    "dialog.tsx",
    "dropdown-menu.tsx",
    "popover.tsx",
    "sheet.tsx",
    "tooltip.tsx",
  ];
  for (const filename of portalSources) {
    const source = await readFile(new URL(`./${filename}`, import.meta.url), "utf8");
    assert.match(source, /useWorkbenchPortalContainer/u, filename);
    assert.match(source, /container=\{/u, filename);
  }

  const [citation, workspaceTabs, workbenchShell] = await Promise.all([
    readFile(new URL("../elements/inline-citation.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../right-workspace/presentation/workspace-tabs.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../shell/workbench-shell.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(citation, /<PreviewCard\.Portal container=\{workbenchContainer\}>/u);
  assert.match(workspaceTabs, /workbenchPortalContainer\?\.current \?\? document\.body/u);
  assert.match(
    workbenchShell,
    /WorkbenchPortalContainerProvider containerRef=\{portalContainerRef\}/u,
  );
  assert.match(workbenchShell, /data-workbench-portal-container=/u);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Tabs, TabsList, TabsTrigger } from "../../src/ui/tabs";

test("shared tabs preserve nested workspace trigger ARIA relationships", () => {
  const html = renderToStaticMarkup(
    <Tabs value="surface-a">
      <TabsList activateOnFocus aria-label="Workspace">
        <div role="presentation">
          <TabsTrigger
            value="surface-a"
            id="workspace-tab-surface-a"
            aria-controls="workspace-tabpanel-surface-a"
          >
            Surface A
          </TabsTrigger>
          <button type="button" aria-label="Close Surface A" />
        </div>
      </TabsList>
    </Tabs>,
  );

  assert.match(html, /role="tablist"/u);
  assert.match(html, /role="tab"/u);
  assert.match(html, /aria-selected="true"/u);
  assert.match(html, /aria-controls="workspace-tabpanel-surface-a"/u);
});

test("WorkspaceTabs delegates keyboard navigation to the shared Tabs primitive", async () => {
  const source = await readFile(
    new URL("../../src/right-workspace/presentation/workspace-tabs.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<Tabs[\s\S]*value=\{activeSurfaceId\}/u);
  assert.match(source, /<TabsList[\s\S]*activateOnFocus/u);
  assert.match(source, /<TabsTrigger[\s\S]*value=\{surface\.id\}/u);
  assert.match(source, /<DirectionProvider direction=\{tabDirection\}>/u);
  assert.doesNotMatch(source, /onKeyDown=/u);
});

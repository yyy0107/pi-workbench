import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SearchableSelector,
  SearchableSelectorCollection,
  SearchableSelectorGroup,
  SearchableSelectorGroupLabel,
  SearchableSelectorItem,
  SearchableSelectorList,
  SearchableSelectorTrigger,
  SearchableSelectorValue,
  SettingsField,
  SettingsGroup,
  SettingsRow,
  StatusBadge,
  Surface,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "./index";

test("Tabs delegates selection semantics to Base UI", () => {
  const html = renderToStaticMarkup(
    <Tabs defaultValue="general">
      <TabsList aria-label="Settings sections">
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="advanced">Advanced</TabsTrigger>
      </TabsList>
      <TabsContent value="general">General settings</TabsContent>
      <TabsContent value="advanced">Advanced settings</TabsContent>
    </Tabs>,
  );

  assert.match(html, /role="tablist"/u);
  assert.match(html, /role="tab"/u);
  assert.match(html, /aria-selected="true"/u);
  assert.match(html, /data-slot="tabs-content"/u);
});

test("SearchableSelector exposes a labelled trigger-based combobox", () => {
  const html = renderToStaticMarkup(
    <SearchableSelector<string> items={["alpha", "beta"]} defaultValue="alpha">
      <SearchableSelectorTrigger aria-label="Select workspace">
        <SearchableSelectorValue />
      </SearchableSelectorTrigger>
    </SearchableSelector>,
  );

  assert.match(html, /role="combobox"/u);
  assert.match(html, /aria-label="Select workspace"/u);
  assert.match(html, /data-slot="searchable-selector-trigger"/u);
});

test("SearchableSelector group labels own their item collection context", () => {
  const items = ["alpha", "beta"];
  const html = renderToStaticMarkup(
    <SearchableSelector<string> items={items} defaultValue="alpha">
      <SearchableSelectorList>
        <SearchableSelectorGroup items={items}>
          <SearchableSelectorGroupLabel>Workspaces</SearchableSelectorGroupLabel>
          <SearchableSelectorCollection>
            {(item: string) => <SearchableSelectorItem value={item}>{item}</SearchableSelectorItem>}
          </SearchableSelectorCollection>
        </SearchableSelectorGroup>
      </SearchableSelectorList>
    </SearchableSelector>,
  );

  assert.match(html, /data-slot="searchable-selector-group-label"/u);
  assert.match(html, /role="group"/u);
  assert.match(html, /role="option"/u);
});

test("settings layouts expose separate content and control slots", () => {
  const html = renderToStaticMarkup(
    <SettingsGroup title="Appearance" description="Customize the workbench">
      <SettingsRow label="Theme" description="Choose a color scheme">
        <span>System</span>
      </SettingsRow>
      <SettingsField label="Custom CSS" error="Invalid value">
        <input aria-label="Custom CSS" />
      </SettingsField>
    </SettingsGroup>,
  );

  assert.match(html, /data-slot="settings-group-content"/u);
  assert.match(html, /data-slot="settings-row-content"/u);
  assert.match(html, /data-slot="settings-row-control"/u);
  assert.match(html, /role="alert"/u);
});

test("status and surface variants remain semantic", () => {
  const html = renderToStaticMarkup(
    <>
      <StatusBadge tone="success">Ready</StatusBadge>
      <Surface variant="floating">Details</Surface>
    </>,
  );

  assert.match(html, /data-tone="success"/u);
  assert.match(html, /bg-success\/10/u);
  assert.match(html, /data-variant="floating"/u);
});

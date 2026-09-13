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
} from "../src/index";

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

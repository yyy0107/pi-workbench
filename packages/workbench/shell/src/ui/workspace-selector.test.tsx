import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspaceSelector } from "./workspace-selector";

test("marks a blocked workspace selector invalid and shows the prompt", () => {
  const html = renderToStaticMarkup(
    createElement(WorkspaceSelector, {
      error: true,
      labels: {
        select: "Select workspace",
        clear: "Clear workspace",
        selecting: "Selecting",
        selectError: "Select a workspace before sending",
        empty: "Select project",
        search: "Search workspaces",
        searchPlaceholder: "Search workspaces",
        noSearchResults: "No matching workspaces",
      },
      workspaces: [],
      onValueChange: () => undefined,
    }),
  );

  assert.match(html, /aria-invalid="true"/u);
  assert.match(html, />Select a workspace before sending</u);
});

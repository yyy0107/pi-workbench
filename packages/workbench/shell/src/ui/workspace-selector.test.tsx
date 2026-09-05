import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspaceSelector, type WorkspaceSelectorOption } from "./workspace-selector";

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

test("selects and searches user and project options without requiring a user workspace path", () => {
  const user: WorkspaceSelectorOption = {
    id: "user",
    name: "User",
    icon: createElement("svg", { "data-test-icon": "user", "aria-hidden": true }),
  };
  const project: WorkspaceSelectorOption = {
    id: "project:example",
    name: "Example",
    rootPath: "/projects/example",
  };
  const selected: string[] = [];
  const selector = WorkspaceSelector({
    labels: {
      select: "Select scope",
      clear: "Clear scope",
      selecting: "Selecting scope",
      selectError: "Could not select scope",
      empty: "Unavailable project",
      search: "Search scopes",
      searchPlaceholder: "Search scopes",
      noSearchResults: "No matching scopes",
    },
    selectedWorkspace: user,
    workspaces: [user, project],
    onValueChange: (id) => selected.push(id),
  });

  assert.equal(selector.props.filter(user, " USER "), true);
  assert.equal(selector.props.filter(user, "missing"), false);
  assert.equal(selector.props.filter(project, "/PROJECTS/"), true);
  assert.doesNotMatch(selector.props.itemToStringLabel(user), /undefined/u);
  selector.props.onValueChange(user);
  selector.props.onValueChange(project);
  assert.deepEqual(selected, [user.id, project.id]);

  const html = renderToStaticMarkup(selector);
  assert.match(html, /data-test-icon="user"/u);
  assert.match(html, />User</u);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseToolboxScopeKey,
  toolboxScopeKey,
  toolboxScopeMatchesCapability,
  toolboxScopeMatchesResource,
  toolboxScopeTarget,
} from "./toolbox-scope";

test("round-trips user and project Toolbox scope keys", () => {
  assert.deepEqual(parseToolboxScopeKey(toolboxScopeKey({ kind: "user" })), { kind: "user" });
  assert.deepEqual(
    parseToolboxScopeKey(toolboxScopeKey({ kind: "project", workspaceId: "project:/one" })),
    { kind: "project", workspaceId: "project:/one" },
  );
  assert.equal(parseToolboxScopeKey("project:%E0%A4%A"), undefined);
});

test("maps the independent Toolbox scope directly to a resource catalog target", () => {
  assert.deepEqual(toolboxScopeTarget({ kind: "user" }), { scope: "user" });
  assert.deepEqual(toolboxScopeTarget({ kind: "project", workspaceId: "project-b" }), {
    scope: "project",
    workspaceId: "project-b",
  });
});

test("keeps direct user and project resources in separate management scopes", () => {
  assert.equal(toolboxScopeMatchesResource({ kind: "user" }, "user"), true);
  assert.equal(toolboxScopeMatchesResource({ kind: "user" }, "project"), false);
  assert.equal(
    toolboxScopeMatchesResource({ kind: "project", workspaceId: "project-a" }, "project"),
    true,
  );
  assert.equal(
    toolboxScopeMatchesResource({ kind: "project", workspaceId: "project-a" }, "temporary"),
    false,
  );
});

test("invalidates project details when the independently selected Toolbox scope changes", () => {
  const capability = {
    capabilityId: "skill:review:project:project-a",
    capabilityKind: "skill" as const,
    name: "review",
    scope: "project" as const,
    projectId: "project-a",
  };

  assert.equal(
    toolboxScopeMatchesCapability({ kind: "project", workspaceId: "project-a" }, capability),
    true,
  );
  assert.equal(
    toolboxScopeMatchesCapability({ kind: "project", workspaceId: "project-b" }, capability),
    false,
  );
  assert.equal(toolboxScopeMatchesCapability({ kind: "user" }, capability), false);
});

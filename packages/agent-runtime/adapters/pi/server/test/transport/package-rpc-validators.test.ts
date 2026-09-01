import assert from "node:assert/strict";
import test from "node:test";

import {
  packageCatalogDescribePayload,
  packageCatalogNameValidator,
  packageCatalogSearchPayload,
  packageDescribePayload,
  packageInstallPayload,
  packageMutationTargetValidator,
  packageSourceMutationPayload,
  packageSourceValidator,
} from "../../src/transport/package-rpc-validators";

test("shares normalized npm Package names between install and Catalog describe", () => {
  assert.deepEqual(packageCatalogNameValidator("  @scope/pi-tools  "), {
    ok: true,
    value: "@scope/pi-tools",
  });
  assert.equal(packageCatalogNameValidator("https://example.com/pi-tools").ok, false);

  const install = packageInstallPayload({
    name: "  @scope/pi-tools  ",
    target: { scope: "user", sessionId: "session-1", ignored: true },
    ignored: true,
  });
  assert.equal(install.ok, true);
  if (!install.ok) assert.fail("Expected a valid Package install payload.");
  assert.deepEqual(install.value, {
    name: "@scope/pi-tools",
    target: { scope: "user", sessionId: "session-1" },
  });

  assert.deepEqual(packageCatalogDescribePayload({ name: "  pi-tools  ", ignored: true }), {
    ok: true,
    value: { name: "pi-tools" },
  });
});

test("shares bounded control-free Package sources across describe, update, and remove", () => {
  assert.deepEqual(packageSourceValidator("  git:github.com/example/pi-tools  "), {
    ok: true,
    value: "git:github.com/example/pi-tools",
  });
  assert.equal(packageSourceValidator("npm:pi-tools\ninvalid").ok, false);
  assert.equal(packageSourceValidator("x".repeat(2_049)).ok, false);

  assert.deepEqual(
    packageDescribePayload({
      source: " npm:pi-tools ",
      target: { scope: "project", workspaceId: "workspace-1", ignored: true },
      ignored: true,
    }),
    {
      ok: true,
      value: {
        source: "npm:pi-tools",
        target: { scope: "project", workspaceId: "workspace-1" },
      },
    },
  );
  assert.deepEqual(
    packageSourceMutationPayload({
      source: " npm:pi-tools ",
      target: { scope: "user", ignored: true },
      ignored: true,
    }),
    {
      ok: true,
      value: { source: "npm:pi-tools", target: { scope: "user" } },
    },
  );
});

test("keeps Package mutation targets and Catalog query fields bounded", () => {
  assert.deepEqual(
    packageMutationTargetValidator({
      scope: "project",
      workspaceId: "workspace-1",
      ignored: true,
    }),
    {
      ok: true,
      value: { scope: "project", workspaceId: "workspace-1" },
    },
  );
  for (const target of [
    { scope: "project", workspaceId: "" },
    { scope: "workspace", workspaceId: "workspace-1" },
  ]) {
    assert.equal(packageMutationTargetValidator(target).ok, false);
  }

  assert.deepEqual(
    packageCatalogSearchPayload({
      query: "  review  ",
      type: "extension",
      sort: "downloads",
      page: 2,
      ignored: true,
    }),
    {
      ok: true,
      value: { query: "review", type: "extension", sort: "downloads", page: 2 },
    },
  );
  assert.equal(packageCatalogSearchPayload({ type: "plugin", page: 0 }).ok, false);
});

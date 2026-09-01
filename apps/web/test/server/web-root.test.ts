import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { STANDALONE_WEB_RELATIVE_APP_DIRECTORY, resolveWebRoot } from "@/server/web-root";

test("resolves explicit Web roots independently of the process cwd", () => {
  assert.equal(STANDALONE_WEB_RELATIVE_APP_DIRECTORY, "apps/web");
  assert.equal(
    resolveWebRoot({ configuredRoot: "apps/web", workingDirectory: "/repository" }),
    path.resolve("/repository/apps/web"),
  );
  assert.equal(
    resolveWebRoot({
      configuredRoot: "/staged/desktop-runtime/apps/web",
      workingDirectory: "/untrusted/cwd",
    }),
    path.resolve("/staged/desktop-runtime/apps/web"),
  );
});

test("uses the caller-selected working directory only when no launcher root is configured", () => {
  assert.equal(
    resolveWebRoot({ configuredRoot: "  ", workingDirectory: "/repository/apps/web" }),
    path.resolve("/repository/apps/web"),
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { contextTraceSurfaceDefinition } from "./context-trace/extension";
import { terminalSurfaceDefinition } from "./terminal/extension";
import { artifactSurfaceDefinition } from "./workspace-artifact/extension";
import { browserSurfaceDefinition } from "./workspace-browser/extension";
import { explorerSurfaceDefinition } from "./workspace-explorer/extension";
import { fileSurfaceDefinition } from "./workspace-file/extension";
import { reviewSurfaceDefinition } from "./workspace-review/extension";

test("built-in workspace surfaces retain only state that cannot be recreated safely", () => {
  assert.equal(terminalSurfaceDefinition.cachePolicy, "keep-alive");
  assert.equal(explorerSurfaceDefinition.cachePolicy, "keep-alive");
  assert.equal(fileSurfaceDefinition.cachePolicy, "preserve-dirty");

  assert.equal(artifactSurfaceDefinition.cachePolicy, "unmount");
  assert.equal(browserSurfaceDefinition.cachePolicy, "unmount");
  assert.equal(reviewSurfaceDefinition.cachePolicy, "unmount");
  assert.equal(contextTraceSurfaceDefinition.cachePolicy, "unmount");
});

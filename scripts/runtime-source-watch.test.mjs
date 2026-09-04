import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import workbenchPaths from "./workbench-paths.cjs";
import {
  createRuntimeSourceWatchArguments,
  piResourceWatchExcludes,
  runtimeSourceWatchIncludes,
} from "./runtime-source-watch.mjs";

const { createWorkbenchPaths } = workbenchPaths;

const watchPath = (value) => value.split(path.sep).join("/");

test("derives one exact Runtime/custom-Web source watch boundary", () => {
  const paths = createWorkbenchPaths({
    repositoryRoot: path.resolve("/arbitrary/workbench-repository"),
  });
  const agentDir = path.resolve("/arbitrary/pi-agent");
  const arguments_ = createRuntimeSourceWatchArguments({ paths, agentDir });

  for (const pattern of piResourceWatchExcludes({ agentDir, root: paths.repositoryRoot })) {
    assert.ok(arguments_.includes(pattern), pattern);
  }
  for (const pattern of runtimeSourceWatchIncludes({ paths })) {
    const index = arguments_.indexOf(pattern);
    assert.ok(index > 0, pattern);
    assert.equal(arguments_[index - 1], "--include");
  }
  assert.deepEqual(runtimeSourceWatchIncludes({ paths }), [
    `${watchPath(paths.runtimeAppRoot)}/src/**/*.{ts,tsx,js,jsx,mjs,cjs,json}`,
    `${watchPath(paths.webSourceRoot)}/server/**/*.{ts,tsx,js,jsx,mjs,cjs,json}`,
    `${watchPath(paths.webSourceRoot)}/runtime-connected-web-main.ts`,
    `${watchPath(paths.runtimeAppRoot)}/package.json`,
    `${watchPath(paths.webRoot)}/package.json`,
    `${watchPath(paths.repositoryRoot)}/packages/**/package.json`,
  ]);
  assert.equal(arguments_.includes("apps/runtime-node/src/main.ts"), false);
});

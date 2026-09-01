import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const {
  default: nextConfig,
  WEB_APP_ROOT,
  WEB_OUTPUT_FILE_TRACING_EXCLUDES,
  WEB_OUTPUT_FILE_TRACING_INCLUDES,
  WEB_REPOSITORY_ROOT,
} = (await import(
  new URL("../next.config.ts", import.meta.url).href
)) as typeof import("../next.config");

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

test("Next and Turbopack use the absolute repository root from the relocated Web app", () => {
  assert.equal(WEB_APP_ROOT, path.join(REPOSITORY_ROOT, "apps", "web"));
  assert.equal(path.isAbsolute(WEB_REPOSITORY_ROOT), true);
  assert.equal(WEB_REPOSITORY_ROOT, REPOSITORY_ROOT);
  assert.equal(nextConfig.outputFileTracingRoot, REPOSITORY_ROOT);
  assert.equal(nextConfig.turbopack?.root, REPOSITORY_ROOT);
  assert.equal(nextConfig.output, "standalone");
});

test("tracing exclusions remain narrow and relative to apps/web", () => {
  assert.deepEqual(nextConfig.outputFileTracingExcludes, {
    "/*": [...WEB_OUTPUT_FILE_TRACING_EXCLUDES],
  });
  assert.equal(
    WEB_OUTPUT_FILE_TRACING_EXCLUDES.every((pattern) => !path.isAbsolute(pattern)),
    true,
  );
  assert.equal(
    WEB_OUTPUT_FILE_TRACING_EXCLUDES.some((pattern) => pattern.includes("packages/")),
    false,
    "shared workspace packages must remain traceable",
  );
  for (const pattern of [
    "../desktop-electron/**/*",
    "../../scripts/**/*",
    "../runtime-node/**/*",
    "src/app/**/*",
    "src/server/**/*",
  ]) {
    assert.equal(WEB_OUTPUT_FILE_TRACING_EXCLUDES.includes(pattern), true, pattern);
  }
  assert.equal("serverExternalPackages" in nextConfig, false);
});

test("tracing includes derive only Next's exact dynamic webpack runtime closure", () => {
  assert.deepEqual(nextConfig.outputFileTracingIncludes, {
    "/*": [...WEB_OUTPUT_FILE_TRACING_INCLUDES],
  });
  assert.equal(WEB_OUTPUT_FILE_TRACING_INCLUDES.length, 21);
  assert.equal(new Set(WEB_OUTPUT_FILE_TRACING_INCLUDES).size, 21);
  assert.equal(
    WEB_OUTPUT_FILE_TRACING_INCLUDES.every(
      (pattern) =>
        !path.isAbsolute(pattern) &&
        pattern.startsWith("node_modules/next/dist/compiled/") &&
        !pattern.includes("*") &&
        !pattern.endsWith(".map"),
    ),
    true,
  );
  for (const path of [
    "node_modules/next/dist/compiled/webpack/webpack-lib.js",
    "node_modules/next/dist/compiled/webpack/webpack.js",
    "node_modules/next/dist/compiled/webpack/bundle5.js",
    "node_modules/next/dist/compiled/@babel/runtime/package.json",
  ]) {
    assert.equal(WEB_OUTPUT_FILE_TRACING_INCLUDES.includes(path), true, path);
  }
});

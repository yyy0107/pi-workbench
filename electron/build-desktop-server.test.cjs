const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { build } = require("esbuild");

const {
  DESKTOP_SERVER_EXTERNAL_PACKAGES,
  assertDesktopServerExternalPackages,
  createDesktopServerBuildOptions,
  externalPackagesFromMetafile,
} = require("./build-desktop-server.cjs");

function writeWorkspaceFixture(root) {
  const packageDirectory = path.join(root, "node_modules", "@workbench", "fixture");
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(
    path.join(packageDirectory, "package.json"),
    JSON.stringify({
      name: "@workbench/fixture",
      version: "0.0.0",
      type: "module",
      exports: "./index.js",
    }),
  );
  writeFileSync(
    path.join(packageDirectory, "index.js"),
    'export const workspaceMarker = "workspace-bundled-sentinel";\n',
  );
}

test("bundles Workbench workspace packages and externalizes only the runtime budget", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "workbench-desktop-server-build-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  writeWorkspaceFixture(root);
  writeFileSync(
    path.join(root, "entry.mjs"),
    [
      'import * as piCodingAgent from "@earendil-works/pi-coding-agent";',
      'import { workspaceMarker } from "@workbench/fixture";',
      'import next from "next";',
      'import * as nodePty from "node-pty";',
      'import { WebSocket } from "ws";',
      "console.log(workspaceMarker, piCodingAgent, next, nodePty, WebSocket);",
    ].join("\n"),
  );

  const options = createDesktopServerBuildOptions({
    absWorkingDir: root,
    entryPoint: "entry.mjs",
    outfile: path.join(root, "server.mjs"),
  });
  assert.equal(options.packages, undefined);
  assert.deepEqual(
    options.external,
    DESKTOP_SERVER_EXTERNAL_PACKAGES.flatMap((packageName) => [packageName, `${packageName}/*`]),
  );

  const result = await build({ ...options, write: false });
  const output = result.outputFiles.find((file) => file.path.endsWith("server.mjs"))?.text;
  assert.ok(output);
  assert.match(output, /workspace-bundled-sentinel/);
  assert.ok(
    Object.keys(result.metafile.inputs).some((input) =>
      input.endsWith("node_modules/@workbench/fixture/index.js"),
    ),
  );
  const externalPackages = externalPackagesFromMetafile(result.metafile);
  assert.equal(externalPackages.includes("@workbench/fixture"), false);
  assert.deepEqual(
    assertDesktopServerExternalPackages(externalPackages),
    [...DESKTOP_SERVER_EXTERNAL_PACKAGES].sort(),
  );
});

test("rejects an externalized Workbench workspace package", () => {
  assert.throws(
    () =>
      assertDesktopServerExternalPackages([
        ...DESKTOP_SERVER_EXTERNAL_PACKAGES,
        "@workbench/fixture",
      ]),
    /Workbench workspace packages must be bundled/,
  );
});

test("rejects a changed third-party external package whitelist", () => {
  assert.throws(
    () => assertDesktopServerExternalPackages(["next", "ws"]),
    /Desktop server external package whitelist changed/,
  );
});

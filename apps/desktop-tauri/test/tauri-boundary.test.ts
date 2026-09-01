import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT,
  DESKTOP_RENDERER_ARTIFACT_KIND,
  DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME,
  DESKTOP_RENDERER_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  DESKTOP_RENDERER_ARTIFACT_STATIC_ROOT,
  type DesktopRendererArtifactFile,
} from "@workbench/host-contracts/desktop-renderer-artifact-manifest";
import { RUNTIME_HOST_PROTOCOL_VERSION } from "@workbench/host-contracts/runtime-host-control";

import {
  DEFAULT_DESKTOP_RENDERER_ARTIFACT_MANIFEST,
  DEFAULT_DESKTOP_RENDERER_ARTIFACT_ROOT,
  DEFAULT_TAURI_FRONTEND_DIST,
  stageDesktopRendererArtifact,
} from "../scripts/stage-desktop-renderer-artifact";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "../..");
const repositoryRequire = createRequire(path.join(repositoryRoot, "package.json"));

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(appRoot, relativePath), "utf8");
}

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await read(relativePath)) as Record<string, unknown>;
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const absolute = path.join(directory, entry.name);
        return entry.isDirectory() ? filesBelow(absolute) : [absolute];
      }),
    )
  ).flat();
}

async function artifactFile(
  root: string,
  relativePath: string,
): Promise<DesktopRendererArtifactFile> {
  const contents = await readFile(path.join(root, ...relativePath.split("/")));
  return {
    path: relativePath,
    size: contents.length,
    sha256: createHash("sha256").update(contents).digest("hex"),
    mode: 0o644,
  };
}

test("stages only the admitted canonical Desktop renderer artifact", async (t) => {
  const workbenchPaths = (
    repositoryRequire("./scripts/workbench-paths.cjs") as {
      readonly createWorkbenchPaths: (options: { readonly repositoryRoot: string }) => {
        readonly desktopRendererArtifactRoot: string;
        readonly desktopRendererArtifactManifestPath: string;
        readonly tauriRoot: string;
      };
    }
  ).createWorkbenchPaths({ repositoryRoot });
  assert.equal(DEFAULT_DESKTOP_RENDERER_ARTIFACT_ROOT, workbenchPaths.desktopRendererArtifactRoot);
  assert.equal(
    DEFAULT_DESKTOP_RENDERER_ARTIFACT_MANIFEST,
    workbenchPaths.desktopRendererArtifactManifestPath,
  );
  assert.equal(DEFAULT_TAURI_FRONTEND_DIST, path.join(workbenchPaths.tauriRoot, "dist"));

  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "workbench-tauri-renderer-"));
  t.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const sourceRoot = path.join(fixtureRoot, "source");
  const destinationRoot = path.join(fixtureRoot, "tauri-dist");
  await mkdir(path.join(sourceRoot, "assets"), { recursive: true });
  await Promise.all([
    writeFile(path.join(sourceRoot, "assets", "app.js"), "export {};\n", { mode: 0o644 }),
    writeFile(path.join(sourceRoot, DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT), "<!doctype html>\n", {
      mode: 0o644,
    }),
  ]);
  await Promise.all([
    chmod(path.join(sourceRoot, "assets", "app.js"), 0o644),
    chmod(path.join(sourceRoot, DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT), 0o644),
  ]);
  const files = await Promise.all(
    ["assets/app.js", DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT].map((relativePath) =>
      artifactFile(sourceRoot, relativePath),
    ),
  );
  const manifestPath = path.join(sourceRoot, DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME);
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: DESKTOP_RENDERER_ARTIFACT_MANIFEST_SCHEMA_VERSION,
        artifactKind: DESKTOP_RENDERER_ARTIFACT_KIND,
        applicationVersion: "0.1.0",
        buildId: "fixture-build",
        entrypoint: DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT,
        staticRoot: DESKTOP_RENDERER_ARTIFACT_STATIC_ROOT,
        requiredRuntimeHostProtocolVersion: RUNTIME_HOST_PROTOCOL_VERSION,
        resources: ["assets/app.js"],
        files,
        links: [],
      },
      null,
      2,
    )}\n`,
    { mode: 0o644 },
  );
  await mkdir(destinationRoot);
  await writeFile(path.join(destinationRoot, "stale.txt"), "stale\n");

  const staged = await stageDesktopRendererArtifact({
    artifactRoot: sourceRoot,
    manifestPath,
    destinationRoot,
  });
  assert.equal(staged.artifactRoot, destinationRoot);
  assert.equal(
    await readFile(path.join(destinationRoot, "assets", "app.js"), "utf8"),
    "export {};\n",
  );
  assert.deepEqual((await readdir(destinationRoot)).sort(), [
    DESKTOP_RENDERER_ARTIFACT_MANIFEST_FILENAME,
    "assets",
    DESKTOP_RENDERER_ARTIFACT_ENTRYPOINT,
  ]);

  await writeFile(path.join(sourceRoot, "assets", "app.js"), "mutated\n");
  await assert.rejects(
    stageDesktopRendererArtifact({ artifactRoot: sourceRoot, manifestPath, destinationRoot }),
    /inventory does not match/u,
  );
  assert.equal(
    await readFile(path.join(destinationRoot, "assets", "app.js"), "utf8"),
    "export {};\n",
  );
});

test("declares a static product renderer build without frontend-only Tauri dependencies", async () => {
  const manifest = await readJson("package.json");
  assert.deepEqual(manifest.dependencies, { "@workbench/host-contracts": "workspace:*" });
  assert.deepEqual(manifest.devDependencies, {
    "@tauri-apps/cli": "2.11.4",
    "@types/node": "^26.2.0",
    "@workbench/host-artifact-policy": "workspace:*",
    "@workbench/host-server": "workspace:*",
    tsx: "^4.23.12",
    typescript: "^7.0.2",
  });
  const scripts = manifest.scripts as Record<string, string>;
  assert.equal(Object.hasOwn(scripts, "build:renderer"), false);
  assert.equal(scripts.build, "pnpm run stage:renderer && pnpm run stage:sidecar");
  assert.equal(scripts["smoke:packaged"], "tsx scripts/linux-packaged-product-smoke.ts");
  assert.equal(
    scripts["smoke:packaged:hard-death"],
    "tsx scripts/linux-packaged-product-smoke.ts --hard-death",
  );
  assert.equal(scripts["stage:renderer"], "tsx scripts/stage-desktop-renderer-artifact.ts");
  await assert.rejects(stat(path.join(appRoot, "src")), { code: "ENOENT" });
  assert.equal(
    Object.keys({
      ...(manifest.dependencies as Record<string, string>),
      ...(manifest.devDependencies as Record<string, string>),
    }).some((name) => name.startsWith("@tauri-apps/plugin-")),
    false,
  );
});

test("confines the production main window to bundled assets, narrow commands, and loopback CSP", async () => {
  const config = await readJson("src-tauri/tauri.conf.json");
  assert.equal(config.productName, "Pi Workbench");
  assert.equal(config.identifier, "com.piworkbench.desktop");
  assert.deepEqual(config.build, {
    beforeDevCommand: { script: "pnpm run stage:renderer", wait: true },
    beforeBuildCommand: "pnpm run stage:renderer",
    frontendDist: "../dist",
  });
  assert.equal(
    path.resolve(
      appRoot,
      "src-tauri",
      String((config.build as Record<string, unknown>).frontendDist),
    ),
    DEFAULT_TAURI_FRONTEND_DIST,
  );
  assert.equal(Object.hasOwn(config.build as object, "devUrl"), false);

  const app = config.app as Record<string, unknown>;
  assert.equal(app.withGlobalTauri, false);
  const windows = app.windows as Array<Record<string, unknown>>;
  assert.deepEqual(
    windows.map((window) => window.label),
    ["main"],
  );
  assert.deepEqual(
    windows.map((window) => window.create),
    [false],
  );
  assert.equal(
    windows.some((window) => Object.hasOwn(window, "url")),
    false,
  );

  const security = app.security as Record<string, unknown>;
  assert.deepEqual(security.capabilities, ["main-runtime-control"]);
  assert.equal(security.dangerousDisableAssetCspModification, false);
  assert.equal(Object.hasOwn(security, "remote"), false);
  const csp = String(security.csp);
  assert.match(
    csp,
    /connect-src 'self' ipc: http:\/\/ipc\.localhost http:\/\/127\.0\.0\.1:\* ws:\/\/127\.0\.0\.1:\*/u,
  );
  for (const directive of [
    "default-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
  ]) {
    assert.equal(csp.includes(directive), true, directive);
  }
  assert.doesNotMatch(csp, /'unsafe-(?:eval|inline)'|\bnull\b|https?:\/\/\*|\s\*\s*(?:;|$)/u);

  const bundle = config.bundle as Record<string, unknown>;
  assert.deepEqual(bundle.externalBin, ["binaries/workbench-runtime-node"]);
  assert.deepEqual(bundle.resources, { "resources/runtime/": "runtime/" });
});

test("creates one main window with narrow desktop Runtime ports", async () => {
  const [source, supervisor] = await Promise.all([
    read("src-tauri/src/lib.rs"),
    read("src-tauri/src/runtime_supervisor.rs"),
  ]);
  const supervisorConstruction = source.indexOf("let supervisor = RuntimeSupervisor::new");
  const hostReady = source.indexOf("supervisor.bootstrap(bundled_renderer_origin().to_owned())");
  const stateRegistration = source.indexOf("app.manage(supervisor)");
  const windowCreation = source.indexOf("WebviewWindowBuilder::from_config");
  assert.ok(
    supervisorConstruction >= 0 &&
      supervisorConstruction < hostReady &&
      hostReady < stateRegistration &&
      stateRegistration < windowCreation,
  );
  assert.match(source, /filter\(\|config\| config\.label == "main"\)/u);
  assert.match(source, /main_configs\.next\(\)\.is_some\(\) \|\| main_config\.create/u);
  assert.match(source, /\.initialization_script\(DESKTOP_RUNTIME_BRIDGE\)/u);
  assert.match(
    source,
    /window\.location\.origin !== "tauri:\/\/localhost"[\s\S]*window\.location\.origin !== "http:\/\/tauri\.localhost"/u,
  );
  assert.match(source, /Object\.defineProperty\(window, "workbenchDesktop"/u);
  assert.match(
    source,
    /runtime: Object\.freeze\(\{[\s\S]*bootstrap: \(\) => invoke\("runtime_bootstrap", \{\}\)/u,
  );
  assert.match(
    source,
    /lifecycle: Object\.freeze\(\{[\s\S]*restartRuntime: \(\) => invoke\("runtime_restart", \{\}\)/u,
  );
  assert.doesNotMatch(source, /restart:\s*Option/u);
  assert.match(
    source,
    /on_document_title_changed\(\|window, title\|[\s\S]*window\.set_title\(&title\)[\s\S]*app_handle\(\)\.exit\(1\)/u,
  );
  assert.equal([...source.matchAll(/WebviewWindowBuilder::from_config/gu)].length, 1);
  assert.equal([...source.matchAll(/tauri::command/gu)].length, 2);
  assert.match(supervisor, /const MAIN_WINDOW_LABEL: &str = "main";/u);
  assert.match(
    supervisor,
    /cfg!\(target_os = "windows"\)[\s\S]*"http:\/\/tauri\.localhost"[\s\S]*"tauri:\/\/localhost"/u,
  );
  assert.match(supervisor, /window\.label\(\) != MAIN_WINDOW_LABEL/u);
});

test("grants the local main window only Runtime bootstrap and restart", async () => {
  const capability = await readJson("src-tauri/capabilities/main.json");
  assert.equal(capability.identifier, "main-runtime-control");
  assert.equal(capability.local, true);
  assert.deepEqual(capability.windows, ["main"]);
  assert.deepEqual(capability.platforms, ["linux", "macOS", "windows"]);
  assert.deepEqual(capability.permissions, ["allow-runtime-bootstrap", "allow-runtime-restart"]);
  assert.equal(Object.hasOwn(capability, "remote"), false);
  assert.doesNotMatch(JSON.stringify(capability), /core:default|shell|filesystem|\bfs:|http:/u);

  const build = await read("src-tauri/build.rs");
  assert.deepEqual([...build.matchAll(/"runtime_[a-z_]+"/gu)].map(([command]) => command).sort(), [
    '"runtime_bootstrap"',
    '"runtime_restart"',
  ]);
});

test("keeps application restart outside the narrow Runtime restart capability", async () => {
  const sources = await Promise.all(
    (await filesBelow(path.join(appRoot, "src-tauri", "src")))
      .filter((file) => file.endsWith(".rs"))
      .map((file) => readFile(file, "utf8")),
  );
  const combined = sources.join("\n");
  assert.doesNotMatch(
    combined,
    /\bAppHandle\s*::\s*restart\b|\brequest_restart\b|\bRESTART_EXIT_CODE\b/u,
  );
  assert.match(combined, /SupervisorRequest::Restart/u);
  assert.match(combined, /RuntimeHostShutdownReason::Restart/u);
  assert.match(combined, /RuntimeHostShutdownReason::Restart\s*=>\s*"restart"/u);
});

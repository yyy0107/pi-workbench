import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { piAgentRuntimeExtensionGroups } from "@workbench/agent-runtime-pi-contributions/installation";
import { shellExtensionGroups } from "@workbench/shell/extensions";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(target)));
    else if (entry.isFile() && /\.(?:ts|tsx|mjs)$/u.test(entry.name)) files.push(target);
  }
  return files.sort();
}

test("keeps the Desktop renderer on one static route and public package boundaries", async () => {
  const appDirectory = path.join(APP_ROOT, "src", "app");
  const routeFiles = (await sourceFiles(appDirectory))
    .map((filename) => path.relative(appDirectory, filename).split(path.sep).join("/"))
    .filter((filename) => /(?:^|\/)(?:page|layout|route)\.(?:ts|tsx)$/u.test(filename));
  assert.deepEqual(routeFiles, ["layout.tsx", "page.tsx"]);

  const productionFiles = await sourceFiles(path.join(APP_ROOT, "src"));
  productionFiles.push(path.join(APP_ROOT, "next.config.ts"));
  for (const filename of productionFiles) {
    const source = await readFile(filename, "utf8");
    const relative = path.relative(APP_ROOT, filename);
    assert.doesNotMatch(source, /apps\/web|apps\\web/u, relative);
    assert.doesNotMatch(
      source,
      /from\s+["']next\/(?:headers|dynamic|image)["']|["']use server["']/u,
      relative,
    );
    assert.doesNotMatch(source, /@workbench\/[A-Za-z0-9._/-]+\/src\//u, relative);
  }

  const nextConfig = await readFile(path.join(APP_ROOT, "next.config.ts"), "utf8");
  assert.match(nextConfig, /output:\s*["']export["']/u);
  assert.doesNotMatch(nextConfig, /\b(?:headers|redirects|rewrites|proxy)\s*:/u);

  const rootLayout = await readFile(path.join(appDirectory, "layout.tsx"), "utf8");
  assert.match(rootLayout, /data-workbench-desktop-renderer="1"/u);

  const productComposition = await readFile(
    path.join(APP_ROOT, "src", "desktop", "desktop-workbench.tsx"),
    "utf8",
  );
  assert.match(productComposition, /\bWorkbenchApplicationShell\b/u);
  assert.match(productComposition, /\bWorkbenchThread\b/u);
  assert.match(productComposition, /\bcreatePiAgentRuntimeInstallation\b/u);
  assert.match(productComposition, /\bPiAgentRuntimeContributionsProvider\b/u);
  assert.match(productComposition, /\bDesktopNavigationProvider\b/u);

  const bootstrapApplication = await readFile(
    path.join(APP_ROOT, "src", "desktop", "desktop-renderer-application.tsx"),
    "utf8",
  );
  assert.match(bootstrapApplication, /<DesktopWorkbench\b/u);
  assert.doesNotMatch(bootstrapApplication, /bootstrap\.ready/u);
});

test("preserves the Desktop extension ID and activation-order baseline", async () => {
  const productComposition = await readFile(
    path.join(APP_ROOT, "src", "desktop", "desktop-workbench.tsx"),
    "utf8",
  );
  const body = productComposition.match(
    /const DESKTOP_EXTENSIONS = Object\.freeze\(\[([\s\S]*?)\]\);/u,
  )?.[1];
  assert.ok(body, "Desktop extension composition must remain statically inspectable");
  assert.deepEqual(
    [...body.matchAll(/(?:\.\.\.)?([A-Za-z][A-Za-z0-9_.]+),/gu)].map((match) => match[1]),
    [
      "shellExtensionGroups.core",
      "shellExtensionGroups.workspace",
      "piAgentRuntimeExtensionGroups.setup",
      "shellExtensionGroups.settings",
      "piAgentRuntimeExtensionGroups.runtime",
      "DESKTOP_RUNTIME_LIFECYCLE_EXTENSION",
    ],
  );

  const ids = [
    ...shellExtensionGroups.core,
    ...shellExtensionGroups.workspace,
    ...piAgentRuntimeExtensionGroups.setup,
    ...shellExtensionGroups.settings,
    ...piAgentRuntimeExtensionGroups.runtime,
    { id: "workbench.desktop-runtime-lifecycle" },
  ].map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [
    "workbench.brand",
    "workbench.workspace-sidebar",
    "workbench.appearance",
    "workbench.locale-selector",
    "workbench.message-presentation",
    "workbench.message-actions",
    "workbench.user-message-index",
    "workbench.message-queue",
    "workbench.archived-chats",
    "workbench.workspace-explorer",
    "workbench.workspace-review",
    "workbench.workspace-browser",
    "workbench.workspace-artifact",
    "workbench.terminal",
    "workbench.workspace-directory-picker",
    "workbench.git-branch",
    "workbench.settings",
    "workbench.agent-configuration",
    "workbench.interactive-requests",
    "workbench.side-chat",
    "workbench.setting-model-config",
    "workbench.pi.settings-action",
    "workbench.image-understanding",
    "workbench.toolbox",
    "workbench.automations",
    "workbench.model-selector",
    "workbench.connection-status",
    "workbench.context-trace",
    "workbench.external-session-import",
    "workbench.token-usage",
    "workbench.workspace-file",
    "workbench.desktop-runtime-lifecycle",
  ]);
});

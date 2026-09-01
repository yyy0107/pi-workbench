import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

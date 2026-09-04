import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceFile = /\.(?:[cm]?[jt]sx?|css)$/u;
const ignoredDirectories = new Set([".next", "build", "coverage", "dist", "node_modules", "out"]);

function filesUnder(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return ignoredDirectories.has(entry.name) ? [] : filesUnder(absolute);
      }
      return [absolute];
    });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function workspaceDirectories() {
  return ["apps", "packages"].flatMap((root) =>
    filesUnder(path.join(repositoryRoot, root))
      .filter((file) => path.basename(file) === "package.json")
      .map((manifest) => path.dirname(manifest)),
  );
}

const workspaces = workspaceDirectories();
const productionSources = workspaces.flatMap((workspace) =>
  filesUnder(path.join(workspace, "src")).filter((file) => sourceFile.test(file)),
);

function repositoryRelative(file) {
  return path.relative(repositoryRoot, file).replaceAll(path.sep, "/");
}

function assertSourcesDoNotMatch(pattern, message) {
  for (const file of productionSources) {
    assert.equal(
      pattern.test(readFileSync(file, "utf8")),
      false,
      `${message}: ${repositoryRelative(file)}`,
    );
  }
}

test("refactored UI sources contain no retired visual overrides", () => {
  assertSourcesDoNotMatch(/var\(----/u, "four-hyphen token reference");
  assertSourcesDoNotMatch(/active:translate-y-0!/u, "default Button motion override");
});

test("retired component-extension and right Panel APIs cannot return", () => {
  assertSourcesDoNotMatch(
    /component-extensions|component-extension-installation|installable-extensions|useInstalledComponentExtensions/u,
    "retired component-extension API",
  );
  assertSourcesDoNotMatch(/panel\.right/u, "retired right Panel slot");

  for (const workspace of workspaces) {
    const manifestPath = path.join(workspace, "package.json");
    const manifest = readFileSync(manifestPath, "utf8");
    assert.doesNotMatch(
      manifest,
      /component-extensions|component-extension-installation/u,
      `retired component-extension manifest entry: ${repositoryRelative(manifestPath)}`,
    );
  }
});

test("the application has one Headless Agent Runtime stack and no AI SDK chat runtime", () => {
  assertSourcesDoNotMatch(/\bfrom\s*["'](?:ai|@ai-sdk\/react)["']/u, "AI SDK import");
  assertSourcesDoNotMatch(/\buseChat\s*\(/u, "second chat runtime hook");

  for (const workspace of workspaces) {
    const manifestPath = path.join(workspace, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    };
    assert.equal(
      Object.hasOwn(dependencies, "ai") || Object.hasOwn(dependencies, "@ai-sdk/react"),
      false,
      `AI SDK dependency: ${repositoryRelative(manifestPath)}`,
    );
  }
});

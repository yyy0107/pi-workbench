import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const IGNORED_DIRECTORIES = new Set([
  ".desktop-build",
  ".electron-build",
  ".git",
  ".next",
  "dist-electron",
  "node_modules",
]);
const PI_IMPORT_ALLOWED_PREFIXES = [
  "app/api/pi/",
  "packages/agent-runtime/adapters/pi/",
  "workbench/providers/installed-agent-runtime.",
  "workbench/runtime-contributions/pi/",
  "workbench/server/pi/",
];

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(absolutePath));
    else if (entry.isFile() && /\.[cm]?tsx?$/u.test(entry.name)) files.push(absolutePath);
  }
  return files;
}

function builtinExtensionImports(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/from\s+"@?\/?([^"]*builtin\/[^"]+)"/gu)].map(
    ([, specifier]) => specifier.replace(/^.*builtin\//u, ""),
  );
}

test("keeps generic and selected-runtime extension contributions disjoint", () => {
  const generic = builtinExtensionImports(
    path.join(repositoryRoot, "extensions/enabled-extensions.ts"),
  );
  const selected = builtinExtensionImports(
    path.join(repositoryRoot, "workbench/runtime-contributions/pi/extensions.ts"),
  );
  const all = [...generic, ...selected];

  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(
    [...all].sort(),
    [
      "agent-configuration",
      "appearance",
      "archived-chats",
      "connection-status",
      "context-trace",
      "execution",
      "external-session-import",
      "git-branch",
      "hardware-acceleration",
      "image-understanding",
      "interactive-requests",
      "locale-selector",
      "message-actions",
      "message-presentation",
      "message-queue",
      "model-selector",
      "pi-extensions",
      "setting-model-config",
      "settings",
      "side-chat",
      "skills",
      "terminal",
      "token-usage",
      "toolbox",
      "user-message-index",
      "workbench-brand",
      "workspace-artifact",
      "workspace-browser",
      "workspace-directory-picker",
      "workspace-explorer",
      "workspace-file",
      "workspace-review",
    ].sort(),
  );
});

test("confines direct Pi package imports to adapter and application composition boundaries", () => {
  const violations = sourceFiles(repositoryRoot)
    .filter((file) => readFileSync(file, "utf8").includes("@workbench/agent-runtime-pi-"))
    .map((file) => path.relative(repositoryRoot, file).split(path.sep).join("/"))
    .filter(
      (file) =>
        file !== "server.ts" &&
        file !== "workbench/runtime-contributions/installed-agent-runtime.test.ts" &&
        !PI_IMPORT_ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix)),
    );

  assert.deepEqual(violations, []);
});

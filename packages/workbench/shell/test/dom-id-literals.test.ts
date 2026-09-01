import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

interface LiteralIdRef {
  readonly attribute: string;
  readonly filename: string;
  readonly value: string;
}

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(target)));
    else if (
      entry.name.endsWith(".tsx") &&
      !entry.name.endsWith(".test.tsx") &&
      !entry.name.endsWith(".spec.tsx")
    ) {
      files.push(target);
    }
  }
  return files;
}

test("Shell production DOM IDREF literals have an empty domain allowlist", async () => {
  const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
  const literalPattern =
    /(?:^|[\s<])(id|htmlFor|aria-(?:controls|labelledby|describedby))="([^"]+)"/gu;
  const literals: LiteralIdRef[] = [];

  for (const filename of await sourceFiles(sourceRoot)) {
    const source = await readFile(filename, "utf8");
    for (const match of source.matchAll(literalPattern)) {
      literals.push({
        attribute: match[1]!,
        filename: path.relative(sourceRoot, filename).split(path.sep).join("/"),
        value: match[2]!,
      });
    }
    assert.doesNotMatch(source, /document\.getElementById\s*\(/u, filename);
  }

  assert.deepEqual(literals, []);
});

test("right-workspace Shell owners read the installation DOM seam", async () => {
  const sources = await Promise.all(
    [
      "../src/right-workspace/presentation/right-workspace.tsx",
      "../src/right-workspace/presentation/right-workspace-toggle-button.tsx",
      "../src/right-workspace/presentation/surface-host.tsx",
    ].map((relative) => readFile(new URL(relative, import.meta.url), "utf8")),
  );

  for (const source of sources) assert.match(source, /useWorkbenchDomIds/u);
  assert.match(sources[0]!, /id=\{domIds\.rightWorkspace\}/u);
  assert.match(sources[1]!, /aria-controls=\{domIds\.rightWorkspace\}/u);
  assert.match(sources[2]!, /id=\{domIds\.rightWorkspaceAuxiliaryPane\}/u);
});

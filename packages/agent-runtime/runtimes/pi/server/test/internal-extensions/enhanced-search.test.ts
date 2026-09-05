import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createEnhancedSearchTools } from "../../src/internal-extensions/enhanced-search";
import { todoExtension } from "../../src/internal-extensions/todo";

test("enhanced grep searches multiple roots with context and honors cancellation", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "enhanced-search-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const folder of ["a", "b"]) {
    await mkdir(path.join(directory, folder));
    await writeFile(path.join(directory, folder, "file.txt"), "before\nneedle\nafter\n");
  }
  const grep = createEnhancedSearchTools(directory).find((tool) => tool.name === "grep")!;
  const result = await grep.execute(
    "search",
    { pattern: "needle", paths: ["a", "b"] },
    undefined,
    undefined,
    {} as never,
  );
  const text = result.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
  assert.match(text, /## a/);
  assert.match(text, /## b/);
  assert.match(text, /before/);
  assert.match(text, /after/);
  await assert.rejects(
    grep.execute("cancelled", { pattern: "needle" }, AbortSignal.abort(), undefined, {} as never),
    /aborted/,
  );
});

test("todo updates are durable tool result data", async () => {
  let registered:
    | { name: string; execute(id: string, params: unknown): Promise<unknown> }
    | undefined;
  todoExtension({
    registerTool: (tool: typeof registered) => {
      registered = tool;
    },
  } as never);
  assert.equal(registered?.name, "workbench_todo");
  const items = [{ text: "Implement settings", status: "completed" }];
  assert.deepEqual(await registered!.execute("todo", { items }), {
    content: [{ type: "text", text: JSON.stringify({ items }) }],
    details: { items },
  });
});

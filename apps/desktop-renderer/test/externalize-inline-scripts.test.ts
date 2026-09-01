import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { externalizeExecutableInlineScripts } from "../scripts/externalize-inline-scripts";

test("externalizes executable inline scripts without changing their order or source", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-inline-scripts-"));
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-inline-module-"));
  t.after(async () => {
    await Promise.all([
      rm(root, { force: true, recursive: true }),
      rm(moduleRoot, { force: true, recursive: true }),
    ]);
  });
  await mkdir(path.join(root, "nested"), { recursive: true });
  const htmlPath = path.join(root, "nested", "index.html");
  await writeFile(
    htmlPath,
    [
      "<!doctype html><body>",
      '<script data-order="first">globalThis.order.push("first")</script>',
      '<script type="application/json">{"kept":"inline"}</script>',
      '<script nonce="nonce-a" type="text/javascript">globalThis.order.push("second")</script>',
      '<script src="/existing.js">ignored inline fallback</script>',
      "</body>",
    ].join(""),
    "utf8",
  );

  const externalized = await externalizeExecutableInlineScripts(root);
  assert.equal(externalized.length, 2);
  assert.deepEqual(
    externalized.map(({ htmlPath: owner, source }) => ({ owner, source })),
    [
      { owner: "nested/index.html", source: 'globalThis.order.push("first")' },
      { owner: "nested/index.html", source: 'globalThis.order.push("second")' },
    ],
  );

  const transformed = await readFile(htmlPath, "utf8");
  const [first, second] = externalized;
  assert.ok(first && second);
  const firstTag = `<script data-order="first" src="/${first.scriptPath}"></script>`;
  const dataTag = '<script type="application/json">{"kept":"inline"}</script>';
  const secondTag = `<script nonce="nonce-a" type="text/javascript" src="/${second.scriptPath}"></script>`;
  const existingTag = '<script src="/existing.js">ignored inline fallback</script>';
  const positions = [firstTag, dataTag, secondTag, existingTag].map((tag) =>
    transformed.indexOf(tag),
  );
  assert.equal(
    positions.every((position) => position >= 0),
    true,
  );
  assert.equal(
    positions.every((position, index) => index === 0 || positions[index - 1]! < position),
    true,
  );
  assert.equal(await readFile(path.join(root, first.scriptPath), "utf8"), first.source);
  assert.equal(await readFile(path.join(root, second.scriptPath), "utf8"), second.source);

  const executableInlineScripts = [
    ...transformed.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu),
  ]
    .filter(([, attributes]) => !/\bsrc\s*=/iu.test(attributes ?? ""))
    .filter(([, attributes]) => !/\btype\s*=\s*["']application\/json["']/iu.test(attributes ?? ""));
  assert.deepEqual(executableInlineScripts, []);

  await writeFile(
    path.join(moduleRoot, "index.html"),
    '<script type="module">import "./relative-module.js"</script>',
    "utf8",
  );
  await assert.rejects(
    externalizeExecutableInlineScripts(moduleRoot),
    /Inline module scripts cannot be externalized in index\.html\./u,
  );
});

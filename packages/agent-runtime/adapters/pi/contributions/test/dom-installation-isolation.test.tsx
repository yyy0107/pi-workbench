import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Fragment, useId } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  WorkbenchDomIdsProvider,
  useWorkbenchDomIds,
  type WorkbenchDomIds,
} from "@workbench/shell/dom";

interface InstallationSnapshot {
  readonly ids: WorkbenchDomIds;
  readonly inputId: string;
}

function CrossPackageIdRefProbe({
  capture,
  label,
}: Readonly<{
  capture(snapshot: InstallationSnapshot): void;
  label: string;
}>) {
  const ids = useWorkbenchDomIds();
  const inputId = useId();
  capture({ ids, inputId });

  return (
    <section data-installation={label}>
      <aside id={ids.rightWorkspace} />
      <button type="button" aria-controls={ids.rightWorkspace} />
      <aside id={ids.rightWorkspaceAuxiliaryPane} />
      <button type="button" aria-controls={ids.rightWorkspaceAuxiliaryPane} />
      <label htmlFor={inputId}>{label}</label>
      <input id={inputId} />
    </section>
  );
}

test("dual installations keep public cross-package IDREFs and labels inside their owning Shell", () => {
  let first: InstallationSnapshot | undefined;
  let second: InstallationSnapshot | undefined;
  const markup = renderToStaticMarkup(
    <Fragment>
      <WorkbenchDomIdsProvider>
        <CrossPackageIdRefProbe label="first" capture={(snapshot) => (first = snapshot)} />
      </WorkbenchDomIdsProvider>
      <WorkbenchDomIdsProvider>
        <CrossPackageIdRefProbe label="second" capture={(snapshot) => (second = snapshot)} />
      </WorkbenchDomIdsProvider>
    </Fragment>,
  );

  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.ids.rightWorkspace, second.ids.rightWorkspace);
  assert.notEqual(first.ids.rightWorkspaceAuxiliaryPane, second.ids.rightWorkspaceAuxiliaryPane);
  assert.notEqual(first.inputId, second.inputId);

  for (const snapshot of [first, second]) {
    assert.equal(markup.includes(`id="${snapshot.ids.rightWorkspace}"`), true);
    assert.equal(markup.includes(`aria-controls="${snapshot.ids.rightWorkspace}"`), true);
    assert.equal(markup.includes(`id="${snapshot.ids.rightWorkspaceAuxiliaryPane}"`), true);
    assert.equal(
      markup.includes(`aria-controls="${snapshot.ids.rightWorkspaceAuxiliaryPane}"`),
      true,
    );
    assert.equal(markup.includes(`for="${snapshot.inputId}"`), true);
    assert.equal(markup.includes(`id="${snapshot.inputId}"`), true);
  }

  const renderedIds = [...markup.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]);
  assert.equal(new Set(renderedIds).size, renderedIds.length);

  const secondSection = markup.match(
    /<section data-installation="second">([\s\S]*?)<\/section>/u,
  )?.[1];
  const secondLabelTarget = secondSection?.match(/<label for="([^"]+)"/u)?.[1];
  assert.equal(secondLabelTarget, second.inputId);
  const focusCalls: string[] = [];
  const inputFocusById = new Map([
    [first.inputId, () => focusCalls.push("first")],
    [second.inputId, () => focusCalls.push("second")],
  ]);
  inputFocusById.get(secondLabelTarget!)?.();
  assert.deepEqual(focusCalls, ["second"]);
});

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

test("production DOM IDREF literals use the exact domain allowlist", async () => {
  const piSourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
  const literalPattern =
    /(?:^|[\s<])(id|htmlFor|aria-(?:controls|labelledby|describedby))="([^"]+)"/gu;
  const literals: LiteralIdRef[] = [];

  for (const filename of await sourceFiles(piSourceRoot)) {
    const source = await readFile(filename, "utf8");
    for (const match of source.matchAll(literalPattern)) {
      literals.push({
        attribute: match[1]!,
        filename: path.relative(piSourceRoot, filename).split(path.sep).join("/"),
        value: match[2]!,
      });
    }
    assert.doesNotMatch(source, /document\.getElementById\s*\(/u, filename);
  }

  assert.deepEqual(literals, []);

  const runningIndicator = await readFile(
    new URL("../src/running-indicator/pi-running-indicator.tsx", import.meta.url),
    "utf8",
  );
  for (const fragmentId of [
    "symbolId",
    "glowFilterId",
    "shineGradientId",
    "clipPathId",
    "gradientId",
  ]) {
    assert.match(runningIndicator, new RegExp(`const ${fragmentId} = useId\\(\\)`, "u"));
    assert.match(runningIndicator, new RegExp(`id=\\{${fragmentId}\\}`, "u"));
  }
});

test("Pi consumers read the shared finite DOM seam through the public Shell entry", async () => {
  const sources = await Promise.all(
    [
      "../src/extensions/context-trace/context-trace-trigger.tsx",
      "../src/extensions/workspace-file/file-surface-header.tsx",
    ].map((relative) => readFile(new URL(relative, import.meta.url), "utf8")),
  );

  for (const source of sources) {
    assert.match(source, /useWorkbenchDomIds/u);
    assert.match(source, /from "@workbench\/shell\/dom"/u);
  }
  assert.match(sources[0]!, /aria-controls=\{domIds\.rightWorkspace\}/u);
  assert.match(sources[1]!, /aria-controls=\{domIds\.rightWorkspaceAuxiliaryPane\}/u);
});

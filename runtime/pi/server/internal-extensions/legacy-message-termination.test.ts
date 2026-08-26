import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !/\.[^/]+$/.test(specifier) &&
      context.parentURL?.includes("/runtime/pi/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  LEGACY_WORKBENCH_MESSAGE_TERMINATION_EXTENSION_FILE,
  legacyWorkbenchMessageTerminationExtensionSource,
  migrateLegacyWorkbenchMessageTerminationExtension,
} = await import("./legacy-message-termination");

test.after(() => moduleHooks.deregister());

test("removes the byte-identical extension previously installed by Workbench", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "workbench-pi-extension-migration-"));
  const extensionDirectory = join(agentDir, "extensions");
  const extensionPath = join(
    extensionDirectory,
    LEGACY_WORKBENCH_MESSAGE_TERMINATION_EXTENSION_FILE,
  );
  t.after(() => rm(agentDir, { recursive: true, force: true }));

  await mkdir(extensionDirectory, { recursive: true });
  await writeFile(extensionPath, legacyWorkbenchMessageTerminationExtensionSource(), "utf8");

  assert.deepEqual(await migrateLegacyWorkbenchMessageTerminationExtension(agentDir), {
    path: extensionPath,
    status: "removed",
  });
  await assert.rejects(readFile(extensionPath, "utf8"), { code: "ENOENT" });
  assert.deepEqual(await migrateLegacyWorkbenchMessageTerminationExtension(agentDir), {
    path: extensionPath,
    status: "absent",
  });
});

test("preserves a user-modified extension with the legacy managed filename", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "workbench-pi-extension-preserved-"));
  const extensionDirectory = join(agentDir, "extensions");
  const extensionPath = join(
    extensionDirectory,
    LEGACY_WORKBENCH_MESSAGE_TERMINATION_EXTENSION_FILE,
  );
  const userSource = `${legacyWorkbenchMessageTerminationExtensionSource()}\n// user change\n`;
  t.after(() => rm(agentDir, { recursive: true, force: true }));

  await mkdir(extensionDirectory, { recursive: true });
  await writeFile(extensionPath, userSource, "utf8");

  assert.deepEqual(await migrateLegacyWorkbenchMessageTerminationExtension(agentDir), {
    path: extensionPath,
    status: "preserved",
  });
  assert.equal(await readFile(extensionPath, "utf8"), userSource);
});

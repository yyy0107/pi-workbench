import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  LEGACY_WORKBENCH_MESSAGE_TERMINATION_EXTENSION_FILE,
  legacyWorkbenchMessageTerminationExtensionSource,
  migrateLegacyWorkbenchMessageTerminationExtension,
} = await import("../../src/internal-extensions/message-termination/legacy-message-termination");
const { LEGACY_WORKBENCH_MESSAGE_TERMINATION_EXTENSION_SOURCE } =
  await import("../../src/internal-extensions/message-termination/legacy-message-termination-extension-source");

test("embeds the byte-identical historical extension source", async () => {
  const embeddedBytes = Buffer.from(LEGACY_WORKBENCH_MESSAGE_TERMINATION_EXTENSION_SOURCE, "utf8");
  const migrationBytes = Buffer.from(legacyWorkbenchMessageTerminationExtensionSource(), "utf8");

  assert.deepEqual(migrationBytes, embeddedBytes);
  assert.equal(migrationBytes.byteLength, 4_245);
  assert.equal(
    createHash("sha256").update(migrationBytes).digest("hex"),
    "e925c53b8a84753a274ca2b879cbda5129853ff5a22e538fb587fbf3e13facc1",
  );
  assert.equal(migrationBytes.at(-1), 0x0a, "historical source must retain its final newline");
  assert.notEqual(migrationBytes.at(-2), 0x0a, "historical source has exactly one final newline");
});

test("removes the legacy extension without an adjacent runtime asset", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "workbench-pi-extension-migration-"));
  const extensionDirectory = join(agentDir, "extensions");
  const extensionPath = join(
    extensionDirectory,
    LEGACY_WORKBENCH_MESSAGE_TERMINATION_EXTENSION_FILE,
  );
  t.after(() => rm(agentDir, { recursive: true, force: true }));

  await assert.rejects(
    access(new URL("./legacy-message-termination-extension.user.js", import.meta.url)),
    { code: "ENOENT" },
  );
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

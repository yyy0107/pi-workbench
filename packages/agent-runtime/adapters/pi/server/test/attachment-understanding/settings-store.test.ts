import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
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
  DEFAULT_IMAGE_UNDERSTANDING_SETTINGS,
  ImageUnderstandingSettingsStore,
  ImageUnderstandingSettingsStoreError,
} = (await import(
  new URL("../../src/attachment-understanding/settings-store.ts", import.meta.url).href
)) as typeof import("../../src/attachment-understanding/settings-store");
moduleHooks.deregister();

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-image-settings-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, "nested", "image-understanding.json");
  return { stateFile, store: new ImageUnderstandingSettingsStore({ stateFile }) };
}

test("describes version-one defaults without creating a settings document", async (t) => {
  const { stateFile, store } = await fixture(t);
  const described = await store.describe();

  assert.equal(described.revision, 0);
  assert.equal(DEFAULT_IMAGE_UNDERSTANDING_SETTINGS.routing, "native-only");
  assert.equal(DEFAULT_IMAGE_UNDERSTANDING_SETTINGS.paddle.model, "PaddleOCR-VL-1.6");
  assert.deepEqual(described.value, {
    ...DEFAULT_IMAGE_UNDERSTANDING_SETTINGS,
    glm: { ...DEFAULT_IMAGE_UNDERSTANDING_SETTINGS.glm, credentialConfigured: false },
    paddle: { ...DEFAULT_IMAGE_UNDERSTANDING_SETTINGS.paddle, credentialConfigured: false },
    ocrAdapter: {
      ...DEFAULT_IMAGE_UNDERSTANDING_SETTINGS.ocrAdapter,
      credentialConfigured: false,
    },
  });
  await assert.rejects(readFile(stateFile, "utf8"), { code: "ENOENT" });
});

test("atomically writes mode-0600 settings and never exposes stored credentials", async (t) => {
  const { stateFile, store } = await fixture(t);
  const secret = "glm-secret-value";
  const paddleSecret = "paddle-secret-value";
  const updated = await store.update({
    expectedRevision: 0,
    patch: {
      routing: "always-preprocess",
      ocrProvider: "paddleocr",
      glm: { endpoint: "https://glm.example.test/layout", apiKey: secret },
      paddle: {
        model: "PaddleOCR-VL-1.5",
        apiKey: paddleSecret,
        pollIntervalMs: 1_000,
        pollTimeoutMs: 120_000,
      },
    },
  });

  assert.equal(updated.revision, 1);
  assert.equal(updated.value.glm.credentialConfigured, true);
  assert.equal(updated.value.paddle.credentialConfigured, true);
  assert.equal(JSON.stringify(updated).includes(secret), false);
  assert.equal(JSON.stringify(updated).includes(paddleSecret), false);
  assert.equal((await stat(stateFile)).mode & 0o777, 0o600);

  const persisted = await readFile(stateFile, "utf8");
  assert.equal(persisted.endsWith("\n"), true);
  assert.equal(persisted.includes(secret), true);
  assert.equal(persisted.includes(paddleSecret), true);
  assert.equal(await store.resolveCredential("glm-ocr"), secret);
  assert.equal(await store.resolveCredential("paddleocr"), paddleSecret);
  const runtimeSettings = await store.resolveRuntimeSettings();
  assert.equal(runtimeSettings.revision, updated.revision);
  assert.equal(runtimeSettings.value.ocrProvider, "paddleocr");
  assert.equal(runtimeSettings.credential, paddleSecret);
  assert.equal(runtimeSettings.value.ocrAdapter.preset, "paddleocr-vl-1.6");
  assert.equal(runtimeSettings.value.ocrAdapter.credentialConfigured, true);
  assert.equal(runtimeSettings.value.glm.endpoint, "https://glm.example.test/layout");
});

test("selects built-in adapter templates and keeps credentials write-only", async (t) => {
  const { stateFile, store } = await fixture(t);
  const secret = "pp-ocrv6-secret";
  const updated = await store.update({
    expectedRevision: 0,
    patch: {
      ocrAdapter: {
        preset: "pp-ocrv6",
        apiKey: secret,
      },
    },
  });

  assert.equal(updated.value.ocrAdapter.preset, "pp-ocrv6");
  assert.equal(updated.value.ocrAdapter.model, "PP-OCRv6");
  assert.equal(updated.value.ocrAdapter.credentialConfigured, true);
  assert.equal(updated.value.ocrAdapter.source.includes("ocrResults"), true);
  assert.equal(JSON.stringify(updated).includes(secret), false);
  assert.equal((await store.resolveRuntimeSettings()).credential, secret);
  assert.equal((await readFile(stateFile, "utf8")).includes(secret), true);
});

test("migrates a legacy provider-only document to an adapter view without rewriting it", async (t) => {
  const { stateFile, store } = await fixture(t);
  await mkdir(path.dirname(stateFile), { recursive: true });
  const legacy = {
    version: 1,
    revision: 4,
    settings: {
      routing: "always-preprocess",
      engine: "ocr",
      ocrProvider: "paddleocr",
      glm: {
        endpoint: "https://api.z.ai/api/paas/v4/layout_parsing",
        model: "glm-ocr",
      },
      paddle: {
        endpoint: "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs",
        model: "PP-StructureV3",
        pollIntervalMs: 5_000,
        pollTimeoutMs: 700_000,
      },
      multimodal: { provider: "", model: "" },
    },
    secrets: { paddleocr: "legacy-secret" },
  };
  const serializedLegacy = `${JSON.stringify(legacy, undefined, 2)}\n`;
  await writeFile(stateFile, serializedLegacy, { mode: 0o600 });

  const described = await store.describe();
  assert.equal(described.revision, 4);
  assert.equal(described.value.ocrAdapter.preset, "pp-structure-v3");
  assert.equal(described.value.ocrAdapter.model, "PP-StructureV3");
  assert.equal(described.value.ocrAdapter.credentialConfigured, true);
  assert.equal((await store.resolveRuntimeSettings()).credential, "legacy-secret");
  assert.equal(await readFile(stateFile, "utf8"), serializedLegacy);
});

test("loads pre-comment built-in adapter source as the current annotated template", async (t) => {
  const { stateFile, store } = await fixture(t);
  await mkdir(path.dirname(stateFile), { recursive: true });
  const oldSource = DEFAULT_IMAGE_UNDERSTANDING_SETTINGS.ocrAdapter.source.replace(
    /\/\*\*[\s\S]*?\*\/\n/,
    "",
  );
  const document = {
    version: 1,
    revision: 2,
    settings: {
      ...DEFAULT_IMAGE_UNDERSTANDING_SETTINGS,
      ocrAdapter: {
        ...DEFAULT_IMAGE_UNDERSTANDING_SETTINGS.ocrAdapter,
        source: oldSource,
      },
    },
    secrets: {},
  };
  const persisted = `${JSON.stringify(document, undefined, 2)}\n`;
  await writeFile(stateFile, persisted, { mode: 0o600 });

  const described = await store.describe();
  assert.match(described.value.ocrAdapter.source, /Workbench OCR adapter contract/);
  assert.equal(await readFile(stateFile, "utf8"), persisted);
});

test("rejects executable or malformed custom adapter source before persisting", async (t) => {
  const { stateFile, store } = await fixture(t);
  await assert.rejects(
    store.update({
      patch: {
        ocrAdapter: {
          preset: "custom",
          source: "export default (() => process.exit(1))();",
        },
      },
    }),
    (error) => {
      assert.ok(error instanceof ImageUnderstandingSettingsStoreError);
      assert.equal(error.code, "image-settings-invalid");
      return true;
    },
  );
  await assert.rejects(readFile(stateFile, "utf8"), { code: "ENOENT" });
});

test("empty secret patches retain credentials while null deletes them", async (t) => {
  const { store } = await fixture(t);
  const configured = await store.update({
    patch: { glm: { apiKey: "keep-me" }, paddle: { apiKey: "remove-me" } },
  });

  const retained = await store.update({
    expectedRevision: configured.revision,
    patch: { glm: { apiKey: "  " }, paddle: { apiKey: undefined } },
  });
  assert.equal(retained.revision, configured.revision);
  assert.equal(await store.resolveCredential("glm-ocr"), "keep-me");
  assert.equal(await store.resolveCredential("paddleocr"), "remove-me");

  const removed = await store.update({
    expectedRevision: retained.revision,
    patch: { paddle: { apiKey: null } },
  });
  assert.equal(removed.revision, retained.revision + 1);
  assert.equal(removed.value.paddle.credentialConfigured, false);
  assert.equal(await store.resolveCredential("paddleocr"), undefined);
});

test("serializes concurrent writers and rejects the stale revision", async (t) => {
  const { store } = await fixture(t);
  const current = await store.describe();
  const results = await Promise.allSettled([
    store.update({ expectedRevision: current.revision, patch: { routing: "disabled" } }),
    store.update({ expectedRevision: current.revision, patch: { routing: "native-only" } }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof ImageUnderstandingSettingsStoreError);
  assert.equal(rejected.reason.code, "image-settings-conflict");
  assert.equal(rejected.reason.expectedRevision, 0);
  assert.equal(rejected.reason.actualRevision, 1);
});

test("rejects unsupported versions without overwriting the document", async (t) => {
  const { stateFile, store } = await fixture(t);
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, '{"version":2,"apiKey":"must-stay-unread"}\n', { mode: 0o600 });

  await assert.rejects(store.describe(), (error) => {
    assert.ok(error instanceof ImageUnderstandingSettingsStoreError);
    assert.equal(error.code, "image-settings-invalid");
    return true;
  });
  await assert.rejects(store.update({ patch: { routing: "auto" } }), (error) => {
    assert.ok(error instanceof ImageUnderstandingSettingsStoreError);
    assert.equal(error.code, "image-settings-invalid");
    return true;
  });
  assert.equal(await readFile(stateFile, "utf8"), '{"version":2,"apiKey":"must-stay-unread"}\n');
});

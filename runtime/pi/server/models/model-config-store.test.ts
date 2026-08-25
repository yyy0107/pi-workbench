import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === "./model-config-store" ? `${specifier}.ts` : specifier,
      context,
    );
  },
});
const { ModelConfigStore } = (await import(
  new URL("./model-config-store.ts", import.meta.url).href
)) as typeof import("./model-config-store");
moduleHooks.deregister();

test("merges provider models without exposing or overwriting credentials", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-model-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, "models.json");
  await writeFile(
    stateFile,
    `{
      // Pi model configuration
      "schemaNote": "keep-me",
      "providers": {
        "acme": {
          "name": "Old name",
          "baseUrl": "https://old.example.test/v1",
          "api": "openai-completions",
          "apiKey": "never-return-this",
          "headers": { "X-Private": "keep-me" },
          "models": [{
            "id": "acme-large",
            "name": "Old",
            "reasoning": true,
            "thinkingLevelMap": { "minimal": "low", "xhigh": null },
            "input": ["text", "image"]
          }],
        },
      },
    }`,
  );

  const store = new ModelConfigStore({ stateFile });
  assert.deepEqual(await store.providers(), {
    acme: {
      displayName: "Old name",
      baseURL: "https://old.example.test/v1",
      api: "openai-completions",
      models: [
        {
          id: "acme-large",
          name: "Old",
          reasoning: true,
          thinkingLevelMap: { minimal: "low", xhigh: null },
          input: ["text", "image"],
        },
      ],
    },
  });
  assert.equal(JSON.stringify(await store.providers()).includes("never-return-this"), false);

  const mutation = await store.setProvider("acme", {
    displayName: "Acme",
    baseURL: "https://api.example.test/v1",
    api: "openai-responses",
    models: [
      {
        id: "acme-large",
        contextWindow: 1_000_000,
        maxTokens: 256_000,
        reasoning: true,
        thinkingLevelMap: { minimal: "low", xhigh: null },
        input: ["text", "image"],
        imageInputSource: "provider-api",
      },
    ],
  });
  const saved = JSON.parse(await readFile(stateFile, "utf8")) as {
    schemaNote: string;
    providers: Record<string, Record<string, unknown>>;
    "x-workbench-model-capability-sources": Record<string, Record<string, string>>;
  };
  assert.equal(saved.schemaNote, "keep-me");
  assert.equal(saved.providers.acme.apiKey, "never-return-this");
  assert.deepEqual(saved.providers.acme.headers, { "X-Private": "keep-me" });
  assert.deepEqual(saved.providers.acme.models, [
    {
      id: "acme-large",
      reasoning: true,
      thinkingLevelMap: { minimal: "low", xhigh: null },
      contextWindow: 1_000_000,
      maxTokens: 256_000,
      input: ["text", "image"],
    },
  ]);
  assert.deepEqual(saved["x-workbench-model-capability-sources"], {
    acme: { "acme-large": "provider-api" },
  });
  assert.deepEqual((await store.providers()).acme.models, [
    {
      id: "acme-large",
      contextWindow: 1_000_000,
      maxTokens: 256_000,
      reasoning: true,
      thinkingLevelMap: { minimal: "low", xhigh: null },
      input: ["text", "image"],
      imageInputSource: "provider-api",
    },
  ]);

  await mutation.rollback();
  assert.match(await readFile(stateFile, "utf8"), /Pi model configuration/u);
});

test("persists user-selected and tested model types in Workbench capability metadata", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-model-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, "models.json");
  const store = new ModelConfigStore({ stateFile });

  await store.setProvider("acme", {
    baseURL: "https://api.example.test/v1",
    api: "openai-responses",
    models: [
      {
        id: "acme-text",
        input: ["text"],
        imageInputSource: "user",
      },
      {
        id: "acme-vision",
        input: ["text", "image"],
        imageInputSource: "test",
      },
    ],
  });

  const saved = JSON.parse(await readFile(stateFile, "utf8")) as {
    "x-workbench-model-capability-sources": Record<string, Record<string, string>>;
  };
  assert.deepEqual(saved["x-workbench-model-capability-sources"], {
    acme: { "acme-text": "user", "acme-vision": "test" },
  });
  assert.deepEqual((await store.providers()).acme.models, [
    {
      id: "acme-text",
      input: ["text"],
      imageInputSource: "user",
    },
    {
      id: "acme-vision",
      input: ["text", "image"],
      imageInputSource: "test",
    },
  ]);
});

test("does not roll back a provider mutation over a newer successful write", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-model-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new ModelConfigStore({ stateFile: path.join(directory, "models.json") });

  const older = await store.setProvider("acme", {
    displayName: "Older",
    baseURL: "https://older.example.test/v1",
    api: "openai-completions",
  });
  await store.setProvider("acme", {
    displayName: "Newer",
    baseURL: "https://newer.example.test/v1",
    api: "openai-responses",
  });

  await older.rollback();

  assert.deepEqual(await store.providers(), {
    acme: {
      displayName: "Newer",
      baseURL: "https://newer.example.test/v1",
      api: "openai-responses",
    },
  });
});

test("does not roll back over a newer mutation that writes identical content", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-model-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, "models.json");
  const olderStore = new ModelConfigStore({ stateFile });
  const newerStore = new ModelConfigStore({ stateFile });
  const configuration = {
    displayName: "Same",
    baseURL: "https://same.example.test/v1",
    api: "openai-responses",
  } as const;

  const older = await olderStore.setProvider("acme", configuration);
  await newerStore.setProvider("acme", configuration);

  await older.rollback();

  assert.deepEqual(await olderStore.providers(), {
    acme: configuration,
  });
});

test("a failed content write restores the prior revision so an older rollback stays valid", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-model-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, "models.json");
  const revisionFile = `${stateFile}.workbench-revision`;
  const store = new ModelConfigStore({ stateFile });
  const older = await store.setProvider("acme", {
    displayName: "Pending",
    baseURL: "https://pending.example.test/v1",
    api: "openai-responses",
  });
  const olderRevision = await readFile(revisionFile, "utf8");
  const mutableStore = store as unknown as {
    writeContent(content: string | undefined): Promise<void>;
  };
  const writeContent = mutableStore.writeContent.bind(store);
  mutableStore.writeContent = async () => {
    throw new Error("injected content write failure");
  };

  await assert.rejects(
    store.setProvider("acme", {
      displayName: "Rejected",
      baseURL: "https://rejected.example.test/v1",
      api: "openai-completions",
    }),
    /injected content write failure/u,
  );
  mutableStore.writeContent = writeContent;

  assert.equal(await readFile(revisionFile, "utf8"), olderRevision);
  await older.rollback();
  await assert.rejects(readFile(stateFile, "utf8"), { code: "ENOENT" });
});

test("writes one model context-window override while preserving provider configuration", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-model-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, "models.json");
  const original = JSON.stringify({
    schemaNote: "keep-me",
    providers: {
      openai: {
        apiKey: "keep-secret",
        modelOverrides: {
          "gpt-5": { maxTokens: 32_000 },
          keep: { contextWindow: 64_000 },
        },
      },
    },
  });
  await writeFile(stateFile, original);
  const store = new ModelConfigStore({ stateFile });

  const mutation = await store.setModelContextWindow("openai", "gpt-5", 256_000);
  const saved = JSON.parse(await readFile(stateFile, "utf8")) as {
    schemaNote: string;
    providers: Record<string, Record<string, unknown>>;
  };
  assert.equal(saved.schemaNote, "keep-me");
  assert.equal(saved.providers.openai.apiKey, "keep-secret");
  assert.deepEqual(saved.providers.openai.modelOverrides, {
    "gpt-5": { maxTokens: 32_000, contextWindow: 256_000 },
    keep: { contextWindow: 64_000 },
  });

  await mutation.rollback();
  assert.equal(await readFile(stateFile, "utf8"), original);
});

test("removes one provider while preserving the rest of models.json", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-model-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, "models.json");
  await writeFile(
    stateFile,
    JSON.stringify({ providers: { acme: { models: [] }, keep: { models: [] } } }),
  );
  const store = new ModelConfigStore({ stateFile });

  assert.ok(await store.removeProvider("acme"));
  const saved = JSON.parse(await readFile(stateFile, "utf8")) as {
    providers: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(saved.providers), ["keep"]);
  assert.equal(await store.removeProvider("missing"), undefined);
});

test("restores adapter models while preserving provider metadata and credentials", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-model-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, "models.json");
  await writeFile(
    stateFile,
    JSON.stringify({
      providers: {
        openai: {
          apiKey: "keep-secret",
          headers: { "X-Private": "keep-me" },
          models: [{ id: "custom-gpt" }],
        },
      },
    }),
  );
  const store = new ModelConfigStore({ stateFile });

  await store.setProvider("openai", {
    displayName: "OpenAI",
    baseURL: "https://api.openai.test/v1",
    api: "openai-responses",
  });

  const saved = JSON.parse(await readFile(stateFile, "utf8")) as {
    providers: Record<string, Record<string, unknown>>;
  };
  assert.equal("models" in saved.providers.openai, false);
  assert.equal(saved.providers.openai.apiKey, "keep-secret");
  assert.deepEqual(saved.providers.openai.headers, { "X-Private": "keep-me" });
});

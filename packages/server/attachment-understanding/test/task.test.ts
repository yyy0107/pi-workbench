import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isTerminalAttachmentRecognitionSnapshot,
  type AttachmentRecognitionSnapshot,
} from "@workbench/attachment-understanding-contracts/state-machine";
import { DEFAULT_IMAGE_UNDERSTANDING_SETTINGS } from "../src/settings-store";
import {
  runAttachmentUnderstandingTask,
  type AttachmentUnderstandingTaskOptions,
} from "../src/task";
import type { AttachmentUnderstandingObservation } from "../src/contracts";
import {
  getOcrAdapterPreset,
  serializeOcrAdapterSource,
} from "@workbench/attachment-understanding-contracts/ocr-adapter";

const observation: AttachmentUnderstandingObservation = {
  attachmentId: "image-1",
  kind: "image",
  sequence: 1,
  providerId: "vision",
  method: "multimodal",
  format: "text",
  text: "Recognized text",
};

function fixture(t: test.TestContext) {
  const resultCacheDirectory = path.join(tmpdir(), `workbench-ocr-task-${randomUUID()}`);
  t.after(() => rm(resultCacheDirectory, { recursive: true, force: true }));
  const controller = new AbortController();
  const snapshots: AttachmentRecognitionSnapshot[] = [];
  const defaults = DEFAULT_IMAGE_UNDERSTANDING_SETTINGS;
  const options: AttachmentUnderstandingTaskOptions = {
    operationId: "operation-1",
    submissionId: "submission-1",
    rpcId: "rpc-1",
    attachments: [
      { id: "image-1", kind: "image", sequence: 1, mimeType: "image/png", data: "aW1hZ2U=" },
    ],
    settings: {
      ok: true,
      value: {
        revision: 0,
        credential: "private-credential",
        value: {
          ...defaults,
          resultCacheDirectory,
          routing: "always-preprocess",
          engine: "multimodal",
          glm: { ...defaults.glm, credentialConfigured: true },
          paddle: { ...defaults.paddle, credentialConfigured: false },
          ocrAdapter: { ...defaults.ocrAdapter, credentialConfigured: true },
          multimodal: { provider: "vision", model: "model" },
        },
      },
    },
    signal: controller.signal,
    modelSupportsImages: async () => false,
    prepareMultimodal: async () => undefined,
    recognizeMultimodal: async ({ onProgress }) => {
      await onProgress(1);
      return [observation];
    },
    publish: (snapshot) => {
      snapshots.push(snapshot);
    },
  };
  return { options, snapshots, controller };
}

test("task publishes one bounded terminal result for OCR and multimodal without credentials", async (t) => {
  for (const engine of ["ocr", "multimodal"] as const) {
    const { options, snapshots } = fixture(t);
    assert.ok(options.settings.ok);
    options.settings.value.value.engine = engine;
    let requests = 0;
    const mockedFetch = t.mock.method(
      globalThis,
      "fetch",
      async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        requests++;
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer private-credential");
        return Response.json({ md_results: "Recognized text" });
      },
    );
    const result = await runAttachmentUnderstandingTask(options);
    assert.equal(result.kind, "preprocessed");
    if (result.kind === "preprocessed") {
      assert.equal(await readFile(result.observations[0]!.resultPath, "utf8"), "Recognized text");
    }
    assert.equal(requests, engine === "ocr" ? 1 : 0);
    assert.equal(snapshots.filter(isTerminalAttachmentRecognitionSnapshot).length, 1);
    assert.equal(snapshots.at(-1)?.status, "succeeded");
    assert.equal(JSON.stringify(snapshots).includes("private-credential"), false);
    mockedFetch.mock.restore();
  }
});

test("task rejects malformed, mismatched and oversized callback results", async (t) => {
  for (const [value, code] of [
    [null, "provider-invalid-response"],
    [[{ ...observation, attachmentId: "other" }], "provider-invalid-response"],
    [[{ ...observation, text: null }], "provider-invalid-response"],
    [[{ ...observation, text: "x".repeat(250_001) }], "provider-response-too-large"],
  ] as const) {
    const { options, snapshots } = fixture(t);
    options.recognizeMultimodal = async () =>
      value as unknown as AttachmentUnderstandingObservation[];
    assert.deepEqual(await runAttachmentUnderstandingTask(options), {
      kind: "failed",
      errorCode: code,
    });
    assert.equal(snapshots.filter(isTerminalAttachmentRecognitionSnapshot).length, 1);
    assert.equal(snapshots.at(-1)?.status, "failed");
  }
});

test("OCR polling publishes per-job page progress before attachments complete and retains terminal details", async (t) => {
  for (const outcome of ["succeeded", "failed", "cancelled"] as const) {
    const { options, snapshots, controller } = fixture(t);
    assert.ok(options.settings.ok);
    const preset = getOcrAdapterPreset("paddleocr-vl-1.6");
    const definition = structuredClone(preset.definition);
    assert.equal(definition.operation.kind, "async-job");
    if (definition.operation.kind === "async-job") delete definition.operation.progress;
    options.settings.value.value.engine = "ocr";
    options.settings.value.value.ocrAdapter = {
      ...options.settings.value.value.ocrAdapter,
      source: serializeOcrAdapterSource(definition), // Existing saved adapter, without new paths.
      endpoint: preset.endpoint,
      model: preset.model,
      pollIntervalMs: 1,
    };
    options.attachments = [
      { id: "pdf-1", kind: "pdf", sequence: 1, mimeType: "application/pdf", data: "cGRm" },
      ...options.attachments,
    ];
    let submitted = 0;
    let polls = 0;
    const mockedFetch = t.mock.method(
      globalThis,
      "fetch",
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (init?.method === "POST") {
          submitted++;
          polls = 0;
          return Response.json({ code: 0, data: { jobId: `private-job-${submitted}` } });
        }
        if (String(input).startsWith(preset.endpoint)) {
          polls++;
          const state =
            outcome === "failed" && polls === 3
              ? "failed"
              : polls === 1
                ? "pending"
                : polls < 4
                  ? "running"
                  : "done";
          return Response.json({
            code: 0,
            data: {
              state,
              ...(polls === 1
                ? {}
                : {
                    extractProgress: {
                      extractedPages: polls === 2 ? 2 : polls === 3 ? 7 : 10,
                      totalPages: 10,
                    },
                  }),
              resultUrl: { markdownUrl: "https://result.bcebos.com/recognized.md" },
            },
          });
        }
        assert.equal(snapshots.at(-1)?.jobs?.[submitted - 1]?.status, "downloading");
        return new Response("Recognized text");
      },
    );
    const publish = options.publish;
    options.publish = async (snapshot) => {
      await publish(snapshot);
      if (snapshot.jobs?.[0]?.completedPages === 7 && outcome === "cancelled") controller.abort();
    };
    try {
      await runAttachmentUnderstandingTask(options);
      const partial = snapshots.find((snapshot) => snapshot.jobs?.[0]?.completedPages === 2);
      assert.equal(partial?.completedCount, 0);
      assert.equal(partial?.jobs?.[0]?.totalPages, 10);
      assert.equal(partial?.jobs?.[1]?.status, "queued");
      assert.equal(snapshots.at(-1)?.status, outcome);
      assert.equal(snapshots.at(-1)?.jobs?.[0]?.status, outcome);
      assert.equal(
        snapshots.at(-1)?.jobs?.[1]?.status,
        outcome === "succeeded" ? "succeeded" : "cancelled",
      );
      assert.equal(snapshots.filter(isTerminalAttachmentRecognitionSnapshot).length, 1);
      assert.doesNotMatch(JSON.stringify(snapshots), /private-|bcebos|extractProgress/);
      if (outcome === "succeeded") {
        assert.ok(
          snapshots.some(
            (snapshot) => snapshot.completedCount === 1 && snapshot.jobs?.[1]?.completedPages === 2,
          ),
        );
        assert.equal(snapshots.at(-1)?.jobs?.[0]?.pollCount, 4);
      }
    } finally {
      mockedFetch.mock.restore();
    }
  }
});

test("cancellation wins over a late provider result; settings failures use the same lifecycle", async (t) => {
  const { options, snapshots, controller } = fixture(t);
  options.recognizeMultimodal = async () => {
    controller.abort();
    return [observation];
  };
  assert.deepEqual(await runAttachmentUnderstandingTask(options), { kind: "cancelled" });
  assert.equal(snapshots.filter(isTerminalAttachmentRecognitionSnapshot).length, 1);
  assert.equal(snapshots.at(-1)?.status, "cancelled");

  const failed = fixture(t);
  failed.options.settings = {
    ok: false,
    error: Object.assign(new Error("private-credential"), { code: "image-settings-invalid" }),
  };
  failed.options.modelSupportsImages = async () => {
    throw new Error("Must not load models");
  };
  assert.deepEqual(await runAttachmentUnderstandingTask(failed.options), {
    kind: "failed",
    errorCode: "image-settings-invalid",
  });
  assert.deepEqual(
    failed.snapshots.map((snapshot) => snapshot.status),
    ["pending", "running", "failed"],
  );
  assert.equal(JSON.stringify(failed.snapshots).includes("private-credential"), false);
});

test("cache write failures publish a failure instead of returning nonexistent result paths", async (t) => {
  const { options, snapshots } = fixture(t);
  assert.ok(options.settings.ok);
  const directory = options.settings.value.value.resultCacheDirectory;
  await mkdir(directory);
  const blocked = path.join(directory, "file-not-directory");
  await writeFile(blocked, "existing content");
  options.settings.value.value.resultCacheDirectory = blocked;
  assert.deepEqual(await runAttachmentUnderstandingTask(options), {
    kind: "failed",
    errorCode: "result-cache-write-failed",
  });
  assert.equal(snapshots.at(-1)?.status, "failed");
  assert.equal(
    snapshots.some((snapshot) => snapshot.status === "succeeded"),
    false,
  );
  assert.equal(await readFile(blocked, "utf8"), "existing content");
});

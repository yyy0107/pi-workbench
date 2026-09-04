import assert from "node:assert/strict";
import test from "node:test";
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

const observation: AttachmentUnderstandingObservation = {
  attachmentId: "image-1",
  kind: "image",
  sequence: 1,
  providerId: "vision",
  method: "multimodal",
  format: "text",
  text: "Recognized text",
};

function fixture() {
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
    const { options, snapshots } = fixture();
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
    assert.equal(requests, engine === "ocr" ? 1 : 0);
    assert.equal(snapshots.filter(isTerminalAttachmentRecognitionSnapshot).length, 1);
    assert.equal(snapshots.at(-1)?.status, "succeeded");
    assert.equal(JSON.stringify(snapshots).includes("private-credential"), false);
    mockedFetch.mock.restore();
  }
});

test("task rejects malformed, mismatched and oversized callback results", async () => {
  for (const [value, code] of [
    [null, "provider-invalid-response"],
    [[{ ...observation, attachmentId: "other" }], "provider-invalid-response"],
    [[{ ...observation, text: null }], "provider-invalid-response"],
    [[{ ...observation, text: "x".repeat(250_001) }], "provider-response-too-large"],
  ] as const) {
    const { options, snapshots } = fixture();
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

test("cancellation wins over a late provider result; settings failures use the same lifecycle", async () => {
  const { options, snapshots, controller } = fixture();
  options.recognizeMultimodal = async () => {
    controller.abort();
    return [observation];
  };
  assert.deepEqual(await runAttachmentUnderstandingTask(options), { kind: "cancelled" });
  assert.equal(snapshots.filter(isTerminalAttachmentRecognitionSnapshot).length, 1);
  assert.equal(snapshots.at(-1)?.status, "cancelled");

  const failed = fixture();
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

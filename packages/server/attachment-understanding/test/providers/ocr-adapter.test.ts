import assert from "node:assert/strict";
import test from "node:test";

import { getOcrAdapterPreset } from "@workbench/attachment-understanding-contracts/ocr-adapter";
import { ImageUnderstandingProviderError, type RecognizableAttachment } from "../../src/contracts";
import { OcrAdapterProvider } from "../../src/providers/ocr-adapter";

const attachment: RecognizableAttachment = {
  id: "attachment-1",
  kind: "image",
  sequence: 1,
  name: "screen.png",
  mimeType: "image/png",
  data: Buffer.from("not-a-real-image").toString("base64"),
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("executes the GLM synchronous JSON adapter without provider-specific branching", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const preset = getOcrAdapterPreset("glm-ocr");
  const provider = new OcrAdapterProvider({
    definition: preset.definition,
    endpoint: preset.endpoint,
    model: preset.model,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      return json({ md_results: "# recognized" });
    },
  });

  const result = await provider.recognize({ attachments: [attachment], credential: "secret" });
  assert.equal(result[0]?.providerId, "glm-ocr");
  assert.equal(result[0]?.format, "markdown");
  assert.equal(result[0]?.text, "# recognized");
  assert.equal(calls.length, 1);
  const firstCall = calls[0];
  assert.ok(firstCall);
  assert.equal(firstCall.url, preset.endpoint);
  assert.equal(new Headers(firstCall.init?.headers).get("Authorization"), "Bearer secret");
  const body = JSON.parse(String(firstCall.init?.body)) as Record<string, unknown>;
  assert.equal(body.model, "glm-ocr");
  assert.match(String(body.file), /^data:image\/png;base64,/);
});

test("executes the PP-OCRv6 async adapter and extracts text from JSONL", async () => {
  const preset = getOcrAdapterPreset("pp-ocrv6");
  const calls: string[] = [];
  const provider = new OcrAdapterProvider({
    source: preset.source,
    endpoint: preset.endpoint,
    model: preset.model,
    pollIntervalMs: 1,
    sleep: async () => undefined,
    fetch: async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (init?.method === "POST") {
        assert.ok(init.body instanceof FormData);
        assert.equal(init.body.get("model"), "PP-OCRv6");
        assert.equal(
          init.body.get("optionalPayload"),
          JSON.stringify({
            useDocOrientationClassify: false,
            useDocUnwarping: false,
            useTextlineOrientation: false,
          }),
        );
        return json({ code: 0, data: { jobId: "job-1" } });
      }
      if (url.endsWith("/job-1")) {
        return json({
          code: 0,
          data: {
            state: "done",
            resultUrl: { jsonUrl: "https://result.bcebos.com/ppocr.jsonl" },
          },
        });
      }
      return new Response(
        `${JSON.stringify({
          result: { ocrResults: [{ prunedResult: { rec_texts: ["first", "second"] } }] },
        })}\n`,
      );
    },
  });

  const result = await provider.recognize({ attachments: [attachment], credential: "secret" });
  assert.equal(result[0]?.providerId, "pp-ocrv6");
  assert.equal(result[0]?.format, "text");
  assert.equal(result[0]?.text, "first\nsecond");
  assert.deepEqual(calls, [
    preset.endpoint,
    `${preset.endpoint}/job-1`,
    "https://result.bcebos.com/ppocr.jsonl",
  ]);
});

test("executes the PP-StructureV3 adapter and extracts layout markdown", async () => {
  const preset = getOcrAdapterPreset("pp-structure-v3");
  const provider = new OcrAdapterProvider({
    definition: preset.definition,
    endpoint: preset.endpoint,
    model: preset.model,
    sleep: async () => undefined,
    fetch: async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") return json({ code: 0, data: { jobId: "layout" } });
      if (url.endsWith("/layout")) {
        return json({
          code: 0,
          data: {
            state: "done",
            resultUrl: { jsonUrl: "https://result.bcebos.com/layout.jsonl" },
          },
        });
      }
      return new Response(
        `${JSON.stringify({
          result: { layoutParsingResults: [{ markdown: { text: "# Page 1" } }] },
        })}\n`,
      );
    },
  });

  const result = await provider.recognize({ attachments: [attachment], credential: "secret" });
  assert.equal(result[0]?.text, "# Page 1");
  assert.equal(result[0]?.format, "markdown");
});

test("uses adapter-declared retry mappings for Paddle service code 10010", async () => {
  const preset = getOcrAdapterPreset("paddleocr-vl-1.6");
  const retries: number[] = [];
  let submissions = 0;
  const provider = new OcrAdapterProvider({
    definition: preset.definition,
    endpoint: preset.endpoint,
    model: preset.model,
    sleep: async (milliseconds) => {
      retries.push(milliseconds);
    },
    fetch: async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") {
        submissions += 1;
        if (submissions < 3) return json({ code: 10010, data: null }, 400);
        return json({ code: 0, data: { jobId: "eventual" } });
      }
      if (url.endsWith("/eventual")) {
        return json({
          code: 0,
          data: {
            state: "done",
            resultUrl: { markdownUrl: "https://result.bcebos.com/result.md" },
          },
        });
      }
      return new Response("recognized");
    },
  });

  const result = await provider.recognize({ attachments: [attachment], credential: "secret" });
  assert.equal(result[0]?.text, "recognized");
  assert.equal(submissions, 3);
  assert.deepEqual(retries, [3_000, 6_000]);
});

test("keeps adapter result download failures distinct from JSONL parsing failures", async () => {
  const preset = getOcrAdapterPreset("pp-ocrv6");
  const provider = new OcrAdapterProvider({
    definition: preset.definition,
    endpoint: preset.endpoint,
    model: preset.model,
    sleep: async () => undefined,
    fetch: async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") return json({ code: 0, data: { jobId: "failed-download" } });
      if (url.endsWith("/failed-download")) {
        return json({
          code: 0,
          data: {
            state: "done",
            resultUrl: { jsonUrl: "https://result.bcebos.com/unavailable.jsonl" },
          },
        });
      }
      return new Response("unavailable", { status: 503 });
    },
  });

  await assert.rejects(
    provider.recognize({ attachments: [attachment], credential: "secret" }),
    (error) => {
      assert.ok(error instanceof ImageUnderstandingProviderError);
      assert.equal(error.diagnostic?.phase, "result-download");
      assert.equal(error.diagnostic?.reason, "download-failed");
      assert.equal(error.diagnostic?.resultSource, "jsonl");
      return true;
    },
  );
});

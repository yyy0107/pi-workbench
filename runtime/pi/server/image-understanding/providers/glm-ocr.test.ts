import assert from "node:assert/strict";
import test from "node:test";

import { ImageUnderstandingProviderError } from "../contracts";
import { GlmOcrProvider } from "./glm-ocr";

const image = {
  id: "image-1",
  name: "receipt.png",
  mimeType: "image/png",
  data: Buffer.from("validated-image").toString("base64"),
};

function errorCode(error: unknown): string | undefined {
  assert.ok(error instanceof ImageUnderstandingProviderError);
  return error.code;
}

test("calls the hosted GLM layout parser with bearer auth and a data URL", async () => {
  const token = "private-glm-token";
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://api.z.ai/api/paas/v4/layout_parsing");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${token}`);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "glm-ocr");
    assert.equal(body.file, `data:image/png;base64,${image.data}`);
    assert.equal(body.return_crop_images, false);
    assert.equal(body.need_layout_visualization, false);
    return new Response(
      JSON.stringify({
        id: "task-1",
        model: "glm-ocr",
        md_results: "# Receipt\n\nTotal: 42",
        layout_details: [[{ content: "must not be returned as raw metadata" }]],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const provider = new GlmOcrProvider({ fetch: fetchImpl });

  const result = await provider.recognize({ images: [image], credential: token });

  assert.deepEqual(result, [
    {
      imageId: "image-1",
      providerId: "glm-ocr",
      method: "ocr",
      format: "markdown",
      text: "# Receipt\n\nTotal: 42",
    },
  ]);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal("layout_details" in result[0]!, false);
});

test("accepts a validated data URL and falls back to normalized layout text", async () => {
  const provider = new GlmOcrProvider({
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.file, `data:image/png;base64,${image.data}`);
      return new Response(
        JSON.stringify({ layout_details: [[{ content: "line one" }, { content: "line two" }]] }),
      );
    },
  });

  const result = await provider.recognize({
    images: [{ ...image, data: `data:image/png;base64,${image.data}` }],
    credential: "token",
  });
  assert.equal(result[0]?.format, "text");
  assert.equal(result[0]?.text, "line one\nline two");
});

test("maps authentication and oversized responses to stable redacted errors", async () => {
  const authProvider = new GlmOcrProvider({
    fetch: async () => new Response("raw upstream secret", { status: 401 }),
  });
  await assert.rejects(
    authProvider.recognize({ images: [image], credential: "token" }),
    (error) => {
      assert.equal(errorCode(error), "provider-authentication-failed");
      assert.equal((error as Error).message.includes("raw upstream secret"), false);
      return true;
    },
  );

  const largeProvider = new GlmOcrProvider({
    maxResponseBytes: 16,
    fetch: async () =>
      new Response(JSON.stringify({ md_results: "too large" }), {
        headers: { "content-length": "999" },
      }),
  });
  await assert.rejects(
    largeProvider.recognize({ images: [image], credential: "token" }),
    (error) => errorCode(error) === "provider-response-too-large",
  );

  const longObservationProvider = new GlmOcrProvider({
    maxObservationCharacters: 4,
    fetch: async () => new Response(JSON.stringify({ md_results: "12345" })),
  });
  await assert.rejects(
    longObservationProvider.recognize({ images: [image], credential: "token" }),
    (error) => errorCode(error) === "provider-response-too-large",
  );
});

test("distinguishes caller cancellation from provider timeout", async () => {
  const neverFetch: typeof fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        {
          once: true,
        },
      );
    });

  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    new GlmOcrProvider({ fetch: neverFetch }).recognize({
      images: [image],
      credential: "token",
      signal: cancelled.signal,
    }),
    (error) => errorCode(error) === "provider-aborted",
  );

  await assert.rejects(
    new GlmOcrProvider({ fetch: neverFetch, timeoutMs: 5 }).recognize({
      images: [image],
      credential: "token",
    }),
    (error) => errorCode(error) === "provider-timeout",
  );
});

test("rejects image formats outside the hosted GLM-OCR contract before sending a request", async () => {
  let called = false;
  const provider = new GlmOcrProvider({
    fetch: async () => {
      called = true;
      return new Response("{}");
    },
  });

  await assert.rejects(
    provider.recognize({
      credential: "token",
      images: [{ ...image, mimeType: "image/webp" }],
    }),
    (error) => errorCode(error) === "provider-invalid-input",
  );
  assert.equal(called, false);
});

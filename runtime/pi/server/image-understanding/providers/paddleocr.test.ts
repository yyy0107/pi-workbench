import assert from "node:assert/strict";
import test from "node:test";

import { ImageUnderstandingProviderError } from "../contracts";
import type { PublicAddressResolver, PublicHttpsResponse, PublicHttpsTransport } from "../http";
import { PaddleOcrProvider } from "./paddleocr";

const image = {
  id: "image-1",
  name: "scan.png",
  mimeType: "image/png",
  data: Buffer.from("validated-image").toString("base64"),
};

function errorCode(error: unknown): string | undefined {
  assert.ok(error instanceof ImageUnderstandingProviderError);
  return error.code;
}

function envelope(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ code: 0, msg: "Success", data }), {
    headers: { "content-type": "application/json" },
  });
}

const publicResultResolver: PublicAddressResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

function publicResponse(
  text: string,
  options: { status?: number; headers?: HeadersInit } = {},
): PublicHttpsResponse {
  const bytes = new TextEncoder().encode(text);
  return {
    status: options.status ?? 200,
    headers: new Headers(options.headers),
    body: (async function* () {
      yield bytes;
    })(),
    cancel: () => undefined,
  };
}

test("submits multipart data, polls pending/running/done, and downloads markdown", async () => {
  const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
  let statusCall = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    if (method === "POST") {
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get("model"), "PaddleOCR-VL-1.5");
      assert.deepEqual(JSON.parse(String(init.body.get("optionalPayload"))), {
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useChartRecognition: false,
        visualize: false,
      });
      const file = init.body.get("file");
      assert.ok(file instanceof Blob);
      assert.equal(file.type, "image/png");
      assert.equal(file.size, Buffer.from(image.data, "base64").byteLength);
      return envelope({ jobId: "job-1" });
    }
    if (url.endsWith("/job-1")) {
      statusCall += 1;
      if (statusCall === 1) return envelope({ state: "pending" });
      if (statusCall === 2) {
        return envelope({
          state: "running",
          extractProgress: { totalPages: 1, extractedPages: 0 },
        });
      }
      return envelope({
        state: "done",
        resultUrl: {
          markdownUrl: "https://results.example.test/job-1.md",
          jsonUrl: "https://results.example.test/job-1.jsonl",
        },
      });
    }
    if (url.endsWith("job-1.md")) return new Response("# Parsed document\n\nHello");
    throw new Error("unexpected request");
  };
  const provider = new PaddleOcrProvider({
    fetch: fetchImpl,
    pollIntervalMs: 1,
    sleep: async () => undefined,
    resultAddressResolver: async (hostname) => {
      assert.equal(hostname, "results.example.test");
      return [{ address: "2606:4700:4700::1111", family: 6 }];
    },
    resultHttpsTransport: async (target) => {
      assert.equal(target.address, "2606:4700:4700::1111");
      assert.equal(target.family, 6);
      assert.equal(target.hostname, "results.example.test");
      assert.equal(target.path, "/job-1.md");
      calls.push({ url: target.url, method: "GET", authorization: null });
      return publicResponse("# Parsed document\n\nHello");
    },
  });

  const result = await provider.recognize({ images: [image], credential: "paddle-token" });

  assert.equal(result[0]?.format, "markdown");
  assert.equal(result[0]?.text, "# Parsed document\n\nHello");
  assert.deepEqual(
    calls.map(({ method }) => method),
    ["POST", "GET", "GET", "GET", "GET"],
  );
  assert.equal(
    calls.slice(0, 4).every((call) => call.authorization === "Bearer paddle-token"),
    true,
  );
  assert.equal(calls.at(-1)?.authorization, null, "pre-signed result downloads omit credentials");
  assert.equal(
    calls.some((call) => call.url.endsWith("job-1.jsonl")),
    false,
  );
});

test("downloads JSONL when markdownUrl is absent and normalizes both result shapes", async () => {
  const resultBodies = [
    `${JSON.stringify({
      result: {
        layoutParsingResults: [
          { markdown: { text: "# Page one" } },
          { markdown: { text: "Page two" } },
        ],
      },
    })}\n`,
    `${JSON.stringify({
      result: { ocrResults: [{ prunedResult: { rec_texts: ["first", "second"] } }] },
    })}\n`,
  ];
  for (const [index, resultBody] of resultBodies.entries()) {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") return envelope({ jobId: `job-${index}` });
      if (url.endsWith(`/job-${index}`)) {
        return envelope({
          state: "done",
          resultUrl: { jsonUrl: `https://results.example.test/job-${index}.jsonl` },
        });
      }
      throw new Error("result downloads must use the pinned HTTPS transport");
    };
    const provider = new PaddleOcrProvider({
      fetch: fetchImpl,
      pollIntervalMs: 1,
      resultAddressResolver: publicResultResolver,
      resultHttpsTransport: async () => publicResponse(resultBody),
    });
    const result = await provider.recognize({ images: [image], credential: "token" });
    assert.equal(result[0]?.text, index === 0 ? "# Page one\n\nPage two" : "first\nsecond");
    assert.equal(result[0]?.format, index === 0 ? "markdown" : "text");
  }
});

test("maps failed jobs, malformed states, and oversized result downloads to stable errors", async () => {
  const cases = [
    {
      response: envelope({ state: "failed", errorMsg: "raw private provider failure" }),
      code: "provider-job-failed",
    },
    { response: envelope({ state: "mystery" }), code: "provider-invalid-response" },
  ] as const;
  for (const { response, code } of cases) {
    const provider = new PaddleOcrProvider({
      pollIntervalMs: 1,
      fetch: async (_input, init) =>
        init?.method === "POST" ? envelope({ jobId: "job" }) : response.clone(),
    });
    await assert.rejects(provider.recognize({ images: [image], credential: "token" }), (error) => {
      assert.equal(errorCode(error), code);
      assert.equal((error as Error).message.includes("raw private provider failure"), false);
      return true;
    });
  }

  const largeProvider = new PaddleOcrProvider({
    maxResponseBytes: 20,
    pollIntervalMs: 1,
    fetch: async (input, init) => {
      if (init?.method === "POST") return envelope({ jobId: "job" });
      if (String(input).endsWith("/job")) {
        return envelope({ state: "done", resultUrl: { markdownUrl: "https://result.test/a" } });
      }
      throw new Error("result downloads must use the pinned HTTPS transport");
    },
    resultAddressResolver: publicResultResolver,
    resultHttpsTransport: async () =>
      publicResponse("large result", { headers: { "content-length": "1000" } }),
  });
  await assert.rejects(
    largeProvider.recognize({ images: [image], credential: "token" }),
    (error) => errorCode(error) === "provider-response-too-large",
  );

  const privateResultProvider = new PaddleOcrProvider({
    pollIntervalMs: 1,
    fetch: async (input, init) => {
      if (init?.method === "POST") return envelope({ jobId: "job" });
      if (String(input).endsWith("/job")) {
        return envelope({
          state: "done",
          resultUrl: { markdownUrl: "https://127.0.0.1:8443/internal" },
        });
      }
      assert.fail("a private result URL must be rejected before fetch");
    },
  });
  await assert.rejects(
    privateResultProvider.recognize({ images: [image], credential: "token" }),
    (error) => errorCode(error) === "provider-invalid-response",
  );
});

test("rejects DNS rebinding, reserved hosts, credentials, and redirects for result URLs", async () => {
  async function recognizeResult(
    markdownUrl: string,
    options: {
      resolver?: PublicAddressResolver;
      transport?: PublicHttpsTransport;
    } = {},
  ): Promise<void> {
    const provider = new PaddleOcrProvider({
      pollIntervalMs: 1,
      fetch: async (input, init) => {
        if (init?.method === "POST") return envelope({ jobId: "job" });
        if (String(input).endsWith("/job")) {
          return envelope({ state: "done", resultUrl: { markdownUrl } });
        }
        assert.fail("result downloads must not use the provider API fetch");
      },
      resultAddressResolver: options.resolver,
      resultHttpsTransport: options.transport,
    });
    await provider.recognize({ images: [image], credential: "token" });
  }

  let transportCalls = 0;
  await assert.rejects(
    recognizeResult("https://169.254.169.254.nip.io/latest/meta-data", {
      resolver: async (hostname) => {
        assert.equal(hostname, "169.254.169.254.nip.io");
        return [{ address: "169.254.169.254", family: 4 }];
      },
      transport: async () => {
        transportCalls += 1;
        return publicResponse("must not be reached");
      },
    }),
    (error) => errorCode(error) === "provider-invalid-response",
  );
  assert.equal(transportCalls, 0, "link-local DNS answers are rejected before connection");

  await assert.rejects(
    recognizeResult("https://mixed-results.example.test/result.md", {
      resolver: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.8", family: 4 },
      ],
      transport: async () => {
        transportCalls += 1;
        return publicResponse("must not be reached");
      },
    }),
    (error) => errorCode(error) === "provider-invalid-response",
  );
  assert.equal(transportCalls, 0, "mixed public/private DNS answer sets are rejected entirely");

  for (const resultUrl of [
    "https://203.0.113.8/result.md",
    "https://[::ffff:127.0.0.1]/result.md",
    "https://user:secret@results.example.test/result.md",
  ]) {
    await assert.rejects(
      recognizeResult(resultUrl, {
        resolver: publicResultResolver,
        transport: async () => {
          transportCalls += 1;
          return publicResponse("must not be reached");
        },
      }),
      (error) => errorCode(error) === "provider-invalid-response",
    );
  }
  assert.equal(transportCalls, 0, "reserved/credentialed URLs are rejected before connection");

  await assert.rejects(
    recognizeResult("https://results.example.test/redirect", {
      resolver: publicResultResolver,
      transport: async () => publicResponse("", { status: 302, headers: { location: "/next" } }),
    }),
    (error) => errorCode(error) === "provider-invalid-response",
  );
});

test("times out and aborts stalled result response bodies", async () => {
  function stalledResponse(cancelled: () => void): PublicHttpsResponse {
    const stalled = new Promise<IteratorResult<Uint8Array>>(() => undefined);
    return {
      status: 200,
      headers: new Headers(),
      body: {
        [Symbol.asyncIterator]: () => ({ next: () => stalled }),
      },
      cancel: cancelled,
    };
  }

  function providerWithStalledResult(
    cancelled: () => void,
    requestTimeoutMs: number,
  ): PaddleOcrProvider {
    return new PaddleOcrProvider({
      requestTimeoutMs,
      pollIntervalMs: 1,
      fetch: async (input, init) => {
        if (init?.method === "POST") return envelope({ jobId: "job" });
        if (String(input).endsWith("/job")) {
          return envelope({
            state: "done",
            resultUrl: { markdownUrl: "https://results.example.test/stalled.md" },
          });
        }
        assert.fail("result downloads must use the pinned HTTPS transport");
      },
      resultAddressResolver: publicResultResolver,
      resultHttpsTransport: async () => stalledResponse(cancelled),
    });
  }

  let timeoutCancellations = 0;
  await assert.rejects(
    providerWithStalledResult(() => {
      timeoutCancellations += 1;
    }, 5).recognize({ images: [image], credential: "token" }),
    (error) => errorCode(error) === "provider-timeout",
  );
  assert.equal(timeoutCancellations, 1);

  let abortCancellations = 0;
  const controller = new AbortController();
  const recognition = providerWithStalledResult(() => {
    abortCancellations += 1;
  }, 10_000).recognize({
    images: [image],
    credential: "token",
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(recognition, (error) => errorCode(error) === "provider-aborted");
  assert.equal(abortCancellations, 1);
});

test("bounds pending jobs by the overall polling deadline", async () => {
  let now = 0;
  const provider = new PaddleOcrProvider({
    pollTimeoutMs: 3,
    pollIntervalMs: 1,
    maxPollIntervalMs: 2,
    now: () => now,
    sleep: async (milliseconds) => {
      now += milliseconds;
    },
    fetch: async (_input, init) =>
      init?.method === "POST" ? envelope({ jobId: "job" }) : envelope({ state: "pending" }),
  });

  await assert.rejects(
    provider.recognize({ images: [image], credential: "token" }),
    (error) => errorCode(error) === "provider-poll-timeout",
  );
});

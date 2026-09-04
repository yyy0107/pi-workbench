import assert from "node:assert/strict";
import test from "node:test";

import { ImageUnderstandingProviderError } from "../../../src/attachment-understanding/contracts";
import type {
  PublicAddressResolver,
  PublicHttpsResponse,
  PublicHttpsTransport,
} from "../../../src/attachment-understanding/http";
import { PaddleOcrProvider } from "../../../src/attachment-understanding/providers/paddleocr";

const image = {
  id: "image-1",
  kind: "image" as const,
  sequence: 1,
  name: "scan.png",
  mimeType: "image/png",
  data: Buffer.from("validated-image").toString("base64"),
};
const pdf = {
  id: "pdf-1",
  kind: "pdf" as const,
  sequence: 1,
  name: "invoice.pdf",
  mimeType: "application/pdf",
  data: Buffer.from("%PDF-1.7\nvalidated-document").toString("base64"),
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
      assert.equal(init.body.get("model"), "PaddleOCR-VL-1.6");
      assert.deepEqual(JSON.parse(String(init.body.get("optionalPayload"))), {
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useChartRecognition: false,
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

  const result = await provider.recognize({ attachments: [image], credential: "paddle-token" });

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
});

test("follows the official PaddleOCR-VL-1.6 JSONL result shape before markdown fallback", async () => {
  const resultBody = `${JSON.stringify({
    result: {
      layoutParsingResults: [
        {
          markdown: {
            text: "# Page one\n\nRecognized with 1.6",
            images: { "images/chart.jpg": "https://results.example.test/chart.jpg" },
          },
          outputImages: { page: "https://results.example.test/page.jpg" },
        },
        {
          markdown: { text: "Page two", images: {} },
          outputImages: {},
        },
      ],
    },
  })}\n`;
  const downloadedPaths: string[] = [];
  const provider = new PaddleOcrProvider({
    pollIntervalMs: 1,
    fetch: async (input, init) => {
      if (init?.method === "POST") return envelope({ jobId: "official-1.6-job" });
      if (String(input).endsWith("/official-1.6-job")) {
        return envelope({
          state: "done",
          extractProgress: {
            totalPages: 2,
            extractedPages: 2,
            startTime: "2026-08-23T10:00:00+08:00",
            endTime: "2026-08-23T10:00:03+08:00",
          },
          resultUrl: {
            jsonUrl: "https://results.example.test/official-1.6.jsonl",
            markdownUrl: "https://results.example.test/official-1.6.md",
          },
        });
      }
      throw new Error("result downloads must use the pinned HTTPS transport");
    },
    resultAddressResolver: publicResultResolver,
    resultHttpsTransport: async (target) => {
      downloadedPaths.push(target.path);
      if (target.path.endsWith(".jsonl")) return publicResponse(resultBody);
      return publicResponse("this fallback must not be selected");
    },
  });

  assert.deepEqual(await provider.recognize({ attachments: [pdf], credential: "token" }), [
    {
      attachmentId: "pdf-1",
      kind: "pdf",
      sequence: 1,
      providerId: "paddleocr",
      method: "ocr",
      format: "markdown",
      text: "# Page one\n\nRecognized with 1.6\n\nPage two",
    },
  ]);
  assert.deepEqual(downloadedPaths, ["/official-1.6.jsonl"]);
});

test("downloads Paddle BOS result links through native fetch without forwarding credentials", async () => {
  const resultBody = `${JSON.stringify({
    result: {
      layoutParsingResults: [{ markdown: { text: "# Result from Paddle BOS" } }],
    },
  })}\n`;
  const calls: Array<{
    url: string;
    method: string;
    authorization: string | null;
    redirect?: RequestRedirect;
  }> = [];
  const resultUrl =
    "https://paddleocr-store-7.bj.bcebos.com/v1/job/test/json/result.json?authorization=redacted";
  const provider = new PaddleOcrProvider({
    pollIntervalMs: 1,
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        authorization: new Headers(init?.headers).get("Authorization"),
        ...(init?.redirect === undefined ? {} : { redirect: init.redirect }),
      });
      if (method === "POST") return envelope({ jobId: "bos-job" });
      if (url.endsWith("/bos-job")) {
        return envelope({ state: "done", resultUrl: { jsonUrl: resultUrl } });
      }
      if (url === resultUrl) {
        assert.equal(init?.redirect, "manual");
        return new Response(resultBody, {
          headers: { "content-type": "application/octet-stream" },
        });
      }
      assert.fail(`unexpected request: ${url}`);
    },
    resultAddressResolver: async () => {
      assert.fail("an official Paddle BOS URL must use the environment-native fetch stack");
    },
    resultHttpsTransport: async () => {
      assert.fail("an official Paddle BOS URL must not use the DNS-pinned transport");
    },
  });

  const result = await provider.recognize({ attachments: [image], credential: "paddle-token" });

  assert.equal(result[0]?.text, "# Result from Paddle BOS");
  assert.equal(result[0]?.format, "markdown");
  assert.equal(calls.at(-1)?.url, resultUrl);
  assert.equal(calls.at(-1)?.authorization, null);
  assert.equal(calls.at(-1)?.redirect, "manual");
});

test("keeps every Paddle BOS result redirect inside the trusted HTTPS namespace", async () => {
  let resultDownloadCalls = 0;
  const provider = new PaddleOcrProvider({
    pollIntervalMs: 1,
    fetch: async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") return envelope({ jobId: "bos-redirect-job" });
      if (url.endsWith("/bos-redirect-job")) {
        return envelope({
          state: "done",
          resultUrl: {
            jsonUrl: "https://paddleocr-store-7.bj.bcebos.com/redirect",
          },
        });
      }
      resultDownloadCalls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/internal" },
      });
    },
  });

  await assert.rejects(
    provider.recognize({ attachments: [image], credential: "token" }),
    (error) => {
      assert.equal(errorCode(error), "provider-invalid-response");
      assert.deepEqual((error as ImageUnderstandingProviderError).diagnostic, {
        phase: "result-download",
        reason: "download-failed",
        resultSource: "jsonl",
      });
      return true;
    },
  );
  assert.equal(resultDownloadCalls, 1, "the disallowed redirect target is never requested");
});

test("falls back to the markdown result when the preferred JSONL payload is malformed", async () => {
  const downloadedPaths: string[] = [];
  const provider = new PaddleOcrProvider({
    pollIntervalMs: 1,
    fetch: async (input, init) => {
      if (init?.method === "POST") return envelope({ jobId: "fallback-job" });
      if (String(input).endsWith("/fallback-job")) {
        return envelope({
          state: "done",
          resultUrl: {
            jsonUrl: "https://results.example.test/fallback.jsonl",
            markdownUrl: "https://results.example.test/fallback.md",
          },
        });
      }
      throw new Error("result downloads must use the pinned HTTPS transport");
    },
    resultAddressResolver: publicResultResolver,
    resultHttpsTransport: async (target) => {
      downloadedPaths.push(target.path);
      return publicResponse(target.path.endsWith(".jsonl") ? "not-jsonl" : "# Fallback result");
    },
  });

  const result = await provider.recognize({ attachments: [image], credential: "token" });
  assert.equal(result[0]?.text, "# Fallback result");
  assert.deepEqual(downloadedPaths, ["/fallback.jsonl", "/fallback.md"]);
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
    const result = await provider.recognize({ attachments: [image], credential: "token" });
    assert.equal(result[0]?.text, index === 0 ? "# Page one\n\nPage two" : "first\nsecond");
    assert.equal(result[0]?.format, index === 0 ? "markdown" : "text");
  }
});

test("submits PDF attachments as named multipart files", async () => {
  const provider = new PaddleOcrProvider({
    pollIntervalMs: 1,
    fetch: async (input, init) => {
      if (init?.method === "POST") {
        assert.ok(init.body instanceof FormData);
        const file = init.body.get("file");
        assert.ok(file instanceof File);
        assert.equal(file.name, "invoice.pdf");
        assert.equal(file.type, "application/pdf");
        assert.equal(file.size, Buffer.from(pdf.data, "base64").byteLength);
        return envelope({ jobId: "pdf-job" });
      }
      if (String(input).endsWith("/pdf-job")) {
        return envelope({
          state: "done",
          resultUrl: { markdownUrl: "https://results.example.test/pdf-job.md" },
        });
      }
      assert.fail("result downloads must use the pinned HTTPS transport");
    },
    resultAddressResolver: publicResultResolver,
    resultHttpsTransport: async () => publicResponse("# Parsed PDF"),
  });

  assert.deepEqual(await provider.recognize({ attachments: [pdf], credential: "token" }), [
    {
      attachmentId: "pdf-1",
      kind: "pdf",
      sequence: 1,
      providerId: "paddleocr",
      method: "ocr",
      format: "markdown",
      text: "# Parsed PDF",
    },
  ]);
});

test("retries a full Paddle submission queue with bounded exponential backoff", async () => {
  let submissionCalls = 0;
  const retryUpdates: Array<{ attempt: number; delayMs: number }> = [];
  const sleeps: number[] = [];
  let submitted = 0;
  const provider = new PaddleOcrProvider({
    maxSubmissionAttempts: 4,
    submissionRetryDelayMs: 3_000,
    maxSubmissionRetryDelayMs: 12_000,
    pollIntervalMs: 1,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    onSubmissionRetry: (update) => {
      retryUpdates.push(update);
    },
    onSubmitted: () => {
      submitted += 1;
    },
    fetch: async (input, init) => {
      if (init?.method === "POST") {
        submissionCalls += 1;
        if (submissionCalls < 4) {
          return new Response(JSON.stringify({ code: 10_010, msg: "queue full", data: {} }), {
            status: 400,
          });
        }
        return envelope({ jobId: "retried-job" });
      }
      if (String(input).endsWith("/retried-job")) {
        return envelope({
          state: "done",
          resultUrl: { markdownUrl: "https://results.example.test/retried.md" },
        });
      }
      assert.fail("result downloads must use the pinned HTTPS transport");
    },
    resultAddressResolver: publicResultResolver,
    resultHttpsTransport: async () => publicResponse("# Retried result"),
  });

  const result = await provider.recognize({ attachments: [image], credential: "token" });

  assert.equal(result[0]?.text, "# Retried result");
  assert.equal(submissionCalls, 4);
  assert.deepEqual(sleeps, [3_000, 6_000, 12_000]);
  assert.deepEqual(retryUpdates, [
    { attempt: 2, delayMs: 3_000 },
    { attempt: 3, delayMs: 6_000 },
    { attempt: 4, delayMs: 12_000 },
  ]);
  assert.equal(submitted, 1);
});

test("does not retry Paddle daily quota exhaustion", async () => {
  let submissionCalls = 0;
  let sleeps = 0;
  const provider = new PaddleOcrProvider({
    sleep: async () => {
      sleeps += 1;
    },
    fetch: async () => {
      submissionCalls += 1;
      return new Response(JSON.stringify({ code: 12_001, msg: "daily quota", data: {} }), {
        status: 403,
      });
    },
  });

  await assert.rejects(
    provider.recognize({ attachments: [image], credential: "token" }),
    (error) => {
      assert.equal(errorCode(error), "provider-rate-limited");
      assert.equal((error as ImageUnderstandingProviderError).retryable, false);
      assert.equal((error as ImageUnderstandingProviderError).diagnostic?.providerCode, "12001");
      return true;
    },
  );
  assert.equal(submissionCalls, 1);
  assert.equal(sleeps, 0);
});

test("maps failed jobs, malformed states, and oversized result downloads to stable errors", async () => {
  const cases = [
    {
      response: envelope({ state: "failed", errorMsg: "raw private provider failure" }),
      code: "provider-job-failed",
      diagnostic: { phase: "polling", reason: "job-failed" },
    },
    {
      response: envelope({ state: "mystery" }),
      code: "provider-invalid-response",
      diagnostic: { phase: "polling", reason: "unexpected-job-state" },
    },
  ] as const;
  for (const { response, code, diagnostic } of cases) {
    const provider = new PaddleOcrProvider({
      pollIntervalMs: 1,
      fetch: async (_input, init) =>
        init?.method === "POST" ? envelope({ jobId: "job" }) : response.clone(),
    });
    await assert.rejects(
      provider.recognize({ attachments: [image], credential: "token" }),
      (error) => {
        assert.equal(errorCode(error), code);
        assert.deepEqual((error as ImageUnderstandingProviderError).diagnostic, diagnostic);
        assert.equal((error as Error).message.includes("raw private provider failure"), false);
        return true;
      },
    );
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
    largeProvider.recognize({ attachments: [image], credential: "token" }),
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
    privateResultProvider.recognize({ attachments: [image], credential: "token" }),
    (error) => errorCode(error) === "provider-invalid-response",
  );
});

test("maps documented PaddleOCR envelope codes without exposing provider messages", async () => {
  const cases = [
    { code: 401, status: 401, expected: "provider-authentication-failed" },
    { code: 500, status: 500, expected: "provider-unavailable" },
    { code: 10_004, status: 400, expected: "provider-invalid-input" },
    { code: 10_007, status: 400, expected: "provider-configuration-invalid" },
    { code: 10_010, status: 429, expected: "provider-rate-limited" },
    { code: 11_003, status: 200, expected: "provider-job-failed" },
  ] as const;

  for (const { code, status, expected } of cases) {
    const provider = new PaddleOcrProvider({
      maxSubmissionAttempts: 1,
      fetch: async () =>
        new Response(
          JSON.stringify({
            code,
            msg: "raw provider detail that must not cross the adapter boundary",
            data: {},
          }),
          { status },
        ),
    });
    await assert.rejects(
      provider.recognize({ attachments: [image], credential: "token" }),
      (error) => {
        assert.equal(errorCode(error), expected);
        assert.equal((error as ImageUnderstandingProviderError).diagnostic?.phase, "submission");
        assert.equal(
          (error as ImageUnderstandingProviderError).diagnostic?.providerCode,
          String(code),
        );
        if (status !== 200) {
          assert.equal((error as ImageUnderstandingProviderError).diagnostic?.httpStatus, status);
        }
        assert.equal(
          (error as Error).message.includes("raw provider detail"),
          false,
          "upstream messages are not surfaced",
        );
        return true;
      },
    );
  }

  const nonEnvelopeRateLimit = new PaddleOcrProvider({
    maxSubmissionAttempts: 1,
    fetch: async () => new Response("upstream busy", { status: 429 }),
  });
  await assert.rejects(
    nonEnvelopeRateLimit.recognize({ attachments: [image], credential: "token" }),
    (error) => errorCode(error) === "provider-rate-limited",
  );
});

test("pins every result redirect while rejecting DNS rebinding and unsafe redirect targets", async () => {
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
    await provider.recognize({ attachments: [image], credential: "token" });
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

  const redirectPaths: string[] = [];
  await recognizeResult("https://results.example.test/redirect", {
    resolver: publicResultResolver,
    transport: async (target) => {
      redirectPaths.push(target.path);
      return target.path === "/redirect"
        ? publicResponse("", { status: 302, headers: { location: "/next" } })
        : publicResponse("# Redirected Paddle result");
    },
  });
  assert.deepEqual(redirectPaths, ["/redirect", "/next"]);

  let unsafeRedirectCalls = 0;
  await assert.rejects(
    recognizeResult("https://results.example.test/redirect-private", {
      resolver: publicResultResolver,
      transport: async () => {
        unsafeRedirectCalls += 1;
        return publicResponse("", {
          status: 302,
          headers: { location: "https://127.0.0.1/internal" },
        });
      },
    }),
    (error) => errorCode(error) === "provider-invalid-response",
  );
  assert.equal(unsafeRedirectCalls, 1, "the unsafe redirect target is rejected before connection");
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
    }, 5).recognize({ attachments: [image], credential: "token" }),
    (error) => errorCode(error) === "provider-timeout",
  );
  assert.equal(timeoutCancellations, 1);

  let abortCancellations = 0;
  const controller = new AbortController();
  const recognition = providerWithStalledResult(() => {
    abortCancellations += 1;
  }, 10_000).recognize({
    attachments: [image],
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
    provider.recognize({ attachments: [image], credential: "token" }),
    (error) => errorCode(error) === "provider-poll-timeout",
  );
});

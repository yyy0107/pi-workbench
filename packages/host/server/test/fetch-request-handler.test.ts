import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createFetchRequestHandler, type RuntimeFetchHandler } from "../src/fetch-request-handler";

async function startCarrier(handler: RuntimeFetchHandler) {
  let origin = "";
  const server = createServer(
    createFetchRequestHandler({
      fetchHandler: handler,
      origin: () => origin,
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
  return { server, origin, port };
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("streams a non-GET upload into a duplex-half Fetch Request before the client ends", async () => {
  let firstChunkResolve!: (value: string) => void;
  const firstChunk = new Promise<string>((resolve) => (firstChunkResolve = resolve));
  const { server, port } = await startCarrier(async (request) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, `http://127.0.0.1:${port}/api/upload?part=1`);
    const reader = request.body!.getReader();
    const first = await reader.read();
    firstChunkResolve(Buffer.from(first.value!).toString());
    const chunks = [Buffer.from(first.value!)];
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(Buffer.from(result.value));
    }
    return Response.json({ body: Buffer.concat(chunks).toString() });
  });

  try {
    const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = httpRequest(
        { hostname: "127.0.0.1", port, path: "/api/upload?part=1", method: "POST" },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.on("end", () =>
            resolve({
              status: incoming.statusCode ?? 0,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      request.on("error", reject);
      request.write("first");
      void firstChunk.then(() => request.end("-second"));
    });
    assert.equal(await firstChunk, "first");
    const result = await response;
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body), { body: "first-second" });
  } finally {
    await closeServer(server);
  }
});

test("filters request and response hop-by-hop headers while preserving multiple Set-Cookie fields", async () => {
  let delegatedHeaders: Headers | undefined;
  const { server, port } = await startCarrier((request) => {
    delegatedHeaders = request.headers;
    const headers = new Headers({
      Connection: "x-response-private",
      "Keep-Alive": "timeout=999",
      "X-Response-Private": "remove-me",
      "X-Runtime": "preserved",
    });
    headers.append("Set-Cookie", "first=one; Path=/; HttpOnly");
    headers.append("Set-Cookie", "second=two; Path=/; SameSite=Strict");
    return new Response("ok", { headers });
  });

  try {
    const result = await new Promise<{
      headers: IncomingMessage["headers"];
      rawHeaders: readonly string[];
    }>((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/headers",
          headers: {
            Connection: "x-request-private, keep-alive",
            "X-Request-Private": "remove-me",
            "X-End-To-End": "preserved",
          },
        },
        (response) => {
          response.resume();
          response.on("end", () =>
            resolve({ headers: response.headers, rawHeaders: response.rawHeaders }),
          );
        },
      );
      request.on("error", reject);
      request.end();
    });
    assert.equal(delegatedHeaders?.get("connection"), null);
    assert.equal(delegatedHeaders?.get("keep-alive"), null);
    assert.equal(delegatedHeaders?.get("x-request-private"), null);
    assert.equal(delegatedHeaders?.get("x-end-to-end"), "preserved");
    assert.equal(result.headers["x-response-private"], undefined);
    assert.notEqual(result.headers["keep-alive"], "timeout=999");
    assert.equal(result.headers["x-runtime"], "preserved");
    assert.deepEqual(result.headers["set-cookie"], [
      "first=one; Path=/; HttpOnly",
      "second=two; Path=/; SameSite=Strict",
    ]);
    assert.equal(
      result.rawHeaders.filter((value) => value.toLowerCase() === "set-cookie").length,
      2,
    );
  } finally {
    await closeServer(server);
  }
});

test("flushes SSE headers before a delayed first body chunk and preserves streaming order", async () => {
  let releaseBody!: () => void;
  const bodyReleased = new Promise<void>((resolve) => (releaseBody = resolve));
  const { server, port } = await startCarrier(
    () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            await bodyReleased;
            controller.enqueue(Buffer.from("data: first\n\n"));
            controller.enqueue(Buffer.from("data: second\n\n"));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  );

  try {
    let headersResolve!: (response: IncomingMessage) => void;
    const headers = new Promise<IncomingMessage>((resolve) => (headersResolve = resolve));
    const request = httpRequest({ hostname: "127.0.0.1", port, path: "/api/events" }, (response) =>
      headersResolve(response),
    );
    request.end();
    const response = await headers;
    assert.equal(response.headers["content-type"], "text/event-stream");
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    releaseBody();
    await once(response, "end");
    assert.equal(Buffer.concat(chunks).toString(), "data: first\n\ndata: second\n\n");
  } finally {
    await closeServer(server);
  }
});

test("honors response backpressure instead of draining an entire Fetch body into memory", async () => {
  const totalChunks = 512;
  const chunkBytes = 64 * 1024;
  let producedChunks = 0;
  const { server, port } = await startCarrier(
    () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            producedChunks += 1;
            controller.enqueue(new Uint8Array(chunkBytes));
            if (producedChunks === totalChunks) controller.close();
          },
        }),
      ),
  );

  try {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = httpRequest(
        { hostname: "127.0.0.1", port, path: "/api/large-stream" },
        resolve,
      );
      request.on("error", reject);
      request.end();
    });
    response.pause();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    assert.equal(
      producedChunks < totalChunks,
      true,
      "producer must stop pulling while the client-side socket is paused",
    );

    let receivedBytes = 0;
    response.on("data", (chunk: Buffer) => (receivedBytes += chunk.length));
    const ended = once(response, "end");
    response.resume();
    await ended;
    assert.equal(receivedBytes, totalChunks * chunkBytes);
    assert.equal(producedChunks, totalChunks);
  } finally {
    await closeServer(server);
  }
});

test("suppresses bodies for HEAD, 204, and 304 responses and cancels an unused HEAD stream", async () => {
  let headCancelled = 0;
  const { server, origin } = await startCarrier((request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/head") {
      return new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(Buffer.from("must-not-be-sent"));
          },
          cancel() {
            headCancelled += 1;
          },
        }),
        { headers: { "Content-Length": "16" } },
      );
    }
    return new Response(null, { status: pathname === "/empty" ? 204 : 304 });
  });

  try {
    const head = await fetch(`${origin}/head`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "16");
    assert.equal(await head.text(), "");
    assert.equal(headCancelled, 1);

    for (const path of ["/empty", "/not-modified"]) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(await response.text(), "");
    }
  } finally {
    await closeServer(server);
  }
});

test("propagates client disconnects to the Fetch Request signal", async () => {
  let startedResolve!: () => void;
  let abortedResolve!: () => void;
  const started = new Promise<void>((resolve) => (startedResolve = resolve));
  const aborted = new Promise<void>((resolve) => (abortedResolve = resolve));
  const { server, port } = await startCarrier(
    (request) =>
      new Promise<Response>((_resolve, reject) => {
        startedResolve();
        request.signal.addEventListener(
          "abort",
          () => {
            abortedResolve();
            reject(request.signal.reason);
          },
          { once: true },
        );
      }),
  );

  try {
    const request = httpRequest({ hostname: "127.0.0.1", port, path: "/api/wait" });
    request.on("error", () => undefined);
    request.end();
    await started;
    request.destroy();
    await aborted;
  } finally {
    await closeServer(server);
  }
});

test("rejects absolute request-targets that escape the injected trusted origin", async () => {
  let delegated = 0;
  const { server, port } = await startCarrier(() => {
    delegated += 1;
    return new Response("unexpected");
  });
  try {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = httpRequest(
        { hostname: "127.0.0.1", port, path: "http://attacker.test/api/identity" },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.on("end", () =>
            resolve({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
          );
        },
      );
      request.on("error", reject);
      request.end();
    });
    assert.deepEqual(response, { status: 400, body: "Bad Request" });
    assert.equal(delegated, 0);
  } finally {
    await closeServer(server);
  }
});

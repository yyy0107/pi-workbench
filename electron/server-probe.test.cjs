const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const {
  DEFAULT_MAX_RESPONSE_BYTES,
  isWorkbenchServer,
  waitForWorkbenchServer,
} = require("./server-probe.cjs");

async function fixture(t, handler) {
  const server = http.createServer(handler);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

function validResponse() {
  return JSON.stringify({
    type: "server-response",
    rpcId: "electron-workbench-probe",
    result: { ok: true, value: { product: "pi-workbench" } },
  });
}

test("recognizes only the typed Workbench host identity response", async (t) => {
  let requestBody = "";
  const url = await fixture(t, (request, response) => {
    request.setEncoding("utf8");
    request.on("data", (chunk) => (requestBody += chunk));
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(validResponse());
    });
  });

  assert.equal(await isWorkbenchServer(url), true);
  assert.deepEqual(JSON.parse(requestBody), {
    type: "client-request",
    rpcId: "electron-workbench-probe",
    method: "host.describe",
    payload: {},
  });
});

test("rejects incorrect status, content type, and product", async (t) => {
  const cases = [
    { status: 503, contentType: "application/json", body: validResponse() },
    { status: 200, contentType: "text/html", body: validResponse() },
    {
      status: 200,
      contentType: "application/json",
      body: validResponse().replace("pi-workbench", "another-product"),
    },
  ];
  let index = 0;
  const url = await fixture(t, (_request, response) => {
    const current = cases[index++];
    response.writeHead(current.status, { "content-type": current.contentType });
    response.end(current.body);
  });

  for (const _case of cases) assert.equal(await isWorkbenchServer(url), false);
});

test("cuts off an oversized response immediately", async (t) => {
  const url = await fixture(t, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(Buffer.alloc(DEFAULT_MAX_RESPONSE_BYTES + 1, 0x20));
  });

  assert.equal(await isWorkbenchServer(url, { timeoutMs: 500 }), false);
});

test("uses an absolute deadline even while a response remains active", async (t) => {
  const url = await fixture(t, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write("{");
    const heartbeat = setInterval(() => response.write(" "), 5);
    response.once("close", () => clearInterval(heartbeat));
  });
  const startedAt = Date.now();

  assert.equal(await isWorkbenchServer(url, { timeoutMs: 50 }), false);
  assert.ok(Date.now() - startedAt < 500);
});

test("readiness ignores another HTTP server until the typed Workbench identity appears", async (t) => {
  let serveWorkbenchIdentity = false;
  let requestCount = 0;
  const url = await fixture(t, (request, response) => {
    request.resume();
    requestCount += 1;
    if (!serveWorkbenchIdentity) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<title>Another local application</title>");
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(validResponse());
  });
  let settled = false;
  const readiness = waitForWorkbenchServer(url, {
    timeoutMs: 500,
    intervalMs: 10,
    probeTimeoutMs: 50,
  }).then((ready) => {
    settled = true;
    return ready;
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(settled, false);
  serveWorkbenchIdentity = true;

  assert.equal(await readiness, true);
  assert.ok(requestCount >= 2);
});

test("readiness reaches its absolute deadline while a non-Workbench server stays online", async (t) => {
  const url = await fixture(t, (request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<title>Another local application</title>");
  });
  const startedAt = Date.now();

  assert.equal(
    await waitForWorkbenchServer(url, {
      timeoutMs: 50,
      intervalMs: 10,
      probeTimeoutMs: 25,
    }),
    false,
  );
  assert.ok(Date.now() - startedAt < 500);
});

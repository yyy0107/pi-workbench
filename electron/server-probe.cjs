const http = require("node:http");

const DEFAULT_PROBE_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_READINESS_INTERVAL_MS = 250;
const WORKBENCH_PRODUCT = "pi-workbench";

function isJsonResponse(response) {
  const header = response.headers["content-type"];
  const contentType = Array.isArray(header) ? header.join(";") : header;
  return typeof contentType === "string" && /^application\/json(?:\s*;|$)/iu.test(contentType);
}

function isWorkbenchServer(
  url,
  { timeoutMs = DEFAULT_PROBE_TIMEOUT_MS, maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES } = {},
) {
  return new Promise((resolve) => {
    const rpcId = "electron-workbench-probe";
    const body = JSON.stringify({
      type: "client-request",
      rpcId,
      method: "host.describe",
      payload: {},
    });
    let request;
    let response;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      response?.destroy();
      request?.destroy();
      resolve(result);
    };
    const deadline = setTimeout(() => finish(false), timeoutMs);
    deadline.unref?.();

    request = http.request(
      new URL("/api/host.describe", url),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (incoming) => {
        response = incoming;
        if (incoming.statusCode !== 200 || !isJsonResponse(incoming)) {
          finish(false);
          return;
        }

        const chunks = [];
        let responseBytes = 0;
        incoming.on("data", (chunk) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          responseBytes += buffer.byteLength;
          if (responseBytes > maxResponseBytes) {
            finish(false);
            return;
          }
          chunks.push(buffer);
        });
        incoming.once("end", () => {
          if (settled) return;
          try {
            const payload = JSON.parse(Buffer.concat(chunks, responseBytes).toString("utf8"));
            finish(
              payload?.type === "server-response" &&
                payload.rpcId === rpcId &&
                payload.result?.ok === true &&
                payload.result.value?.product === WORKBENCH_PRODUCT,
            );
          } catch {
            finish(false);
          }
        });
        incoming.once("aborted", () => finish(false));
        incoming.once("error", () => finish(false));
      },
    );
    request.once("error", () => finish(false));
    request.end(body);
  });
}

async function waitForWorkbenchServer(
  url,
  {
    timeoutMs,
    intervalMs = DEFAULT_READINESS_INTERVAL_MS,
    probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    beforeAttempt,
  },
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    beforeAttempt?.();
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    if (
      await isWorkbenchServer(url, {
        timeoutMs: Math.min(probeTimeoutMs, remainingMs),
      })
    ) {
      return true;
    }

    const delayMs = Math.min(intervalMs, deadline - Date.now());
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_READINESS_INTERVAL_MS,
  isWorkbenchServer,
  waitForWorkbenchServer,
};

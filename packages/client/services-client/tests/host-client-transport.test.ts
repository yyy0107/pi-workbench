import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeFetch } from "@workbench/runtime-transport-client";
import { createHostClient } from "../src/host";

test("directory picking forwards per-call cancellation through the installed transport", async () => {
  const installedController = new AbortController();
  const requestController = new AbortController();
  const signals: Array<AbortSignal | null | undefined> = [];
  const client = createHostClient({
    signal: installedController.signal,
    transport: createRuntimeFetch(
      { kind: "same-origin", protocolVersion: 1, httpOrigin: "https://runtime.example" },
      async (url, init) => {
        assert.equal(url.href, "https://runtime.example/api/host.pickDirectory");
        signals.push(init?.signal);
        if (init?.signal === requestController.signal) {
          return new Promise<Response>((_, reject) => {
            init.signal!.addEventListener("abort", () => reject(init.signal!.reason), {
              once: true,
            });
          });
        }
        return Response.json({
          type: "server-response",
          rpcId: JSON.parse(String(init?.body)).rpcId,
          result: { ok: true, value: { path: "/home/project" } },
        });
      },
    ),
  });

  assert.equal(await client.pickDirectory(), "/home/project");
  assert.equal(await client.pickDirectory({ signal: undefined }), "/home/project");
  const pending = client.pickDirectory({ signal: requestController.signal });
  requestController.abort();
  await assert.rejects(pending, { code: "cancelled" });
  assert.deepEqual(signals, [
    installedController.signal,
    installedController.signal,
    requestController.signal,
  ]);
  assert.equal(installedController.signal.aborted, false);
});

test("facade calls without options keep the Host default carrier", async (t) => {
  const { pickHostDirectory } = await import("../src/host");
  t.mock.method(globalThis, "fetch", async (input: string | URL, init?: RequestInit) => {
    assert.equal(String(input), "/api/host.pickDirectory");
    const body = JSON.parse(String(init?.body));
    return Response.json({
      type: "server-response",
      rpcId: body.rpcId,
      result: { ok: true, value: { path: "/default-project" } },
    });
  });
  assert.equal(await pickHostDirectory(), "/default-project");
});

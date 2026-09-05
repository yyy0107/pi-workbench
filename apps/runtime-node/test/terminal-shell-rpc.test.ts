import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createFetchRequestHandler } from "@workbench/host-server/fetch-request-handler";
import { createWorkbenchHttpServer } from "@workbench/host-server/workbench-http-server";
import { defineDesktopSidecarRuntimeAuthPolicy } from "@workbench/host-server/runtime-transport-auth";
import { createTerminalShellRpcHandler } from "../src/terminal-shell-rpc";
import { createInstalledRuntimeService } from "../src/installed-runtime-service";

const body = (shell: unknown) =>
  JSON.stringify({
    type: "client-request",
    rpcId: "shell-test",
    method: "terminal.setDefaultShell",
    payload: { shell },
  });

test("desktop shell RPC validates profiles behind Bearer and loopback checks; Web does not install it", async (t) => {
  const calls: string[] = [];
  const handler = createTerminalShellRpcHandler((shell) => {
    calls.push(shell);
    return { shell };
  });
  const policy = defineDesktopSidecarRuntimeAuthPolicy({
    instanceId: "shell-test",
    accessToken: "test-secret",
    allowedOrigins: ["https://renderer.test"],
  });
  const server = createWorkbenchHttpServer({
    requestHandler: createFetchRequestHandler({
      fetchHandler: handler,
      origin: () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    }),
    webSocketGateway: { handleUpgrade: () => false },
    upgradeRequiredPaths: [],
    desktopSidecarAuth: policy,
  });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/terminal.setDefaultShell`;
  const send = (shell: unknown, authorization?: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: body(shell),
    });
  assert.equal((await send("wsl")).status, 401);
  assert.equal((await send("wsl", "Bearer wrong")).status, 401);
  assert.equal(
    (await (await send("C:\\arbitrary.exe", "Bearer test-secret")).json()).result.ok,
    false,
  );
  assert.deepEqual(calls, []);
  const response = await send("wsl", "Bearer test-secret");
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), {
    type: "server-response",
    rpcId: "shell-test",
    result: { ok: true, value: { shell: "wsl" } },
  });
  const remote = await handler(
    new Request("http://remote.example/api/terminal.setDefaultShell", {
      method: "POST",
      headers: { host: "remote.example", "content-type": "application/json" },
      body: body("powershell"),
    }),
  );
  assert.equal(remote.status, 403);
  assert.deepEqual(calls, ["wsl"]);
  const web = createInstalledRuntimeService();
  t.after(() => web.dispose());
  const unavailable = await web.handleHttpRequest(
    new Request(url, {
      method: "POST",
      headers: { host: new URL(url).host, "content-type": "application/json" },
      body: body("wsl"),
    }),
  );
  assert.equal(unavailable.status, 404);
});

import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { BrowserHistoryEntry, BrowserSessionState } from "@workbench/browser-contracts";
import { BrowserManager } from "../src/index";
import { findBrowserExecutable, type BrowserCdp } from "../src/cdp";

test("conversations share persistent login, site storage and history while tabs stay separate", async (t) => {
  try {
    await findBrowserExecutable();
  } catch {
    t.skip("Chrome is not installed");
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-browser-profile-"));
  const server = createServer((request, response) => {
    if (request.url === "/login")
      response.setHeader(
        "Set-Cookie",
        "login=remembered; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax",
      );
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><title>Shared profile ${request.url}</title>
      <body><p>${request.headers.cookie ?? "anonymous"}</p><script>
        ${request.url === "/login" ? "localStorage.setItem('account', 'remembered'); sessionStorage.setItem('tab', 'first');" : ""}
      </script></body>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  let manager = new BrowserManager({ stateDirectory: directory });
  const engine = () =>
    manager as unknown as {
      browser?: BrowserCdp;
      tabs: Map<string, { cdpSessionId: string }>;
    };
  const stop = async () => {
    const browser = engine().browser;
    const exited = browser?.process ? once(browser.process, "exit") : Promise.resolve();
    manager.dispose();
    await exited;
  };
  const open = async (sessionId: string, projectId: string, route: string) => {
    await manager.handle({ type: "attach", sessionId, projectId, url: origin + route });
    await manager.handle({ type: "snapshot", sessionId });
    return (
      await engine().browser!.send(
        "Runtime.evaluate",
        {
          expression:
            "({login:document.querySelector('p').textContent,account:localStorage.getItem('account'),tab:sessionStorage.getItem('tab')})",
          returnByValue: true,
        },
        engine().tabs.get(sessionId)!.cdpSessionId,
      )
    ).result.value;
  };
  const remembered = { login: "login=remembered", account: "remembered", tab: null };
  try {
    assert.equal((await open("conversation-a", "project-a", "/login")).tab, "first");
    assert.deepEqual(await open("conversation-b", "project-b", "/account"), remembered);
    for (const suffix of ["a", "b"])
      assert.deepEqual(
        (
          (await manager.handle({
            type: "tabs.list",
            projectId: `project-${suffix}`,
          })) as BrowserSessionState[]
        ).map((tab) => tab.id),
        [`conversation-${suffix}`],
      );
    await manager.handle({ type: "close", sessionId: "conversation-a" });
    await stop();
    manager = new BrowserManager({ stateDirectory: directory });
    assert.deepEqual(await manager.handle({ type: "tabs.list", projectId: "project-b" }), []);
    assert.deepEqual(await open("conversation-c", "project-c", "/account"), remembered);
    const history = (await manager.handle({ type: "history.list" })) as BrowserHistoryEntry[];
    assert.ok(history.some((entry) => entry.url === `${origin}/login`));
    assert.ok(history.some((entry) => entry.url === `${origin}/account`));
  } finally {
    await stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

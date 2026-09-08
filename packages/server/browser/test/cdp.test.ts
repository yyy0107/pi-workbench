import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BrowserCdp, findBrowserExecutable } from "../src/cdp";
import { BrowserError } from "../src/errors";

test("CDP errors retain the method, protocol diagnostic, and timeout without closing the pipe", async (t) => {
  let executable: string;
  try {
    executable = await findBrowserExecutable();
  } catch {
    t.skip("Chrome is not installed");
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-browser-cdp-"));
  const browser = new BrowserCdp(executable, directory, () => {});
  try {
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
    await assert.rejects(browser.send("Runtime.evaluate", {}, sessionId), (error: unknown) => {
      assert.ok(error instanceof BrowserError);
      assert.equal(error.code, "browser-operation-failed");
      assert.match(error.message, /CDP Runtime\.evaluate \(-32602\)/);
      assert.match(error.message, /expression/);
      return true;
    });
    await assert.rejects(browser.send("Runtime.missingMethod", {}, sessionId), {
      message: /CDP Runtime\.missingMethod \(-32601\)/,
    });
    await assert.rejects(
      browser.send(
        "Runtime.evaluate",
        { expression: "new Promise(() => {})", awaitPromise: true },
        sessionId,
        20,
      ),
      { message: /CDP Runtime\.evaluate timed out after 20 ms/ },
    );
    const result = await browser.send("Runtime.evaluate", { expression: "1 + 1" }, sessionId);
    assert.equal(result.result.value, 2);
    const cancellation = new AbortController();
    const canceled = assert.rejects(
      browser.send(
        "Runtime.evaluate",
        { expression: "new Promise(() => {})", awaitPromise: true },
        sessionId,
        30_000,
        cancellation.signal,
      ),
      { code: "browser-user-active" },
    );
    cancellation.abort(new BrowserError("browser-user-active"));
    await canceled;
    await assert.rejects(
      browser.send(
        "Runtime.evaluate",
        { expression: "window.shouldNotRun = true" },
        sessionId,
        30_000,
        cancellation.signal,
      ),
      { code: "browser-user-active" },
    );
    assert.equal(
      (
        await browser.send(
          "Runtime.evaluate",
          { expression: "window.shouldNotRun === undefined" },
          sessionId,
        )
      ).result.value,
      true,
    );
    assert.ok(
      new BrowserError("browser-operation-failed", "x".repeat(10_000)).message.length < 2200,
    );
  } finally {
    const exited = once(browser.process, "exit");
    browser.dispose();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserManager } from "../src/index";
import { findBrowserExecutable } from "../src/cdp";
import { normalizeBrowserUrl, BrowserError } from "../src/index";

test("local file navigation requires user permission and rejects remote file hosts", () => {
  const url = "file:///tmp/hello%20world.html";
  assert.equal(normalizeBrowserUrl(url, false, true), url);
  assert.throws(() => normalizeBrowserUrl(url), BrowserError);
  assert.throws(() => normalizeBrowserUrl(url, true), BrowserError);
  for (const invalid of [
    "file://server/share/a.html",
    "javascript:alert(1)",
    "data:text/html,test",
  ]) {
    assert.throws(() => normalizeBrowserUrl(invalid, false, true), BrowserError);
  }
});

test("user opens a local HTML file with relative assets in separate browser sessions", async (t) => {
  try {
    await findBrowserExecutable();
  } catch {
    t.skip("Chrome is not installed");
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-browser-file-"));
  const manager = new BrowserManager({ stateDirectory: path.join(directory, "state") });
  try {
    const file = path.join(directory, "中文 #100%.html");
    await writeFile(
      file,
      '<link rel="stylesheet" href="style.css"><script src="script.js"></script><body>Local file</body>',
    );
    await writeFile(path.join(directory, "style.css"), "body { color: rgb(1, 2, 3); }");
    await writeFile(
      path.join(directory, "script.js"),
      'document.title = "Relative script loaded";',
    );
    const url = pathToFileURL(file).href;
    await manager.handle({ type: "settings.update", patch: { fullCdpAccess: true } });
    for (const sessionId of ["first", "second"]) {
      await manager.handle({ type: "attach", sessionId, projectId: "project", url });
      const result = (await manager.handle({
        type: "cdp",
        sessionId,
        method: "Runtime.evaluate",
        params: {
          expression: `new Promise(resolve => {
            const done = () => resolve([document.title, getComputedStyle(document.body).color]);
            document.readyState === 'complete' ? done() : addEventListener('load', done, { once: true });
          })`,
          awaitPromise: true,
          returnByValue: true,
        },
      })) as { result: { value: string[] } };
      assert.deepEqual(result.result.value, ["Relative script loaded", "rgb(1, 2, 3)"]);
    }
    assert.equal(
      ((await manager.handle({ type: "tabs.list", projectId: "project" })) as unknown[]).length,
      2,
    );
    await assert.rejects(
      manager.handle(
        { type: "attach", sessionId: "agent", projectId: "project", url },
        { source: "agent" },
      ),
      BrowserError,
    );
  } finally {
    await manager.dispose();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

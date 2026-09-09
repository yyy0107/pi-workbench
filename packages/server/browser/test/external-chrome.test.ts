import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { BrowserManager } from "../src/index";
import { connectBrowser, findBrowserExecutable, type BrowserCdp } from "../src/cdp";
import { listBrowserProfiles } from "../src/profiles";

async function eventually<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean = Boolean,
): Promise<T> {
  let error;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const value = await read();
      if (ready(value)) return value;
    } catch (cause) {
      error = cause;
    }
    await delay(50);
  }
  throw error ?? new Error("Chrome did not reach the expected state");
}

test("profiles exclude system and ephemeral accounts and preserve directory identity", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "browser-profile-list-"));
  try {
    await writeFile(
      path.join(directory, "Local State"),
      JSON.stringify({
        profile: {
          last_used: "Profile 1",
          info_cache: {
            Default: { name: "Personal" },
            "Profile 1": { name: "Work" },
            "Guest Profile": { name: "Guest" },
            "../escape": { name: "Invalid" },
            Temporary: { name: "Ephemeral", is_ephemeral: true },
          },
        },
      }),
    );
    const profiles = await listBrowserProfiles(directory);
    assert.deepEqual(
      profiles.map((item) => item.profileDirectory),
      ["Profile 1", "Default"],
    );
    assert.equal(profiles[0]?.id, `${directory}#Profile 1`);
    assert.equal(profiles[0]?.lastUsed, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("external Chrome binds the selected profile, reconnects owned tabs, and survives Workbench disposal", async (t) => {
  let executable;
  try {
    executable = await findBrowserExecutable();
  } catch {
    t.skip("Chrome is not installed");
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "browser-external-"));
  const userDataDirectory = path.join(directory, "chrome");
  await mkdir(path.join(userDataDirectory, "Profile 1"), { recursive: true });
  await writeFile(
    path.join(userDataDirectory, "Local State"),
    JSON.stringify({
      profile: { last_used: "Profile 1", info_cache: { "Profile 1": { name: "Work" } } },
    }),
  );
  // Profile switching is a native Chrome window flow, so use an isolated display on Linux.
  if (process.platform !== "linux") {
    t.skip("This profile integration fixture requires Xvfb");
    await rm(directory, { recursive: true, force: true });
    return;
  }
  const displayServer = spawn("Xvfb", ["-displayfd", "3", "-screen", "0", "1280x900x24"], {
    stdio: ["ignore", "ignore", "ignore", "pipe"],
  });
  try {
    await once(displayServer, "spawn");
  } catch {
    t.skip("Xvfb is not installed");
    await rm(directory, { recursive: true, force: true });
    return;
  }
  const [displayNumber] = await once(displayServer.stdio[3]!, "data");
  const previousDisplay = process.env.DISPLAY;
  process.env.DISPLAY = `:${String(displayNumber).trim()}`;
  t.after(() => {
    if (previousDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = previousDisplay;
    displayServer.kill();
  });
  const chrome = spawn(
    executable,
    [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDirectory}`,
      "--profile-directory=Default",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let inspector: BrowserCdp | undefined;
  let manager: BrowserManager | undefined;
  t.after(async () => {
    manager?.dispose();
    inspector?.dispose();
    const exited = chrome.exitCode === null ? once(chrome, "exit") : Promise.resolve();
    chrome.kill();
    await exited;
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const endpoint = await eventually(async () => {
    const [port, endpoint] = (
      await readFile(path.join(userDataDirectory, "DevToolsActivePort"), "utf8")
    )
      .trim()
      .split(/\r?\n/);
    return `ws://127.0.0.1:${port}${endpoint}`;
  });
  inspector = await connectBrowser(endpoint, () => {});
  const initial = await inspector.send("Target.getTargets");
  const unrelated = initial.targetInfos.find((target: any) => target.type === "page");
  assert.ok(unrelated);
  manager = new BrowserManager({ stateDirectory: path.join(directory, "workbench") });
  await manager.handle({
    type: "settings.update",
    patch: {
      connection: "chrome",
      chromeEndpoint: endpoint,
      chromeUserDataDirectory: userDataDirectory,
      chromeProfile: `${userDataDirectory}#Profile 1`,
      fullCdpAccess: true,
    },
  });
  assert.equal(((await manager.handle({ type: "connection.test" })) as any).connected, true);
  await manager.handle({ type: "attach", sessionId: "owned", projectId: "project" });
  const engine = manager as unknown as {
    browser: BrowserCdp;
    tabs: Map<string, { targetId: string; cdpSessionId: string }>;
  };
  const controlledId = engine.tabs.get("owned")!.targetId;
  const all = (await manager.handle({
    type: "tabs.list",
    projectId: "project",
    scope: "all",
  })) as Array<{ id: string; owned: boolean }>;
  assert.equal(all.find((tab) => tab.id === unrelated.targetId)?.owned, false);
  assert.equal(all.find((tab) => tab.id === "owned")?.owned, true);
  await Promise.all(
    ["parallel-a", "parallel-b"].map((sessionId) =>
      manager!.handle({ type: "attach", sessionId, projectId: "project" }),
    ),
  );
  assert.notEqual(engine.tabs.get("parallel-a")!.targetId, engine.tabs.get("parallel-b")!.targetId);
  await Promise.all(
    ["parallel-a", "parallel-b"].map((sessionId) => manager!.handle({ type: "close", sessionId })),
  );

  await manager.handle({
    type: "cdp",
    sessionId: "owned",
    method: "Page.navigate",
    params: { url: "chrome://version" },
  });
  const profilePath = await eventually(async () => {
    const result = (await manager!.handle({
      type: "cdp",
      sessionId: "owned",
      method: "Runtime.evaluate",
      params: {
        expression: "document.querySelector('#profile_path')?.textContent",
        returnByValue: true,
      },
    })) as any;
    return result.result.value as string;
  });
  assert.equal(profilePath, path.join(userDataDirectory, "Profile 1"));
  const beforeReconnect = (await inspector.send("Target.getTargets")).targetInfos.length;
  engine.browser.dispose();
  await eventually(async () => !engine.tabs.get("owned")!.cdpSessionId);
  await manager.handle({ type: "attach", sessionId: "owned", projectId: "project" });
  assert.equal(engine.tabs.get("owned")!.targetId, controlledId);
  assert.equal((await inspector.send("Target.getTargets")).targetInfos.length, beforeReconnect);
  await manager.handle({ type: "close", sessionId: "owned" });
  assert.ok(
    (await inspector.send("Target.getTargets")).targetInfos.some(
      (target: any) => target.targetId === unrelated.targetId,
    ),
  );
  manager.dispose();
  manager = undefined;
  await eventually(
    async () =>
      (await inspector!.send("Target.getTargets")).targetInfos.filter(
        (target: any) => target.type === "page",
      ),
    (targets) => targets.length === 1,
  );
  assert.ok((await inspector.send("Browser.getVersion")).product);
  assert.equal(chrome.exitCode, null);
});

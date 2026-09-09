import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { BROWSER_TOOL_ACTIONS, type BrowserCommand } from "@workbench/browser-contracts";
import { BrowserManager } from "@workbench/browser-server";
import { createBrowserExtension } from "../index";
import { runBrowserScript } from "../script";

test("all harness tools load with schemas and keep selection, batches, research and local files scoped", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "browser-tools-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tools = new Map<string, ToolDefinition>();
  const events = new Map<string, () => void>();
  const calls: BrowserCommand[] = [];
  const extension = createBrowserExtension(() => ({
    async command(command) {
      calls.push(command);
      if (command.type === "attach" && command.url === "bad://url") throw new Error("Invalid URL");
      if (command.type === "wait-for-load" && command.timeout === 0.01)
        throw new Error("Page still loading");
      if (command.type === "tabs.list") return [];
      if (command.type === "read-page") return { url: command.url, text: "Isolated article" };
      if (command.type === "print")
        return {
          name: "page.pdf",
          mimeType: "application/pdf",
          data: Buffer.from("%PDF-test").toString("base64"),
        };
      if (command.type === "snapshot")
        return {
          session: { url: "https://current.example" },
          nodes: [],
          screenshot: { mimeType: "image/png", data: "cGljdHVyZQ==" },
        };
      return { url: "url" in command ? (command.url ?? "about:blank") : "about:blank" };
    },
  }));
  await extension({
    registerTool(tool) {
      tools.set(tool.name, tool as ToolDefinition);
    },
    on(event, handler) {
      events.set(event, handler as () => void);
    },
  } as ExtensionAPI);
  assert.deepEqual(
    [...tools.keys()].sort(),
    [...Object.keys(BROWSER_TOOL_ACTIONS), "workbench_browser"].sort(),
  );
  const context = {
    cwd: directory,
    sessionManager: { getSessionId: () => "conversation" },
  } as ExtensionContext;
  const execute = async (name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.get(name)!;
    validateToolArguments(tool, { type: "toolCall", id: name, name, arguments: args });
    return tool.execute(name, args, undefined, undefined, context);
  };
  await execute("browser_setup");
  assert.deepEqual(calls.at(-1), {
    type: "attach",
    sessionId: "workbench-conversation",
    projectId: directory,
    threadId: "conversation",
  });
  const opened = await execute("browser_new_tab", { url: "https://example.test" });
  const id = (opened.details as { browserSessionId: string }).browserSessionId;
  assert.notEqual(id, "workbench-conversation");
  await execute("browser_fill", { selector: "input", value: "Hello" });
  assert.equal((calls.at(-1) as { sessionId: string }).sessionId, id);
  assert.equal((calls.at(-1) as { text: string }).text, "Hello");
  await execute("browser_select_option", { ref: "e2", label: "Beta" });
  assert.equal(calls.at(-1)?.type, "select");
  const batch = await execute("browser_open_urls", {
    urls: ["https://one.test", "bad://url", "https://two.test"],
  });
  const batchDetails = batch.details as { browserSessions: Array<{ browserSessionId: string }> };
  assert.equal(batchDetails.browserSessions.length, 2);
  await execute("browser_current_tab");
  assert.equal(
    (calls.at(-1) as { sessionId: string }).sessionId,
    batchDetails.browserSessions[1]?.browserSessionId,
  );
  assert.deepEqual(
    (await execute("browser_read_page", { url: "https://research.test" })).details,
    {},
  );
  assert.deepEqual((await execute("browser_list_tabs")).details, {});
  const snapshot = await execute("browser_snapshot", { includeScreenshot: true });
  assert.equal(snapshot.content.at(-1)?.type, "image");
  const navigationStart = calls.length;
  await execute("browser_navigate", { url: "https://next.example", query: "Login" });
  assert.deepEqual(
    calls.slice(navigationStart).map((call) => call.type),
    ["navigate", "wait-for-load", "snapshot"],
  );
  assert.equal((calls.at(-1) as { query: string }).query, "Login");
  await execute("browser_navigate", { url: "https://next.example", includeSnapshot: false });
  assert.equal(calls.at(-1)?.type, "navigate");
  const pending = await execute("browser_navigate", { url: "https://next.example", timeout: 0.01 });
  assert.ok(
    pending.content.some(
      (part) => part.type === "text" && part.text.includes("Page still loading"),
    ),
  );
  assert.equal(
    (pending.details as { browserSessionId: string }).browserSessionId,
    (snapshot.details as { browserSessionId: string }).browserSessionId,
  );
  await writeFile(path.join(directory, "upload.txt"), "Upload content");
  await execute("browser_upload_file", {
    selector: "input[type=file]",
    filePath: path.join(directory, "upload.txt"),
  });
  const upload = calls.at(-1);
  assert.ok(upload?.type === "upload");
  assert.equal(Buffer.from(upload.files[0]!.data, "base64").toString(), "Upload content");
  await execute("browser_print_to_pdf", { outputPath: "output.pdf" });
  assert.equal(await readFile(path.join(directory, "output.pdf"), "utf8"), "%PDF-test");
  await assert.rejects(execute("browser_print_to_pdf", { path: "output.pdf" }), /EEXIST/);
  await execute("browser_download", { downloadPath: directory });
  assert.equal((calls.at(-1) as { directory: string }).directory, directory);
  await execute("browser_scroll");
  assert.equal((calls.at(-1) as { deltaY: number }).deltaY, 300);
  await execute("browser_list_tabs", { scope: "all", includeInternal: false });
  assert.equal((calls.at(-1) as { scope: string }).scope, "all");
  events.get("session_shutdown")!();
  await execute("browser_setup");
  assert.equal((calls.at(-1) as { sessionId: string }).sessionId, "workbench-conversation");
  const server = createServer((_request, response) => response.end("x".repeat(70000)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const result = await execute("browser_http_get", { url: `http://127.0.0.1:${address.port}` });
  assert.ok(result.content[0]?.type === "text");
  const http = JSON.parse(result.content[0].text);
  assert.equal(http.body.length, 65536);
  assert.equal(http.truncated, true);
});

test("browser tools enforce conversation ownership across lists, explicit IDs, popups and session switches", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "browser-ownership-"));
  const browser = new BrowserManager({ stateDirectory: directory });
  t.after(async () => {
    browser.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  const engine = browser as unknown as {
    connectTab(tab: {
      state: { id: string };
      targetId: string;
      cdpSessionId: string;
    }): Promise<void>;
    send(): Promise<object>;
    onEvent(event: object): Promise<void>;
  };
  t.mock.method(engine, "connectTab", async (tab: Parameters<typeof engine.connectTab>[0]) => {
    tab.targetId ||= `target-${tab.state.id}`;
    tab.cdpSessionId = `cdp-${tab.state.id}`;
  });
  t.mock.method(engine, "send", async () => ({}));
  const tools = new Map<string, ToolDefinition>();
  await createBrowserExtension(() => ({
    command: (command, signal, controlSignal) =>
      browser.handle(command, { source: "agent", signal, controlSignal }),
  }))({
    on() {},
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool as ToolDefinition);
    },
  } as unknown as ExtensionAPI);
  const execute = async (threadId: string, name: string, args: Record<string, unknown> = {}) => {
    const result = await tools.get(name)!.execute(name, args, undefined, undefined, {
      cwd: directory,
      sessionManager: { getSessionId: () => threadId },
    } as ExtensionContext);
    const content = result.content.find((part) => part.type === "text");
    assert.ok(content?.type === "text");
    return JSON.parse(content.text);
  };
  const first = await execute("first", "browser_new_tab");
  const second = await execute("second", "browser_new_tab");
  assert.equal((await execute("first", "browser_current_tab")).id, first.id);
  assert.equal((await execute("second", "browser_current_tab")).id, second.id);
  for (const [id, threadId] of [
    ["manual", "draft"],
    ["outside", undefined],
  ] as const)
    await browser.handle({ type: "attach", sessionId: id, projectId: directory, threadId });
  const promote = {
    type: "attach",
    sessionId: "manual",
    projectId: directory,
    threadId: "first",
  } as const;
  await assert.rejects(browser.handle(promote, { source: "agent" }), {
    code: "browser-permission-denied",
  });
  await browser.handle(promote);
  await engine.onEvent({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "cdp-popup",
      targetInfo: {
        type: "page",
        targetId: "popup-target",
        openerId: `target-${first.id}`,
        url: "about:blank",
      },
    },
  });
  const tabs = await execute("first", "browser_list_tabs");
  assert.equal(tabs.length, 3);
  assert.ok(tabs.every((tab: { threadId: string }) => tab.threadId === "first"));
  assert.ok(tabs.some((tab: { id: string }) => tab.id === "manual"));
  assert.deepEqual(await execute("first", "browser_list_tabs", { scope: "all" }), tabs);
  assert.deepEqual(
    await execute("first", "workbench_browser", {
      action: "tabs.list",
      params: { scope: "all", threadId: "second", projectId: "/other" },
    }),
    tabs,
  );
  assert.deepEqual(
    (await execute("second", "browser_list_tabs")).map((tab: { id: string }) => tab.id),
    [second.id],
  );
  assert.deepEqual(
    await browser.handle(
      { type: "tabs.list", projectId: directory, scope: "all" },
      { source: "agent" },
    ),
    [],
  );
  for (const name of ["browser_snapshot", "browser_switch_tab", "browser_close_tab"])
    for (const id of [second.id, "outside"])
      await assert.rejects(execute("first", name, { targetId: id }), {
        code: "browser-permission-denied",
      });
  await assert.rejects(
    execute("first", "workbench_browser", {
      action: "attach",
      sessionId: second.id,
      params: { threadId: "second" },
    }),
    { code: "browser-permission-denied" },
  );
  assert.equal((await execute("second", "browser_current_tab")).id, second.id);
  await browser.handle({ type: "settings.update", patch: { fullCdpAccess: true } });
  for (const method of ["Target.getTargets", "Target.attachToTarget", "Browser.close"])
    await assert.rejects(
      execute("first", "workbench_browser", {
        action: "cdp",
        sessionId: first.id,
        params: { method },
      }),
      { code: "browser-permission-denied" },
    );
  await execute("first", "browser_switch_tab", { targetId: "manual" });
  await execute("first", "browser_close_tab");
  assert.equal((await execute("first", "browser_current_tab")).id, "workbench-first");
  assert.equal((await execute("second", "browser_current_tab")).id, second.id);
});

test("browser scripts proxy CDP and enforce a hard timeout and serializable text results", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "browser-scripts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "script.js");
  const context = { cwd: directory } as ExtensionContext;
  const calls: string[] = [];
  const run = (timeoutMs = 1000) =>
    runBrowserScript(
      { path: filename, params: { name: "Alice" }, timeoutMs },
      context,
      undefined,
      async (method) => {
        calls.push(method);
        return { title: "Live title" };
      },
      undefined,
    );
  await writeFile(
    filename,
    "const result = await daemon.session().call('Page.getInfo'); return { content: [{type:'text',text:params.name + ': ' + result.data.title}], details: {cwd:ctx.cwd} };",
  );
  const result = await run();
  assert.deepEqual(calls, ["Page.getInfo"]);
  assert.deepEqual(result.content, [{ type: "text", text: "Alice: Live title" }]);
  await writeFile(filename, "while(true) {}");
  const started = Date.now();
  await assert.rejects(run(100), /timed out/);
  assert.ok(Date.now() - started < 1500, "A synchronous loop must not block the host");
  await writeFile(
    filename,
    "const value={content:[{type:'text',text:'cyclic'}]};value.details=value;return value;",
  );
  await assert.rejects(run(), /circular/i);
  await assert.rejects(
    runBrowserScript({ path: "relative.js" }, context, undefined, async () => ({}), undefined),
    /absolute/,
  );
});

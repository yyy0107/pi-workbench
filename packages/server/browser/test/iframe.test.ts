import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import type { BrowserEvent, BrowserSnapshot } from "@workbench/browser-contracts";

import { BrowserError, BrowserManager } from "../src/index";
import { findBrowserExecutable, type BrowserCdp } from "../src/cdp";

async function eventually<T>(read: () => T | Promise<T>, ready: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const value = await read();
      if (ready(value)) return value;
    } catch (error) {
      if (
        !(error instanceof BrowserError) ||
        !["browser-element-stale", "browser-page-loading"].includes(error.code)
      )
        throw error;
    }
    await setTimeout(30);
  }
  throw new Error("The frame fixture did not reach the expected state.");
}

test("real Chrome observes and safely operates same-origin frame references", async (t) => {
  try {
    await findBrowserExecutable();
  } catch {
    t.skip("Chrome is not installed");
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-browser-iframe-"));
  const frame = `<!doctype html><title>Frame form</title>
    <style>body{margin:16px}input,button{display:block;margin:12px 0;padding:10px}#spacer{height:700px}</style>
    <div id="spacer">Frame spacer</div>
    <label>Frame name<input id="name" value="old"></label>
    <label>Frame password<input type="password" value="frame-private-secret"></label>
    <button id="save" onclick="document.querySelector('#result').textContent=document.querySelector('#name').value;window.trustedClick=event.isTrusted">Save frame name</button>
    <p id="result" role="status">Not saved</p>`;
  const other = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(frame.replaceAll("Frame name", "Cross-origin name"));
  });
  await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
  const otherAddress = other.address();
  assert.ok(otherAddress && typeof otherAddress === "object");
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    if (request.url?.startsWith("/frame")) {
      response.end(frame);
      return;
    }
    response.end(`<!doctype html><title>Frame fixture</title>
      <style>body{margin:0}#spacer{height:650px}iframe{display:block;margin:0 0 20px 80px;width:500px;height:300px;border:6px solid black}#overlay{display:none;position:fixed;inset:0;background:gray;z-index:99}</style>
      <div id="spacer">Root spacer</div>
      <iframe id="contentFrame" title="Same-origin form" src="/frame"></iframe>
      <iframe title="Cross-origin form" src="http://127.0.0.1:${otherAddress.port}/frame"></iframe>
      <iframe title="Sandbox form" sandbox="allow-scripts" src="/frame"></iframe>
      <div id="overlay">Parent overlay</div>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/`;
  const browser = new BrowserManager({ stateDirectory: directory });
  const control = new AbortController();
  const agent = { source: "agent" as const, controlSignal: control.signal };
  const cursors: Extract<BrowserEvent, { type: "cursor" }>[] = [];
  browser.subscribe((event) => {
    if (event.type === "cursor") cursors.push(event);
  });
  const engine = browser as unknown as {
    browser: BrowserCdp;
    tabs: Map<string, { cdpSessionId: string; snapshot?: unknown }>;
  };
  const evaluate = async (expression: string) => {
    const result = await engine.browser.send(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      engine.tabs.get("frames")!.cdpSessionId,
    );
    assert.equal(result.exceptionDetails, undefined);
    return result.result.value;
  };
  const observe = () =>
    browser.handle({ type: "snapshot", sessionId: "frames" }, agent) as Promise<BrowserSnapshot>;
  const observedForm = () =>
    eventually(observe, (snapshot) =>
      snapshot.nodes.some((node) => node.name === "Frame name" && !!node.ref),
    );
  const ref = (snapshot: BrowserSnapshot, name: string) => {
    const value = snapshot.nodes.find((node) => node.name === name && node.ref)?.ref;
    assert.ok(value, "Missing observed frame reference: " + name);
    return value;
  };
  const point = (selector: string) =>
    evaluate(`(() => {
      const owner = document.querySelector('#contentFrame');
      const outer = owner.getBoundingClientRect();
      const inner = owner.contentDocument.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x: outer.left + owner.clientLeft + inner.left + inner.width / 2,
        y: outer.top + owner.clientTop + inner.top + inner.height / 2};
    })()`);
  const cursorAt = (position: { x: number; y: number }) => {
    const cursor = cursors.at(-1)?.cursor;
    assert.ok(cursor);
    assert.ok(Math.abs(cursor.x - position.x) < 1, `Cursor x ${cursor.x} != ${position.x}`);
    assert.ok(Math.abs(cursor.y - position.y) < 1, `Cursor y ${cursor.y} != ${position.y}`);
  };
  const oldRefFails = (reference: string) =>
    assert.rejects(browser.handle({ type: "click", sessionId: "frames", ref: reference }, agent), {
      code: "browser-element-stale",
    });
  try {
    await browser.handle({
      type: "settings.update",
      patch: {
        permissions: { history: "allow", download: "deny", upload: "deny" },
      },
    });
    await browser.handle({ type: "attach", sessionId: "frames", projectId: "project", url }, agent);
    await browser.handle({
      type: "viewport",
      sessionId: "frames",
      width: 800,
      height: 600,
      visible: true,
    });
    let snapshot = await observedForm();
    assert.equal(
      snapshot.nodes.find((node) => node.name === "Same-origin form")?.unavailable,
      undefined,
    );
    for (const name of ["Cross-origin form", "Sandbox form"]) {
      const frameNode = snapshot.nodes.find((node) => node.name === name);
      assert.equal(frameNode?.unavailable, "frame");
      assert.equal(frameNode.ref, undefined);
    }
    assert.ok(!snapshot.nodes.some((node) => node.name === "Cross-origin name"));
    assert.ok(!JSON.stringify(snapshot).includes("frame-private-secret"));
    assert.equal(snapshot.nodes.filter((node) => node.name === "Frame name" && node.ref).length, 1);

    await browser.handle(
      {
        type: "fill",
        sessionId: "frames",
        ref: ref(snapshot, "Frame name"),
        text: "Saved inside frame",
      },
      agent,
    );
    cursorAt(await point("#name"));
    const scroll = await evaluate(
      "({root:scrollY,frame:document.querySelector('#contentFrame').contentWindow.scrollY})",
    );
    assert.ok(
      scroll.root > 0 && scroll.frame > 0,
      "Both the root document and the child frame scroll",
    );
    await browser.handle(
      { type: "click", sessionId: "frames", ref: ref(snapshot, "Save frame name") },
      agent,
    );
    cursorAt(await point("#save"));
    assert.equal(
      await evaluate("document.querySelector('#contentFrame').contentWindow.trustedClick"),
      true,
    );
    snapshot = await observedForm();
    assert.ok(snapshot.nodes.some((node) => node.name === "Saved inside frame"));

    const button = ref(snapshot, "Save frame name");
    await evaluate("document.querySelector('#overlay').style.display='block'");
    await assert.rejects(
      browser.handle({ type: "click", sessionId: "frames", ref: button }, agent),
      { code: "browser-element-not-interactable" },
    );
    await evaluate("document.querySelector('#overlay').style.display='none'");

    await evaluate("document.querySelector('#contentFrame').contentWindow.location.hash='changed'");
    await eventually(
      () => engine.tabs.get("frames")?.snapshot,
      (value) => value === undefined,
    );
    await oldRefFails(button);
    snapshot = await observedForm();
    assert.equal(snapshot.session.url, url, "Child routes do not change the tab URL");
    const beforeNavigation = ref(snapshot, "Save frame name");
    await evaluate("document.querySelector('#contentFrame').src='/frame?next'");
    await eventually(
      () => engine.tabs.get("frames")?.snapshot,
      (value) => value === undefined,
    );
    await oldRefFails(beforeNavigation);
    snapshot = await observedForm();
    const beforeRemoval = ref(snapshot, "Save frame name");
    await evaluate("document.querySelector('#contentFrame').remove()");
    await eventually(
      () => engine.tabs.get("frames")?.snapshot,
      (value) => value === undefined,
    );
    await oldRefFails(beforeRemoval);
  } finally {
    control.abort();
    browser.dispose();
    for (const fixture of [server, other]) {
      fixture.closeAllConnections();
      await new Promise<void>((resolve) => fixture.close(() => resolve()));
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

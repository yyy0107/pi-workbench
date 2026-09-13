import assert from "node:assert/strict";
import test from "node:test";
import { parseBrowserCommand } from "../src/index";

test("browser observation commands validate their project and observed references", () => {
  assert.equal(parseBrowserCommand({ type: "tabs.list" }), undefined);
  assert.equal(parseBrowserCommand({ type: "tabs.list", projectId: "" }), undefined);
  assert.equal(parseBrowserCommand({ type: "click", sessionId: "tab", ref: "" }), undefined);
  assert.equal(
    parseBrowserCommand({ type: "fill", sessionId: "tab", ref: "ref", text: 123 }),
    undefined,
  );
  assert.ok(parseBrowserCommand({ type: "tabs.list", projectId: "project" }));
  assert.ok(parseBrowserCommand({ type: "fill", sessionId: "tab", ref: "ref", text: "" }));
  for (const allow of [false, true])
    assert.ok(parseBrowserCommand({ type: "permission.respond", requestId: "id", allow }));
  assert.equal(
    parseBrowserCommand({ type: "permission.respond", requestId: "id", allow: "true" }),
    undefined,
  );
  for (const patch of [
    { permissions: { navigate: "allow" } },
    { sites: [{ origin: "https://example.com", permissions: { navigate: "deny" } }] },
  ])
    assert.equal(parseBrowserCommand({ type: "settings.update", patch }), undefined);
});

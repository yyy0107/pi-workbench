import assert from "node:assert/strict";
import test from "node:test";

import { conversationIdFromWorkbenchPathname } from "@/workbench/providers/workbench-routes";

test("decodes only the app-owned canonical conversation route", () => {
  assert.equal(conversationIdFromWorkbenchPathname("/"), undefined);
  assert.equal(conversationIdFromWorkbenchPathname("/c/thread-1"), "thread-1");
  assert.equal(conversationIdFromWorkbenchPathname("/c/a%2Fb"), "a/b");
  assert.equal(conversationIdFromWorkbenchPathname("/c/thread-1/"), "thread-1");
  assert.equal(conversationIdFromWorkbenchPathname("/c/thread-1/extra"), undefined);
  assert.equal(conversationIdFromWorkbenchPathname("/c/%"), undefined);
});

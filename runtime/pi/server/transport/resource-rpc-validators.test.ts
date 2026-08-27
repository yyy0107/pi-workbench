import assert from "node:assert/strict";
import test from "node:test";

import type { SkillDescribePayload } from "@/runtime/pi/contracts/rpc";
import {
  resourceListPayload,
  resourceNameValidator,
  resourceRelativeDirectoryPathValidator,
  resourceRelativeFilePathValidator,
  resourceRequestPayload,
} from "./resource-rpc-validators";

test("accepts exactly one Session or resource-catalog identity", () => {
  for (const [input, expected] of [
    [{ sessionId: "session-1", ignored: true }, { sessionId: "session-1" }],
    [{ target: { scope: "user" }, ignored: true }, { target: { scope: "user" } }],
    [
      { target: { scope: "project", workspaceId: "workspace-1" }, ignored: true },
      { target: { scope: "project", workspaceId: "workspace-1" } },
    ],
  ] as const) {
    const result = resourceListPayload(input, ["payload"]);
    assert.equal(result.ok, true);
    if (!result.ok) assert.fail("Expected a valid resource identity.");
    assert.deepEqual(result.value, expected);
  }

  for (const input of [
    {},
    { sessionId: "" },
    { target: { scope: "project", workspaceId: "" } },
    { sessionId: "session-1", target: { scope: "user" } },
  ]) {
    const result = resourceListPayload(input, ["payload"]);
    assert.equal(result.ok, false);
  }
});

test("composes domain fields while retaining resource identity sanitization", () => {
  const payload = resourceRequestPayload<SkillDescribePayload>({
    name: resourceNameValidator,
  });
  const result = payload(
    {
      target: { scope: "user", ignored: true },
      name: "  review  ",
      ignored: true,
    },
    ["payload"],
  );

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail("Expected a valid named resource request.");
  assert.deepEqual(result.value, {
    target: { scope: "user" },
    name: "review",
  });
});

test("shares bounded directory and file relative-path semantics", () => {
  assert.deepEqual(resourceRelativeDirectoryPathValidator(""), { ok: true, value: "" });
  assert.equal(resourceRelativeFilePathValidator("").ok, false);
  assert.deepEqual(resourceRelativeFilePathValidator("references/guide.md"), {
    ok: true,
    value: "references/guide.md",
  });

  const oversized = "x".repeat(16_385);
  assert.equal(resourceRelativeDirectoryPathValidator(oversized).ok, false);
  assert.equal(resourceRelativeFilePathValidator(oversized).ok, false);
});

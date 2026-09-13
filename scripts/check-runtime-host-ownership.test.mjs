import assert from "node:assert/strict";
import test from "node:test";

import {
  INSTALLED_PI_COMPOSITION_OWNER,
  runtimeBoundaryViolations,
} from "./check-runtime-host-ownership.mjs";

test("guards the remaining literal Runtime boundaries", () => {
  const violations = runtimeBoundaryViolations(
    new Map([
      [INSTALLED_PI_COMPOSITION_OWNER, "createPiRuntimeHttpRouter(); createPiRuntimeHttpRouter();"],
      [
        "apps/web/src/unsafe.ts",
        [
          "createPiAgentServerImplementation();",
          "new WebSocket('/runtime');",
          "window.location.origin;",
          "require(runtimeModule);",
        ].join("\n"),
      ],
    ]),
  );

  assert.equal(violations.length, 5, JSON.stringify(violations, null, 2));
  for (const expected of [
    "at most once",
    "only apps/runtime-node/src/composition/installed-pi-server.ts",
    "non-literal module reference",
    "RuntimeConnection instead of WebSocket",
    "RuntimeConnection instead of location.origin",
  ]) {
    assert.ok(violations.some((violation) => violation.includes(expected)));
  }
});

test("native sockets belong only to the Runtime transport owner in client", () => {
  const owner = "packages/transport/runtime-transport-client/src/runtime-websocket.ts";
  const consumer = "packages/client/shell/src/connection.ts";
  const violations = runtimeBoundaryViolations(
    new Map([
      [owner, "new globalThis.WebSocket(url);"],
      [consumer, "new globalThis.WebSocket(url);"],
    ]),
  );
  assert.deepEqual(violations, [
    `${consumer}: use the installed RuntimeConnection instead of WebSocket`,
  ]);
});

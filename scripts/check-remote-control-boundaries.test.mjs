import assert from "node:assert/strict";
import test from "node:test";

import { remoteControlBoundaryViolations } from "./check-remote-control-boundaries.mjs";

test("rejects forbidden package dependencies at each remote trust boundary", () => {
  const violations = remoteControlBoundaryViolations({
    manifests: new Map([
      [
        "apps/mobile/package.json",
        {
          dependencies: {
            "@workbench/ui-tool": "workspace:*",
            "expo-auth-session": "~57.0.0",
          },
        },
      ],
      [
        "packages/contracts/remote-control-contracts/package.json",
        { dependencies: { react: "19.2.3" } },
      ],
      [
        "packages/transport/remote-control-client/package.json",
        { dependencies: { "expo-secure-store": "~57.0.0" } },
      ],
      [
        "packages/pi-runtime/pi-runtime-remote-control/package.json",
        { dependencies: { "@workbench/pi-runtime-server": "workspace:*" } },
      ],
      [
        "packages/server/remote-control-direct-server/package.json",
        { dependencies: { pg: "^8.0.0", "@workbench/pi-rpc-client": "workspace:*" } },
      ],
    ]),
  });

  assert.equal(violations.length, 7, JSON.stringify(violations, null, 2));
});

test("rejects forbidden source imports and catch-all wire contracts", () => {
  const violations = remoteControlBoundaryViolations({
    sources: new Map([
      ["apps/mobile/src/bad.ts", 'import "@workbench/shell";'],
      ["apps/mobile/src/auth.ts", 'import "expo-auth-session";'],
      [
        "packages/contracts/remote-control-contracts/src/bad.ts",
        'import "node:fs"; export interface Request { method: string; payload?: unknown }',
      ],
      [
        "packages/pi-runtime/pi-runtime-remote-control/src/bad.ts",
        'import "../pi-runtime-server/src/streams/stream-hub";',
      ],
      ["apps/mobile/src/deep.ts", 'import "@workbench/remote-control-client/src/client";'],
      [
        "packages/server/remote-control-direct-server/src/bad.ts",
        'import "@workbench/remote-control-relay-server"; const relayOrigin = "https://relay.test";',
      ],
      [
        "packages/server/remote-control-direct-server/src/bad-public.ts",
        'export const endpoint = "ws://8.8.8.8:8787/remote/v1/direct";',
      ],
      [
        "packages/transport/remote-control-client/src/profiles.ts",
        "export interface Profile { accountId: string; accessToken: string }",
      ],
    ]),
  });

  assert.equal(violations.length, 10, JSON.stringify(violations, null, 2));
  assert.ok(violations.some((item) => item.includes("catch-all method/payload")));
  assert.ok(violations.some((item) => item.includes("forbidden deep import")));
  assert.ok(violations.some((item) => item.includes("forbidden direct-gateway import")));
  assert.ok(violations.some((item) => item.includes("public endpoint literal")));
  assert.ok(violations.some((item) => item.includes("bearer credential")));
});

test("rejects cycles among remote production packages", () => {
  const violations = remoteControlBoundaryViolations({
    manifests: new Map([
      [
        "packages/a/package.json",
        { name: "@workbench/remote-a", dependencies: { "@workbench/remote-b": "workspace:*" } },
      ],
      [
        "packages/b/package.json",
        { name: "@workbench/remote-b", dependencies: { "@workbench/remote-a": "workspace:*" } },
      ],
    ]),
  });
  assert.deepEqual(violations, [
    "remote package dependency cycle: @workbench/remote-a -> @workbench/remote-b -> @workbench/remote-a",
  ]);
});

test("accepts the intended package dependency direction", () => {
  const violations = remoteControlBoundaryViolations({
    manifests: new Map([
      [
        "apps/mobile/package.json",
        {
          dependencies: {
            "@workbench/remote-control-client": "workspace:*",
            "@workbench/remote-control-contracts": "workspace:*",
            "@workbench/ui-remote-conversation": "workspace:*",
            expo: "~57.0.22",
            react: "19.2.3",
            "react-native": "0.86.3",
          },
        },
      ],
      [
        "packages/contracts/remote-control-contracts/package.json",
        { dependencies: { "@workbench/core-contracts": "workspace:*" } },
      ],
      [
        "packages/transport/remote-control-client/package.json",
        { dependencies: { "@workbench/remote-control-contracts": "workspace:*" } },
      ],
      [
        "packages/server/remote-control-direct-server/package.json",
        { dependencies: { "@workbench/remote-control-contracts": "workspace:*" } },
      ],
      [
        "packages/pi-runtime/pi-runtime-remote-control/package.json",
        {
          dependencies: {
            "@workbench/pi-conversation-adapter": "workspace:*",
            "@workbench/pi-rpc-client": "workspace:*",
            "@workbench/remote-control-contracts": "workspace:*",
            "@workbench/runtime-transport-client": "workspace:*",
          },
        },
      ],
    ]),
    sources: new Map([
      [
        "apps/mobile/src/components/remote-conversation.dom.tsx",
        'import { RemoteConversationSurface } from "@workbench/ui-remote-conversation"; import "@workbench/ui-remote-conversation/styles.css";',
      ],
    ]),
  });

  assert.deepEqual(violations, []);
});

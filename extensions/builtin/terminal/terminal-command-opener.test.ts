import assert from "node:assert/strict";
import test from "node:test";

import type { OpenSurfaceRequest } from "@/platform/extensions";

import { TERMINAL_COMMAND_SCHEME, terminalCommandOpenHandler } from "./terminal-command-opener";

const context = {
  applicationId: "pi-workbench",
  threadId: "thread-current",
  projectId: "project-current",
  rootPath: "/projects/current",
};

test("the terminal command opener only accepts bounded, non-empty commands", () => {
  assert.equal(
    terminalCommandOpenHandler.canOpen({
      resource: { scheme: TERMINAL_COMMAND_SCHEME, path: "pi install npm:pi-tools" },
      context,
    }),
    100,
  );
  assert.equal(
    terminalCommandOpenHandler.canOpen({
      resource: { scheme: TERMINAL_COMMAND_SCHEME, path: "   " },
      context,
    }),
    0,
  );
  assert.equal(
    terminalCommandOpenHandler.canOpen({
      resource: { scheme: "file", path: "pi install npm:pi-tools" },
      context,
    }),
    0,
  );
  assert.equal(
    terminalCommandOpenHandler.canOpen({
      resource: { scheme: TERMINAL_COMMAND_SCHEME, path: "x".repeat(32_769) },
      context,
    }),
    0,
  );
});

test("the terminal command opener starts a focused primary terminal with one pending command", () => {
  let opened: OpenSurfaceRequest | undefined;
  const result = terminalCommandOpenHandler.open(
    {
      resource: {
        scheme: TERMINAL_COMMAND_SCHEME,
        path: "pi install 'npm:@example/pi-tools' --local",
        label: "Install @example/pi-tools",
        metadata: {
          cwd: "/projects/example",
          workspaceId: "workspace-example",
        },
      },
      context,
      scope: { type: "application", key: "pi-workbench" },
      policy: "force-focus",
    },
    {
      surfaces: {
        open: (request) => {
          opened = request;
          return "terminal-surface";
        },
        reveal: () => assert.fail("A command must open a fresh terminal Surface"),
      },
    },
  );

  assert.equal(result, "terminal-surface");
  assert.equal(opened?.kind, "terminal");
  assert.equal(opened?.title, "Install @example/pi-tools");
  assert.equal(opened?.placement, "primary");
  assert.deepEqual(opened?.context, context);
  assert.deepEqual(opened?.scope, { type: "application", key: "pi-workbench" });
  assert.equal(opened?.status, "ready");
  assert.equal(opened?.policy, "force-focus");
  assert.equal(opened?.params.mode, "pty");
  assert.equal(opened?.params.threadId, "application");
  assert.equal(opened?.params.workspaceId, "workspace-example");
  assert.equal(opened?.params.cwd, "/projects/example");
  assert.equal(opened?.params.initialCommand, "pi install 'npm:@example/pi-tools' --local");
  assert.equal(typeof opened?.params.terminalId, "string");
  assert.match(String(opened?.params.sessionId), /^terminal:application:/);
});

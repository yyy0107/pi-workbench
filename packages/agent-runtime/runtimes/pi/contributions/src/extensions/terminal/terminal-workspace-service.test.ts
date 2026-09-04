import assert from "node:assert/strict";
import test from "node:test";

import type { RightWorkspaceController } from "@workbench/shell/right-workspace";

import { createToggleTerminalCommand, getTerminalWorkspaceService } from "./open-terminal-command";
import {
  openTerminal,
  revealTerminalTranscript,
  type TerminalWorkspaceService,
} from "./terminal-workspace-service";

function attachToggleHost(
  service: TerminalWorkspaceService,
  threadId: string,
  requests: unknown[],
): () => void {
  return service.attach({
    controller: {
      open(request: unknown) {
        requests.push(request);
        return `terminal:${threadId}`;
      },
    } as RightWorkspaceController,
    context: { applicationId: `workbench:${threadId}`, threadId },
    launch: { threadId, workspaceId: `project:${threadId}` },
    title: "Terminal",
    activeTerminal: false,
    workspaceOpen: false,
  });
}

test("opens a fresh thread-scoped terminal instance", () => {
  const requests: unknown[] = [];
  const controller = {
    open(request: unknown) {
      requests.push(request);
      return "terminal:surface";
    },
  } as RightWorkspaceController;

  assert.equal(
    openTerminal(
      {
        controller,
        context: { applicationId: "workbench", threadId: "thread-1" },
        launch: { threadId: "thread-1", workspaceId: "project", cwd: "/workspace" },
        title: "Terminal",
      },
      "terminal-1",
    ),
    "terminal:surface",
  );
  assert.deepEqual(requests, [
    {
      kind: "terminal",
      title: "Terminal",
      params: {
        mode: "pty",
        terminalId: "terminal-1",
        threadId: "thread-1",
        sessionId: "terminal:thread-1:terminal-1",
        workspaceId: "project",
        cwd: "/workspace",
      },
      context: { applicationId: "workbench", threadId: "thread-1" },
      scope: { type: "thread", key: "thread-1" },
      status: "ready",
    },
  ]);
});

test("allocates a different PTY session for every new terminal", () => {
  const requests: Array<{ params?: { sessionId?: string } }> = [];
  const controller = {
    open(request: { params?: { sessionId?: string } }) {
      requests.push(request);
      return `terminal:${requests.length}`;
    },
  } as RightWorkspaceController;
  const host = {
    controller,
    context: { applicationId: "workbench", threadId: "thread-1" },
    launch: { threadId: "thread-1", workspaceId: "project" },
    title: "Terminal",
  };

  openTerminal(host);
  openTerminal(host);

  assert.equal(requests.length, 2);
  assert.notEqual(requests[0]?.params?.sessionId, requests[1]?.params?.sessionId);
});

test("opens a terminal inside the visible main-view workspace context", () => {
  const requests: unknown[] = [];
  const controller = {
    open(request: unknown) {
      requests.push(request);
      return "terminal:toolbox";
    },
  } as RightWorkspaceController;

  openTerminal(
    {
      controller,
      context: {
        applicationId: "workbench",
        threadId: "workbench-main-view:toolbox",
      },
      launch: {
        threadId: "conversation-1",
        workspaceId: "project-1",
        cwd: "/project-1",
      },
      title: "Terminal",
    },
    "terminal-1",
  );

  assert.deepEqual(requests, [
    {
      kind: "terminal",
      title: "Terminal",
      params: {
        mode: "pty",
        terminalId: "terminal-1",
        threadId: "workbench-main-view:toolbox",
        sessionId: "terminal:workbench-main-view:toolbox:terminal-1",
        workspaceId: "application",
      },
      context: {
        applicationId: "workbench",
        threadId: "workbench-main-view:toolbox",
      },
      scope: { type: "thread", key: "workbench-main-view:toolbox" },
      status: "ready",
    },
  ]);
});

test("reveals the thread-scoped terminal for the selected tool call", () => {
  const requests: unknown[] = [];
  const controller = {
    reveal(request: unknown) {
      requests.push(request);
      return "terminal:transcript";
    },
  } as RightWorkspaceController;

  assert.equal(
    revealTerminalTranscript({
      controller,
      context: { applicationId: "workbench", threadId: "thread-1" },
      toolCallId: "call-7",
      command: "pnpm test",
      piSessionId: "session-4",
      title: "pnpm test",
    }),
    "terminal:transcript",
  );
  assert.deepEqual(requests, [
    {
      kind: "terminal",
      title: "pnpm test",
      params: {
        mode: "transcript",
        toolCallId: "call-7",
        command: "pnpm test",
        piSessionId: "session-4",
        threadId: "thread-1",
      },
      context: { applicationId: "workbench", threadId: "thread-1" },
      scope: { type: "thread", key: "thread-1" },
      status: "ready",
    },
  ]);
});

test("resolves duplicate terminal command IDs to their owning ExtensionHost installation", () => {
  const firstCommand = Object.freeze({ ...createToggleTerminalCommand() });
  const secondCommand = Object.freeze({ ...createToggleTerminalCommand() });
  const firstService = getTerminalWorkspaceService(firstCommand);
  const secondService = getTerminalWorkspaceService(secondCommand);
  const firstRequests: unknown[] = [];
  const secondRequests: unknown[] = [];

  assert.equal(firstCommand.id, secondCommand.id);
  assert.ok(firstService);
  assert.ok(secondService);
  assert.notEqual(firstService, secondService);

  const detachFirst = attachToggleHost(firstService, "same-thread", firstRequests);
  const detachSecond = attachToggleHost(secondService, "same-thread", secondRequests);
  firstCommand.run({} as never);
  secondCommand.run({} as never);

  assert.equal(firstRequests.length, 1);
  assert.equal(secondRequests.length, 1);
  assert.equal(
    (firstRequests[0] as { context: { applicationId: string } }).context.applicationId,
    "workbench:same-thread",
  );
  assert.equal(
    (secondRequests[0] as { context: { applicationId: string } }).context.applicationId,
    "workbench:same-thread",
  );

  detachFirst();
  firstService.dispose();
  assert.throws(() => firstCommand.run({} as never), /Terminal workspace runtime is unavailable/);

  secondCommand.run({} as never);
  assert.equal(firstRequests.length, 1);
  assert.equal(secondRequests.length, 2);
  detachSecond();
  secondService.dispose();
});

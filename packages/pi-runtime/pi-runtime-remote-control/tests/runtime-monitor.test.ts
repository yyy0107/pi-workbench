import assert from "node:assert/strict";
import test from "node:test";

import type { PiWebSocket, PiWebSocketMessageEvent } from "@workbench/pi-rpc-client/connections";
import type {
  RemoteRunStateV1,
  RemoteSessionSummaryV1,
} from "@workbench/remote-control-contracts/protocol";

import { createDesktopRemoteRuntimeMonitor } from "../src/runtime-monitor.ts";

class FakeSocket implements PiWebSocket {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: PiWebSocketMessageEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  send(): void {}

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  message(payload: Readonly<Record<string, unknown>>): void {
    this.onmessage?.({
      data: JSON.stringify({
        type: "server-request",
        rpcId: "rpc-1",
        method: payload.type,
        payload,
      }),
    });
  }
}

const session: RemoteSessionSummaryV1 = {
  sessionId: "session-1",
  title: "Remote session",
  updatedAt: "2030-09-13T20:00:00.000Z",
  pinned: false,
  archived: false,
  attention: "none",
  runState: "running",
  entityRevision: "revision-1",
};

test("streams safe session and conversation changes while the direct listener is active", async () => {
  const sockets: FakeSocket[] = [];
  const runStates: RemoteRunStateV1[] = [];
  const entries: unknown[][] = [];
  const monitor = createDesktopRemoteRuntimeMonitor({
    machineId: "machine-1",
    runtimeConnection: {
      kind: "same-origin",
      protocolVersion: 1,
      httpOrigin: "http://runtime.example.test",
    },
    webSocketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    frameProcessor: {
      async refreshCatalog() {
        return [session];
      },
      async publishRunState(_sessionId, state) {
        runStates.push(state);
        return undefined;
      },
      async publishConversationEntries(_sessionId, values) {
        entries.push([...values]);
        return [];
      },
    },
    readSessionCatalog: async () => [session],
  });

  await monitor.start();
  assert.equal(sockets.length, 2);
  const [mux, host] = sockets;
  mux!.open();
  host!.open();
  await new Promise((resolve) => setTimeout(resolve, 0));
  mux!.message({ type: "session/subscribed", sessionId: "session-1", lastSeq: 0 });
  host!.message({
    type: "host/session-status",
    sessionId: "session-1",
    running: false,
  });
  host!.message({
    type: "host/session-status",
    sessionId: "session-1",
    running: true,
  });
  monitor.noteOperationAccepted({ type: "session.stop", sessionId: "session-1" });
  host!.message({
    type: "host/session-status",
    sessionId: "session-1",
    running: false,
  });
  host!.message({
    type: "host/session-interaction-status",
    sessionId: "session-1",
    waitingForUserInput: true,
  });
  host!.message({ type: "host/agent-error", sessionId: "session-1", message: "private" });
  mux!.message({
    type: "session/event",
    sessionId: "session-1",
    event: {
      type: "message_end",
      seq: 1,
      time: Date.parse("2030-09-13T20:00:01.000Z"),
      data: {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Safe output" }],
          stopReason: "end",
        },
      },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.deepEqual(runStates, [
    "completed",
    "running",
    "stopping",
    "stopped",
    "waiting-for-input",
    "failed",
  ]);
  assert.equal(entries.length, 1);
  monitor.stop();
});

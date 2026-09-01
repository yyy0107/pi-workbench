import assert from "node:assert/strict";
import test from "node:test";

import { isValidElement } from "react";

import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";
import type { PromptFeedbackPort } from "@workbench/agent-runtime-client/prompt-feedback";
import type { PiClientTransport } from "@workbench/agent-runtime-pi-client/installation";
import type { RuntimeWebSocket, RuntimeWebSocketMessageEvent } from "@workbench/host-client";
import {
  RUNTIME_CONNECTION_PROTOCOL_VERSION,
  defineRuntimeConnection,
} from "@workbench/host-contracts";

import {
  createInstalledAgentRuntime,
  createInstalledAgentRuntimeTransport,
} from "@/workbench/providers/installed-agent-runtime";
import { createWorkspaceDirectoryStoreInstallation } from "@/workbench/workspaces/workspace-directory-store";

class FakeWebSocket implements RuntimeWebSocket {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: RuntimeWebSocketMessageEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {}

  send(): void {}
  close(): void {}
}

test("selects Pi as the single Agent Runtime installed by this Workbench build", () => {
  const promptFeedback: PromptFeedbackPort = {
    claimForThreads: () => undefined,
    commit: () => undefined,
    release: () => undefined,
  };

  const workspaceDirectories = createWorkspaceDirectoryStoreInstallation();
  const installation = createInstalledAgentRuntime({
    promptFeedback,
    runtimeConnection: defineRuntimeConnection({
      kind: "same-origin",
      protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
      httpOrigin: "https://workbench.example",
    }),
    copy: {
      titles: { attachment: "Attachment", image: "Image" },
      errors: {
        sessionBusy: "Busy",
        emptyPrompt: "Empty",
        sessionNotFound: "Missing",
        invalidWorkingDirectory: "Invalid directory",
        invalidWorkspace: "Invalid workspace",
        modelNotAvailable: "Model unavailable",
        requestFailed: "Request failed",
      },
    },
    workspaceDirectoryStore: workspaceDirectories.port,
  });

  assert.equal(installation.descriptor, PI_AGENT_RUNTIME_DESCRIPTOR);
  const element = installation.render(null);
  assert.ok(
    isValidElement<{
      transport?: PiClientTransport;
      workspaceDirectoryStore?: unknown;
    }>(element),
  );
  assert.equal(typeof element.props.transport?.http, "function");
  assert.equal(typeof element.props.transport?.webSocketFactory, "function");
  assert.equal(Object.isFrozen(element.props.transport), true);
  assert.equal(element.props.workspaceDirectoryStore, workspaceDirectories.port);
});

test("derives isolated Pi HTTP and WebSocket carriers from one sidecar descriptor", async () => {
  const connection = defineRuntimeConnection({
    kind: "desktop-sidecar",
    protocolVersion: RUNTIME_CONNECTION_PROTOCOL_VERSION,
    httpOrigin: "http://127.0.0.1:43123",
    instanceId: "runtime-a",
    accessToken: "runtime-a-token",
  });
  if (connection.kind !== "desktop-sidecar") throw new Error("Expected a sidecar connection.");
  const fetchCalls: Array<{ input: URL; init?: RequestInit }> = [];
  const rawSockets: FakeWebSocket[] = [];
  const transport = createInstalledAgentRuntimeTransport(connection, {
    fetchImplementation: async (input, init) => {
      fetchCalls.push({ input, init });
      return Response.json({});
    },
    webSocket: {
      webSocketFactory: (url) => {
        const socket = new FakeWebSocket(url);
        rawSockets.push(socket);
        return socket;
      },
    },
  });

  await transport.http("/api/host.describe");
  transport.webSocketFactory("/api/events.host");

  assert.equal(fetchCalls[0]?.input.href, "http://127.0.0.1:43123/api/host.describe");
  assert.equal(
    new Headers(fetchCalls[0]?.init?.headers).get("Authorization"),
    "Bearer runtime-a-token",
  );
  assert.equal(rawSockets[0]?.url, "ws://127.0.0.1:43123/api/events.host");
  assert.equal(rawSockets[0]?.url.includes(connection.accessToken), false);
  assert.equal(Object.isFrozen(transport), true);
});

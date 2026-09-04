import assert from "node:assert/strict";
import test from "node:test";

import { createElement, isValidElement, type ReactNode } from "react";

import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";
import type { PromptFeedbackPort } from "@workbench/agent-runtime-client/prompt-feedback";
import type { WorkbenchWorkspaceDirectoryStorePort } from "@workbench/agent-runtime-client/workspaces";

import { createPiAgentRuntimeInstallation } from "../../src/integration/pi-runtime-installation";
import {
  PiAgentRuntimeProvider,
  resolvePiSessionManager,
} from "../../src/integration/pi-runtime-provider";
import { PiSessionManager } from "../../src/runtime/manager";
import type { PiClientTransport } from "../../src/transport/client-transport";

test("binds the shared Pi descriptor and application inputs to the complete Pi provider", () => {
  const promptFeedback: PromptFeedbackPort = {
    claimForThreads: () => undefined,
    commit: () => undefined,
    release: () => undefined,
  };
  const directorySnapshot = { collapsedDirectoryIds: [] } as const;
  const workspaceDirectoryStore: WorkbenchWorkspaceDirectoryStorePort = {
    getSnapshot: () => directorySnapshot,
    subscribe: () => () => undefined,
    actions: {
      reconcileDirectoryIds: () => undefined,
      discardDirectory: () => undefined,
      activateDirectory: () => undefined,
      deactivateDirectory: () => undefined,
      revealDirectory: () => undefined,
      setDirectoryCollapsed: () => undefined,
      toggleDirectory: () => undefined,
      beginNewThread: () => undefined,
      destroyNewThread: () => undefined,
    },
  };
  const copy = {
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
  } as const;
  const child = createElement("span", null, "Workbench");
  const http: PiClientTransport["http"] = async () => Response.json({});
  const webSocketFactory: PiClientTransport["webSocketFactory"] = () => {
    throw new Error("not opened while binding the installation");
  };
  const callerOwnedTransport: {
    http?: PiClientTransport["http"];
    webSocketFactory?: PiClientTransport["webSocketFactory"];
  } = { http, webSocketFactory };
  const installation = createPiAgentRuntimeInstallation({
    copy,
    promptFeedback,
    transport: callerOwnedTransport,
    workspaceDirectoryStore,
  });
  callerOwnedTransport.http = undefined;
  callerOwnedTransport.webSocketFactory = undefined;
  const element = installation.render(child);

  assert.equal(installation.descriptor, PI_AGENT_RUNTIME_DESCRIPTOR);
  assert.ok(
    isValidElement<{
      children: ReactNode;
      copy: typeof copy;
      promptFeedback?: PromptFeedbackPort;
      transport?: PiClientTransport;
      workspaceDirectoryStore: WorkbenchWorkspaceDirectoryStorePort;
    }>(element),
  );
  assert.equal(element.type, PiAgentRuntimeProvider);
  assert.equal(element.props.children, child);
  assert.equal(element.props.copy, copy);
  assert.equal(element.props.promptFeedback, promptFeedback);
  assert.notEqual(element.props.transport, callerOwnedTransport);
  assert.equal(element.props.transport?.http, http);
  assert.equal(element.props.transport?.webSocketFactory, webSocketFactory);
  assert.equal(Object.isFrozen(element.props.transport), true);
  assert.equal(element.props.workspaceDirectoryStore, workspaceDirectoryStore);
});

test("keeps transport snapshots isolated between installation instances", () => {
  const workspaceDirectoryStore = {
    getSnapshot: () => ({ collapsedDirectoryIds: [] }),
    subscribe: () => () => undefined,
    actions: {},
  } as unknown as WorkbenchWorkspaceDirectoryStorePort;
  const copy = {
    titles: { attachment: "Attachment", image: "Image" },
    errors: {},
  } as unknown as Parameters<typeof createPiAgentRuntimeInstallation>[0]["copy"];
  const firstHttp: NonNullable<PiClientTransport["http"]> = async () => Response.json({});
  const secondHttp: NonNullable<PiClientTransport["http"]> = async () => Response.json({});
  const first = createPiAgentRuntimeInstallation({
    copy,
    workspaceDirectoryStore,
    transport: { http: firstHttp },
  }).render(null);
  const second = createPiAgentRuntimeInstallation({
    copy,
    workspaceDirectoryStore,
    transport: { http: secondHttp },
  }).render(null);

  assert.ok(isValidElement<{ transport?: PiClientTransport }>(first));
  assert.ok(isValidElement<{ transport?: PiClientTransport }>(second));
  assert.notEqual(first.props.transport, second.props.transport);
  assert.equal(first.props.transport?.http, firstHttp);
  assert.equal(second.props.transport?.http, secondHttp);
});

test("retains exactly one manager for a Provider installation", () => {
  let creations = 0;
  const factory = (options: ConstructorParameters<typeof PiSessionManager>[0]) => {
    creations += 1;
    return new PiSessionManager(options);
  };
  const options = {
    titleFallbacks: { attachment: "Attachment", image: "Image" },
  } as const;
  const first = resolvePiSessionManager(null, options, factory);
  const retained = resolvePiSessionManager(first, options, factory);

  try {
    assert.equal(retained, first);
    assert.equal(creations, 1);
  } finally {
    first.dispose();
  }
});

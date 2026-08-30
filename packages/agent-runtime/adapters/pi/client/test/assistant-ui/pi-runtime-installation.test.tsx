import assert from "node:assert/strict";
import test from "node:test";

import { createElement, isValidElement, type ReactNode } from "react";

import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";
import type { PromptFeedbackPort } from "@workbench/agent-runtime-client/prompt-feedback";
import type { WorkbenchWorkspaceDirectoryStorePort } from "@workbench/agent-runtime-client/workspaces";

import { createPiAgentRuntimeInstallation } from "../../src/assistant-ui/pi-runtime-installation";
import { PiAgentRuntimeProvider } from "../../src/assistant-ui/pi-runtime-provider";

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
  const installation = createPiAgentRuntimeInstallation({
    copy,
    promptFeedback,
    workspaceDirectoryStore,
  });
  const element = installation.render(child);

  assert.equal(installation.descriptor, PI_AGENT_RUNTIME_DESCRIPTOR);
  assert.ok(
    isValidElement<{
      children: ReactNode;
      copy: typeof copy;
      promptFeedback?: PromptFeedbackPort;
      workspaceDirectoryStore: WorkbenchWorkspaceDirectoryStorePort;
    }>(element),
  );
  assert.equal(element.type, PiAgentRuntimeProvider);
  assert.equal(element.props.children, child);
  assert.equal(element.props.copy, copy);
  assert.equal(element.props.promptFeedback, promptFeedback);
  assert.equal(element.props.workspaceDirectoryStore, workspaceDirectoryStore);
});

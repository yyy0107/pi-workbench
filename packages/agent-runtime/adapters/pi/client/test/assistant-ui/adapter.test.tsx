import { createElement } from "react";

import { defineWorkbenchAgentRuntimeAdapterContract } from "@workbench/agent-runtime-testkit/client";
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";
import type { WorkbenchWorkspaceDirectoryStorePort } from "@workbench/agent-runtime-client/workspaces";

import { PiSessionManagerProvider } from "../../src/runtime/context";
import { PiSessionManager } from "../../src/runtime/manager";
import { createPiAgentRuntimeAdapter } from "../../src/assistant-ui/adapter";
import { PiAgentRuntimeCopyProvider } from "../../src/assistant-ui/copy";
import { PiWorkspaceSelectionProvider } from "../../src/assistant-ui/workspace-selection-provider";

const directorySnapshot = { collapsedDirectoryIds: [] } as const;
const directoryStore: WorkbenchWorkspaceDirectoryStorePort = {
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

defineWorkbenchAgentRuntimeAdapterContract({
  name: "Pi",
  createHarness() {
    const manager = new PiSessionManager();
    return {
      adapter: createPiAgentRuntimeAdapter(manager),
      wrap: (element: ReturnType<typeof createElement>) =>
        createElement(PiAgentRuntimeCopyProvider, {
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
          children: createElement(PiSessionManagerProvider, {
            manager,
            children: createElement(PiWorkspaceSelectionProvider, {
              directoryStore,
              children: element,
            }),
          }),
        }),
      dispose: () => manager.dispose(),
    };
  },
  expected: {
    id: PI_AGENT_RUNTIME_DESCRIPTOR.id,
    commandNames: [],
    hasThreadStore: true,
    threadSnapshot: {
      isRunning: false,
      isWaitingForInput: false,
      hasUnreadCompletion: false,
      isPinned: false,
    },
    threadCapabilities: {
      switchToBranch: true,
      switchBranchDuringRun: false,
      edit: false,
      // assistant-ui 0.15 derives delete together with branch switching from setMessages.
      delete: true,
      reload: true,
      refetchThread: true,
      cancel: true,
      attachments: true,
      dictation: true,
      feedback: true,
      queue: false,
    },
  },
});

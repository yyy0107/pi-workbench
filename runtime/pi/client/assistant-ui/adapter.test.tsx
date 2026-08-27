import { createElement } from "react";

import { I18nProvider } from "@/i18n/provider";
import { defineWorkbenchAgentRuntimeAdapterContract } from "@/runtime/assistant-ui/testing/agent-runtime-adapter-contract";
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@/runtime/pi/descriptor";

import { PiSessionManagerProvider } from "../runtime/context";
import { PiSessionManager } from "../runtime/manager";
import { createPiAgentRuntimeAdapter } from "./adapter";
import { PiWorkspaceSelectionProvider } from "./workspace-selection-provider";

defineWorkbenchAgentRuntimeAdapterContract({
  name: "Pi",
  createHarness() {
    const manager = new PiSessionManager();
    return {
      adapter: createPiAgentRuntimeAdapter(manager),
      wrap: (element: ReturnType<typeof createElement>) =>
        createElement(I18nProvider, {
          initialLocale: "en-US",
          children: createElement(PiSessionManagerProvider, {
            manager,
            children: createElement(PiWorkspaceSelectionProvider, { children: element }),
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

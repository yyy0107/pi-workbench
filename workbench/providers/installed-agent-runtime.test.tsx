import assert from "node:assert/strict";
import test from "node:test";

import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/agent-runtime-pi-shared/descriptor";
import type { PromptFeedbackPort } from "@workbench/agent-runtime-client/prompt-feedback";

import { createInstalledAgentRuntime } from "./installed-agent-runtime";

test("selects Pi as the single Agent Runtime installed by this Workbench build", () => {
  const promptFeedback: PromptFeedbackPort = {
    claimForThreads: () => undefined,
    commit: () => undefined,
    release: () => undefined,
  };

  const installation = createInstalledAgentRuntime({
    promptFeedback,
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
  });

  assert.equal(installation.descriptor, PI_AGENT_RUNTIME_DESCRIPTOR);
});

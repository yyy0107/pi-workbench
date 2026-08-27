import assert from "node:assert/strict";
import test from "node:test";

import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@/runtime/pi/descriptor";
import type { PromptFeedbackPort } from "@/services/workspace-feedback-service";

import { createInstalledAgentRuntime } from "./installed-agent-runtime";

test("selects Pi as the single Agent Runtime installed by this Workbench build", () => {
  const promptFeedback: PromptFeedbackPort = {
    claimForThreads: () => undefined,
    commit: () => undefined,
    release: () => undefined,
  };

  const installation = createInstalledAgentRuntime(promptFeedback);

  assert.equal(installation.descriptor, PI_AGENT_RUNTIME_DESCRIPTOR);
});

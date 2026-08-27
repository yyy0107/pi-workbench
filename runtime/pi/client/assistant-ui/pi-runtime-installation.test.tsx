import assert from "node:assert/strict";
import test from "node:test";

import { createElement, isValidElement, type ReactNode } from "react";

import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@/runtime/pi/descriptor";
import type { PromptFeedbackPort } from "@/services/workspace-feedback-service";

import { createPiAgentRuntimeInstallation } from "./pi-runtime-installation";
import { PiAgentRuntimeProvider } from "./pi-runtime-provider";

test("binds the shared Pi descriptor and application inputs to the complete Pi provider", () => {
  const promptFeedback: PromptFeedbackPort = {
    claimForThreads: () => undefined,
    commit: () => undefined,
    release: () => undefined,
  };
  const child = createElement("span", null, "Workbench");
  const installation = createPiAgentRuntimeInstallation({ promptFeedback });
  const element = installation.render(child);

  assert.equal(installation.descriptor, PI_AGENT_RUNTIME_DESCRIPTOR);
  assert.ok(
    isValidElement<{
      children: ReactNode;
      promptFeedback?: PromptFeedbackPort;
    }>(element),
  );
  assert.equal(element.type, PiAgentRuntimeProvider);
  assert.equal(element.props.children, child);
  assert.equal(element.props.promptFeedback, promptFeedback);
});

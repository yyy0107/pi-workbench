import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { WorkbenchAgentRuntimeCapabilities } from "../src/capabilities";
import { WorkbenchAgentCapabilityError } from "../src/capabilities";
import {
  WorkbenchAgentRuntimeEnvironmentProvider,
  useWorkbenchAttachmentUnderstandingCapability,
  useWorkbenchAutomationCapability,
  useWorkbenchContextCapability,
  useWorkbenchInteractionCapability,
  useWorkbenchModelSelectionCapability,
  useWorkbenchRuntimeHostCapability,
  useWorkbenchScratchSessionCapability,
  useWorkbenchWorkspaceCapability,
} from "../src/agent-runtime-context";

function readCapabilities(capabilities?: WorkbenchAgentRuntimeCapabilities) {
  let observed: WorkbenchAgentRuntimeCapabilities | undefined;

  function Probe() {
    observed = {
      host: useWorkbenchRuntimeHostCapability(),
      workspace: useWorkbenchWorkspaceCapability(),
      models: useWorkbenchModelSelectionCapability(),
      interactions: useWorkbenchInteractionCapability(),
      scratchSessions: useWorkbenchScratchSessionCapability(),
      context: useWorkbenchContextCapability(),
      automation: useWorkbenchAutomationCapability(),
      attachmentUnderstanding: useWorkbenchAttachmentUnderstandingCapability(),
    };
    return null;
  }

  renderToStaticMarkup(
    createElement(WorkbenchAgentRuntimeEnvironmentProvider, {
      id: "fixture",
      commands: [],
      ...(capabilities === undefined ? {} : { capabilities }),
      children: createElement(Probe),
    }),
  );
  return observed;
}

test("keeps every Runtime capability optional and exposes only installed fields", () => {
  assert.equal(
    Object.values(readCapabilities() ?? {}).every((value) => value === undefined),
    true,
  );

  const capabilities = {
    host: { marker: "host" },
    workspace: { marker: "workspace" },
    models: { marker: "models" },
    interactions: { marker: "interactions" },
    scratchSessions: { marker: "scratchSessions" },
    context: { marker: "context" },
    automation: { marker: "automation" },
    attachmentUnderstanding: { marker: "attachmentUnderstanding" },
  } as unknown as WorkbenchAgentRuntimeCapabilities;

  assert.deepEqual(readCapabilities(capabilities), capabilities);
});

test("defines a stable Runtime-neutral capability error", () => {
  const error = new WorkbenchAgentCapabilityError("conflict", { revision: 3 });

  assert.equal(error.name, "WorkbenchAgentCapabilityError");
  assert.equal(error.code, "conflict");
  assert.deepEqual(error.details, { revision: 3 });
});

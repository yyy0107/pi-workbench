import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { WorkbenchAgentRuntimeCapabilities } from "../src/environment/capabilities";
import { WorkbenchAgentCapabilityError } from "../src/environment/capabilities";
import {
  WorkbenchAgentRuntimeEnvironmentProvider,
  WorkbenchBoundSessionProvider,
  useWorkbenchAgentThreadId,
  useWorkbenchAgentCommands,
  useWorkbenchSessionContextPolicy,
  type WorkbenchBoundSessionProps,
  useWorkbenchAutomationCapability,
  useWorkbenchContextCapability,
  useWorkbenchInteractionCapability,
  useWorkbenchModelSelectionCapability,
  useWorkbenchRuntimeHostCapability,
  useWorkbenchScratchSessionCapability,
  useWorkbenchWorkspaceCapability,
} from "../src/environment/context";

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
  } as unknown as WorkbenchAgentRuntimeCapabilities;

  assert.deepEqual(readCapabilities(capabilities), capabilities);
});

test("defines a stable Runtime-neutral capability error", () => {
  const error = new WorkbenchAgentCapabilityError("conflict", { revision: 3 });

  assert.equal(error.name, "WorkbenchAgentCapabilityError");
  assert.equal(error.code, "conflict");
  assert.deepEqual(error.details, { revision: 3 });
});

test("nested session binding uses the installed provider and leaves its parent scope intact", () => {
  const observed: unknown[] = [];
  function Probe() {
    observed.push([useWorkbenchAgentThreadId(), useWorkbenchAgentCommands()]);
    return null;
  }
  function Binding({ sessionId, children }: WorkbenchBoundSessionProps) {
    return createElement(WorkbenchAgentRuntimeEnvironmentProvider, {
      id: "fixture",
      threadId: sessionId,
      commands: [],
      children,
    });
  }
  renderToStaticMarkup(
    createElement(WorkbenchAgentRuntimeEnvironmentProvider, {
      id: "fixture",
      threadId: "parent",
      commands: [],
      sessionBinding: Binding,
      children: [
        createElement(WorkbenchBoundSessionProvider, {
          key: "bound",
          sessionId: "scratch",
          children: createElement(Probe),
        }),
        createElement(Probe, { key: "parent" }),
      ],
    }),
  );
  assert.deepEqual(observed, [
    ["scratch", []],
    ["parent", []],
  ]);
  assert.equal(
    renderToStaticMarkup(
      createElement(WorkbenchAgentRuntimeEnvironmentProvider, {
        id: "fixture",
        commands: [],
        children: createElement(WorkbenchBoundSessionProvider, {
          sessionId: "missing",
          fallback: "unsupported",
          children: createElement(Probe),
        }),
      }),
    ),
    "unsupported",
  );
});

test("context policy actions retain the selected session and reject missing capabilities", async () => {
  let policy!: ReturnType<typeof useWorkbenchSessionContextPolicy>;
  function Probe() {
    policy = useWorkbenchSessionContextPolicy("scratch");
    return null;
  }
  const render = (capabilities?: WorkbenchAgentRuntimeCapabilities) =>
    renderToStaticMarkup(
      createElement(WorkbenchAgentRuntimeEnvironmentProvider, {
        id: "fixture",
        commands: [],
        capabilities,
        children: createElement(Probe),
      }),
    );
  render();
  await assert.rejects(policy.update({ mode: "inherit" }), { code: "unavailable" });
  await assert.rejects(policy.compact(), { code: "unavailable" });
  const calls: unknown[] = [];
  const value = {
    policy: { mode: "inherit" as const },
    overridden: false,
    compaction: { enabled: true, reserveTokens: 10, keepRecentTokens: 20 },
    usage: { tokens: 1, percent: 1 },
    nearingCompaction: false,
  };
  render({
    context: {
      getSnapshot: () => ({ status: "ready", value }),
      subscribe: () => () => undefined,
      load: async (...args) => {
        calls.push(["load", ...args]);
        return value;
      },
      update: async (...args) => {
        calls.push(["update", ...args]);
        return value;
      },
      compact: async (...args) => {
        calls.push(["compact", ...args]);
        return value;
      },
    },
  });
  await policy.refresh();
  await policy.update({ mode: "custom", desiredContextTokens: 100 });
  await policy.compact();
  assert.deepEqual(calls, [
    ["load", "scratch", true],
    ["update", "scratch", { mode: "custom", desiredContextTokens: 100 }],
    ["compact", "scratch"],
  ]);
});

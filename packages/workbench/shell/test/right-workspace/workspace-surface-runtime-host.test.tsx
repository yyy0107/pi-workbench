import assert from "node:assert/strict";
import test from "node:test";

import type {
  LocalizableText,
  OpenerService,
  WorkspaceContext,
  WorkspaceSurfaceDefinition,
} from "@workbench/extension-sdk";
import { WorkspaceSurfaceRegistryImpl } from "@workbench/extension-sdk/internal";
import {
  RightWorkspaceProvider,
  WorkspaceSurfaceRuntimeHost,
  useWorkspaceContext,
  type WorkspaceRuntimeErrorDetails,
} from "@workbench/shell/right-workspace/react";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { flushReactMicrotasks, installMinimalReactDomEnvironment } from "../react-dom-environment";

const validateLocalizableText = (candidate: unknown): candidate is LocalizableText =>
  typeof candidate === "string" ||
  Boolean(candidate && typeof candidate === "object" && "key" in candidate);

const FixtureIcon = (() => null) as unknown as WorkspaceSurfaceDefinition["icon"];

function createOpener(): OpenerService {
  return {
    async open() {},
    getHandlers: () => [],
    subscribe: () => () => undefined,
  };
}

test("runtime host overrides context and isolates contribution errors through the public boundary", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const registry = new WorkspaceSurfaceRegistryImpl();
  const contexts: WorkspaceContext[] = [];
  const reports: Array<{ error: unknown; details: WorkspaceRuntimeErrorDetails }> = [];
  const originalConsoleError = console.error;
  console.error = () => undefined;

  function ContextRuntime() {
    contexts.push(useWorkspaceContext());
    return null;
  }

  function ThrowingRuntime(): never {
    throw new Error("runtime failed");
  }

  registry.register({
    kind: "context-runtime",
    icon: FixtureIcon,
    cachePolicy: "unmount",
    getResourceKey: () => "context-runtime",
    render: () => null,
    runtime: ContextRuntime,
  });
  registry.register({
    kind: "throwing-runtime",
    icon: FixtureIcon,
    cachePolicy: "unmount",
    getResourceKey: () => "throwing-runtime",
    render: () => null,
    runtime: ThrowingRuntime,
  });
  const initialContext = { applicationId: "provider-app", threadId: "provider-thread" };
  const runtimeContext = { applicationId: "runtime-app", threadId: "runtime-thread" };

  try {
    await act(async () => {
      root.render(
        createElement(RightWorkspaceProvider, {
          createOpener,
          initialContext,
          registry,
          validateLocalizableText,
          children: createElement(WorkspaceSurfaceRuntimeHost, {
            context: runtimeContext,
            reportError: (error, details) => reports.push({ error, details }),
          }),
        }),
      );
      await flushReactMicrotasks();
    });

    assert.ok(contexts.length >= 1);
    assert.equal(
      contexts.every((context) => context === runtimeContext),
      true,
    );
    assert.equal(reports.length, 1);
    assert.match(String(reports[0]?.error), /runtime failed/);
    assert.equal(reports[0]?.details.source, "workspace");
    assert.equal(reports[0]?.details.contributionId, "throwing-runtime");
  } finally {
    console.error = originalConsoleError;
    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    dom.restore();
  }
});

test("re-registering the same kind remounts the same runtime component function", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const registry = new WorkspaceSurfaceRegistryImpl();
  let mounts = 0;
  let cleanups = 0;

  function TrackedRuntime() {
    useEffect(() => {
      mounts += 1;
      return () => {
        cleanups += 1;
      };
    }, []);
    return null;
  }

  const definition: WorkspaceSurfaceDefinition = {
    kind: "tracked-runtime",
    icon: FixtureIcon,
    cachePolicy: "unmount",
    getResourceKey: () => "tracked-runtime",
    render: () => null,
    runtime: TrackedRuntime,
  };
  let registration = registry.register(definition);

  try {
    await act(async () => {
      root.render(
        createElement(RightWorkspaceProvider, {
          createOpener,
          initialContext: { applicationId: "runtime-remount" },
          registry,
          validateLocalizableText,
          children: createElement(WorkspaceSurfaceRuntimeHost, {
            reportError: () => undefined,
          }),
        }),
      );
      await flushReactMicrotasks();
    });
    assert.equal(mounts, 1);
    assert.equal(cleanups, 0);

    await act(async () => {
      registration.dispose();
      registration = registry.register(definition);
      await flushReactMicrotasks();
    });
    assert.equal(mounts, 2);
    assert.equal(cleanups, 1);
  } finally {
    await act(async () => {
      registration.dispose();
      root.unmount();
      await flushReactMicrotasks();
    });
    dom.restore();
  }
});

test("re-registering an errored runtime clears the old error boundary", async () => {
  const dom = installMinimalReactDomEnvironment();
  const root = createRoot(dom.container);
  const registry = new WorkspaceSurfaceRegistryImpl();
  const originalConsoleError = console.error;
  const reports: unknown[] = [];
  let healthyRenders = 0;
  console.error = () => undefined;

  function ThrowingRuntime(): never {
    throw new Error("stale runtime failed");
  }

  function HealthyRuntime() {
    healthyRenders += 1;
    return null;
  }

  let registration = registry.register({
    kind: "replaceable-runtime",
    icon: FixtureIcon,
    cachePolicy: "unmount",
    getResourceKey: () => "replaceable-runtime",
    render: () => null,
    runtime: ThrowingRuntime,
  });

  try {
    await act(async () => {
      root.render(
        createElement(RightWorkspaceProvider, {
          createOpener,
          initialContext: { applicationId: "runtime-recovery" },
          registry,
          validateLocalizableText,
          children: createElement(WorkspaceSurfaceRuntimeHost, {
            reportError: (error) => reports.push(error),
          }),
        }),
      );
      await flushReactMicrotasks();
    });
    assert.equal(reports.length, 1);
    assert.equal(healthyRenders, 0);

    await act(async () => {
      registration.dispose();
      registration = registry.register({
        kind: "replaceable-runtime",
        icon: FixtureIcon,
        cachePolicy: "unmount",
        getResourceKey: () => "replaceable-runtime",
        render: () => null,
        runtime: HealthyRuntime,
      });
      await flushReactMicrotasks();
    });
    assert.equal(healthyRenders, 1);
    assert.equal(reports.length, 1);
  } finally {
    console.error = originalConsoleError;
    await act(async () => {
      registration.dispose();
      root.unmount();
      await flushReactMicrotasks();
    });
    dom.restore();
  }
});

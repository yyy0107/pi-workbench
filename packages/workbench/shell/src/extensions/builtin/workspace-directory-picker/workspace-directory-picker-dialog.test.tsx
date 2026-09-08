import assert from "node:assert/strict";
import test from "node:test";
import {
  act,
  Children,
  isValidElement,
  type ComponentProps,
  type ElementType,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";

import {
  WorkbenchAgentCapabilityError,
  type WorkbenchRuntimeHostCapability,
} from "@workbench/agent-runtime-client";
import { I18nProvider } from "@workbench/shell/i18n";
import { WorkbenchSettingsProvider } from "@workbench/shell/settings";
import {
  createSameOriginRuntimeConnection,
  RuntimeConnectionProvider,
} from "@workbench/shell/runtime-connection";
import { Button, Dialog } from "@workbench/shell/ui";

import { installMinimalReactDomEnvironment } from "../../../../test/react-dom-environment";
import { RemoteDirectoryPickerDialog } from "./remote-directory-picker-dialog";
import { WorkspaceDirectoryPickerDialog } from "./workspace-directory-picker-dialog";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child)
      ? [child, ...elements(child.props.children)]
      : [],
  );
}

test("project type overrides connection detection and preserves native cancellation and failures", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  let tree: ReactElement;
  const props = <T extends ElementType>(type: T, value?: string): ComponentProps<T> => {
    const element = elements(tree).find(
      (candidate) =>
        candidate.type === type && (value === undefined || candidate.props.value === value),
    );
    assert.ok(element);
    return element.props as ComponentProps<T>;
  };

  try {
    for (const scenario of [
      { origin: "http://localhost:3000", choice: "remote", remote: true },
      { origin: "https://workbench.example.test", remote: true },
      { origin: "http://localhost:3000", result: "/work/local" },
      { origin: "https://workbench.example.test", choice: "local", result: "/work/local" },
      {
        origin: "http://localhost:3000",
        result: "/work/local",
        admissionError: new WorkbenchAgentCapabilityError("unavailable"),
      },
      { origin: "http://localhost:3000" },
      { origin: "http://localhost:3000", error: new Error("Picker failed") },
      {
        origin: "http://localhost:3000",
        error: new WorkbenchAgentCapabilityError("unavailable"),
        remote: true,
      },
      {
        origin: "http://localhost:3000",
        error: new WorkbenchAgentCapabilityError("permission-denied"),
        remote: true,
      },
    ] as const) {
      const calls: string[] = [];
      const hostClient = {
        pickDirectory: async () => {
          calls.push("native");
          if ("error" in scenario) throw scenario.error;
          return "result" in scenario ? scenario.result : undefined;
        },
      } as WorkbenchRuntimeHostCapability;
      function Probe() {
        tree = WorkspaceDirectoryPickerDialog({
          hostClient,
          onClose: () => calls.push("close"),
          onSelectPath: (path) => {
            calls.push(`select:${path}`);
            if ("admissionError" in scenario) throw scenario.admissionError;
          },
        });
        return null;
      }

      await act(async () => {
        root.render(
          <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
            <I18nProvider initialLocale="en-US">
              <RuntimeConnectionProvider
                key={scenario.origin}
                connection={createSameOriginRuntimeConnection(scenario.origin)}
              >
                <Probe />
              </RuntimeConnectionProvider>
            </I18nProvider>
          </WorkbenchSettingsProvider>,
        );
      });
      const defaultType = scenario.origin.includes("localhost") ? "local" : "remote";
      assert.equal(props("input", defaultType).checked, true);
      assert.deepEqual(calls, [], "opening the panel must not launch a picker");

      if ("choice" in scenario) {
        await act(async () => {
          props("input", scenario.choice).onChange?.({} as never);
        });
        assert.equal(props("input", scenario.choice).checked, true);
      }
      await act(async () => {
        props("form").onSubmit?.({ preventDefault() {} } as never);
      });

      if ("remote" in scenario) {
        assert.equal(tree!.type, RemoteDirectoryPickerDialog);
        assert.deepEqual(calls, "error" in scenario ? ["native"] : []);
        await props(RemoteDirectoryPickerDialog).onSelectPath("/work/remote");
        props(RemoteDirectoryPickerDialog).onOpenChange(false);
        assert.deepEqual(calls.slice(-2), ["select:/work/remote", "close"]);
      } else if ("result" in scenario) {
        if ("admissionError" in scenario) {
          assert.deepEqual(calls, ["native", "select:/work/local"]);
          assert.equal(tree!.type, Dialog);
          assert.equal(
            elements(tree!).some((element) => element.props.role === "alert"),
            true,
          );
        } else {
          assert.deepEqual(calls, ["native", "select:/work/local", "close"]);
        }
      } else {
        assert.deepEqual(calls, ["native"]);
        assert.equal(tree!.type, Dialog);
        assert.equal(props("fieldset").disabled, false);
        assert.equal(
          elements(tree!).some((element) => element.props.role === "alert"),
          "error" in scenario,
        );
      }
      await act(async () => root.render(null));
    }
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
});

test("pending native selection can recover or close without applying late results", async (context) => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let tree: ReactElement;
  const props = <T extends ElementType>(type: T): ComponentProps<T> => {
    const element = elements(tree).find((candidate) => candidate.type === type);
    assert.ok(element);
    return element.props as ComponentProps<T>;
  };
  const fallback = () =>
    elements(tree).find(
      (element) =>
        element.type === Button && element.props.children === "Use remote folder browser",
    ) as ReactElement<ComponentProps<typeof Button>> | undefined;
  const hasSlowHint = () => elements(tree).some((element) => element.props.role === "status");

  try {
    for (const scenario of [
      { action: "remote", delay: false, reject: false },
      { action: "remote", delay: true, reject: true },
      { action: "close", delay: true, reject: false },
      { action: "close", delay: false, reject: true },
      { action: "unmount", delay: false, reject: false },
      { action: "unmount", delay: true, reject: true },
      { action: "local", delay: true, reject: false },
    ] as const) {
      const native = Promise.withResolvers<string | undefined>();
      const admission = Promise.withResolvers<void>();
      const calls: string[] = [];
      let signal: AbortSignal | undefined;
      const hostClient = {
        pickDirectory: (options) => {
          calls.push("native");
          signal = options?.signal;
          return native.promise;
        },
      } as WorkbenchRuntimeHostCapability;
      function Probe() {
        tree = WorkspaceDirectoryPickerDialog({
          hostClient,
          onClose: () => calls.push("close"),
          onSelectPath: (path) => {
            calls.push(`select:${path}`);
            return admission.promise;
          },
        });
        return null;
      }
      await act(async () => {
        root.render(
          <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
            <I18nProvider initialLocale="en-US">
              <RuntimeConnectionProvider
                connection={createSameOriginRuntimeConnection("http://localhost:3000")}
              >
                <Probe />
              </RuntimeConnectionProvider>
            </I18nProvider>
          </WorkbenchSettingsProvider>,
        );
      });
      await act(async () => {
        props("form").onSubmit?.({ preventDefault() {} } as never);
      });
      assert.ok(signal);
      assert.equal(signal.aborted, false);
      assert.ok(fallback(), "recovery must be available immediately");
      assert.notEqual(fallback()!.props.disabled, true);
      assert.equal(hasSlowHint(), false);
      if (scenario.delay) {
        await act(async () => context.mock.timers.tick(7_999));
        assert.equal(hasSlowHint(), false);
        await act(async () => context.mock.timers.tick(1));
        assert.equal(hasSlowHint(), true);
        assert.equal(tree!.type, Dialog, "slow native selection must not force remote fallback");
        assert.equal(signal.aborted, false);
      }

      await act(async () => {
        if (scenario.action === "remote") fallback()!.props.onClick?.({} as never);
        else if (scenario.action === "close") props(Dialog).onOpenChange?.(false, {} as never);
        else if (scenario.action === "unmount") root.render(null);
      });
      assert.equal(signal.aborted, scenario.action !== "local");
      await act(async () => {
        if (scenario.reject) native.reject(new Error("Late native picker failure"));
        else native.resolve("/work/local");
      });
      await act(async () => context.mock.timers.tick(8_000));

      if (scenario.action === "local") {
        assert.deepEqual(calls, ["native", "select:/work/local"]);
        assert.equal(fallback(), undefined, "recovery ends before project admission");
        assert.equal(hasSlowHint(), false);
        await act(async () => props(Dialog).onOpenChange?.(false, {} as never));
        assert.deepEqual(calls, ["native", "select:/work/local"], "admission blocks closing");
        await act(async () => admission.resolve());
        assert.deepEqual(calls, ["native", "select:/work/local", "close"]);
      } else {
        assert.deepEqual(calls, scenario.action === "close" ? ["native", "close"] : ["native"]);
        if (scenario.action === "remote") {
          assert.equal(tree!.type, RemoteDirectoryPickerDialog);
        }
      }
      await act(async () => root.render(null));
    }
  } finally {
    await act(async () => root.unmount());
    context.mock.timers.reset();
    environment.restore();
  }
});

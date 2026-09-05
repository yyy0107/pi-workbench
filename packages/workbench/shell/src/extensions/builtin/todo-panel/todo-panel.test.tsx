import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import {
  flushReactMicrotasks,
  installMinimalReactDomEnvironment,
} from "../../../../test/react-dom-environment";
import { I18nProvider } from "../../../i18n";
import { WorkbenchSettingsProvider } from "../../../settings";
import type { TodoSnapshot } from "../../../chat/todo-model";
import { TodoPanelContent, useTodoPanelHidden } from "./todo-panel";

test("the shared panel renders both sources, accessible progress and localized statuses", () => {
  for (const locale of ["en-US", "zh-CN"] as const) {
    const html = renderToStaticMarkup(
      <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
        <I18nProvider initialLocale={locale}>
          <TodoPanelContent
            snapshots={[
              {
                toolName: "workbench_todo",
                items: [{ id: "0", text: "Implemented", status: "completed" }],
              },
              {
                toolName: "todo",
                items: [
                  {
                    id: "1",
                    text: "Verify <output>",
                    status: "in_progress",
                    activeForm: "Running checks",
                  },
                ],
              },
            ]}
          />
        </I18nProvider>
      </WorkbenchSettingsProvider>,
    );
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /role="status"/);
    assert.match(html, /workbench_todo/);
    assert.match(html, /Verify &lt;output&gt;/);
    assert.match(html, /Running checks/);
    assert.match(html, locale === "en-US" ? /1 \/ 2 completed/ : /已完成 1 \/ 2/);
    assert.match(html, locale === "en-US" ? /In progress/ : /进行中/);
  }
});

test("clearing hides immediately while completed and unfinished lists initially remain visible", () => {
  const render = (snapshots: readonly TodoSnapshot[]) =>
    renderToStaticMarkup(
      <WorkbenchSettingsProvider service={{ load: async () => ({}), update: async () => {} }}>
        <I18nProvider initialLocale="en-US">
          <TodoPanelContent snapshots={snapshots} />
        </I18nProvider>
      </WorkbenchSettingsProvider>,
    );
  assert.equal(render([]), "");
  assert.equal(render([{ toolName: "todo", items: [] }]), "");
  const completed: TodoSnapshot[] = [
    { toolName: "workbench_todo", items: [{ id: "0", text: "Done", status: "completed" }] },
    { toolName: "todo", items: [{ id: "1", text: "Also done", status: "completed" }] },
  ];
  assert.match(render(completed), /2 \/ 2 completed/);
  for (const status of ["pending", "in_progress"] as const) {
    assert.match(
      render([
        completed[0]!,
        {
          toolName: "todo",
          items: [...completed[1]!.items, { id: "2", text: "New task", status }],
        },
      ]),
      /data-slot="todo-panel"/,
    );
  }
});

test("completion hides after five seconds, new work cancels the timer, and unmount cleans it up", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  let timeout: (() => void) | undefined;
  let hidden: boolean | undefined;
  let scheduled = 0;
  Object.assign(window, {
    setTimeout(callback: () => void, delay: number) {
      assert.equal(delay, 5_000);
      timeout = callback;
      return ++scheduled;
    },
    clearTimeout() {
      timeout = undefined;
    },
  });
  function Probe({ completed }: { completed: boolean }) {
    hidden = useTodoPanelHidden(completed);
    return null;
  }
  const render = async (completed: boolean) => {
    await act(async () => {
      root.render(createElement(Probe, { completed }));
      await flushReactMicrotasks();
    });
  };
  try {
    await render(false);
    assert.equal(hidden, false);
    assert.equal(timeout, undefined);
    await render(true);
    assert.equal(hidden, false);
    assert.ok(timeout);
    await render(true);
    assert.equal(scheduled, 1); // Unrelated renders must not restart the countdown.
    await render(false);
    assert.equal(timeout, undefined);
    assert.equal(hidden, false);
    await render(true);
    assert.equal(scheduled, 2);
    await act(async () => {
      timeout?.();
      await flushReactMicrotasks();
    });
    assert.equal(hidden, true);
    await render(false);
    assert.equal(hidden, false);
    await render(true);
    assert.equal(hidden, false);
    assert.ok(timeout);
  } finally {
    await act(async () => {
      root.unmount();
      await flushReactMicrotasks();
    });
    environment.restore();
  }
  assert.equal(timeout, undefined);
});

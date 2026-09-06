import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useModelConfigAutosave } from "./use-model-config-autosave";
import {
  emptyDraft,
  providerDraftSaveSignature,
  reconcileSavedProviderDraft,
} from "./model-config-draft";

const { installMinimalReactDomEnvironment } = await import(
  new URL("../../../../../../../workbench/shell/test/react-dom-environment.ts", import.meta.url)
    .href
);

test("autosave debounces edits and serializes newer changes, including a revert during a write", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  let current = "initial";
  let baseline = current;
  const writes: string[] = [];
  const complete: Array<() => void> = [];
  let controls!: ReturnType<typeof useModelConfigAutosave>;
  function Probe() {
    controls = useModelConfigAutosave({
      changeKey: current === baseline ? undefined : current,
      enabled: true,
      getChangeKey: () => (current === baseline ? undefined : current),
      save: async () => {
        const snapshot = current;
        writes.push(snapshot);
        await new Promise<void>((resolve) => complete.push(resolve));
        baseline = snapshot;
        return true;
      },
    });
    return null;
  }
  const render = () => act(async () => root.render(<Probe />));
  try {
    await render();
    current = "first";
    await render();
    await act(async () => t.mock.timers.tick(600));
    assert.deepEqual(writes, []);
    current = "second";
    await render();
    await act(async () => t.mock.timers.tick(700));
    assert.deepEqual(writes, ["second"]);
    assert.equal(controls.saving, true);
    current = "third";
    await render();
    await act(async () => t.mock.timers.tick(700));
    assert.deepEqual(writes, ["second"]);
    await act(async () => complete.shift()!());
    assert.deepEqual(writes, ["second", "third"]);
    current = "second";
    await render();
    await act(async () => complete.shift()!());
    assert.deepEqual(writes, ["second", "third", "second"]);
    await act(async () => complete.shift()!());
    assert.equal(baseline, current);
    assert.equal(controls.saving, false);
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
});

test("failed saves retain changes without looping; retry and unmount flush the latest draft", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  let current = "initial";
  let baseline = current;
  let fail = true;
  let attempts = 0;
  let controls!: ReturnType<typeof useModelConfigAutosave>;
  function Probe() {
    controls = useModelConfigAutosave({
      changeKey: current === baseline ? undefined : current,
      enabled: true,
      getChangeKey: () => (current === baseline ? undefined : current),
      save: async () => {
        attempts += 1;
        if (fail) return false;
        baseline = current;
        return true;
      },
    });
    return null;
  }
  const render = () => act(async () => root.render(<Probe />));
  try {
    await render();
    current = "changed";
    await render();
    await act(async () => t.mock.timers.tick(700));
    assert.equal(attempts, 1);
    assert.equal(baseline, "initial");
    await act(async () => t.mock.timers.tick(10000));
    assert.equal(attempts, 1);
    fail = false;
    await act(async () => assert.equal(await controls.flushSave(), true));
    assert.equal(baseline, "changed");
    current = "before leaving";
    await render();
    await act(async () => root.unmount());
    assert.equal(baseline, "before leaving");
    assert.equal(attempts, 3);
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
});

test("acknowledging a saved draft preserves newer fields and credentials", () => {
  const saved = {
    ...emptyDraft("example"),
    apiKey: "submitted-key",
    baseURL: "https://old.example",
  };
  const current = { ...saved, baseURL: "https://new.example", apiKey: "new-key" };
  assert.deepEqual(reconcileSavedProviderDraft(current, saved), current);
  const withSameKey = { ...current, apiKey: saved.apiKey };
  assert.deepEqual(reconcileSavedProviderDraft(withSameKey, saved), { ...withSameKey, apiKey: "" });
  assert.notEqual(providerDraftSaveSignature(saved), providerDraftSaveSignature(current));
});

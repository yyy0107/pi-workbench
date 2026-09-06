import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useModelTestFeedback } from "./use-model-test-feedback";

const { installMinimalReactDomEnvironment } = await import(
  new URL("../../../../../../../workbench/shell/test/react-dom-environment.ts", import.meta.url)
    .href
);

test("test feedback expires after three seconds and a new result gets its own timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  let result: { message: string } | undefined;
  let visible: typeof result;
  function Probe() {
    visible = useModelTestFeedback(result);
    return null;
  }
  const render = () => act(async () => root.render(<Probe />));
  try {
    await render();
    assert.equal(visible, undefined);
    result = { message: "Success" };
    await render();
    await act(async () => t.mock.timers.tick(2999));
    assert.equal(visible, result);
    await act(async () => t.mock.timers.tick(1));
    assert.equal(visible, undefined);
    result = { message: "Warning" };
    await render();
    await act(async () => t.mock.timers.tick(2000));
    result = { message: "Error" };
    await render();
    await act(async () => t.mock.timers.tick(1000));
    assert.equal(visible, result);
    await act(async () => t.mock.timers.tick(2000));
    assert.equal(visible, undefined);
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
});

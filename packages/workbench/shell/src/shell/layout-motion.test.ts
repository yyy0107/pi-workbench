import assert from "node:assert/strict";
import test from "node:test";
import { isWorkbenchLayoutMoving, observeLayoutMotion } from "./layout-motion";

function fixture() {
  const listeners = new Map<string, (event: unknown) => void>();
  const shell = {
    dataset: {} as Record<string, string>,
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const frame = () => ({
    matches: () => true,
    closest: () => shell,
    getAnimations: () => [] as unknown as Animation[],
  });
  const emit = (type: string, target: ReturnType<typeof frame>, propertyName: string) => {
    listeners.get(type)?.({ type, target, propertyName });
  };
  const element = shell as unknown as HTMLElement;
  const stop = observeLayoutMotion(element);
  return { shell, element, frame, emit, stop, listeners };
}

test("index reveal waits for both side frames and the conversation gutter to finish", () => {
  const { shell, element, frame, emit, stop } = fixture();
  const left = frame(),
    right = frame(),
    gutter = frame();
  emit("transitionrun", left, "--workbench-sidebar-expansion");
  emit("transitionrun", right, "--workbench-panel-expansion");
  emit("transitionrun", gutter, "--thread-content-inline-gutter");
  assert.equal(isWorkbenchLayoutMoving(element), true);
  emit("transitionend", left, "--workbench-sidebar-expansion");
  emit("transitionend", right, "--workbench-panel-expansion");
  assert.equal(isWorkbenchLayoutMoving(element), true, "gutter still owns a layout transition");
  emit("transitionend", gutter, "--thread-content-inline-gutter");
  assert.equal(isWorkbenchLayoutMoving(element), false);
  shell.dataset.resizing = "true";
  assert.equal(isWorkbenchLayoutMoving(element), true);
  delete shell.dataset.resizing;
  shell.dataset.windowResizing = "true";
  assert.equal(isWorkbenchLayoutMoving(element), true);
  stop();
});

test("ignores unrelated transitions and other Shell installations", () => {
  const { element, frame, emit, stop, listeners } = fixture();
  const panel = frame();
  emit("transitionrun", panel, "opacity");
  emit("transitionrun", { ...panel, matches: () => false }, "width");
  emit(
    "transitionrun",
    { ...panel, closest: () => ({}) as ReturnType<typeof panel.closest> },
    "width",
  );
  assert.equal(
    isWorkbenchLayoutMoving(element),
    false,
    "no timer when reduced motion runs no transition",
  );
  emit("transitionrun", panel, "width");
  stop();
  assert.equal(isWorkbenchLayoutMoving(element), false);
  assert.equal(listeners.size, 0);
});

test("cancelled or removed frames settle without clearing a newer reverse transition", async () => {
  const { element, frame, emit, stop } = fixture();
  const panel = frame();
  let settle!: () => void;
  panel.getAnimations = () =>
    [
      {
        transitionProperty: "width",
        finished: new Promise<void>((resolve) => {
          settle = resolve;
        }),
      },
    ] as unknown as Animation[];
  emit("transitionrun", panel, "width");
  const finishOld = settle;
  emit("transitioncancel", panel, "width");
  emit("transitionrun", panel, "width");
  finishOld();
  await Promise.resolve();
  assert.equal(isWorkbenchLayoutMoving(element), true);
  settle();
  await Promise.resolve();
  assert.equal(isWorkbenchLayoutMoving(element), false);
  stop();
});

import assert from "node:assert/strict";
import test from "node:test";
import { act, type ComponentProps, type RefObject } from "react";
import { createRoot } from "react-dom/client";

import { installMinimalReactDomEnvironment } from "../../test/react-dom-environment";
import { ConversationLayout } from "./conversation-layout";

test("the first send moves the Composer from its measured center and cancels on navigation", async () => {
  const environment = installMinimalReactDomEnvironment();
  const root = createRoot(environment.container);
  const properties = new Map<string, string>();
  const measurements: string[] = [];
  let onAnimationEnd: NonNullable<ComponentProps<"div">["onAnimationEnd"]>;
  let reducedMotion = false;
  const dock = {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
    getBoundingClientRect: () => {
      measurements.push("dock");
      return { left: 20, top: 600, width: 800, height: 100 };
    },
  };
  const centered = {
    getBoundingClientRect: () => {
      measurements.push("center");
      return { left: 120, top: 300, width: 600, height: 150 };
    },
  };
  const layout = {
    ownerDocument: { defaultView: { matchMedia: () => ({ matches: reducedMotion }) } },
    querySelector: (selector: string) =>
      selector === '[data-slot="empty-composer"]' ? centered : dock,
  };

  // Run React's actual snapshot/update lifecycle with deterministic layout measurements.
  class LayoutProbe extends ConversationLayout {
    render() {
      const element = super.render();
      (element.props.ref as RefObject<unknown>).current = layout;
      onAnimationEnd = element.props.onAnimationEnd;
      return <></>;
    }
  }
  let props: ComponentProps<typeof ConversationLayout> = {
    sessionId: "draft",
    isEmpty: true,
    isHistoryLoading: false,
    hasDockedComposer: false,
  };
  const render = (patch: Partial<typeof props> = {}) =>
    act(async () => {
      props = { ...props, ...patch };
      root.render(<LayoutProbe {...props} />);
    });

  try {
    await render();
    assert.deepEqual(measurements, [], "initial empty views do not animate");
    await render({ isEmpty: false, hasDockedComposer: true });
    assert.deepEqual(measurements, ["center", "dock"]);
    assert.equal(
      properties.get("--composer-dock-enter-transform"),
      "translate(100px, -300px) scale(0.75, 1.5)",
    );
    assert.equal(dock.dataset.animateDock, "");

    await render();
    assert.equal(measurements.length, 2, "streaming updates must not restart the animation");
    await render({ sessionId: "other-thread" });
    assert.equal(dock.dataset.animateDock, undefined, "navigation cancels an in-flight move");
    assert.equal(properties.size, 0);

    await render({ isEmpty: true });
    await render({ isEmpty: false });
    assert.equal(measurements.length, 2, "already docked project composers do not move");

    await render({ isEmpty: true, hasDockedComposer: false });
    await render({ isEmpty: false, hasDockedComposer: true, sessionId: "restored-thread" });
    assert.equal(measurements.length, 2, "switching to history must not animate as a first send");

    await render({ isEmpty: true, hasDockedComposer: false });
    await render({ isEmpty: false, hasDockedComposer: true, isHistoryLoading: true });
    assert.equal(measurements.length, 2, "history loading must not animate as a first send");

    await render({ isEmpty: true, hasDockedComposer: false, isHistoryLoading: false });
    reducedMotion = true;
    await render({ isEmpty: false, hasDockedComposer: true });
    assert.equal(measurements.length, 2, "reduced motion skips measurements and animation");

    reducedMotion = false;
    await render({ isEmpty: true, hasDockedComposer: false });
    await render({ isEmpty: false, hasDockedComposer: true });
    onAnimationEnd!({
      target: dock,
      animationName: "composer-dock-enter",
    } as unknown as Parameters<typeof onAnimationEnd>[0]);
    assert.equal(properties.size, 0, "finishing removes the temporary transform");
    assert.equal(dock.dataset.animateDock, undefined);
    await render({ isEmpty: true, hasDockedComposer: false });
    await render({ isEmpty: false, hasDockedComposer: true });
    assert.equal(dock.dataset.animateDock, "");
  } finally {
    await act(async () => root.unmount());
    environment.restore();
  }
  assert.equal(properties.size, 0, "unmounting cleans up an unfinished animation");
  assert.equal(dock.dataset.animateDock, undefined);
});

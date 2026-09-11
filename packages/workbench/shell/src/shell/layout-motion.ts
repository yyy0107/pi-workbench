const LAYOUT_FRAMES =
  '[data-slot="workbench-sidebar-layout"], [data-slot="right-workspace-layout"], [data-slot="conversation-layout"]';
const LAYOUT_PROPERTIES = new Set([
  "width",
  "--workbench-sidebar-expansion",
  "--workbench-panel-expansion",
  "--workbench-panel-maximization",
  "--thread-content-inline-gutter",
]);

export function isWorkbenchLayoutMoving(shell: HTMLElement | null | undefined): boolean {
  return (
    shell?.dataset.layoutAnimating === "true" ||
    shell?.dataset.resizing === "true" ||
    shell?.dataset.windowResizing === "true"
  );
}

/** Share actual transition lifetime; do not guess animation durations with a timer. */
export function observeLayoutMotion(shell: HTMLElement): () => void {
  const active = new Map<HTMLElement, Map<string, object>>();
  let disposed = false;
  const publish = () => {
    if (active.size) {
      if (shell.dataset.layoutAnimating !== "true") shell.dataset.layoutAnimating = "true";
    } else {
      delete shell.dataset.layoutAnimating;
    }
  };
  const finish = (target: HTMLElement, property: string, token?: object) => {
    if (disposed) return;
    const properties = active.get(target);
    if (!properties || (token && properties.get(property) !== token)) return;
    properties.delete(property);
    if (!properties.size) active.delete(target);
    publish();
  };
  const onTransition = (event: TransitionEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      !target?.matches?.(LAYOUT_FRAMES) ||
      target.closest("[data-workbench-shell]") !== shell ||
      !LAYOUT_PROPERTIES.has(event.propertyName)
    )
      return;
    if (event.type !== "transitionrun") {
      finish(target, event.propertyName);
      return;
    }
    const token = {};
    const properties = active.get(target) ?? new Map<string, object>();
    properties.set(event.propertyName, token);
    active.set(target, properties);
    publish();
    // Removed frames may not bubble transitioncancel to the Shell. The animation's
    // promise also settles on removal; an old promise must not clear a reversed transition.
    const animation = target
      .getAnimations()
      .find(
        (candidate) =>
          "transitionProperty" in candidate && candidate.transitionProperty === event.propertyName,
      );
    const settle = () => finish(target, event.propertyName, token);
    void animation?.finished.then(settle, settle);
  };
  shell.addEventListener("transitionrun", onTransition);
  shell.addEventListener("transitionend", onTransition);
  shell.addEventListener("transitioncancel", onTransition);
  return () => {
    disposed = true;
    shell.removeEventListener("transitionrun", onTransition);
    shell.removeEventListener("transitionend", onTransition);
    shell.removeEventListener("transitioncancel", onTransition);
    active.clear();
    publish();
  };
}

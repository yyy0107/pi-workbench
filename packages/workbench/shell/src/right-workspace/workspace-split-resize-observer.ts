export function observeWorkspaceSplitResize(
  element: HTMLElement,
  onWidthChange: (width: number) => void,
): () => void {
  const workspace = element.closest<HTMLElement>('[data-workbench-surface="right-workspace"]');
  let measureFrame: number | undefined;
  let debounceTimer: number | undefined;
  let maximumWaitTimer: number | undefined;

  const clearTimers = () => {
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    if (maximumWaitTimer !== undefined) window.clearTimeout(maximumWaitTimer);
    debounceTimer = undefined;
    maximumWaitTimer = undefined;
  };
  const measure = () => {
    clearTimers();
    if (measureFrame !== undefined) return;
    measureFrame = window.requestAnimationFrame(() => {
      measureFrame = undefined;
      onWidthChange(Math.round(element.getBoundingClientRect().width));
    });
  };
  const scheduleMeasure = () => {
    if (workspace?.dataset.resizing !== "true") {
      measure();
      return;
    }
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(measure, 80);
    // Continuous movement must still update pane placement before pointer release.
    maximumWaitTimer ??= window.setTimeout(measure, 160);
  };

  measure();
  const observer = new ResizeObserver(scheduleMeasure);
  observer.observe(element);
  const resizeStateObserver = workspace
    ? new MutationObserver(() => {
        if (workspace.dataset.resizing !== "true") measure();
      })
    : undefined;
  if (workspace) {
    resizeStateObserver?.observe(workspace, {
      attributes: true,
      attributeFilter: ["data-resizing"],
    });
  }
  return () => {
    observer.disconnect();
    resizeStateObserver?.disconnect();
    clearTimers();
    if (measureFrame !== undefined) window.cancelAnimationFrame(measureFrame);
  };
}

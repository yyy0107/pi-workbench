/** Keep xterm's row measurement and PTY reflow out of interactive resize previews. */
export function createTerminalResizeObserver(container: HTMLElement, resize: () => void) {
  const shell = container.closest<HTMLElement>("[data-workbench-shell]");
  const workspace = container.closest<HTMLElement>('[data-workbench-surface="right-workspace"]');
  let active = false;
  let frame: number | undefined;

  const schedule = () => {
    if (!active || frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (
        !active ||
        shell?.dataset.resizing === "true" ||
        shell?.dataset.windowResizing === "true" ||
        workspace?.dataset.resizing === "true"
      ) {
        return;
      }
      resize();
    });
  };
  const observer = new ResizeObserver(schedule);
  const resizeStateObserver = new MutationObserver(schedule);

  return {
    schedule,
    observe() {
      if (active) return;
      active = true;
      observer.observe(container);
      if (shell) {
        resizeStateObserver.observe(shell, {
          attributes: true,
          attributeFilter: ["data-resizing", "data-window-resizing"],
        });
      }
      if (workspace) {
        resizeStateObserver.observe(workspace, {
          attributes: true,
          attributeFilter: ["data-resizing"],
        });
      }
      schedule();
    },
    disconnect() {
      active = false;
      observer.disconnect();
      resizeStateObserver.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    },
  };
}

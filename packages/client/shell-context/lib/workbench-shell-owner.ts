const WORKBENCH_SHELL_SELECTOR = "[data-workbench-shell]";

/** Resolve the appearance owner for DOM contributed by one Workbench installation. */
export function resolveWorkbenchShellOwner(element: HTMLElement): HTMLElement {
  return (
    element.closest<HTMLElement>(WORKBENCH_SHELL_SELECTOR) ?? element.ownerDocument.documentElement
  );
}

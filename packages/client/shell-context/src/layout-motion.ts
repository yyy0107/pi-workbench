export function isWorkbenchLayoutMoving(shell: HTMLElement | null | undefined): boolean {
  return (
    shell?.dataset.layoutAnimating === "true" ||
    shell?.dataset.resizing === "true" ||
    shell?.dataset.windowResizing === "true"
  );
}

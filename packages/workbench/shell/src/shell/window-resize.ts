/** Keep layout changes immediate while the native window is being resized. */
export function observeWindowResize(shell: HTMLElement): () => void {
  const view = shell.ownerDocument.defaultView;
  if (!view) return () => {};

  let timeout: number | undefined;
  const finish = () => {
    delete shell.dataset.windowResizing;
    timeout = undefined;
  };
  const resize = () => {
    if (shell.dataset.windowResizing !== "true") shell.dataset.windowResizing = "true";
    view.clearTimeout(timeout);
    timeout = view.setTimeout(finish, 150);
  };

  view.addEventListener("resize", resize);
  return () => {
    view.removeEventListener("resize", resize);
    view.clearTimeout(timeout);
    finish();
  };
}

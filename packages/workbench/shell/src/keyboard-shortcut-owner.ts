function isDomNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "nodeType" in value;
}

/**
 * Routes realm-wide keyboard events to one Shell: the event/focus owner wins, while a document
 * containing exactly one Shell keeps the familiar application-global shortcut behavior.
 */
export function shellOwnsKeyboardEvent(
  root: HTMLElement | null,
  event: Pick<Event, "target">,
  portalContainer?: HTMLElement | null,
): boolean {
  if (!root) return false;
  if (
    isDomNode(event.target) &&
    (root.contains(event.target) || portalContainer?.contains(event.target))
  ) {
    return true;
  }

  const activeElement = root.ownerDocument.activeElement;
  if (
    isDomNode(activeElement) &&
    (root.contains(activeElement) || portalContainer?.contains(activeElement))
  ) {
    return true;
  }

  const shellRoots = root.ownerDocument.querySelectorAll<HTMLElement>("[data-workbench-shell]");
  return shellRoots.length === 1 && shellRoots[0] === root;
}

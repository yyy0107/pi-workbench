export interface ResizeHandleGeometry {
  width: number;
  maximum: number;
}

/** Keep live drag limits and ARIA values current without rendering a React subtree. */
export function observeResizeHandle(
  panel: HTMLElement,
  handle: HTMLElement,
  geometry: ResizeHandleGeometry,
  maximumForContainer: (width: number) => number,
): () => void {
  const parent = panel.parentElement;
  if (!parent) return () => {};

  const publish = () => {
    for (const [name, value] of [
      ["aria-valuenow", geometry.width],
      ["aria-valuemax", geometry.maximum],
    ] as const) {
      const text = String(Math.round(value));
      if (handle.getAttribute(name) !== text) handle.setAttribute(name, text);
    }
  };

  geometry.width = panel.getBoundingClientRect().width;
  geometry.maximum = maximumForContainer(parent.getBoundingClientRect().width);
  publish();
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      if (entry.target === panel) geometry.width = width;
      if (entry.target === parent) geometry.maximum = maximumForContainer(width);
    }
    publish();
  });
  observer.observe(panel);
  observer.observe(parent);
  return () => observer.disconnect();
}

declare const __WORKBENCH_BUNDLED_RESOURCES__: boolean;
/** Source snapshots accompany the inline factories in development and runtime artifacts. */
export function workbenchToolSourceDirectory(): URL {
  const bundled =
    typeof __WORKBENCH_BUNDLED_RESOURCES__ !== "undefined" && __WORKBENCH_BUNDLED_RESOURCES__;
  return new URL(bundled ? "./internal-extensions/" : "../", import.meta.url);
}

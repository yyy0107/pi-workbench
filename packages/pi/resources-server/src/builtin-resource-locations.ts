declare const __WORKBENCH_BUNDLED_RESOURCES__: boolean;

/** Bundling relocates modules to the Runtime entry; its resources retain their artifact paths. */
export function workbenchBuiltinResourceUrl(kind: "skills" | "prompts"): URL {
  const bundled =
    typeof __WORKBENCH_BUNDLED_RESOURCES__ !== "undefined" && __WORKBENCH_BUNDLED_RESOURCES__;
  return new URL(bundled ? `./internal-${kind}/` : `../resources/${kind}/`, import.meta.url);
}

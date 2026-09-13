declare const __WORKBENCH_BUNDLED_RESOURCES__: boolean;

// Source modules live in src/; independently bundled and Runtime artifacts live at their root.
const bundled =
  typeof __WORKBENCH_BUNDLED_RESOURCES__ !== "undefined" && __WORKBENCH_BUNDLED_RESOURCES__;
export const browserPackageDirectory = new URL(bundled ? "./" : "../", import.meta.url);

// Relative to the compiled Runtime entry point.
export const browserPackageArtifactRelativePath = "./internal-packages/browser";

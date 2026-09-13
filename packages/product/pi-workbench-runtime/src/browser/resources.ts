declare const __WORKBENCH_BUNDLED_RESOURCES__: boolean;
const bundled =
  typeof __WORKBENCH_BUNDLED_RESOURCES__ !== "undefined" && __WORKBENCH_BUNDLED_RESOURCES__;
/** Product source root in development; generated Browser package root when bundled. */
export const browserPackageDirectory = new URL(bundled ? "./" : "../../", import.meta.url);
export const browserPackageArtifactRelativePath = "./internal-packages/browser";

/** Persisted Pi package identity, retained while its source owner becomes the product. */
export function createBrowserPackageManifest() {
  return {
    name: "@workbench/pi-runtime-browser",
    version: "0.1.0",
    private: true,
    description: "Workbench product browser tools and browser-use skill.",
    keywords: ["pi-package"],
    type: "module",
    exports: { ".": "./index.js", "./resources": "./resources.js" },
    peerDependencies: {
      "@earendil-works/pi-ai": "*",
      "@earendil-works/pi-coding-agent": "*",
      typebox: "*",
    },
    pi: { extensions: ["./index.js"], skills: ["./skills"] },
  };
}

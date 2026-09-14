const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const mobileReactRoot = path.dirname(require.resolve("react/package.json", { paths: [__dirname] }));
const mobileReactDomRoot = path.dirname(
  require.resolve("react-dom/package.json", { paths: [__dirname] }),
);
const mobileReactEntrypoints = new Map(
  [
    "react",
    "react/compiler-runtime",
    "react/jsx-dev-runtime",
    "react/jsx-runtime",
    "react-dom",
    "react-dom/client",
  ].map((moduleName) => [moduleName, require.resolve(moduleName, { paths: [__dirname] })]),
);
const baseUiRoot = path.dirname(
  require.resolve("@base-ui/react", {
    paths: [path.resolve(__dirname, "../../packages/client/ui")],
  }),
);
const baseUiPrehydrationStub = path.join(baseUiRoot, "internals/prehydrationScript.stub.mjs");

// Shared workspace packages develop against the desktop React patch. Force every mobile bundle,
// including Expo DOM bundles compiled from symlinked sources, to use the app-local matching React
// and ReactDOM pair. Mixing the app's React with the desktop ReactDOM causes invalid hook calls.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: mobileReactRoot,
  "react-dom": mobileReactDomRoot,
};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const mobileEntrypoint = mobileReactEntrypoints.get(moduleName);
  if (mobileEntrypoint) {
    return { filePath: mobileEntrypoint, type: "sourceFile" };
  }
  // @base-ui/react's browser import map points both prehydration aliases at this no-op module.
  // Metro does not currently resolve conditional package "imports" aliases from symlinked
  // workspace dependencies, so preserve the package's browser mapping explicitly.
  if (moduleName.startsWith("#prehydration/")) {
    return { filePath: baseUiPrehydrationStub, type: "sourceFile" };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

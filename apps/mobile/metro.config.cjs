const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const mobileReactRoot = path.dirname(require.resolve("react/package.json", { paths: [__dirname] }));

// The shared i18n workspace develops against the desktop React patch. Force all mobile bundle
// imports—including symlinked workspace sources—to Expo's app-local React 19.2.3 runtime.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: mobileReactRoot,
};

module.exports = config;

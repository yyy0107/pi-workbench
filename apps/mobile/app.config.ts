import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Workbench Remote",
  slug: "workbench-remote",
  scheme: "workbench-remote",
  version: "0.1.0",
  platforms: ["ios", "android"],
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  locales: {
    en: "./locales/en.json",
    "zh-CN": "./locales/zh-CN.json",
  },
  plugins: [
    "expo-router",
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 24,
          usesCleartextTraffic: true,
        },
      },
    ],
    [
      "expo-secure-store",
      {
        faceIDPermission: false,
      },
    ],
    "expo-sqlite",
    [
      "expo-camera",
      {
        cameraPermission: "Allow Workbench Remote to scan a desktop pairing QR code.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    "react-native-quick-crypto",
  ],
  experiments: {
    typedRoutes: true,
  },
  ios: {
    bundleIdentifier: "com.piworkbench.remote",
    supportsTablet: false,
    infoPlist: {
      NSLocalNetworkUsageDescription:
        "Allow Workbench Remote to connect directly to computers on your local network.",
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
        NSExceptionDomains: {
          "ts.net": {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSIncludesSubdomains: true,
          },
        },
      },
    },
  },
  android: {
    package: "com.piworkbench.remote",
  },
};

export default config;

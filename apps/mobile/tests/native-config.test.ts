import assert from "node:assert/strict";
import test from "node:test";

import config from "../app.config.ts";

test("declares only the direct local-network transport exceptions required by each mobile OS", () => {
  assert.deepEqual(
    config.plugins?.find(
      (
        plugin,
      ): plugin is [
        string,
        {
          readonly android?: {
            readonly minSdkVersion?: number;
            readonly usesCleartextTraffic?: boolean;
          };
        },
      ] =>
        Array.isArray(plugin) && plugin[0] === "expo-build-properties",
    ),
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 24,
          usesCleartextTraffic: true,
        },
      },
    ],
  );
  assert.deepEqual(
    config.plugins?.find(
      (plugin): plugin is [string, { readonly faceIDPermission?: boolean }] =>
        Array.isArray(plugin) && plugin[0] === "expo-secure-store",
    ),
    ["expo-secure-store", { faceIDPermission: false }],
  );
  assert.deepEqual(
    config.plugins?.find(
      (
        plugin,
      ): plugin is [
        string,
        {
          readonly cameraPermission?: string;
          readonly microphonePermission?: boolean;
          readonly recordAudioAndroid?: boolean;
        },
      ] => Array.isArray(plugin) && plugin[0] === "expo-camera",
    ),
    [
      "expo-camera",
      {
        cameraPermission: "Allow Workbench Remote to scan a desktop pairing QR code.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
  );

  const infoPlist = config.ios?.infoPlist;
  assert.equal(typeof infoPlist?.NSLocalNetworkUsageDescription, "string");
  assert.equal(
    (
      infoPlist?.NSAppTransportSecurity as {
        readonly NSAllowsLocalNetworking?: boolean;
        readonly NSAllowsArbitraryLoads?: boolean;
        readonly NSExceptionDomains?: Readonly<
          Record<
            string,
            {
              readonly NSExceptionAllowsInsecureHTTPLoads?: boolean;
              readonly NSIncludesSubdomains?: boolean;
            }
          >
        >;
      }
    )?.NSAllowsLocalNetworking,
    true,
  );

  const transportSecurity = infoPlist?.NSAppTransportSecurity as {
    readonly NSAllowsArbitraryLoads?: boolean;
    readonly NSExceptionDomains?: Readonly<
      Record<
        string,
        {
          readonly NSExceptionAllowsInsecureHTTPLoads?: boolean;
          readonly NSIncludesSubdomains?: boolean;
        }
      >
    >;
  };
  assert.equal(transportSecurity.NSAllowsArbitraryLoads, undefined);
  assert.deepEqual(Object.keys(transportSecurity.NSExceptionDomains ?? {}), ["ts.net"]);
  assert.deepEqual(transportSecurity.NSExceptionDomains?.["ts.net"], {
    NSExceptionAllowsInsecureHTTPLoads: true,
    NSIncludesSubdomains: true,
  });
});

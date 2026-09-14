import assert from "node:assert/strict";
import { realpath, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

test("mobile resolves one Expo-compatible React while consuming the shared i18n runtime", async () => {
  const mobilePackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { dependencies: Record<string, string> };
  const i18nPackage = JSON.parse(
    await readFile(new URL("../../../packages/client/i18n/package.json", import.meta.url), "utf8"),
  ) as {
    dependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
  };
  const reactPackage = JSON.parse(
    await readFile(new URL("../node_modules/react/package.json", import.meta.url), "utf8"),
  ) as { version: string };
  const metroConfig = require("../metro.config.cjs") as {
    resolver: { extraNodeModules: Record<string, string> };
  };

  assert.equal(mobilePackage.dependencies["@workbench/i18n"], "workspace:*");
  assert.equal(i18nPackage.peerDependencies.react, ">=19.2.0 <20");
  assert.equal(i18nPackage.dependencies["@workbench/extension-sdk"], undefined);
  assert.equal(reactPackage.version, "19.2.3");
  assert.equal(
    await realpath(metroConfig.resolver.extraNodeModules.react),
    await realpath(new URL("../node_modules/react", import.meta.url)),
  );
});

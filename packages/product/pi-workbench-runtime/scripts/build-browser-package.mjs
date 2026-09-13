import { build } from "esbuild";
import { cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const outputDirectory = path.resolve(process.argv[2] ?? path.join(packageRoot, "dist/browser"));
await build({
  absWorkingDir: packageRoot,
  entryPoints: {
    index: "resources/extensions/browser/index.ts",
    resources: "src/browser/resources.ts",
  },
  define: { __WORKBENCH_BUNDLED_RESOURCES__: "true" },
  outdir: outputDirectory,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "typebox"],
});
const { createBrowserPackageManifest } = await import(
  pathToFileURL(path.join(outputDirectory, "resources.js")).href
);
await writeFile(
  path.join(outputDirectory, "package.json"),
  JSON.stringify(createBrowserPackageManifest(), null, 2) + "\n",
);
await cp(
  path.join(packageRoot, "resources/skills/browser-use"),
  path.join(outputDirectory, "skills/browser-use"),
  { recursive: true },
);
await cp(path.join(packageRoot, "src/browser/README.md"), path.join(outputDirectory, "README.md"));
await cp(
  path.join(packageRoot, "../../server/browser-server/THIRD_PARTY_NOTICES.md"),
  path.join(outputDirectory, "THIRD_PARTY_NOTICES.md"),
);

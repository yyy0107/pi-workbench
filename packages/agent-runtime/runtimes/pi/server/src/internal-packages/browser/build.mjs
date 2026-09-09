import { build } from "esbuild";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("./", import.meta.url));
const outputDirectory = process.argv[2] ?? path.join(packageRoot, "dist");
await build({
  absWorkingDir: packageRoot,
  entryPoints: ["index.ts", "resources.ts"],
  outdir: outputDirectory,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "typebox"],
});
const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
await writeFile(
  path.join(outputDirectory, "package.json"),
  JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      private: manifest.private,
      description: manifest.description,
      keywords: manifest.keywords,
      type: manifest.type,
      exports: { ".": "./index.js", "./resources": "./resources.js" },
      peerDependencies: manifest.peerDependencies,
      pi: { ...manifest.pi, extensions: ["./index.js"] },
    },
    null,
    2,
  ) + "\n",
);
for (const entry of ["skills", "README.md"]) {
  await cp(path.join(packageRoot, entry), path.join(outputDirectory, entry), { recursive: true });
}

await cp(
  fileURLToPath(
    new URL("../../../../../../../server/browser/THIRD_PARTY_NOTICES.md", import.meta.url),
  ),
  path.join(outputDirectory, "THIRD_PARTY_NOTICES.md"),
);

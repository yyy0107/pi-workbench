import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

await build({
  entryPoints: ["index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "typebox"],
});
await mkdir("dist", { recursive: true });
await writeFile(
  "dist/resources.js",
  'export const browserSkillDirectory = new URL("../skills/browser/", import.meta.url);\n',
);

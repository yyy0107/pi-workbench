import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import workbenchPaths from "../../../scripts/workbench-paths.cjs";

const require = createRequire(import.meta.url);
const { webPublicRoot } = workbenchPaths.defaultWorkbenchPaths;
const packageRoot = dirname(require.resolve("material-icon-theme/package.json"));
const source = join(packageRoot, "icons");
const manifestSource = join(packageRoot, "dist", "material-icons.json");
const targetRoot = join(webPublicRoot, "vendor", "material-icon-theme");
const target = join(targetRoot, "icons");
const manifestTarget = join(targetRoot, "material-icons.json");

await rm(targetRoot, { force: true, recursive: true });
await mkdir(targetRoot, { recursive: true });
await cp(source, target, { recursive: true });
await cp(manifestSource, manifestTarget);

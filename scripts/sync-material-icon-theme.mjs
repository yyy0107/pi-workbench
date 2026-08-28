import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(projectRoot, "node_modules", "material-icon-theme");
const source = join(packageRoot, "icons");
const manifestSource = join(packageRoot, "dist", "material-icons.json");
const targetRoot = join(projectRoot, "public", "vendor", "material-icon-theme");
const target = join(targetRoot, "icons");
const manifestTarget = join(targetRoot, "material-icons.json");

await rm(targetRoot, { force: true, recursive: true });
await mkdir(targetRoot, { recursive: true });
await cp(source, target, { recursive: true });
await cp(manifestSource, manifestTarget);

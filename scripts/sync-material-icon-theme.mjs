import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(projectRoot, "node_modules", "material-icon-theme", "icons");
const target = join(projectRoot, "public", "vendor", "material-icon-theme", "icons");

await rm(target, { force: true, recursive: true });
await mkdir(dirname(target), { recursive: true });
await cp(source, target, { recursive: true });

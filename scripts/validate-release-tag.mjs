import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2];
const tagPattern = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

if (!tag || !tagPattern.test(tag)) {
  throw new Error(`Release tag must match vMAJOR.MINOR.PATCH or a SemVer prerelease: ${tag ?? ""}`);
}

const rootManifest = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
if (tag.slice(1) !== rootManifest.version) {
  throw new Error(`Release tag ${tag} does not match root version ${rootManifest.version}.`);
}
for (const relativePath of [
  "apps/web/package.json",
  "apps/runtime-node/package.json",
  "apps/desktop-electron/package.json",
  "apps/desktop-renderer/package.json",
]) {
  const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
  if (manifest.version !== rootManifest.version) {
    throw new Error(
      `${relativePath} version ${manifest.version} does not match ${rootManifest.version}.`,
    );
  }
}
function gitRevision(revision) {
  return execFileSync("git", ["rev-parse", revision], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

const head = gitRevision("HEAD");
const tagged = gitRevision(`refs/tags/${tag}^{commit}`);
if (head !== tagged) {
  throw new Error(`Release tag ${tag} points to ${tagged}, but HEAD is ${head}.`);
}
execFileSync("git", ["merge-base", "--is-ancestor", head, "origin/main"], { cwd: repositoryRoot });
if (
  execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim()
) {
  throw new Error("Release builds require a clean checkout of the tagged commit.");
}

process.stdout.write(
  `${JSON.stringify({ tag, version: rootManifest.version, prerelease: tag.includes("-"), commit: head })}\n`,
);

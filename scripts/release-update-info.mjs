import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/** JSON is valid YAML; generate one native updater manifest per release target. */
export function releaseUpdateInfo({ targetKey, version, directory, packages }) {
  const extension = targetKey.startsWith("win32-")
    ? ".exe"
    : targetKey.startsWith("darwin-")
      ? ".zip"
      : ".AppImage";
  const candidates = packages.filter((asset) => asset.filename.endsWith(extension));
  if (candidates.length !== 1)
    throw new Error(`Expected one ${extension} update for ${targetKey}.`);
  const file = candidates[0];
  const content = readFileSync(path.join(directory, file.filename));
  const sha512 = createHash("sha512").update(content).digest("base64");
  return {
    filename: `latest-${targetKey}.yml`,
    content:
      JSON.stringify(
        {
          version,
          files: [{ url: file.filename, sha512, size: content.length }],
          path: file.filename,
          sha512,
        },
        null,
        2,
      ) + "\n",
  };
}

import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const SYNC_MARKER = ".workbench-assets";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function syncStaticAssets({ entries, fingerprint, targetRoot }) {
  const marker = path.join(targetRoot, SYNC_MARKER);
  const previousFingerprint = await readFile(marker, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
  if (
    previousFingerprint === fingerprint &&
    (await Promise.all(entries.map(({ target }) => exists(path.join(targetRoot, target))))).every(
      Boolean,
    )
  ) {
    return false;
  }

  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });
  await Promise.all(
    entries.map(async ({ source, target }) => {
      const destination = path.join(targetRoot, target);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true });
    }),
  );
  await writeFile(marker, fingerprint);
  return true;
}

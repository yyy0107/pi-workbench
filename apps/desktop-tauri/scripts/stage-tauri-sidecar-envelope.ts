import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { stageTauriSidecarEnvelope } from "./tauri-sidecar-envelope";

export async function main(): Promise<void> {
  const staged = await stageTauriSidecarEnvelope();
  process.stdout.write(
    `[desktop-tauri] Staged ${staged.envelope.nodeBinary.filename} and ${staged.envelope.materializedTree.fileCount} Runtime files.\n`,
  );
}

const invokedFile = process.argv[1] ? realpathSync(process.argv[1]) : undefined;
if (invokedFile === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

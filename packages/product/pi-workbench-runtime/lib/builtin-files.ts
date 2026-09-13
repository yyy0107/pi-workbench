import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { atomicReplaceFile } from "@workbench/server-core/file-persistence";

export async function ensureBuiltinDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) {
    throw new Error("A built-in resource directory cannot be a symbolic link.");
  }
}

export async function writeBuiltinFile(filePath: string, content: string): Promise<void> {
  try {
    if ((await readFile(filePath, "utf8")) === content) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await atomicReplaceFile(filePath, content);
}

export async function copyBuiltinDirectory(source: string, destination: string): Promise<void> {
  await ensureBuiltinDirectory(destination);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyBuiltinDirectory(sourcePath, destinationPath);
    else if (entry.isFile())
      await writeBuiltinFile(destinationPath, await readFile(sourcePath, "utf8"));
  }
}

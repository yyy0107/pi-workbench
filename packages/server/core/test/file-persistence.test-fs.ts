import { promises as fs } from "node:fs";

const REMOVE_HOOK = Symbol.for("workbench.file-persistence.test.remove-hook");

type RemoveHook = (
  target: Parameters<typeof fs.rm>[0],
  options: Parameters<typeof fs.rm>[1],
) => Promise<void>;

export const chmod = fs.chmod;
export const link = fs.link;
export const mkdir = fs.mkdir;
export const open = fs.open;
export const readdir = fs.readdir;
export const readFile = (async (...args: Parameters<typeof fs.readFile>) => {
  const hook = Reflect.get(globalThis, Symbol.for("workbench.file-persistence.test.read-hook")) as
    | ((target: Parameters<typeof fs.readFile>[0]) => Promise<void>)
    | undefined;
  await hook?.(args[0]);
  return fs.readFile(...args);
}) as typeof fs.readFile;
export const rename = fs.rename;
export const rmdir = fs.rmdir;
export const stat = fs.stat;
export const utimes = fs.utimes;

export async function rm(
  target: Parameters<typeof fs.rm>[0],
  options: Parameters<typeof fs.rm>[1],
): Promise<void> {
  const hook = Reflect.get(globalThis, REMOVE_HOOK) as RemoveHook | undefined;
  await hook?.(target, options);
  await fs.rm(target, options);
}

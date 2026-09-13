import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

import { childProcessEnvironment } from "@workbench/server-core/child-process-environment";

export interface LocalAppCommandResult {
  stdout: string;
  stderr: string;
}

export type LocalAppCommandRunner = (
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<LocalAppCommandResult>;

export type LocalAppPathExists = (candidate: string) => Promise<boolean>;

export interface DetachedSpawnOptions {
  cwd?: string;
}

export type LocalAppDetachedSpawner = (
  command: string,
  args: readonly string[],
  options?: DetachedSpawnOptions,
) => Promise<void>;

export function runLocalAppCommand(
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<LocalAppCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, signal, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

export async function localAppPathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

export function localAppSpawnEnvironment(
  env: Readonly<NodeJS.ProcessEnv> = process.env,
): NodeJS.ProcessEnv {
  return childProcessEnvironment(env) as NodeJS.ProcessEnv;
}

export function spawnLocalAppDetached(
  command: string,
  args: readonly string[],
  options: DetachedSpawnOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      detached: true,
      env: localAppSpawnEnvironment(),
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function findExecutable(
  names: readonly string[],
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    platform?: NodeJS.Platform;
    exists?: LocalAppPathExists;
  } = {},
): Promise<string | undefined> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? localAppPathExists;
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  const delimiter = platform === "win32" ? ";" : ":";
  const pathApi = platform === "win32" ? path.win32 : path;
  const extensions =
    platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean) : [""];

  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidates =
        platform === "win32" && !pathApi.extname(name)
          ? extensions.map((extension) => pathApi.join(directory, `${name}${extension}`))
          : [pathApi.join(directory, name)];
      for (const candidate of candidates) {
        if (await exists(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

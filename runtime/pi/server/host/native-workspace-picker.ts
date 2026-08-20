import { execFile } from "node:child_process";
import { homedir } from "node:os";

export type NativeWorkspacePickerRunner = (
  command: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<{ stdout: string; stderr: string }>;

export interface NativeWorkspacePickerInternals {
  platform?: NodeJS.Platform;
  run?: NativeWorkspacePickerRunner;
}

export class NativeWorkspacePickerUnavailableError extends Error {
  constructor() {
    super("No supported native workspace directory picker is available.");
    this.name = "NativeWorkspacePickerUnavailableError";
  }
}

function outputPath(stdout: string): string | undefined {
  const selectedPath = stdout.replace(/[\r\n]+$/, "");
  return selectedPath || undefined;
}

function errorCode(error: unknown): string | number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

function errorStderr(error: unknown): string {
  if (typeof error !== "object" || error === null || !("stderr" in error)) return "";
  const stderr = (error as { stderr?: unknown }).stderr;
  return typeof stderr === "string" ? stderr : "";
}

function runNativeCommand(
  command: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        env:
          process.platform === "linux" && process.env.DISPLAY
            ? { ...process.env, GDK_BACKEND: "x11" }
            : process.env,
        maxBuffer: 1024 * 1024,
        signal,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            Object.assign(new Error(error.message, { cause: error }), {
              code: error.code,
              stdout,
              stderr,
            }),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function pickerUnavailable(): NativeWorkspacePickerUnavailableError {
  return new NativeWorkspacePickerUnavailableError();
}

export async function pickNativeWorkspaceDirectory(
  signal: AbortSignal,
  internals: NativeWorkspacePickerInternals = {},
): Promise<string | undefined> {
  const platform = internals.platform ?? process.platform;
  const run = internals.run ?? runNativeCommand;

  if (platform === "darwin") {
    try {
      const result = await run(
        "osascript",
        ["-e", "set selectedFolder to choose folder", "-e", "POSIX path of selectedFolder"],
        signal,
      );
      return outputPath(result.stdout);
    } catch (error) {
      if (
        !signal.aborted &&
        errorCode(error) === 1 &&
        /(?:User canceled|-128)/i.test(errorStderr(error))
      ) {
        return undefined;
      }
      throw error;
    }
  }

  if (platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.ShowNewFolderButton = $true",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "  Write-Output $dialog.SelectedPath",
      "}",
    ].join("; ");
    const result = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
      signal,
    );
    return outputPath(result.stdout);
  }

  if (platform === "linux") {
    try {
      const result = await run("zenity", ["--file-selection", "--directory"], signal);
      return outputPath(result.stdout);
    } catch (error) {
      if (signal.aborted) throw error;
      if (errorCode(error) === 1) return undefined;
      if (errorCode(error) !== "ENOENT") throw error;
    }

    try {
      const result = await run("kdialog", ["--getexistingdirectory", homedir()], signal);
      return outputPath(result.stdout);
    } catch (error) {
      if (signal.aborted) throw error;
      if (errorCode(error) === 1) return undefined;
      if (errorCode(error) !== "ENOENT") throw error;
    }

    try {
      const result = await run("yad", ["--file-selection", "--directory"], signal);
      return outputPath(result.stdout);
    } catch (error) {
      if (signal.aborted) throw error;
      if (errorCode(error) === 1 || errorCode(error) === 252) return undefined;
      if (errorCode(error) === "ENOENT") throw pickerUnavailable();
      throw error;
    }
  }

  throw pickerUnavailable();
}

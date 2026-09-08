import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { childProcessEnvironment } from "@workbench/server-core/child-process-environment";

import { BrowserError } from "./errors";

export interface CdpEvent {
  method: string;
  params: Record<string, any>;
  sessionId?: string;
}

const MAX_CDP_MESSAGE_BYTES = 96 * 1024 * 1024;

/** A private pipe keeps the browser's unrestricted debugging port off the network. */
export class BrowserCdp {
  private readonly pending = new Map<
    number,
    {
      method: string;
      resolve(value: any): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly listeners = new Set<(event: CdpEvent) => void>();
  private chunks: Buffer[] = [];
  private bufferedBytes = 0;
  private sequence = 0;
  private closed = false;
  private closing = false;
  readonly process: ChildProcess;
  private readonly input: Writable;

  constructor(executable: string, profileDirectory: string, onClose: () => void) {
    this.process = spawn(
      executable,
      [
        "--headless",
        // Match the live stream's 2x density to bound compositor work.
        "--force-device-scale-factor=2",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--allow-chrome-scheme-url",
        "--enable-features=WebMCP,WebMCPTesting",
        "--remote-debugging-pipe",
        `--user-data-dir=${profileDirectory}`,
        "about:blank",
      ],
      {
        stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
        windowsHide: true,
        env: childProcessEnvironment(process.env),
      },
    );
    this.input = this.process.stdio[3] as Writable;
    const output = this.process.stdio[4] as Readable;
    const close = () => {
      if (this.closed) return;
      this.closed = true;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new BrowserError("browser-unavailable"));
      }
      this.pending.clear();
      this.listeners.clear();
      this.chunks = [];
      this.bufferedBytes = 0;
      onClose();
    };
    this.process.once("error", close);
    this.process.once("exit", close);
    this.input.on("error", close);
    output.on("error", close);
    output.on("close", close);
    output.on("data", (chunk: Buffer) => {
      if (this.closed || this.closing) return;
      let start = 0;
      while (start < chunk.length) {
        const boundary = chunk.indexOf(0, start);
        const end = boundary === -1 ? chunk.length : boundary;
        const part = chunk.subarray(start, end);
        const size = this.bufferedBytes + part.length;
        if (size > MAX_CDP_MESSAGE_BYTES) {
          this.dispose();
          return;
        }
        this.bufferedBytes = size;
        if (boundary === -1) {
          this.chunks.push(part);
          return;
        }
        // Copy a fragmented message once, instead of recopying it on every pipe chunk.
        const message = this.chunks.length
          ? Buffer.concat([...this.chunks, part], this.bufferedBytes).toString("utf8")
          : part.toString("utf8");
        this.chunks = [];
        this.bufferedBytes = 0;
        start = boundary + 1;
        try {
          const payload = JSON.parse(message);
          if (payload.id) {
            const request = this.pending.get(payload.id);
            if (!request) continue;
            this.pending.delete(payload.id);
            clearTimeout(request.timer);
            if (payload.error) {
              const diagnostic = [payload.error.message, payload.error.data]
                .filter((value): value is string => typeof value === "string")
                .join(". ");
              request.reject(
                new BrowserError(
                  "browser-operation-failed",
                  `CDP ${request.method} (${payload.error.code}): ${diagnostic}`,
                ),
              );
            } else request.resolve(payload.result ?? {});
          } else if (typeof payload.method === "string") {
            for (const listener of this.listeners) listener(payload);
          }
        } catch {
          this.dispose();
          return;
        }
      }
    });
  }

  send<T = Record<string, any>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = 30_000,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.closed) return Promise.reject(new BrowserError("browser-unavailable"));
    const id = ++this.sequence;
    let abort: (() => void) | undefined;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BrowserError(
            "browser-operation-failed",
            `CDP ${method} timed out after ${timeoutMs} ms.`,
          ),
        );
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { method, resolve, reject, timer });
      abort = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.input.write(
        `${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`,
        (error) => {
          if (!error) return;
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new BrowserError("browser-unavailable"));
        },
      );
    }).finally(() => {
      if (abort) signal?.removeEventListener("abort", abort);
    });
  }

  subscribe(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.closed || this.closing) return;
    this.closing = true;
    void this.send("Browser.close").catch(() => undefined);
    const process = this.process;
    const timer = setTimeout(() => process.kill(), 1_000);
    timer.unref();
    process.once("exit", () => clearTimeout(timer));
  }
}

export async function findBrowserExecutable(): Promise<string> {
  const explicit = process.env.WORKBENCH_BROWSER_EXECUTABLE?.trim();
  const candidates = explicit
    ? [explicit]
    : process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          path.join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ]
      : process.platform === "win32"
        ? [
            ...[
              process.env.PROGRAMFILES,
              process.env["PROGRAMFILES(X86)"],
              process.env.LOCALAPPDATA,
            ]
              .filter((directory): directory is string => Boolean(directory))
              .map((directory) => path.join(directory, "Google/Chrome/Application/chrome.exe")),
            "chrome.exe",
            "chromium.exe",
          ]
        : [
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
            "/opt/google/chrome/chrome",
          ];
  for (const candidate of candidates) {
    const paths =
      path.isAbsolute(candidate) || /[\\/]/.test(candidate)
        ? [path.resolve(candidate)]
        : (process.env.PATH ?? "")
            .split(path.delimiter)
            .filter(Boolean)
            .map((directory) => path.join(directory, candidate));
    for (const executable of paths) {
      try {
        await access(executable, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return executable;
      } catch {
        /* Try the next installed browser. */
      }
    }
  }
  throw new BrowserError("browser-unavailable");
}

export async function launchBrowser(
  profileDirectory: string,
  onClose: () => void,
): Promise<BrowserCdp> {
  await mkdir(profileDirectory, { recursive: true, mode: 0o700 });
  const cdp = new BrowserCdp(await findBrowserExecutable(), profileDirectory, onClose);
  try {
    const version = await cdp.send("Browser.getVersion");
    const major = /(?:Chrome|Chromium)\/(\d+)/.exec(version.product)?.[1];
    if (!major || Number(major) < 123) throw new BrowserError("browser-unavailable");
    return cdp;
  } catch {
    cdp.dispose();
    throw new BrowserError("browser-unavailable");
  }
}

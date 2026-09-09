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
  readonly process?: ChildProcess;
  private readonly input?: Writable;
  private readonly socket?: WebSocket;

  constructor(executable: string | WebSocket, profileDirectory: string, onClose: () => void) {
    let output: Readable | undefined;
    if (typeof executable === "string") {
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
      output = this.process.stdio[4] as Readable;
    } else this.socket = executable;
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
    this.process?.once("error", close);
    this.process?.once("exit", close);
    this.input?.on("error", close);
    output?.on("error", close);
    output?.on("close", close);
    this.socket?.addEventListener("close", close);
    this.socket?.addEventListener("error", close);
    const receive = (chunk: Buffer) => {
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
    };
    output?.on("data", receive);
    this.socket?.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        this.dispose();
        return;
      }
      receive(Buffer.from(`${event.data}\0`));
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
      const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
      const failed = (error?: Error | null) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new BrowserError("browser-unavailable"));
      };
      if (this.socket) {
        try {
          this.socket.send(payload);
        } catch (error) {
          failed(error as Error);
        }
      } else this.input!.write(`${payload}\0`, failed);
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
    if (this.socket) {
      this.socket.close();
      return;
    }
    void this.send("Browser.close").catch(() => undefined);
    const process = this.process;
    if (!process) return;
    const timer = setTimeout(() => process.kill(), 1_000);
    timer.unref();
    process.once("exit", () => clearTimeout(timer));
  }
}

export function cdpEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BrowserError("browser-invalid");
  }
  if (
    !["http:", "https:", "ws:", "wss:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new BrowserError(
      "browser-invalid",
      "Chrome debugging endpoints must use a loopback address without credentials.",
    );
  return url;
}

/** Disconnecting an external browser never sends Browser.close or terminates its process. */
export async function connectBrowser(endpoint: string, onClose: () => void): Promise<BrowserCdp> {
  let url = cdpEndpoint(endpoint);
  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = await fetch(new URL("/json/version", url), {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!response.ok) throw new BrowserError("browser-unavailable");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > 65536) throw new BrowserError("browser-invalid");
      chunks.push(Buffer.from(chunk));
    }
    const version = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof version.webSocketDebuggerUrl !== "string")
      throw new BrowserError("browser-unavailable");
    url = cdpEndpoint(version.webSocketDebuggerUrl);
  }
  if (!["ws:", "wss:"].includes(url.protocol) || !url.pathname.startsWith("/devtools/browser/"))
    throw new BrowserError(
      "browser-invalid",
      "Use the browser debugger endpoint, not a page debugger URL.",
    );
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new BrowserError("browser-unavailable"));
    }, 15000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new BrowserError("browser-unavailable"));
      },
      { once: true },
    );
    socket.addEventListener(
      "close",
      () => {
        clearTimeout(timer);
        reject(new BrowserError("browser-unavailable"));
      },
      { once: true },
    );
  });
  return new BrowserCdp(socket, "", onClose);
}

export async function findBrowserExecutable(preferred?: readonly string[]): Promise<string> {
  const explicit = process.env.WORKBENCH_BROWSER_EXECUTABLE?.trim();
  const candidates =
    preferred ??
    (explicit
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
            ]);
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

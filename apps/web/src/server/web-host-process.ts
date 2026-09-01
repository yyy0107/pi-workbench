import type { Writable } from "node:stream";

import {
  WebHostControlSessionResultCode,
  runWebHostControlSession,
} from "@workbench/host-server/web-host-control-session";

import { loadWebArtifactRuntimeLayout, type WebArtifactRuntimeLayout } from "./web-artifact-layout";
import { startWebOnlyHost } from "./web-only-host";

function redirectControlConsoleToStderr(): () => void {
  const original = { debug: console.debug, info: console.info, log: console.log };
  console.debug = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);
  console.log = (...args: unknown[]) => console.error(...args);
  return () => {
    console.debug = original.debug;
    console.info = original.info;
    console.log = original.log;
  };
}

export interface WebHostProcessSignalSource {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

function installProcessLifecycle(
  controller: AbortController,
  source: WebHostProcessSignalSource,
): { readonly wasSignalled: () => boolean; dispose(): void } {
  let signalled = false;
  const abort = () => {
    if (signalled) return;
    signalled = true;
    if (!controller.signal.aborted) controller.abort();
  };
  source.once("SIGINT", abort);
  source.once("SIGTERM", abort);
  return Object.freeze({
    wasSignalled: () => signalled,
    dispose() {
      source.off("SIGINT", abort);
      source.off("SIGTERM", abort);
    },
  });
}

function forwardLifecycleAbort(
  controller: AbortController,
  source: AbortSignal | undefined,
): () => void {
  if (!source || source === controller.signal) return () => undefined;
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  if (source.aborted) abort();
  else source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

export interface RunWebHostProcessOptions {
  /** Always derived from the primary entry's import.meta.url in production. */
  readonly artifactRoot: string;
  readonly input?: NodeJS.ReadableStream & AsyncIterable<Uint8Array>;
  readonly output?: Writable;
  readonly pid?: number;
  readonly forceExit?: (code: 0 | 1) => void;
  readonly setExitCode?: (code: 0 | 1) => void;
  readonly loadLayout?: (artifactRoot: string) => Promise<WebArtifactRuntimeLayout>;
  readonly runControlSession?: typeof runWebHostControlSession;
  readonly startHost?: typeof startWebOnlyHost;
  readonly lifecycleController?: AbortController;
  readonly lifecycleSignal?: AbortSignal;
  readonly processControl?: WebHostProcessSignalSource;
}

/** Owns production stdio control while deferring all Web construction until a valid start frame. */
export async function runWebHostProcess({
  artifactRoot,
  input = process.stdin,
  output = process.stdout,
  pid = process.pid,
  forceExit = (code) => process.exit(code),
  setExitCode = (code) => {
    process.exitCode = code;
  },
  loadLayout = loadWebArtifactRuntimeLayout,
  runControlSession = runWebHostControlSession,
  startHost = startWebOnlyHost,
  lifecycleController = new AbortController(),
  lifecycleSignal,
  processControl = process,
}: RunWebHostProcessOptions): Promise<void> {
  const restoreConsole = redirectControlConsoleToStderr();
  const stopForwardingLifecycle = forwardLifecycleAbort(lifecycleController, lifecycleSignal);
  const processLifecycle = installProcessLifecycle(lifecycleController, processControl);
  let layoutOperation: Promise<WebArtifactRuntimeLayout> | undefined;
  try {
    const result = await runControlSession({
      input,
      output,
      pid,
      lifecycleController,
      async startHost({ host, port, startupSignal }) {
        layoutOperation ??= loadLayout(artifactRoot);
        const layout = await layoutOperation;
        return startHost({
          dev: false,
          hostname: host,
          port,
          startupSignal,
          webRoot: layout.webRoot,
        });
      },
    });
    const successful =
      result.code === WebHostControlSessionResultCode.shutdownAcknowledged ||
      result.code === WebHostControlSessionResultCode.controlDisconnected;
    setExitCode(successful ? 0 : 1);
    if (!successful) forceExit(1);
    else if (processLifecycle.wasSignalled()) forceExit(0);
  } catch (error) {
    setExitCode(1);
    forceExit(1);
    throw error;
  } finally {
    processLifecycle.dispose();
    stopForwardingLifecycle();
    restoreConsole();
  }
}

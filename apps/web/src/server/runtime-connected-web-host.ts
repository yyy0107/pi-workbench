import runtimeArtifactAdmission from "@workbench/host-artifact-policy/runtime-admission";
import type { DesktopSidecarRuntimeConnection } from "@workbench/host-contracts/runtime-connection";
import { STREAM_PATHS } from "@workbench/agent-runtime-pi-protocol/stream";

import {
  WEB_APPLICATION_HOST,
  startWebApplicationHost,
  type RunningWebApplicationHost,
  type WebApplicationHostDependencies,
  type WebApplicationHostShutdownOptions,
} from "./web-application-host";

export const RUNTIME_ARTIFACT_UPGRADE_PATHS =
  runtimeArtifactAdmission.createRuntimeArtifactAdmissionPolicy([
    STREAM_PATHS.mux,
    STREAM_PATHS.host,
  ]).expectedUpgradePaths;

export const RUNTIME_CONNECTED_WEB_HOST = WEB_APPLICATION_HOST;

export type RuntimeConnectedWebHostShutdownOptions = WebApplicationHostShutdownOptions;

export interface StartRuntimeConnectedWebHostOptions {
  readonly dev: boolean;
  readonly hostname: typeof RUNTIME_CONNECTED_WEB_HOST;
  readonly port: number;
  readonly publicOrigin: string;
  readonly runtimeConnection: DesktopSidecarRuntimeConnection;
  readonly startupSignal?: AbortSignal;
  readonly webRoot: string;
}

export type RunningRuntimeConnectedWebHost = RunningWebApplicationHost;
export type RuntimeConnectedWebHostDependencies = WebApplicationHostDependencies;

/**
 * Starts the browser Web owner over an already-admitted Runtime endpoint. The connection is used
 * only by the transport proxy and never grants this process Runtime lifecycle ownership.
 */
export async function startRuntimeConnectedWebHost(
  options: StartRuntimeConnectedWebHostOptions,
  dependencies: RuntimeConnectedWebHostDependencies = {},
): Promise<RunningRuntimeConnectedWebHost> {
  try {
    return await startWebApplicationHost(
      {
        dev: options.dev,
        hostname: options.hostname,
        port: options.port,
        runtime: {
          connection: options.runtimeConnection,
          publicOrigin: options.publicOrigin,
          upgradeRequiredPaths: RUNTIME_ARTIFACT_UPGRADE_PATHS,
        },
        startupSignal: options.startupSignal,
        webRoot: options.webRoot,
      },
      dependencies,
    );
  } catch {
    throw new Error("Runtime-connected Web Host startup failed.");
  }
}

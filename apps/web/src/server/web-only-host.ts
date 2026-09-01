import path from "node:path";

import {
  WEB_APPLICATION_HOST,
  isWebApplicationPort,
  startWebApplicationHost,
  type RunningWebApplicationHost,
  type WebApplicationHostDependencies,
  type WebApplicationHostShutdownOptions,
} from "./web-application-host";

export const WEB_ONLY_HOST = WEB_APPLICATION_HOST;

export type WebOnlyHostShutdownOptions = WebApplicationHostShutdownOptions;

export interface StartWebOnlyHostOptions {
  readonly dev: false;
  readonly hostname: typeof WEB_ONLY_HOST;
  readonly port: number;
  readonly startupSignal?: AbortSignal;
  readonly webRoot: string;
}

export type RunningWebOnlyHost = RunningWebApplicationHost;

export type WebOnlyHostDependencies = Pick<
  WebApplicationHostDependencies,
  "createNext" | "createPublicServer"
>;

/**
 * Starts only the public Next listener. Runtime API and WebSocket traffic remain unavailable;
 * this owner never imports, constructs, or launches the Runtime application graph.
 */
export async function startWebOnlyHost(
  options: StartWebOnlyHostOptions,
  dependencies: WebOnlyHostDependencies = {},
): Promise<RunningWebOnlyHost> {
  if (
    options.dev !== false ||
    options.hostname !== WEB_ONLY_HOST ||
    !isWebApplicationPort(options.port) ||
    !path.isAbsolute(options.webRoot) ||
    options.startupSignal?.aborted
  ) {
    throw new Error("Invalid Web Host start options.");
  }
  try {
    return await startWebApplicationHost(options, dependencies);
  } catch {
    throw new Error("Web Host startup failed.");
  }
}

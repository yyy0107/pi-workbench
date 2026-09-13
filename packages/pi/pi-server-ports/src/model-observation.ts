export interface PiProviderRequestObserver {
  observeProviderHttpRequest(
    bodyBytes: number | undefined,
    contentEncoding: string | undefined,
  ): ((status?: number, error?: unknown) => void) | undefined;
}
export interface PiModelRuntimeDependencies {
  getRequestObserver?(sessionId: string): PiProviderRequestObserver | undefined;
}

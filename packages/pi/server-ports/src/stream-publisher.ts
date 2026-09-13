import type {
  MuxStreamPayload,
  HostStreamPayload,
  ServerRequest,
  SessionMessageSnapshotPayload,
} from "@workbench/agent-runtime-pi-protocol/stream";
export interface StreamPublishOptions {
  /** Required for interactive requests when `/api/respond` must echo a pre-registered id. */
  rpcId?: string;
}
export interface PiStreamPublisher {
  publishMux(
    payload: MuxStreamPayload,
    options?: StreamPublishOptions,
  ): ServerRequest<MuxStreamPayload>;
  publishHost(
    payload: HostStreamPayload,
    options?: StreamPublishOptions,
  ): ServerRequest<HostStreamPayload>;
  /** Retains one immutable active assistant view; callers replace rather than mutate it. */
  setSessionMessageSnapshot(payload: SessionMessageSnapshotPayload): void;
  /** Clears only the expected generation when `streamId` is provided. */
  clearSessionMessageSnapshot(sessionId: string, streamId?: string): void;
}

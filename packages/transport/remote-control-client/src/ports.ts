export interface RemoteControlClientClock {
  now(): Date;
}

export interface RemoteControlClientRandom {
  nextUnit(): number;
}

export interface RemoteControlClientSocket {
  readonly bufferedAmount: number;
  send(frame: string): void;
  close(code: number, reason: string): void;
}

export interface RemoteControlClientSocketRequest {
  readonly url: string;
  readonly protocols: readonly string[];
}

export interface RemoteControlClientSocketPort {
  connect(request: RemoteControlClientSocketRequest): RemoteControlClientSocket;
}

export interface DirectChallengeProofPort {
  sign(canonicalTranscript: string): Promise<string>;
}

export interface RemoteControlProjectionRecord {
  readonly machineId: string;
  readonly epoch: string;
  readonly offset: string;
  readonly encodedProjection: string;
  readonly updatedAt: string;
}

export interface RemoteControlProjectionStorePort {
  read(machineId: string): Promise<RemoteControlProjectionRecord | undefined>;
  write(record: RemoteControlProjectionRecord): Promise<void>;
  clear(machineId?: string): Promise<void>;
}

export interface RemoteControlClientLifecyclePort {
  current(): "active" | "background" | "inactive";
  subscribe(listener: (state: "active" | "background" | "inactive") => void): () => void;
}

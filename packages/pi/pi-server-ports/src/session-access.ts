export interface PiResourceMutationSessionHost {
  readonly isAlive?: boolean;
  readonly isBusy?: boolean;
  readonly isRunning?: boolean;
  readonly session: {
    readonly sessionManager?: {
      getCwd(): string;
    };
    reload?(): Promise<void>;
  };
}

export interface LoadedPiResourceMutationSessionHost extends PiResourceMutationSessionHost {
  readonly id: string;
}

export interface PiResourceMutationCoordinatorDependencies {
  getLoadedSessions(): readonly LoadedPiResourceMutationSessionHost[];
}

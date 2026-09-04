"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Application-localized copy consumed by the Pi browser implementation. */
export interface PiAgentRuntimeCopy {
  readonly titles: {
    readonly attachment: string;
    readonly image: string;
  };
  readonly errors: {
    readonly sessionBusy: string;
    readonly emptyPrompt: string;
    readonly sessionNotFound: string;
    readonly invalidWorkingDirectory: string;
    readonly invalidWorkspace: string;
    readonly modelNotAvailable: string;
    readonly requestFailed: string;
  };
}

const PiAgentRuntimeCopyContext = createContext<PiAgentRuntimeCopy | null>(null);

export function PiAgentRuntimeCopyProvider({
  children,
  copy,
}: Readonly<{ children: ReactNode; copy: PiAgentRuntimeCopy }>) {
  return (
    <PiAgentRuntimeCopyContext.Provider value={copy}>{children}</PiAgentRuntimeCopyContext.Provider>
  );
}

export function usePiAgentRuntimeCopy(): PiAgentRuntimeCopy {
  const copy = useContext(PiAgentRuntimeCopyContext);
  if (!copy) throw new Error("PiAgentRuntimeCopyProvider is missing");
  return copy;
}

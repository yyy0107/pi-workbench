"use client";

import { useMemo } from "react";

import { createAutomationClient, type PiAutomationClient } from "../automations/automation-client";
import { usePiSessionManager } from "../runtime/context";
import { describePiProjectTrust, updatePiProjectTrust } from "../transport/api";

export { createAutomationClient };
export type { PiAutomationClient };

export interface PiAutomationDomainClient {
  readonly automation: PiAutomationClient;
  describeProjectTrust: typeof describePiProjectTrust;
  updateProjectTrust: typeof updatePiProjectTrust;
}

export function usePiAutomationClient(): PiAutomationDomainClient {
  const manager = usePiSessionManager();
  return useMemo(() => {
    const options = manager.rpcTransportOptions;
    return Object.freeze({
      automation: createAutomationClient(options),
      describeProjectTrust: (payload: Parameters<typeof describePiProjectTrust>[0]) =>
        describePiProjectTrust(payload, options),
      updateProjectTrust: (payload: Parameters<typeof updatePiProjectTrust>[0]) =>
        updatePiProjectTrust(payload, options),
    });
  }, [manager]);
}

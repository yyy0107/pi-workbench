import type {
  AutomationArchivePayload,
  AutomationLaunchValue,
  AutomationListPayload,
  AutomationListValue,
  AutomationReadPayload,
  AutomationReadValue,
  AutomationRemoveSessionPayload,
  AutomationRemoveSessionValue,
  AutomationRunNowPayload,
  AutomationSavePayload,
  AutomationSessionsPayload,
  AutomationSessionsValue,
  AutomationSetEnabledPayload,
} from "@workbench/automation-contracts";

import { callPiRpc, type PiRpcCallOptions } from "../transport/api";

const AUTOMATION_QUERY_TIMEOUT_MS = 30_000;

/**
 * Create an Automation RPC facade for one Pi installation.  The caller-owned transport options
 * are captured once; this module deliberately has no mutable default client.
 */
export function createAutomationClient(rpcOptions: Readonly<PiRpcCallOptions> = {}) {
  const options = Object.freeze({ ...rpcOptions });
  const query = <Payload, Value>(method: string, payload: Payload): Promise<Value> =>
    callPiRpc(method, payload, {
      ...options,
      signal: AbortSignal.timeout(AUTOMATION_QUERY_TIMEOUT_MS),
    });

  return Object.freeze({
    list(payload: AutomationListPayload = {}): Promise<AutomationListValue> {
      return query("automation.list", payload);
    },
    read(payload: AutomationReadPayload): Promise<AutomationReadValue> {
      return query("automation.read", payload);
    },
    save(payload: AutomationSavePayload): Promise<AutomationReadValue> {
      return callPiRpc("automation.save", payload, options);
    },
    archive(payload: AutomationArchivePayload): Promise<AutomationReadValue> {
      return callPiRpc("automation.archive", payload, options);
    },
    setEnabled(payload: AutomationSetEnabledPayload): Promise<AutomationReadValue> {
      return callPiRpc("automation.setEnabled", payload, options);
    },
    runNow(payload: AutomationRunNowPayload): Promise<AutomationLaunchValue> {
      return callPiRpc("automation.runNow", payload, options);
    },
    sessions(payload: AutomationSessionsPayload): Promise<AutomationSessionsValue> {
      return query("automation.sessions", payload);
    },
    removeSession(payload: AutomationRemoveSessionPayload): Promise<AutomationRemoveSessionValue> {
      return callPiRpc("automation.removeSession", payload, options);
    },
  });
}

export type PiAutomationClient = ReturnType<typeof createAutomationClient>;

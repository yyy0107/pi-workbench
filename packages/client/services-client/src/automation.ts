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

import { callServiceRpc } from "./errors";
import type { RpcCallOptions } from "@workbench/host-client/rpc";

const AUTOMATION_QUERY_TIMEOUT_MS = 30_000;

/**
 * Create an Automation RPC facade for one Runtime installation.  The caller-owned transport options
 * are captured once; this module deliberately has no mutable default client.
 */
export function createAutomationClient(rpcOptions: Readonly<RpcCallOptions> = {}) {
  const options = Object.freeze({ ...rpcOptions });
  const query = <Payload, Value>(method: string, payload: Payload): Promise<Value> =>
    callServiceRpc(method, payload, {
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
      return callServiceRpc("automation.save", payload, options);
    },
    archive(payload: AutomationArchivePayload): Promise<AutomationReadValue> {
      return callServiceRpc("automation.archive", payload, options);
    },
    setEnabled(payload: AutomationSetEnabledPayload): Promise<AutomationReadValue> {
      return callServiceRpc("automation.setEnabled", payload, options);
    },
    runNow(payload: AutomationRunNowPayload): Promise<AutomationLaunchValue> {
      return callServiceRpc("automation.runNow", payload, options);
    },
    sessions(payload: AutomationSessionsPayload): Promise<AutomationSessionsValue> {
      return query("automation.sessions", payload);
    },
    removeSession(payload: AutomationRemoveSessionPayload): Promise<AutomationRemoveSessionValue> {
      return callServiceRpc("automation.removeSession", payload, options);
    },
  });
}

export type AutomationClient = ReturnType<typeof createAutomationClient>;

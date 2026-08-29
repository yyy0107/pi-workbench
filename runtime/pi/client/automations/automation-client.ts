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
} from "@/runtime/shared/automation";

import { callPiRpc, type PiRpcCallOptions } from "../transport/api";

const AUTOMATION_QUERY_TIMEOUT_MS = 30_000;

function query<Payload, Value>(method: string, payload: Payload): Promise<Value> {
  const options: PiRpcCallOptions = {
    signal: AbortSignal.timeout(AUTOMATION_QUERY_TIMEOUT_MS),
  };
  return callPiRpc(method, payload, options);
}

export const automationClient = {
  list(payload: AutomationListPayload = {}): Promise<AutomationListValue> {
    return query("automation.list", payload);
  },
  read(payload: AutomationReadPayload): Promise<AutomationReadValue> {
    return query("automation.read", payload);
  },
  save(payload: AutomationSavePayload): Promise<AutomationReadValue> {
    return callPiRpc("automation.save", payload);
  },
  archive(payload: AutomationArchivePayload): Promise<AutomationReadValue> {
    return callPiRpc("automation.archive", payload);
  },
  setEnabled(payload: AutomationSetEnabledPayload): Promise<AutomationReadValue> {
    return callPiRpc("automation.setEnabled", payload);
  },
  runNow(payload: AutomationRunNowPayload): Promise<AutomationLaunchValue> {
    return callPiRpc("automation.runNow", payload);
  },
  sessions(payload: AutomationSessionsPayload): Promise<AutomationSessionsValue> {
    return query("automation.sessions", payload);
  },
  removeSession(payload: AutomationRemoveSessionPayload): Promise<AutomationRemoveSessionValue> {
    return callPiRpc("automation.removeSession", payload);
  },
};

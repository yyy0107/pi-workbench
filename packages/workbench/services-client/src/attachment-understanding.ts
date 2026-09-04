import type { WorkbenchServicesCapabilities } from "@workbench/agent-runtime-client/capabilities";
import type {
  AttachmentUnderstandingDescribeValue,
  AttachmentUnderstandingUpdatePayload,
} from "@workbench/attachment-understanding-contracts/settings";
import { callServiceRpc, capabilityCall } from "./errors";
import type { RpcCallOptions } from "@workbench/host-client/rpc";

export function describeAttachmentUnderstandingSettings(
  options?: RpcCallOptions,
): Promise<AttachmentUnderstandingDescribeValue> {
  return callServiceRpc("imageUnderstanding.describe", {}, options);
}

export function updateAttachmentUnderstandingSettings(
  payload: AttachmentUnderstandingUpdatePayload,
  options?: RpcCallOptions,
): Promise<AttachmentUnderstandingDescribeValue> {
  return callServiceRpc("imageUnderstanding.update", payload, options);
}

export function createAttachmentUnderstandingClient(
  rpcOptions: Readonly<RpcCallOptions> = {},
): WorkbenchServicesCapabilities["attachmentUnderstanding"] {
  const options = Object.freeze({ ...rpcOptions });
  return Object.freeze({
    describe: () => capabilityCall(() => describeAttachmentUnderstandingSettings(options)),
    update: (request: AttachmentUnderstandingUpdatePayload) =>
      capabilityCall(() => updateAttachmentUnderstandingSettings(request, options)),
  });
}

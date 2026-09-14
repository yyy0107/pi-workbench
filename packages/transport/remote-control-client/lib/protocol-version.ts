import { REMOTE_CONTROL_PROTOCOL_VERSION } from "@workbench/remote-control-contracts/protocol";

export function isRemoteControlClientProtocolVersionSupported(
  version: number,
): version is typeof REMOTE_CONTROL_PROTOCOL_VERSION {
  return version === REMOTE_CONTROL_PROTOCOL_VERSION;
}

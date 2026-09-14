import type { RemoteCommandV1 } from "@workbench/remote-control-contracts/protocol";

export type RemoteCommandType = RemoteCommandV1["type"];

export const REMOTE_CONTROL_COMMAND_TYPES = [
  "session.create",
  "session.send",
  "session.stop",
  "session.rename",
  "session.setPinned",
  "session.setArchived",
  "interaction.answerQuestion",
] as const satisfies readonly RemoteCommandType[];

const commandTypes = new Set<string>(REMOTE_CONTROL_COMMAND_TYPES);

export function isRemoteControlCommandType(value: string): value is RemoteCommandType {
  return commandTypes.has(value);
}

import type { ExternalSessionImportView } from "@workbench/pi-rpc-contracts/rpc";
export const IMPORT_BATCH_SIZE = 200;

export function selectionKey(session: ExternalSessionImportView): string {
  return `${session.source}\0${session.sourceSessionId}`;
}

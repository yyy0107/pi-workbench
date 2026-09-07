import type { PastedTextAttachment } from "@workbench/contracts/composer";
import { WORKSPACE_FILE_EDITABLE_SIZE_LIMIT } from "./runtime-capabilities";

export type { PastedTextAttachment } from "@workbench/contracts/composer";
export { parsePastedTextAttachment } from "@workbench/contracts/composer";

export const PASTED_TEXT_MIN_CHARACTERS = 5000;
export const PASTED_TEXT_RESTORE_MAX_CHARACTERS = 25000;
export const PASTED_TEXT_MAX_BYTES = WORKSPACE_FILE_EDITABLE_SIZE_LIMIT;
export const PASTED_TEXT_MAX_COUNT = 20;
export const PASTED_TEXT_READ_PAGE_SIZE = 25000;

export function canRestorePastedText(characterCount: number): boolean {
  return (
    characterCount >= PASTED_TEXT_MIN_CHARACTERS &&
    characterCount <= PASTED_TEXT_RESTORE_MAX_CHARACTERS
  );
}

export interface CreatePastedTextAttachmentRequest {
  readonly id: string;
  readonly text: string;
}
export interface ReadPastedTextAttachmentRequest {
  readonly id: string;
  readonly offset?: number;
}
export interface ReadPastedTextAttachmentResult {
  readonly attachment: PastedTextAttachment;
  readonly text: string;
  readonly nextOffset?: number;
}

export interface ComposerTextAttachmentService {
  create(input: CreatePastedTextAttachmentRequest): Promise<PastedTextAttachment>;
  read(input: ReadPastedTextAttachmentRequest): Promise<ReadPastedTextAttachmentResult>;
  discard(input: { readonly id: string }): Promise<void>;
}

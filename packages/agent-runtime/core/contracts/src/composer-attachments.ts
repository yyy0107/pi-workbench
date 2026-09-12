import type {
  ManagedFileAttachment,
  ManagedImageAttachment,
  ManagedImageMediaType,
  PastedTextAttachment,
} from "@workbench/contracts/composer";
import { WORKSPACE_FILE_EDITABLE_SIZE_LIMIT } from "./runtime-capabilities";

export type {
  ManagedFileAttachment,
  ManagedImageAttachment,
  ManagedImageMediaType,
  PastedTextAttachment,
} from "@workbench/contracts/composer";
export {
  MANAGED_IMAGE_MEDIA_TYPES,
  detectManagedImageMediaType,
  parseManagedFileAttachment,
  parseManagedImageAttachment,
  parsePastedTextAttachment,
} from "@workbench/contracts/composer";

export const PASTED_TEXT_MIN_CHARACTERS = 5000;
export const PASTED_TEXT_RESTORE_MAX_CHARACTERS = 25000;
export const PASTED_TEXT_MAX_BYTES = WORKSPACE_FILE_EDITABLE_SIZE_LIMIT;
export const PASTED_TEXT_MAX_COUNT = 20;
export const PASTED_TEXT_READ_PAGE_SIZE = 25000;
export const MANAGED_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const MANAGED_FILE_MAX_COUNT = 20;
export const MANAGED_FILE_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

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

export interface CreateManagedFileAttachmentRequest {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
  readonly data: string;
}

export interface ReadManagedFileAttachmentRequest {
  readonly id: string;
}

export interface ReadManagedFileAttachmentResult {
  readonly attachment: ManagedFileAttachment;
  readonly data: string;
}

export type CreateManagedImageAttachmentRequest = CreateManagedFileAttachmentRequest & {
  readonly mediaType: ManagedImageMediaType;
};
export type ReadManagedImageAttachmentRequest = ReadManagedFileAttachmentRequest;
export type ReadManagedImageAttachmentResult = ReadManagedFileAttachmentResult & {
  readonly attachment: ManagedImageAttachment;
};

export interface ComposerTextAttachmentService {
  create(input: CreatePastedTextAttachmentRequest): Promise<PastedTextAttachment>;
  read(input: ReadPastedTextAttachmentRequest): Promise<ReadPastedTextAttachmentResult>;
  discard(input: { readonly id: string }): Promise<void>;
}

export interface ComposerAttachmentService extends ComposerTextAttachmentService {
  createFile(input: CreateManagedFileAttachmentRequest): Promise<ManagedFileAttachment>;
  readFile(input: ReadManagedFileAttachmentRequest): Promise<ReadManagedFileAttachmentResult>;
  createImage(input: CreateManagedImageAttachmentRequest): Promise<ManagedImageAttachment>;
  readImage(input: ReadManagedImageAttachmentRequest): Promise<ReadManagedImageAttachmentResult>;
}

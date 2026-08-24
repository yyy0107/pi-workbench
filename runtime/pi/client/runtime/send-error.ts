import {
  isSessionAttachmentErrorReason,
  type SessionAttachmentErrorReason,
} from "../../attachment-contracts";
import { PiApiError } from "../transport/api";

export type PiComposerSendError =
  | "model-attachment-unsupported"
  | "attachment-invalid"
  | "attachment-too-large"
  | "too-many-attachments";

const SEND_ERROR_BY_ATTACHMENT_REASON = {
  MODEL_DOES_NOT_SUPPORT_IMAGES: "model-attachment-unsupported",
  PERSISTED_ATTACHMENT_UNAVAILABLE: "attachment-invalid",
  QUEUE_EDIT_NON_TEXT: "attachment-invalid",
  TOO_MANY_INLINE_IMAGES: "too-many-attachments",
  UNSUPPORTED_IMAGE_MEDIA_TYPE: "attachment-invalid",
  INVALID_IMAGE_BASE64: "attachment-invalid",
  INLINE_IMAGE_TOO_LARGE: "attachment-too-large",
  INLINE_IMAGES_TOTAL_TOO_LARGE: "attachment-too-large",
  UNRECOGNIZED_IMAGE_FORMAT: "attachment-invalid",
  IMAGE_MEDIA_TYPE_MISMATCH: "attachment-invalid",
  TOO_MANY_INLINE_ATTACHMENTS: "too-many-attachments",
  UNSUPPORTED_DOCUMENT_MEDIA_TYPE: "attachment-invalid",
  INVALID_DOCUMENT_BASE64: "attachment-invalid",
  INLINE_DOCUMENT_TOO_LARGE: "attachment-too-large",
  INLINE_ATTACHMENTS_TOTAL_TOO_LARGE: "attachment-too-large",
  UNRECOGNIZED_DOCUMENT_FORMAT: "attachment-invalid",
  DOCUMENT_MEDIA_TYPE_MISMATCH: "attachment-invalid",
} as const satisfies Record<SessionAttachmentErrorReason, PiComposerSendError>;

export function piComposerSendError(error: unknown): PiComposerSendError | undefined {
  if (!(error instanceof PiApiError) || error.code !== "attachment-error") return undefined;

  const reason = error.details.reason;
  return isSessionAttachmentErrorReason(reason)
    ? SEND_ERROR_BY_ATTACHMENT_REASON[reason]
    : "attachment-invalid";
}

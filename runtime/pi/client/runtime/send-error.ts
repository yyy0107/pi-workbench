import {
  isSessionAttachmentErrorReason,
  type SessionAttachmentErrorReason,
} from "../../attachment-contracts";
import { PiApiError } from "../transport/api";

export type PiComposerSendError =
  | "model-image-unsupported"
  | "image-invalid"
  | "image-too-large"
  | "too-many-images";

const SEND_ERROR_BY_ATTACHMENT_REASON = {
  MODEL_DOES_NOT_SUPPORT_IMAGES: "model-image-unsupported",
  PERSISTED_ATTACHMENT_UNAVAILABLE: "image-invalid",
  QUEUE_EDIT_NON_TEXT: "image-invalid",
  TOO_MANY_INLINE_IMAGES: "too-many-images",
  UNSUPPORTED_IMAGE_MEDIA_TYPE: "image-invalid",
  INVALID_IMAGE_BASE64: "image-invalid",
  INLINE_IMAGE_TOO_LARGE: "image-too-large",
  INLINE_IMAGES_TOTAL_TOO_LARGE: "image-too-large",
  UNRECOGNIZED_IMAGE_FORMAT: "image-invalid",
  IMAGE_MEDIA_TYPE_MISMATCH: "image-invalid",
} as const satisfies Record<SessionAttachmentErrorReason, PiComposerSendError>;

export function piComposerSendError(error: unknown): PiComposerSendError | undefined {
  if (!(error instanceof PiApiError) || error.code !== "attachment-error") return undefined;

  const reason = error.details.reason;
  return isSessionAttachmentErrorReason(reason)
    ? SEND_ERROR_BY_ATTACHMENT_REASON[reason]
    : "image-invalid";
}

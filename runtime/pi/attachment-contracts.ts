export const INLINE_IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type InlineImageMediaType = (typeof INLINE_IMAGE_MEDIA_TYPES)[number];

export const INLINE_DOCUMENT_MEDIA_TYPES = ["application/pdf"] as const;
export type InlineDocumentMediaType = (typeof INLINE_DOCUMENT_MEDIA_TYPES)[number];

export function isInlineImageMediaType(value: unknown): value is InlineImageMediaType {
  return (
    typeof value === "string" && INLINE_IMAGE_MEDIA_TYPES.some((mediaType) => mediaType === value)
  );
}

export function isInlineDocumentMediaType(value: unknown): value is InlineDocumentMediaType {
  return (
    typeof value === "string" &&
    INLINE_DOCUMENT_MEDIA_TYPES.some((mediaType) => mediaType === value)
  );
}

export const INLINE_IMAGE_LIMITS = Object.freeze({
  maxCount: 20,
  maxDecodedBytesPerImage: 10 * 1024 * 1024,
  maxDecodedBytesTotal: 25 * 1024 * 1024,
});

export const INLINE_ATTACHMENT_LIMITS = Object.freeze({
  maxCount: INLINE_IMAGE_LIMITS.maxCount,
  maxDecodedBytesPerDocument: 50 * 1024 * 1024,
  maxDecodedBytesTotal: 50 * 1024 * 1024,
});

export const INLINE_IMAGE_ADMISSION_ERROR_REASONS = [
  "TOO_MANY_INLINE_IMAGES",
  "UNSUPPORTED_IMAGE_MEDIA_TYPE",
  "INVALID_IMAGE_BASE64",
  "INLINE_IMAGE_TOO_LARGE",
  "INLINE_IMAGES_TOTAL_TOO_LARGE",
  "UNRECOGNIZED_IMAGE_FORMAT",
  "IMAGE_MEDIA_TYPE_MISMATCH",
] as const;

export const INLINE_DOCUMENT_ADMISSION_ERROR_REASONS = [
  "TOO_MANY_INLINE_ATTACHMENTS",
  "UNSUPPORTED_DOCUMENT_MEDIA_TYPE",
  "INVALID_DOCUMENT_BASE64",
  "INLINE_DOCUMENT_TOO_LARGE",
  "INLINE_ATTACHMENTS_TOTAL_TOO_LARGE",
  "UNRECOGNIZED_DOCUMENT_FORMAT",
  "DOCUMENT_MEDIA_TYPE_MISMATCH",
] as const;

export type InlineImageAdmissionErrorReason = (typeof INLINE_IMAGE_ADMISSION_ERROR_REASONS)[number];
export type InlineDocumentAdmissionErrorReason =
  (typeof INLINE_DOCUMENT_ADMISSION_ERROR_REASONS)[number];
export type InlineAttachmentAdmissionErrorReason =
  | InlineImageAdmissionErrorReason
  | InlineDocumentAdmissionErrorReason;

export const SESSION_ATTACHMENT_ERROR_REASONS = [
  "MODEL_DOES_NOT_SUPPORT_IMAGES",
  "PERSISTED_ATTACHMENT_UNAVAILABLE",
  "QUEUE_EDIT_NON_TEXT",
  ...INLINE_IMAGE_ADMISSION_ERROR_REASONS,
  ...INLINE_DOCUMENT_ADMISSION_ERROR_REASONS,
] as const;

export type SessionAttachmentErrorReason = (typeof SESSION_ATTACHMENT_ERROR_REASONS)[number];

export function isSessionAttachmentErrorReason(
  value: unknown,
): value is SessionAttachmentErrorReason {
  return (
    typeof value === "string" && SESSION_ATTACHMENT_ERROR_REASONS.some((reason) => reason === value)
  );
}

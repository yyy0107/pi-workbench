import type { PiImageContent } from "@workbench/agent-runtime-pi-protocol/messages";
import { detectManagedImageMediaType } from "@workbench/agent-runtime-contracts/composer-attachments";
import {
  INLINE_IMAGE_LIMITS,
  isInlineImageMediaType,
  type InlineImageAdmissionErrorReason,
} from "@workbench/agent-runtime-pi-protocol/attachments";

const MAX_INLINE_IMAGE_BASE64_LENGTH =
  Math.ceil(INLINE_IMAGE_LIMITS.maxDecodedBytesPerImage / 3) * 4;

export class InlineImageAdmissionError extends Error {
  readonly reason: InlineImageAdmissionErrorReason;

  constructor(reason: InlineImageAdmissionErrorReason, message: string) {
    super(message);
    this.name = "InlineImageAdmissionError";
    this.reason = reason;
  }
}

export interface InlineImageAdmissionInput {
  readonly data: string;
  readonly mediaType: string;
  readonly name?: string;
}

function fail(reason: InlineImageAdmissionErrorReason, message: string): never {
  throw new InlineImageAdmissionError(reason, message);
}

function isBase64CodeUnit(codeUnit: number): boolean {
  return (
    (codeUnit >= 0x41 && codeUnit <= 0x5a) ||
    (codeUnit >= 0x61 && codeUnit <= 0x7a) ||
    (codeUnit >= 0x30 && codeUnit <= 0x39) ||
    codeUnit === 0x2b ||
    codeUnit === 0x2f
  );
}

function canonicalBase64DecodedBytes(value: string): number | undefined {
  if (!value || value.length % 4 !== 0) return undefined;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const contentLength = value.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    if (!isBase64CodeUnit(value.charCodeAt(index))) return undefined;
  }
  return (value.length / 4) * 3 - padding;
}

export function admitInlineImages(parts: readonly InlineImageAdmissionInput[]): PiImageContent[] {
  if (parts.length > INLINE_IMAGE_LIMITS.maxCount) {
    fail("TOO_MANY_INLINE_IMAGES", "The prompt contains too many inline images.");
  }

  let totalBytes = 0;
  return parts.map((part) => {
    if (!isInlineImageMediaType(part.mediaType)) {
      fail("UNSUPPORTED_IMAGE_MEDIA_TYPE", "An inline image has an unsupported media type.");
    }
    if (part.data.length > MAX_INLINE_IMAGE_BASE64_LENGTH) {
      fail("INLINE_IMAGE_TOO_LARGE", "An inline image exceeds the size limit.");
    }
    const decodedBytes = canonicalBase64DecodedBytes(part.data);
    if (decodedBytes === undefined) {
      fail("INVALID_IMAGE_BASE64", "An inline image is not canonical base64.");
    }
    if (decodedBytes > INLINE_IMAGE_LIMITS.maxDecodedBytesPerImage) {
      fail("INLINE_IMAGE_TOO_LARGE", "An inline image exceeds the size limit.");
    }
    totalBytes += decodedBytes;
    if (totalBytes > INLINE_IMAGE_LIMITS.maxDecodedBytesTotal) {
      fail(
        "INLINE_IMAGES_TOTAL_TOO_LARGE",
        "The prompt's inline images exceed the total size limit.",
      );
    }

    const bytes = Buffer.from(part.data, "base64");
    if (bytes.length !== decodedBytes || bytes.toString("base64") !== part.data) {
      fail("INVALID_IMAGE_BASE64", "An inline image is not canonical base64.");
    }
    const detected = detectManagedImageMediaType(bytes);
    if (detected === undefined) {
      fail(
        "UNRECOGNIZED_IMAGE_FORMAT",
        "An inline image does not have a supported image signature.",
      );
    }
    if (detected !== part.mediaType) {
      fail(
        "IMAGE_MEDIA_TYPE_MISMATCH",
        "An inline image's media type does not match its file signature.",
      );
    }

    return {
      type: "image",
      data: part.data,
      mimeType: part.mediaType,
      ...(part.name === undefined ? {} : { name: part.name }),
    };
  });
}

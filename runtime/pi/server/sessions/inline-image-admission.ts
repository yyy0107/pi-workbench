import type { PiImageContent } from "../../contracts";
import {
  INLINE_IMAGE_LIMITS,
  isInlineImageMediaType,
  type InlineImageAdmissionErrorReason,
  type InlineImageMediaType,
} from "../../attachment-contracts";

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

function detectedImageMediaType(bytes: Uint8Array): InlineImageMediaType | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6) {
    const gifHeader = String.fromCharCode(...bytes.subarray(0, 6));
    if (gifHeader === "GIF87a" || gifHeader === "GIF89a") return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
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
    const detected = detectedImageMediaType(bytes);
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

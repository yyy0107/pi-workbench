import { PiApiError } from "../transport/api";

export type PiComposerSendError =
  | "model-image-unsupported"
  | "image-invalid"
  | "image-too-large"
  | "too-many-images";

export function piComposerSendError(error: unknown): PiComposerSendError | undefined {
  if (!(error instanceof PiApiError) || error.code !== "attachment-error") return undefined;

  switch (error.details.reason) {
    case "MODEL_DOES_NOT_SUPPORT_IMAGES":
      return "model-image-unsupported";
    case "IMAGE_TOO_LARGE":
    case "IMAGE_TOTAL_TOO_LARGE":
      return "image-too-large";
    case "TOO_MANY_INLINE_IMAGES":
      return "too-many-images";
    default:
      return "image-invalid";
  }
}

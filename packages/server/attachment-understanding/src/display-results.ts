import {
  MAX_ATTACHMENT_RECOGNITION_RESULT_CHARACTERS,
  type AttachmentRecognitionResult,
} from "@workbench/attachment-understanding-contracts/state-machine";

import type { AttachmentUnderstandingObservation } from "./contracts";

/**
 * Projects provider-neutral observations into the bounded terminal message payload.
 * The model-context observations remain untouched; only the user-visible copy is shortened.
 */
export function projectAttachmentRecognitionResults(
  observations: readonly AttachmentUnderstandingObservation[],
): readonly AttachmentRecognitionResult[] {
  let remainingCharacters = MAX_ATTACHMENT_RECOGNITION_RESULT_CHARACTERS;

  return observations.map(({ attachmentId, format, text }) => {
    const visibleText = text.slice(0, remainingCharacters);
    remainingCharacters -= visibleText.length;
    return {
      attachmentId,
      format,
      text: visibleText,
      ...(visibleText.length < text.length ? { truncated: true as const } : {}),
    };
  });
}

/** @deprecated New operations use attachment-neutral result identifiers. */
export const projectImageRecognitionResults = projectAttachmentRecognitionResults;

import type {
  PiDocumentContent,
  PiImageContent,
  PiQueuedPrompt,
  PiQueueMode,
} from "@workbench/agent-runtime-pi-protocol/messages";
import {
  AgentExecutionError,
  type AgentExecutionErrorCode,
  type AgentExecutionPort,
  type AgentExecutionPrompt,
  type AgentQueueMutation,
} from "@workbench/agent-runtime-server/execution";

import {
  cancelSession,
  regenerateSession,
  resumeSession,
  selectSessionBranch,
  submitPrompt,
  updatePromptQueueItem,
  type PromptQueueMutation,
  type PromptSubmissionProvenance,
  type PromptSubmissionResult,
} from "../sessions/session-registry";

export interface PiAgentExecutionDependencies {
  submitPrompt(
    sessionId: string,
    mode: PiQueueMode,
    prompt: PiQueuedPrompt,
    provenance?: PromptSubmissionProvenance,
  ): Promise<PromptSubmissionResult>;
  regenerateSession(sessionId: string, messageId: string, requestId?: string): Promise<void>;
  resumeSession(sessionId: string, checkpointId: string, expectedLeafId: string): Promise<void>;
  selectSessionBranch(sessionId: string, leafId: string): Promise<void>;
  updateQueueItem(sessionId: string, itemId: string, mutation: PromptQueueMutation): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
}

function defaultDependencies(): PiAgentExecutionDependencies {
  return {
    submitPrompt,
    regenerateSession,
    resumeSession,
    selectSessionBranch,
    updateQueueItem: updatePromptQueueItem,
    cancelSession,
  };
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

const PI_EXECUTION_ERROR_CODE_MAP: Readonly<Record<string, AgentExecutionErrorCode>> = {
  pi_session_not_found: "thread-not-found",
  pi_session_busy: "busy",
  pi_branch_not_found: "branch-not-found",
  pi_resume_stale: "resume-stale",
  pi_resume_unavailable: "resume-blocked",
  pi_resume_confirmation_required: "resume-confirmation-required",
  pi_queue_item_not_found: "queue-item-not-found",
  pi_session_not_running: "steer-unavailable",
  pi_steer_unavailable: "steer-unavailable",
  pi_model_image_unsupported: "image-input-unsupported",
  pi_empty_prompt: "prompt-rejected",
  pi_prompt_rejected: "prompt-rejected",
  pi_command_not_found: "prompt-rejected",
  pi_composer_command_conflict: "prompt-rejected",
  pi_composer_command_args_invalid: "prompt-rejected",
  pi_skill_read_tool_unavailable: "prompt-rejected",
  "text-attachment-unavailable": "prompt-rejected",
  "text-attachment-invalid": "prompt-rejected",
  "text-attachment-discarded": "prompt-rejected",
};

function translatePiExecutionError(error: unknown): never {
  if (error instanceof AgentExecutionError) throw error;
  const code = errorCode(error);
  const translated =
    code === undefined ? "internal" : (PI_EXECUTION_ERROR_CODE_MAP[code] ?? "internal");

  throw new AgentExecutionError(translated, "The Pi Agent execution operation failed.", {
    cause: error,
  });
}

function piPrompt(prompt: AgentExecutionPrompt): PiQueuedPrompt {
  const textAttachmentIds: string[] = [];
  const images: PiImageContent[] = [];
  const documents: PiDocumentContent[] = [];

  for (const attachment of prompt.attachments) {
    if (attachment.kind === "text-reference") {
      textAttachmentIds.push(attachment.attachmentId);
      continue;
    }
    if (attachment.kind === "image") {
      images.push({
        type: "image",
        data: attachment.data,
        mimeType: attachment.mediaType,
        ...(attachment.name === undefined ? {} : { name: attachment.name }),
      });
      continue;
    }
    if (attachment.mediaType !== "application/pdf") {
      throw new AgentExecutionError(
        "prompt-rejected",
        "Pi accepts PDF documents only at this execution boundary.",
      );
    }
    documents.push({
      type: "file",
      data: attachment.data,
      mimeType: attachment.mediaType,
      ...(attachment.name === undefined ? {} : { name: attachment.name }),
    });
  }

  return {
    message: prompt.text,
    ...(textAttachmentIds.length ? { textAttachmentIds } : {}),
    ...(images.length ? { images } : {}),
    ...(documents.length ? { documents } : {}),
  };
}

function piQueueMutation(mutation: AgentQueueMutation): PromptQueueMutation {
  return mutation.kind === "edit"
    ? {
        kind: "edit",
        prompt: {
          message: mutation.text,
          ...(mutation.textAttachmentIds === undefined
            ? {}
            : { textAttachmentIds: [...mutation.textAttachmentIds] }),
        },
      }
    : mutation;
}

export function createPiAgentExecution(
  dependencies: Partial<PiAgentExecutionDependencies> = {},
): AgentExecutionPort {
  const implementation = { ...defaultDependencies(), ...dependencies };

  return {
    async submit(input) {
      try {
        const admission = await implementation.submitPrompt(
          input.threadId,
          input.mode === "follow-up" ? "followUp" : "steer",
          piPrompt(input.prompt),
          {
            ...(input.provenance?.requestId === undefined
              ? {}
              : { rpcId: input.provenance.requestId }),
            ...(input.provenance?.clientTimeZone === undefined
              ? {}
              : { clientTimeZone: input.provenance.clientTimeZone }),
            ...(input.prompt.composer === undefined ? {} : { composer: input.prompt.composer }),
          },
        );
        return admission.queued
          ? {
              kind: "queued",
              ...(admission.queueItemId === undefined
                ? {}
                : { queueItemId: admission.queueItemId }),
            }
          : { kind: "started" };
      } catch (error) {
        translatePiExecutionError(error);
      }
    },

    regeneration: {
      async regenerate({ threadId, userMessageId, requestId }) {
        try {
          await implementation.regenerateSession(threadId, userMessageId, requestId);
        } catch (error) {
          translatePiExecutionError(error);
        }
      },
    },

    resume: {
      async resume({ threadId, checkpointId, expectedStateToken }) {
        try {
          await implementation.resumeSession(threadId, checkpointId, expectedStateToken);
        } catch (error) {
          translatePiExecutionError(error);
        }
      },
    },

    branches: {
      async select({ threadId, branchToken }) {
        try {
          await implementation.selectSessionBranch(threadId, branchToken);
        } catch (error) {
          translatePiExecutionError(error);
        }
      },
    },

    queue: {
      async update({ threadId, itemId, mutation }) {
        try {
          await implementation.updateQueueItem(threadId, itemId, piQueueMutation(mutation));
        } catch (error) {
          translatePiExecutionError(error);
        }
      },
    },

    async cancel({ threadId }) {
      try {
        await implementation.cancelSession(threadId);
      } catch (error) {
        translatePiExecutionError(error);
      }
    },
  };
}

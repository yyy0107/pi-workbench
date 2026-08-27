import {
  PI_THINKING_LEVELS,
  type PiModelListResponse,
  type PiSessionHistory,
  type PiThinkingLevel,
} from "@/runtime/pi/contracts/pi";
import type {
  ModelCatalogFailure,
  ModelProviderGroup,
  ModelSelection,
  SessionCompactValue,
  SessionContextPolicyUpdatePayload,
  SessionContextPolicyValue,
  SessionModelsValue,
} from "@/runtime/pi/contracts/rpc";

import { ModelService } from "../models/model-service";
import {
  compactSessionContext,
  getSessionContextPolicy,
  getSessionHistory,
  listModels,
  selectSessionModel,
  updateSessionContextPolicy,
} from "./session-registry";

export interface PiSessionModelContextServiceDependencies {
  getSessionHistory(sessionId: string): Promise<PiSessionHistory>;
  getModelCatalog(
    cwd: string,
  ): Promise<{ groups: ModelProviderGroup[]; failures: ModelCatalogFailure[] }>;
  listModels(cwd: string): Promise<PiModelListResponse>;
  selectSessionModel(sessionId: string, selection: ModelSelection): Promise<void>;
  getSessionContextPolicy(sessionId: string): Promise<SessionContextPolicyValue>;
  updateSessionContextPolicy(
    sessionId: string,
    policy: SessionContextPolicyUpdatePayload["policy"],
  ): Promise<SessionContextPolicyValue>;
  compactSessionContext(sessionId: string): Promise<SessionCompactValue>;
}

export interface PiSessionModelContextService {
  models(input: { sessionId: string; cwd: string }): Promise<SessionModelsValue>;
  selectModel(input: {
    sessionId: string;
    cwd: string;
    selection: ModelSelection;
  }): Promise<ModelSelection>;
  contextPolicy(sessionId: string): Promise<SessionContextPolicyValue>;
  updateContextPolicy(
    sessionId: string,
    policy: SessionContextPolicyUpdatePayload["policy"],
  ): Promise<SessionContextPolicyValue>;
  compactContext(sessionId: string): Promise<SessionCompactValue>;
}

export interface PiSessionModelContextServiceErrorDetails {
  "session-not-found": Record<string, never>;
  "model-unavailable": { provider: string; model: string };
  busy: Record<string, never>;
  "compaction-unavailable": {
    reason: "already-compacted" | "cancelled" | "context-too-small";
  };
  internal: Record<string, never>;
}

export type PiSessionModelContextServiceErrorCode = keyof PiSessionModelContextServiceErrorDetails;

export class PiSessionModelContextServiceError<
  Code extends PiSessionModelContextServiceErrorCode = PiSessionModelContextServiceErrorCode,
> extends Error {
  readonly code: Code;
  readonly details: PiSessionModelContextServiceErrorDetails[Code];

  constructor(
    code: Code,
    details: PiSessionModelContextServiceErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super("The Pi session model/context operation failed.", options);
    this.name = "PiSessionModelContextServiceError";
    this.code = code;
    this.details = details;
  }
}

interface ErrorContext {
  provider?: string;
  model?: string;
  operation?: "compact";
}

function defaultDependencies(): PiSessionModelContextServiceDependencies {
  return {
    getSessionHistory,
    getModelCatalog: (cwd) => new ModelService({ cwd }).models(),
    listModels,
    selectSessionModel,
    getSessionContextPolicy,
    updateSessionContextPolicy,
    compactSessionContext,
  };
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function manualCompactionUnavailableReason(
  error: unknown,
): PiSessionModelContextServiceErrorDetails["compaction-unavailable"]["reason"] | undefined {
  if (!(error instanceof Error)) return undefined;

  // Pi 0.84 exposes these expected manual-compaction outcomes as plain Errors rather than a
  // public typed error. Normalize them at the Pi SDK boundary so the RPC facade and browser never
  // have to parse SDK-owned English messages.
  if (error.name === "AbortError" || error.message === "Compaction cancelled") return "cancelled";
  if (error.message === "Already compacted") return "already-compacted";
  if (error.message === "Nothing to compact (session too small)") return "context-too-small";
  return undefined;
}

function translatePiModelContextError(error: unknown, context: ErrorContext = {}): never {
  if (error instanceof PiSessionModelContextServiceError) throw error;
  const compactionReason =
    context.operation === "compact" ? manualCompactionUnavailableReason(error) : undefined;
  if (compactionReason) {
    throw new PiSessionModelContextServiceError(
      "compaction-unavailable",
      { reason: compactionReason },
      { cause: error },
    );
  }

  const code = errorCode(error);
  if (code === "pi_session_not_found") {
    throw new PiSessionModelContextServiceError("session-not-found", {}, { cause: error });
  }
  if (
    (code === "pi_model_not_available" || code === "pi_model_image_unsupported") &&
    context.provider &&
    context.model
  ) {
    throw new PiSessionModelContextServiceError(
      "model-unavailable",
      { provider: context.provider, model: context.model },
      { cause: error },
    );
  }
  if (code === "pi_session_busy") {
    throw new PiSessionModelContextServiceError("busy", {}, { cause: error });
  }
  throw new PiSessionModelContextServiceError("internal", {}, { cause: error });
}

function isThinkingLevel(value: string): value is PiThinkingLevel {
  return (PI_THINKING_LEVELS as readonly string[]).includes(value);
}

export function createPiSessionModelContextService(
  dependencies: Partial<PiSessionModelContextServiceDependencies> = {},
): PiSessionModelContextService {
  const implementation = { ...defaultDependencies(), ...dependencies };

  return {
    async models({ sessionId, cwd }) {
      try {
        const history = await implementation.getSessionHistory(sessionId);
        const catalog = await implementation.getModelCatalog(cwd);
        let current: ModelSelection | undefined = history.context.model
          ? {
              provider: history.context.model.provider,
              model: history.context.model.modelId,
              ...(history.context.thinkingLevel
                ? { reasoningEffort: history.context.thinkingLevel }
                : {}),
            }
          : undefined;
        if (!current) {
          const defaults = await implementation.listModels(cwd);
          if (defaults.defaultModel) {
            current = {
              provider: defaults.defaultModel.provider,
              model: defaults.defaultModel.modelId,
            };
          }
        }
        current ??= catalog.groups.flatMap((group) =>
          group.models.map((model) => ({ provider: group.id, model: model.id })),
        )[0];
        if (!current) {
          throw new PiSessionModelContextServiceError("internal", {});
        }
        const routable = catalog.groups.some(
          (group) =>
            group.id === current.provider &&
            group.models.some((model) => model.id === current.model),
        );
        return { current, routable, groups: catalog.groups, failures: catalog.failures };
      } catch (error) {
        translatePiModelContextError(error);
      }
    },

    async selectModel({ sessionId, cwd, selection }) {
      try {
        const catalog = await implementation.getModelCatalog(cwd);
        const model = catalog.groups
          .find((group) => group.id === selection.provider)
          ?.models.find((candidate) => candidate.id === selection.model);
        const effortAvailable =
          selection.reasoningEffort === undefined ||
          model?.reasoning?.efforts.some((effort) => effort.id === selection.reasoningEffort);
        if (
          !model ||
          !effortAvailable ||
          (selection.reasoningEffort && !isThinkingLevel(selection.reasoningEffort))
        ) {
          throw new PiSessionModelContextServiceError("model-unavailable", {
            provider: selection.provider,
            model: selection.model,
          });
        }
        await implementation.selectSessionModel(sessionId, selection);
        return selection;
      } catch (error) {
        translatePiModelContextError(error, {
          provider: selection.provider,
          model: selection.model,
        });
      }
    },

    async contextPolicy(sessionId) {
      try {
        return await implementation.getSessionContextPolicy(sessionId);
      } catch (error) {
        translatePiModelContextError(error);
      }
    },

    async updateContextPolicy(sessionId, policy) {
      try {
        return await implementation.updateSessionContextPolicy(sessionId, policy);
      } catch (error) {
        translatePiModelContextError(error);
      }
    },

    async compactContext(sessionId) {
      try {
        return await implementation.compactSessionContext(sessionId);
      } catch (error) {
        translatePiModelContextError(error, { operation: "compact" });
      }
    },
  };
}

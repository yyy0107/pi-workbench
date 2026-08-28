import type { PiModelSelection } from "@/runtime/pi/contracts/pi";

export function resolveInitialSessionModel<Model extends { provider: string; id: string }>(
  selection: PiModelSelection | undefined,
  availableModels: readonly Model[],
): { model?: Model; thinkingLevel?: PiModelSelection["thinkingLevel"] } {
  if (!selection) return {};
  const model = availableModels.find(
    (candidate) => candidate.provider === selection.provider && candidate.id === selection.modelId,
  );
  if (!model) {
    const error = new Error(
      `The configured execution model ${selection.provider}/${selection.modelId} is unavailable.`,
    );
    Object.assign(error, { code: "agent-model-unavailable" });
    throw error;
  }
  return {
    model,
    ...(selection.thinkingLevel ? { thinkingLevel: selection.thinkingLevel } : {}),
  };
}

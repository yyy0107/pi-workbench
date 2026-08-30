import type { PromptListPayload, PromptListValue } from "@workbench/agent-runtime-pi-protocol/rpc";
import {
  getScopedResourceContextService,
  type ScopedResourceContextService,
} from "../resources/scoped-resource-context";

export interface PromptServiceDependencies {
  scopedResources: Pick<ScopedResourceContextService, "get">;
}

/** Session-independent Pi prompt-catalog capability exposed to transport. */
export interface PromptCatalogProtocol {
  list(payload: PromptListPayload): Promise<PromptListValue>;
}

export class PromptService implements PromptCatalogProtocol {
  private readonly dependencies: PromptServiceDependencies;

  constructor(dependencies: Partial<PromptServiceDependencies> = {}) {
    this.dependencies = {
      scopedResources: getScopedResourceContextService(),
      ...dependencies,
    };
  }

  async list({ target }: PromptListPayload): Promise<PromptListValue> {
    const context = await this.dependencies.scopedResources.get(target);
    return {
      prompts: context.resourceLoader
        .getPrompts()
        .prompts.filter((prompt) => prompt.sourceInfo.scope === target.scope)
        .map((prompt) => ({
          kind: "prompt" as const,
          name: prompt.name,
          invocationName: prompt.name,
          effect: "prompt-transform" as const,
          exclusive: false,
          ...(prompt.description ? { description: prompt.description } : {}),
          ...(prompt.argumentHint ? { argumentHint: prompt.argumentHint } : {}),
          source: prompt.sourceInfo.source,
          scope: prompt.sourceInfo.scope,
          origin: prompt.sourceInfo.origin,
        })),
    };
  }
}

import {
  filterModelSelectorOptions,
  type ModelSelectorEffort,
  type ModelSelectorOption,
} from "@/components/ui/model-selector-models";
import type {
  ModelCatalogValue,
  ModelSelection,
  SessionModelsValue,
} from "@/workbench/runtime-contributions/pi/protocol/rpc";

export type SelectorEffort = ModelSelectorEffort;
export type SelectorModel = ModelSelectorOption;

export function modelSelectorId(provider: string, model: string): string {
  return `${encodeURIComponent(provider)}/${encodeURIComponent(model)}`;
}

export const filterSelectorModels = filterModelSelectorOptions;

export function sessionSelectorModels(catalog: SessionModelsValue): SelectorModel[] {
  const models = catalog.groups.flatMap((group) =>
    group.models.map((model): SelectorModel => {
      const reasoning = model.reasoning;
      return {
        id: modelSelectorId(group.id, model.id),
        provider: group.id,
        providerName: group.name,
        model: model.id,
        name: model.name,
        ...(model.description === undefined ? {} : { description: model.description }),
        ...(reasoning
          ? {
              efforts: reasoning.efforts,
              ...(reasoning.defaultEffort === undefined
                ? {}
                : { defaultEffort: reasoning.defaultEffort }),
            }
          : {}),
      };
    }),
  );
  const currentId = modelSelectorId(catalog.current.provider, catalog.current.model);
  if (models.some((model) => model.id === currentId)) return models;

  return [
    {
      id: currentId,
      provider: catalog.current.provider,
      providerName: catalog.current.provider,
      model: catalog.current.model,
      name: catalog.current.model,
      unavailable: true,
    },
    ...models,
  ];
}

export function draftSelectorModels(catalog: ModelCatalogValue): SelectorModel[] {
  return catalog.groups.flatMap((group) =>
    group.models.map((model) => ({
      id: modelSelectorId(group.id, model.id),
      provider: group.id,
      providerName: group.name,
      model: model.id,
      name: model.name,
      ...(model.description === undefined ? {} : { description: model.description }),
      ...(model.reasoning
        ? {
            efforts: model.reasoning.efforts,
            ...(model.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: model.reasoning.defaultEffort }),
          }
        : {}),
    })),
  );
}

export function resolveDraftSelectorModel(
  models: readonly SelectorModel[],
  draftModelId: string | undefined,
  rememberedModelId: string | undefined,
): SelectorModel | undefined {
  return (
    models.find((model) => model.id === draftModelId) ??
    models.find((model) => model.id === rememberedModelId) ??
    models[0]
  );
}

export function modelSelection(model: SelectorModel, preferredEffort?: string): ModelSelection {
  const efforts = model.efforts;
  const reasoningEffort = efforts?.some((effort) => effort.id === preferredEffort)
    ? preferredEffort
    : efforts?.some((effort) => effort.id === model.defaultEffort)
      ? model.defaultEffort
      : efforts?.[0]?.id;
  return {
    provider: model.provider,
    model: model.model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  };
}

export function modelChangeSelection(model: SelectorModel): ModelSelection {
  return modelSelection(model);
}

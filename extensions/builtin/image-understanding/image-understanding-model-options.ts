import type { ModelCatalogValue, ModelProvidersValue } from "@/runtime/pi/rpc-contracts";

export interface MultimodalModelOption {
  readonly value: string;
  readonly label: string;
}

export interface MultimodalProviderOption extends MultimodalModelOption {
  readonly models: readonly MultimodalModelOption[];
}

export function configuredMultimodalModelOptions(
  directory: ModelProvidersValue,
  catalog: ModelCatalogValue,
): readonly MultimodalProviderOption[] {
  const configuredProviders = new Map(
    directory.providers
      .filter(
        (provider) => provider.active && (provider.configured || provider.configurationDefined),
      )
      .map((provider) => [provider.provider, provider] as const),
  );

  return catalog.groups.flatMap((group) => {
    const configuredProvider = configuredProviders.get(group.id);
    if (!configuredProvider) return [];

    const models = group.models
      .filter((model) => model.input?.includes("image"))
      .map((model) => ({ value: model.id, label: model.name }));
    if (models.length === 0) return [];

    return [
      {
        value: group.id,
        label: configuredProvider.displayName || group.name,
        models,
      },
    ];
  });
}

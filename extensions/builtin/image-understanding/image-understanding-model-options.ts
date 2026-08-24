import type {
  ModelCapabilityState,
  ModelCatalogValue,
  ModelProvidersValue,
} from "@/runtime/pi/rpc-contracts";

export interface MultimodalModelOption {
  readonly value: string;
  readonly label: string;
}

export interface MultimodalProviderOption extends MultimodalModelOption {
  readonly models: readonly MultimodalModelOption[];
  readonly imageInput: ModelCapabilityState;
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
      .filter((model) => model.imageInput === "supported")
      .map((model) => ({ value: model.id, label: model.name }));
    const imageInput =
      models.length > 0
        ? "supported"
        : group.models.some((model) => model.imageInput === "unknown")
          ? "unknown"
          : "unsupported";
    return [
      {
        value: group.id,
        label: configuredProvider.displayName || group.name,
        models,
        imageInput,
      },
    ];
  });
}

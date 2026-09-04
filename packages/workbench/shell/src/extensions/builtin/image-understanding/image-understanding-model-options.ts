import type {
  WorkbenchModelCatalog,
  WorkbenchModelCatalogEntry,
} from "@workbench/agent-runtime-contracts/runtime-capabilities";

export interface MultimodalModelOption {
  readonly value: string;
  readonly label: string;
}

export interface MultimodalProviderOption extends MultimodalModelOption {
  readonly models: readonly MultimodalModelOption[];
  readonly imageInput: WorkbenchModelCatalogEntry["imageInput"];
}

export function configuredMultimodalModelOptions(
  catalog: WorkbenchModelCatalog,
): readonly MultimodalProviderOption[] {
  return catalog.groups.map((group) => {
    const models = group.models
      .filter((model) => model.imageInput === "supported")
      .map((model) => ({ value: model.id, label: model.name }));
    const imageInput =
      models.length > 0
        ? "supported"
        : group.models.some((model) => model.imageInput === "unknown")
          ? "unknown"
          : "unsupported";
    return {
      value: group.id,
      label: group.name,
      models,
      imageInput,
    };
  });
}

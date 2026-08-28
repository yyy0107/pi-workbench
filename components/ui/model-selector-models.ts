export interface ModelSelectorEffort {
  id: string;
  name: string;
  description?: string;
}

export interface ModelSelectorOption {
  id: string;
  provider: string;
  providerName: string;
  model: string;
  name: string;
  description?: string;
  efforts?: readonly ModelSelectorEffort[];
  defaultEffort?: string;
  unavailable?: boolean;
}

export function filterModelSelectorOptions(
  models: readonly ModelSelectorOption[],
  query: string,
): readonly ModelSelectorOption[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return models;

  return models.filter((model) => {
    const searchableText = [model.name, model.model, model.providerName, model.provider]
      .join("\n")
      .toLowerCase();
    return terms.every((term) => searchableText.includes(term));
  });
}

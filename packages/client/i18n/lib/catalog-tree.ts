type CatalogRecord = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function readMessage(catalog: CatalogRecord, key: string): unknown {
  return key.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, segment)) return undefined;
    return (value as Record<string, unknown>)[segment];
  }, catalog);
}

function cloneCatalogValue(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneCatalogValue(entry)]),
    ),
  );
}

export function mergeCatalog(
  base: CatalogRecord,
  addition: CatalogRecord,
  bundleId: string,
  prefix = "",
): CatalogRecord {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, additionValue] of Object.entries(addition)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Object.hasOwn(base, key)) {
      merged[key] = cloneCatalogValue(additionValue);
      continue;
    }

    const baseValue = base[key];
    if (isRecord(baseValue) && isRecord(additionValue)) {
      merged[key] = mergeCatalog(baseValue, additionValue, bundleId, path);
      continue;
    }

    throw new Error(`Translation bundle "${bundleId}" collides with message "${path}"`);
  }
  return Object.freeze(merged);
}

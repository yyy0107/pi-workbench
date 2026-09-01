import { SUPPORTED_LOCALES, type Locale } from "./config";
import type { CatalogShape, TranslationBundle } from "./types";

type CatalogRecord = Readonly<Record<string, unknown>>;

function isCatalogRecord(value: unknown): value is CatalogRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function leafKind(value: unknown): "function" | "string" | undefined {
  if (typeof value === "function") return "function";
  if (typeof value === "string") return "string";
  return undefined;
}

function assertCatalogParity(
  reference: CatalogRecord,
  candidate: CatalogRecord,
  bundleId: string,
  locale: Locale,
  prefix = "",
): void {
  const referenceKeys = Object.keys(reference).sort();
  const candidateKeys = Object.keys(candidate).sort();
  if (
    referenceKeys.length !== candidateKeys.length ||
    referenceKeys.some((key, index) => key !== candidateKeys[index])
  ) {
    throw new Error(
      `Translation bundle "${bundleId}" has different message keys for ${locale} at "${prefix || "<root>"}"`,
    );
  }

  for (const key of referenceKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const referenceValue = reference[key];
    const candidateValue = candidate[key];
    const referenceKind = leafKind(referenceValue);
    const candidateKind = leafKind(candidateValue);

    if (referenceKind || candidateKind) {
      if (!referenceKind || referenceKind !== candidateKind) {
        throw new Error(
          `Translation bundle "${bundleId}" has incompatible messages for ${locale} at "${path}"`,
        );
      }
      continue;
    }

    if (!isCatalogRecord(referenceValue) || !isCatalogRecord(candidateValue)) {
      throw new Error(
        `Translation bundle "${bundleId}" contains an unsupported message at "${path}"`,
      );
    }
    assertCatalogParity(referenceValue, candidateValue, bundleId, locale, path);
  }
}

function cloneCatalog(catalog: CatalogRecord, bundleId: string, prefix = ""): CatalogRecord {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (leafKind(value)) {
      clone[key] = value;
      continue;
    }
    if (!isCatalogRecord(value)) {
      throw new Error(
        `Translation bundle "${bundleId}" contains an unsupported message at "${path}"`,
      );
    }
    clone[key] = cloneCatalog(value, bundleId, path);
  }
  return Object.freeze(clone);
}

export function validateTranslationBundle(bundle: TranslationBundle): void {
  if (!bundle.id.trim()) throw new Error("Translation bundle id must not be empty");

  const reference = bundle.messages["en-US"];
  if (!isCatalogRecord(reference)) {
    throw new Error(`Translation bundle "${bundle.id}" must contain an en-US catalog`);
  }

  for (const locale of SUPPORTED_LOCALES) {
    const catalog = bundle.messages[locale];
    if (!isCatalogRecord(catalog)) {
      throw new Error(`Translation bundle "${bundle.id}" must contain a ${locale} catalog`);
    }
    assertCatalogParity(reference, catalog, bundle.id, locale);
  }
}

export function defineTranslationBundle<const TCatalog extends object>(definition: {
  readonly id: string;
  readonly messages: Readonly<{
    readonly "en-US": TCatalog;
    readonly "zh-CN": CatalogShape<TCatalog>;
  }>;
}): TranslationBundle<CatalogShape<TCatalog>> {
  validateTranslationBundle(definition as TranslationBundle);

  const messages = Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      cloneCatalog(definition.messages[locale] as CatalogRecord, definition.id),
    ]),
  ) as Record<Locale, CatalogShape<TCatalog>>;

  return Object.freeze({
    id: definition.id,
    messages: Object.freeze(messages),
  });
}

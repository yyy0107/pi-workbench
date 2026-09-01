import type {
  LocalizableMessageDescriptor,
  LocalizableText as ExtensionLocalizableText,
} from "@workbench/extension-sdk";
// The catalog runtime is the sole Shell boundary allowed to construct the SDK's branded
// descriptors. Keeping the constructor internal prevents business modules from forging them.
import { createLocalizableMessageDescriptor } from "@workbench/extension-sdk/internal";

import { validateTranslationBundle } from "./bundle";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "./config";
import { messages, type Messages } from "./messages";
import type {
  CatalogTranslate,
  I18nRuntime,
  MessageDescriptorFor,
  MessageFormatters,
  MessageKeyOf,
  TranslationArgs,
  TranslationBundle,
} from "./types";

type CatalogRecord = Readonly<Record<string, unknown>>;

export type MessageKey = MessageKeyOf<Messages>;

type StaticMessageKeyOf<T, TPrefix extends string = ""> = {
  [TKey in keyof T & string]: T[TKey] extends string
    ? `${TPrefix}${TKey}`
    : T[TKey] extends (...args: never[]) => string
      ? never
      : T[TKey] extends object
        ? StaticMessageKeyOf<T[TKey], `${TPrefix}${TKey}.`>
        : never;
}[keyof T & string];

export type StaticMessageKey = StaticMessageKeyOf<Messages>;

const resolveMessageDescriptor = Symbol("workbench.i18n.resolve-message-descriptor");

export type Translate = CatalogTranslate<Messages> & {
  readonly [resolveMessageDescriptor]: (descriptor: LocalizableMessageDescriptor) => string;
};

export type MessageDescriptor = {
  [TKey in MessageKey]: MessageDescriptorFor<Messages, TKey>;
}[MessageKey];

/** Catalog-neutral input accepted from extension contracts. Descriptors remain opaque in source. */
export type LocalizableText = ExtensionLocalizableText;

export interface WorkbenchI18nRuntime extends I18nRuntime<Translate> {
  isLocalizableText(value: unknown): value is LocalizableText;
  text(value: LocalizableText): string;
  forBundle<TCatalog extends object>(
    bundle: TranslationBundle<TCatalog>,
  ): I18nRuntime<CatalogTranslate<TCatalog>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readMessage(catalog: CatalogRecord, key: string): unknown {
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

function mergeCatalog(
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

function composeCatalogs(
  bundles: readonly TranslationBundle[],
): Readonly<Record<Locale, CatalogRecord>> {
  const installedBundleIds = new Set<string>();
  const catalogs: Record<Locale, CatalogRecord> = {
    "en-US": messages["en-US"],
    "zh-CN": messages["zh-CN"],
  };

  for (const bundle of bundles) {
    validateTranslationBundle(bundle);
    if (installedBundleIds.has(bundle.id)) {
      throw new Error(`Duplicate translation bundle id "${bundle.id}"`);
    }
    installedBundleIds.add(bundle.id);
    for (const locale of SUPPORTED_LOCALES) {
      catalogs[locale] = mergeCatalog(
        catalogs[locale],
        bundle.messages[locale] as CatalogRecord,
        bundle.id,
      );
    }
  }

  return Object.freeze(catalogs);
}

function createFormatters(locale: Locale): MessageFormatters {
  return {
    date: (value, options) => new Intl.DateTimeFormat(locale, options).format(value),
    number: (value, options) => new Intl.NumberFormat(locale, options).format(value),
    plural: (value, options) => new Intl.PluralRules(locale, options).select(value),
    relativeTime: (value, unit) =>
      new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit),
  };
}

function createLocalizableTextValidator(
  fallbackCatalog: CatalogRecord,
): (value: unknown) => value is LocalizableText {
  return (value: unknown): value is LocalizableText => {
    if (typeof value === "string") return true;
    if (!isRecord(value) || !Object.hasOwn(value, "key") || typeof value.key !== "string") {
      return false;
    }
    if (Object.keys(value).some((key) => key !== "key" && key !== "values")) return false;

    const message = readMessage(fallbackCatalog, value.key);
    if (typeof message === "string") return !("values" in value);
    if (typeof message === "function") return isRecord(value.values);
    return false;
  };
}

export function createI18n(
  locale: Locale,
  bundles: readonly TranslationBundle[] = [],
): WorkbenchI18nRuntime {
  const formatters = createFormatters(locale);
  const catalogs = composeCatalogs(bundles);
  const fallbackCatalog = catalogs[DEFAULT_LOCALE];
  const selectedCatalog = catalogs[locale];
  const installedBundles = new Map(bundles.map((bundle) => [bundle.id, bundle]));
  const bundleRuntimeCache = new WeakMap<object, unknown>();

  const translateValidatedMessage = (key: string, values?: object): string => {
    const selected = readMessage(selectedCatalog, key);
    const fallback = readMessage(fallbackCatalog, key);
    const message = selected ?? fallback;

    if (typeof message === "function") {
      return (message as (values: object, formatters: MessageFormatters) => string)(
        values ?? {},
        formatters,
      );
    }
    if (typeof message === "string") return message;

    if (process.env.NODE_ENV !== "production") {
      throw new Error(`Missing i18n message "${key}" for locale "${locale}"`);
    }
    console.error(`Missing i18n message "${key}" for locale "${locale}"`);
    return "";
  };

  const translate = ((key: MessageKey, values?: object) =>
    translateValidatedMessage(key, values)) as CatalogTranslate<Messages>;
  const t: Translate = Object.assign(translate, {
    [resolveMessageDescriptor]: (descriptor: LocalizableMessageDescriptor) =>
      translateValidatedMessage(
        descriptor.key,
        "values" in descriptor ? descriptor.values : undefined,
      ),
  });
  const validateLocalizableText = createLocalizableTextValidator(fallbackCatalog);

  const runtime: WorkbenchI18nRuntime = {
    locale,
    t,
    ...formatters,
    isLocalizableText: validateLocalizableText,
    text: (value) => resolveText(t, value, validateLocalizableText),
    forBundle: <TCatalog extends object>(bundle: TranslationBundle<TCatalog>) => {
      if (installedBundles.get(bundle.id) !== bundle) {
        throw new Error(`Translation bundle "${bundle.id}" is not installed in this I18n runtime`);
      }
      const cached = bundleRuntimeCache.get(bundle);
      if (cached) return cached as I18nRuntime<CatalogTranslate<TCatalog>>;
      const bundleTranslate = ((key: MessageKeyOf<TCatalog>, values?: object) =>
        translateValidatedMessage(key, values)) as CatalogTranslate<TCatalog>;
      const bundleRuntime = Object.freeze({ locale, t: bundleTranslate, ...formatters });
      bundleRuntimeCache.set(bundle, bundleRuntime);
      return bundleRuntime;
    },
  };
  return runtime;
}

function createDescriptor(key: string, args: readonly unknown[]): LocalizableMessageDescriptor {
  if (args.length === 0) return createLocalizableMessageDescriptor(key);
  const values = args[0];
  if (!isRecord(values)) throw new Error(`Message "${key}" values must be an object`);
  return createLocalizableMessageDescriptor(key, values);
}

export function defineMessage<TKey extends MessageKey>(
  key: TKey,
  ...args: TranslationArgs<Messages, TKey>
): MessageDescriptorFor<Messages, TKey> {
  return createDescriptor(key, args) as MessageDescriptorFor<Messages, TKey>;
}

export type TranslationBundleMessageFactory<TCatalog extends object> = <
  TKey extends MessageKeyOf<TCatalog>,
>(
  key: TKey,
  ...args: TranslationArgs<TCatalog, TKey>
) => MessageDescriptorFor<TCatalog, TKey>;

export function createTranslationBundleMessageFactory<TCatalog extends object>(
  _bundle: TranslationBundle<TCatalog>,
): TranslationBundleMessageFactory<TCatalog> {
  return <TKey extends MessageKeyOf<TCatalog>>(
    key: TKey,
    ...args: TranslationArgs<TCatalog, TKey>
  ) => createDescriptor(key, args) as MessageDescriptorFor<TCatalog, TKey>;
}

/**
 * Validates localizable text restored from an untyped persistence boundary against the Shell base
 * catalog. Consumers that install translation bundles should use the validator returned by
 * `createI18n()` or `useI18n()` so bundle-owned descriptors are also recognized.
 */
export const isLocalizableText = createLocalizableTextValidator(messages[DEFAULT_LOCALE]);

export function resolveText(
  t: Translate,
  value: LocalizableText,
  validate: (value: unknown) => value is LocalizableText = isLocalizableText,
): string {
  if (!validate(value)) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error("Invalid or unknown localizable message descriptor");
    }
    console.error("Invalid or unknown localizable message descriptor");
    return "";
  }
  if (typeof value === "string") return value;
  return t[resolveMessageDescriptor](value);
}

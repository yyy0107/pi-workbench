import { isRecord, readMessage, mergeCatalog } from "../lib/catalog-tree";
import type {
  LocalizableMessageDescriptor,
  LocalizableText as ExtensionLocalizableText,
} from "@workbench/extension-sdk";
// The catalog runtime is the sole translation boundary allowed to construct the SDK's branded
// descriptors. Keeping the constructor internal prevents business modules from forging them.
import { createLocalizableMessageDescriptor } from "@workbench/extension-sdk/internal";

import { validateTranslationBundle } from "./bundle";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "./config";
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

const resolveMessageDescriptor = Symbol("workbench.i18n.resolve-message-descriptor");
const validateMessageDescriptor = Symbol("workbench.i18n.validate-message-descriptor");

export interface DescriptorTranslate {
  readonly [resolveMessageDescriptor]: (descriptor: LocalizableMessageDescriptor) => string;
  readonly [validateMessageDescriptor]: (value: unknown) => value is LocalizableText;
}

export type Translate = ((key: string, values?: object) => string) & DescriptorTranslate;

/** Catalog-neutral input accepted from extension contracts. Descriptors remain opaque in source. */
export type LocalizableText = ExtensionLocalizableText;

export interface WorkbenchI18nRuntime extends I18nRuntime<Translate> {
  isLocalizableText(value: unknown): value is LocalizableText;
  text(value: LocalizableText): string;
  forBundle<TCatalog extends object>(
    bundle: TranslationBundle<TCatalog>,
  ): I18nRuntime<CatalogTranslate<TCatalog>>;
}

function composeCatalogs(
  bundles: readonly TranslationBundle[],
): Readonly<Record<Locale, CatalogRecord>> {
  const installedBundleIds = new Set<string>();
  const catalogs: Record<Locale, CatalogRecord> = {
    "en-US": Object.freeze({}),
    "zh-CN": Object.freeze({}),
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

  const translate = (key: string, values?: object) => translateValidatedMessage(key, values);
  const validateLocalizableText = createLocalizableTextValidator(fallbackCatalog);
  const t: Translate = Object.assign(translate, {
    [validateMessageDescriptor]: validateLocalizableText,
    [resolveMessageDescriptor]: (descriptor: LocalizableMessageDescriptor) =>
      translateValidatedMessage(
        descriptor.key,
        "values" in descriptor ? descriptor.values : undefined,
      ),
  });
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

export function resolveText(
  t: DescriptorTranslate,
  value: LocalizableText,
  validate: (value: unknown) => value is LocalizableText = t[validateMessageDescriptor],
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

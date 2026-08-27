import { DEFAULT_LOCALE, type Locale } from "./config";
import { messages, type Messages } from "./messages";
import type { I18nRuntime, MessageFormatters } from "./types";

type MessageLeaf = string | ((...args: never[]) => string);

type MessageKeyOf<T, TPrefix extends string = ""> = {
  [TKey in keyof T & string]: T[TKey] extends MessageLeaf
    ? `${TPrefix}${TKey}`
    : T[TKey] extends object
      ? MessageKeyOf<T[TKey], `${TPrefix}${TKey}.`>
      : never;
}[keyof T & string];

type MessageAtPath<T, TPath extends string> = TPath extends `${infer THead}.${infer TTail}`
  ? THead extends keyof T
    ? MessageAtPath<T[THead], TTail>
    : never
  : TPath extends keyof T
    ? T[TPath]
    : never;

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

type TranslationArgs<TKey extends MessageKey> =
  MessageAtPath<Messages, TKey> extends (values: infer TValues, ...args: never[]) => string
    ? [values: TValues]
    : [];

export type Translate = <TKey extends MessageKey>(
  key: TKey,
  ...args: TranslationArgs<TKey>
) => string;

type DescriptorFor<TKey extends MessageKey> =
  TranslationArgs<TKey> extends []
    ? { readonly key: TKey }
    : { readonly key: TKey; readonly values: TranslationArgs<TKey>[0] };

export type MessageDescriptor = {
  [TKey in MessageKey]: DescriptorFor<TKey>;
}[MessageKey];

export type LocalizableText = string | MessageDescriptor;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readMessage(catalog: Messages, key: string): unknown {
  return key.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, segment)) return undefined;
    return (value as Record<string, unknown>)[segment];
  }, catalog);
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

export function createI18n(locale: Locale): I18nRuntime<Translate> {
  const formatters = createFormatters(locale);
  const fallbackCatalog = messages[DEFAULT_LOCALE];

  const t = ((key: MessageKey, values?: Record<string, unknown>) => {
    const selected = readMessage(messages[locale], key);
    const fallback = readMessage(fallbackCatalog, key);
    const message = selected ?? fallback;

    if (typeof message === "function") {
      return (
        message as (values: Record<string, unknown>, formatters: MessageFormatters) => string
      )(values ?? {}, formatters);
    }
    if (typeof message === "string") return message;

    if (process.env.NODE_ENV !== "production") {
      throw new Error(`Missing i18n message "${key}" for locale "${locale}"`);
    }
    console.error(`Missing i18n message "${key}" for locale "${locale}"`);
    return "";
  }) as Translate;

  return { locale, t, ...formatters };
}

export function defineMessage<TKey extends MessageKey>(
  key: TKey,
  ...args: TranslationArgs<TKey>
): DescriptorFor<TKey> {
  return (args.length === 0 ? { key } : { key, values: args[0] }) as DescriptorFor<TKey>;
}

/**
 * Validates localizable text restored from an untyped persistence boundary.
 * Literal strings remain valid for user/resource labels and legacy snapshots.
 */
export function isLocalizableText(value: unknown): value is LocalizableText {
  if (typeof value === "string") return true;
  if (!isRecord(value) || typeof value.key !== "string") return false;
  if (Object.keys(value).some((key) => key !== "key" && key !== "values")) return false;

  const message = readMessage(messages[DEFAULT_LOCALE], value.key);
  if (typeof message === "string") return !("values" in value);
  if (typeof message === "function") return isRecord(value.values);
  return false;
}

export function resolveText(t: Translate, value: LocalizableText): string {
  if (typeof value === "string") return value;
  if ("values" in value) {
    return (t as (key: MessageKey, values: unknown) => string)(value.key, value.values);
  }
  return (t as (key: MessageKey) => string)(value.key);
}

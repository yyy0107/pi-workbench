import type { Locale } from "./config";
import type { LocalizableMessageDescriptor } from "@workbench/extension-sdk";

export type MessageVariables = Record<string, unknown>;

export interface MessageFormatters {
  date(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  plural(value: number, options?: Intl.PluralRulesOptions): Intl.LDMLPluralRule;
  relativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string;
}

export type CatalogShape<T> = T extends string
  ? string
  : T extends (...args: infer TArgs) => string
    ? (...args: TArgs) => string
    : T extends object
      ? { readonly [TKey in keyof T]: CatalogShape<T[TKey]> }
      : never;

type MessageLeaf = string | ((...args: never[]) => string);

export type MessageKeyOf<TCatalog, TPrefix extends string = ""> = {
  [TKey in keyof TCatalog & string]: TCatalog[TKey] extends MessageLeaf
    ? `${TPrefix}${TKey}`
    : TCatalog[TKey] extends object
      ? MessageKeyOf<TCatalog[TKey], `${TPrefix}${TKey}.`>
      : never;
}[keyof TCatalog & string];

export type MessageAtPath<
  TCatalog,
  TPath extends string,
> = TPath extends `${infer THead}.${infer TTail}`
  ? THead extends keyof TCatalog
    ? MessageAtPath<TCatalog[THead], TTail>
    : never
  : TPath extends keyof TCatalog
    ? TCatalog[TPath]
    : never;

export type TranslationArgs<TCatalog, TKey extends MessageKeyOf<TCatalog>> =
  MessageAtPath<TCatalog, TKey> extends (...args: infer TArgs) => string
    ? TArgs extends [values: infer TValues, ...formatters: unknown[]]
      ? [values: TValues]
      : []
    : [];

export type CatalogTranslate<TCatalog> = <TKey extends MessageKeyOf<TCatalog>>(
  key: TKey,
  ...args: TranslationArgs<TCatalog, TKey>
) => string;

export type MessageDescriptorFor<TCatalog, TKey extends MessageKeyOf<TCatalog>> =
  TranslationArgs<TCatalog, TKey> extends []
    ? LocalizableMessageDescriptor<TKey, undefined>
    : LocalizableMessageDescriptor<TKey, Extract<TranslationArgs<TCatalog, TKey>[0], object>>;

/**
 * An immutable, explicitly installed catalog extension. Bundles are values so every provider owns
 * its own catalog composition; importing a package never mutates a process-wide registry.
 */
export interface TranslationBundle<TCatalog extends object = object> {
  readonly id: string;
  readonly messages: Readonly<Record<Locale, TCatalog>>;
}

export type I18nRuntime<TTranslate> = MessageFormatters & {
  locale: Locale;
  t: TTranslate;
};

import type { Locale } from "./config";

export type MessageVariables = Record<string, unknown>;

export interface MessageFormatters {
  date(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  relativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string;
}

export type CatalogShape<T> = T extends string
  ? string
  : T extends (...args: infer TArgs) => string
    ? (...args: TArgs) => string
    : T extends object
      ? { readonly [TKey in keyof T]: CatalogShape<T[TKey]> }
      : never;

export type I18nRuntime<TTranslate> = MessageFormatters & {
  locale: Locale;
  t: TTranslate;
};

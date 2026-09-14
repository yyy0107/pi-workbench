import type { LocalizableMessageDescriptor } from "./localizable-text";

/** Infrastructure-only factory; product code constructs descriptors through its typed catalog. */
export function createLocalizableMessageDescriptor<const TKey extends string>(
  key: TKey,
): LocalizableMessageDescriptor<TKey, undefined>;
export function createLocalizableMessageDescriptor<
  const TKey extends string,
  const TValues extends object,
>(key: TKey, values: TValues): LocalizableMessageDescriptor<TKey, TValues>;
export function createLocalizableMessageDescriptor(
  key: string,
  values?: object,
): LocalizableMessageDescriptor {
  const descriptor = values === undefined ? { key } : { key, values };
  return Object.freeze(descriptor) as LocalizableMessageDescriptor;
}

import type { LocalizableMessageDescriptor } from "./api/localizable-text";

/** Concrete registries and lifecycle machinery for trusted host composition and tests. */
export * from "./extension-manager";
export * from "./registries";

/**
 * Infrastructure-only constructor used by an application's catalog-typed `defineMessage()`.
 * Public extension authoring intentionally does not export this factory.
 */
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

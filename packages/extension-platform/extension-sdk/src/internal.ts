import { createLocalizableMessageDescriptor as createCoreLocalizableMessageDescriptor } from "@workbench/core-contracts/localizable-text/internal";
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
  return values === undefined
    ? createCoreLocalizableMessageDescriptor(key)
    : createCoreLocalizableMessageDescriptor(key, values);
}

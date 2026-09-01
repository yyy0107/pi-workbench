/**
 * Compile-time-only brand. It intentionally has no runtime property so descriptors retain the
 * plain JSON `{ key }` / `{ key, values }` shape used by persistence boundaries. Applications
 * recover the branded type only after validating restored data against their own message catalog.
 */
declare const localizableMessageDescriptorBrand: unique symbol;

type DescriptorValues<TValues extends object | undefined> = TValues extends object
  ? { readonly values: TValues }
  : { readonly values?: never };

/**
 * Catalog-neutral, opaque message descriptor. `TKey` is the combined semantic key (including its
 * namespace, for example `extensions.toolbox.title`) and `TValues` remains paired with that key.
 * Raw object literals cannot satisfy this contract because the phantom brand is not exported.
 */
export type LocalizableMessageDescriptor<
  TKey extends string = string,
  TValues extends object | undefined = object | undefined,
> = Readonly<{
  key: TKey;
  [localizableMessageDescriptorBrand]: {
    key: TKey;
    values: TValues;
  };
}> &
  DescriptorValues<TValues>;

export type LocalizableText = string | LocalizableMessageDescriptor;

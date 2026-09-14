/**
 * Compile-time-only brand. Descriptors retain the JSON-safe `{ key }` / `{ key, values }` shape
 * across extension, host, web, desktop, and mobile boundaries.
 */
declare const localizableMessageDescriptorBrand: unique symbol;

type DescriptorValues<TValues extends object | undefined> = TValues extends object
  ? { readonly values: TValues }
  : { readonly values?: never };

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

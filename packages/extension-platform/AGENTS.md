# Extension Platform i18n and boundary rules

- The SDK is host-free: public authoring contracts must not import root application modules,
  `@/*`, a router, stores, or an application-local i18n runtime.
- The Host owns extension metadata's translation boundary. It accepts stable descriptors and the
  application resolves them for the active locale; Service/Registry code must never call React
  hooks.
- Platform APIs must keep stable identifiers separate from display copy. Registry `id`s and enums
  are not localized; `title`, `description`, and `category` accept lazily resolved message
  descriptors or an equivalent type.
- Public message descriptors must contain a namespace, semantic key, and type-safe parameters;
  do not use an entire English sentence as a key.
- SDK descriptors are opaque in source even though persistence keeps the plain JSON `{ key }` or
  `{ key, values }` shape. Application extensions construct them through the catalog-typed
  `defineMessage()` API; do not import the SDK infrastructure factory into product code or replace
  the brand with a raw object assertion.
- Do not resolve and retain translated text in `setup()`. Snapshots store stable descriptors so a
  locale change can rerender without deactivating extensions.
- Platform-owned command palette, extension error-boundary, and default Panel/Renderer copy uses
  the `platform.extensions` dictionary. Feature copy remains in that feature's namespace.
- Any changed platform copy contract requires synchronized SDK types, Host behavior, built-in
  examples, `docs/extensions.md`, and both `en-US` and `zh-CN` messages.

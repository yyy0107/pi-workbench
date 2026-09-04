# Shell extension ownership and i18n

- Shell-owned built-in extension copy belongs in `../i18n/extensions/<locale>.ts`, grouped by
  stable extension namespace. Do not create a private dictionary or translation hook for each
  small extension.
- Extension IDs, command IDs, panel IDs, renderer names, and state enums are stable protocol values
  and are not translated. Names, titles, descriptions, categories, controls, errors, empty states,
  tooltips, and accessibility copy are translated.
- Extension `setup()` must not freeze text for the current locale. Register stable message
  descriptors through the Shell i18n API and resolve them in the Host at render time.
- Shared extension terminology belongs under `extensions.shared`; platform-owned terminology stays
  with the Extension Host. Shared UI controls receive already-owned localizable labels instead of
  importing a feature dictionary.
- Terminal output, code, paths, provider/model names, raw token values, and user content remain
  unchanged. Surrounding labels, units, status, and explanations use locale-aware formatting.
- Every changed key must exist with the same parameters in `en-US` and `zh-CN`, including tooltip,
  empty-state, error, and accessibility text.

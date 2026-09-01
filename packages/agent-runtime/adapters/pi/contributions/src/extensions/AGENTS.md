# Pi contribution extension ownership and i18n

- Pi-owned Workbench contribution copy belongs in `../i18n/<locale>.ts`, grouped under the stable
  `extensions` namespace. Do not move Pi-specific product copy into the generic Shell dictionary or
  create per-feature translation runtimes.
- Extension IDs, command IDs, panel IDs, renderer names, and state enums are stable protocol values
  and are not translated. Names, titles, descriptions, categories, controls, errors, empty states,
  tooltips, and accessibility copy are translated.
- Extension `setup()` must not retain text resolved for the current locale. Register stable message
  descriptors and let the installed Host resolve them when rendered.
- Shared Pi-contribution terminology belongs in this owner's `extensions.shared` namespace;
  platform-owned terminology remains in the Extension Host bundle.
- Terminal output, code, paths, provider/model names, raw token values, and user content remain
  unchanged. Surrounding labels, units, status, and explanations use locale-aware formatting.
- Every changed key must exist with the same parameters in `en-US` and `zh-CN`, including tooltip,
  empty-state, error, and accessibility text.

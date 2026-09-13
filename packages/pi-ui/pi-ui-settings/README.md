# @workbench/pi-ui-settings

Owns Pi agent configuration settings, system and append prompt editors, dynamic prompt placeholders, cache-miss notices, and configuration-file actions. Pi provider and model configuration now belongs to `@workbench/pi-ui-settings-models`.

`src/` contains the agent configuration extensions, settings items, cache notice, configuration actions, local dictionary, and prompt placeholder styles. `lib/` contains the consumed prompt-placeholder highlighting helper. Tests remain in `tests/`; Pi client/protocol behavior stays behind the public Pi client boundary.

The package preserves existing agent configuration extension IDs, settings IDs, prompt persistence, and resource disposal. Consumers use public package exports and the `./i18n` bundle; model configuration consumers use `@workbench/pi-ui-settings-models`.

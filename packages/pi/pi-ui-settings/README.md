# @workbench/pi-ui-settings

src owns Pi model configuration, agent settings, cache-miss UI, configuration-file actions and bilingual dictionaries/styles. lib owns consumed draft conversion, provider credential links and prompt token highlight helpers. Keep TS/TSX with at most one subdirectory. The product installs the bundle and extensions in their original order, preserving Pi client instances, autosave and resource disposal. Tests live in tests/.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/model-config-model-row.tsx` imports `lib/model-config-draft.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

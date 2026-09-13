# @workbench/settings-ui

src owns settings navigation, section UI, appearance and language controls, background image state and bilingual dictionaries/styles. lib owns consumed locale-display and appearance-page default-selection helpers. Both contain TS/TSX with at most one subdirectory. Product installation preserves extension order, preference storage, locale hydration and disposal. Public consumers use exports; tests live in tests/.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/appearance-reset-action.tsx` imports `lib/appearance-settings-pages.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

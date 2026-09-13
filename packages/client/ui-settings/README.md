# @workbench/ui-settings

src owns settings navigation, section UI, appearance and language controls, background image state and bilingual dictionaries/styles. lib owns consumed locale-display and appearance-page default-selection helpers. Both contain TS/TSX with at most one subdirectory. Product installation preserves extension order, preference storage, locale hydration and disposal. Public consumers use exports; tests live in tests/.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/appearance-reset-action.tsx` imports `lib/appearance-settings-pages.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

Color selection is owned here: `./color-picker` exposes ColorPicker and normalizeHexColor; `./color-picker.css` is assembled by Shell. The component consumes `lib/normalize-hex-color.ts` and the existing settings bundle owns the unchanged `ui.colorPicker.*` keys.

颜色选择器及其样式、正规化辅助和双语文案归本包；Shell 在原层叠位置导入颜色样式，组件使用共享 i18n bundle。

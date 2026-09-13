# @workbench/ui-theme

Owns appearance settings, background effects, color selection, appearance state, and their scoped styles. Shell remains the CSS aggregation point.

AppearanceSettingsItem only dispatches sections. Theme, font, interface and background pages own their actual JSX; the page model keeps installation state wiring and controls preserve distinct range/color commit lifecycles.

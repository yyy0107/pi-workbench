# @workbench/ui-selectors

Owns the shared searchable, animated, and workspace selector controls. Labels and validation copy
are supplied by callers; the package does not create a second translation bundle. Selector popup
content uses the installing Workbench portal supplied by the base UI package.

`lib/selector-dropdown-metrics.ts` contains the transition metric helpers consumed by the animated
selector hook. The existing selector behavior and public component types remain unchanged.

SearchableSelector foundation assertions are owned here; they are retained but excluded from execution under the current no-UI-tests constraint.

## Shared dropdown appearance

Menus, settings dropdowns, model dropdowns, and searchable selectors share the surface, item,
and scroll-area styles exported by `@workbench/ui` from `menu-styles.ts`.

- Popups size to their content, are at least as wide as their anchor when space permits, and
  never exceed the positioning layer's available width. Height is constrained by default.
- Single-line items use `--form-control-height` and the default control padding. Descriptions
  and paths can add lines naturally; consumers should not impose another fixed row height.
- Rounded corners, shadows, colors, and item states come from the shared profile. Scrolling
  uses the global scrollbar appearance. Scrollbar space is not reserved by default.
- Use `SearchableSelectorSearch` for a fixed search row, `SearchableSelectorList` for the
  shrinking, scrollable list, and a non-shrinking footer for actions. The popup remains in the
  installing Workbench portal.
- Feature wrappers should retain semantics and layout only. Avoid overriding popup width,
  item spacing, corner radius, or shadows. A structural exception such as the two-column time
  picker should explain its sizing near the implementation.

`DropdownMenuContent`, `ContextMenuContent`, `SearchableSelectorContent`, and their settings,
submenu, and model wrappers accept these layout options:

| Option                  | Default | Behavior                                                                                                                                          |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reserveScrollbarSpace` | `false` | Reserve scrollbar width before overflow when enabled.                                                                                             |
| `limitHeight`           | `true`  | Cap the panel at eight standard row heights or available space, whichever is smaller. Set to `false` to let the panel and list grow with content. |

For a short menu, use `reserveScrollbarSpace={false}` and optionally `limitHeight={false}`.
Branch menus reserve space only above eight options. `WorkspaceSelector` exposes both options
and uses the same eight-option threshold as its default reservation policy. Searchable content
passes the options to its list, so the fixed search row and footer do not reserve extra gutters.

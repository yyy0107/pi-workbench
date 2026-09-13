# @workbench/ui-settings

Owns the shared settings container: the settings registry integration, main view, navigation sidebar, sidebar rail, settings command, and settings trigger. Feature packages contribute sections and items through the public settings registry; `ui-settings-general` contributes locale and conversation preferences, while `ui-theme` contributes appearance settings.

The package keeps the settings request and surface contracts used by Shell and workspace consumers. `src/` contains the container implementation, contracts, styles, and its settings dictionary; `lib/` contains only consumed container helpers. Tests remain in `tests/`, and all source stays TypeScript or TSX.

The `extensions.settings.general` and `extensions.settings.groups.*` messages belong to the container. Feature-owned dictionaries are registered by their owning packages. Consumers use the public `./request`, `./surface`, `./sidebar`, `./sidebar-rail`, `./i18n`, and `./styles.css` exports.

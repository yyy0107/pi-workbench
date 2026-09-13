# @workbench/shell

`@workbench/shell` is the application assembly package for the Workbench. It installs the shared
Shell context, settings and locale adapters, extension registries, runtime and navigation ports,
and the capability bundles used by Web and Desktop. It keeps the application lifecycle and
composition boundary; reusable UI capabilities live in their owning packages.

The current public exports are:

- `@workbench/shell/application` — the application entry and installation props.
- `@workbench/shell/browser-session-persistence` — browser session persistence adapters.
- `@workbench/shell/extensions` — built-in extension groups and Shell-owned extension exports.
- `@workbench/shell/i18n` — the Shell provider, runtime view, and shared bundle composition API.
- `@workbench/shell/i18n/runtime` — the server-safe runtime and translation descriptor types.
- `@workbench/shell/styles.css` — the unified Web/Desktop stylesheet entry.

The package manifest is the source of truth for this surface. Consumers must use these explicit
entries and must not import Shell internals by filesystem path.

Responsibility is divided across capability owners:

- `@workbench/ui-layout` owns `WorkbenchShell`, the frame, Header, Statusbar, global layers,
  sidebar frame/resize, layout observation, and layout-owned hydration. Shell installs and
  composes it.
- `@workbench/ui-sidebar` owns conversation and workspace lists, ordering and drag policy,
  `ConversationActionsMenu`, the workspace sidebar extension, and the `workbench.sidebar.*`
  bundle. The `workbench.shell.workspace` key also belongs to this bundle because the Header and
  workspace extension consume it.
- `@workbench/ui-panels` owns panel layout, docks, sizing, and `TerminalDrawer`. Panel state is
  still installed per Workbench through Shell context.
- The Extension Host owns the command palette entry and its keyboard/lifecycle behavior.
- Conversation, Composer, workspace, settings, terminal, and Pi capabilities remain in their
  existing packages and contribute their own translation bundles and extensions.

Shell aggregates capability bundles into the one installed `@workbench/i18n` provider. It owns
locale hydration, revision and cookie behavior, while each capability owns its bilingual
dictionary. It does not create a second translation context or reimplement capability hooks.

`styles.css` remains the single stylesheet entry for Web and Desktop. It imports global Shell
styles and the stylesheets owned by the contributing capabilities in the established order.
Applications provide host fonts and Tailwind scan roots; capability packages own their regional
tokens and styles. Portal containers and installation-scoped state remain under the Workbench
Shell root so menus, dialogs, drag overlays, and other floating UI retain the installation's
theme and keyboard ownership.

The package intentionally has no product routing, Pi implementation, platform transport, or
native/Electron ownership. Applications supply the navigation adapter, runtime connection,
settings service, extension registries, initial locale, and capability bundles at installation.

Source layout stays shallow: `src/` contains Shell assembly and its contracts, `lib/` contains
only helpers with real Shell consumers, and `tests/` contains package tests. UI tests are retained
for regression coverage but are excluded from the current migration validation by project
instruction; type, structure, dependency, non-UI logic, and build checks remain applicable.

Useful checks:

```bash
pnpm --filter @workbench/shell typecheck
pnpm check:package-structure
```

The installation composes conversation header data/actions and one ThreadScrollStateProvider inside RuntimeProvider for both main conversation and SideChat.

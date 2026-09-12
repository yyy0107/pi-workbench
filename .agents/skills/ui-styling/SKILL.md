---
name: ui-styling
description: Implement Workbench UI components, layout, and appearance changes using Shell primitives and tokens. Use for unresolved styling or interaction implementation; routine copy and logic edits do not need this skill.
argument-hint: "[component or layout]"
license: MIT
metadata:
  author: claudekit
  version: "1.0.0"
---

# Workbench UI Styling

Follow the repository `AGENTS.md` and reuse the existing Shell component and appearance system. This skill covers Workbench implementation, including shared tokens and component states. Product extensions and their registration use `extend-workbench-ui`; specific UX questions can use `ui-ux-pro-max` when project conventions leave a decision unresolved.

## Find the existing owner

For new controls or layout/visual/interaction changes, inspect only the relevant owner:

- `packages/workbench/shell/src/ui/`: shared primitives and variants; use the owning package's public exports instead of copying implementations.
- `packages/workbench/shell/src/styles.css`: semantic Tailwind mappings and imported regional styles.
- `packages/workbench/shell/src/extensions/builtin/appearance/`: appearance settings and their style derivation when the change touches them.
- The feature's co-located CSS: regional layout and tokens. Reuse unchanged context already read.

Use `WorkspaceSelector` for workspace/project selection and the existing `SelectorDropdown` or `DropdownMenu` composition for rich generic selection. Keep overlays in the owning Shell Portal container and preserve the scope markers needed by their styles. Localize changed product and accessibility copy through the shared i18n API.

## Tokens and component specifications

- Keep the existing hierarchy: theme/base values → semantic meaning → component or regional tokens. Reuse an existing token before adding an alias; do not generate a parallel JSON/CSS token system or rename the project's conventions to match a template.
- Use semantic classes such as `bg-background`, `text-foreground`, `text-muted-foreground`, and `border-border`. Shared controls own their sizing, radius, and states through `--button-*`, `--control-*`, `--icon-*`, `--input-control-*`, `--dropdown-control-*`, and `--switch-*` tokens.
- Derive local dimensions from the current density, radius, and shared control tokens in the consuming scope. Do not apply arbitrary fixed dimensions or blanket descendant overrides where the corresponding token exists.
- Keep global theme rules global, Shell layout rules on the Shell, and feature/region rules with their owner. A reused regional value does not automatically belong in `:root`.
- For a new variant, define the actual semantic purpose and relevant default, hover, focus-visible, active, disabled, selected, error, or loading behavior. Reuse shared state styles and preserve visible keyboard focus when states overlap; do not add states or a separate specification document the feature does not need.
- Extend shared component variants only for behavior shared by their consumers. Keep a one-feature layout local. Check that changed tokens respond to supported themes, global colors, density, and radius settings.

## Read for an unresolved implementation question

| Concern | Reference |
|---|---|
| Primitive composition or component API | [Components](references/shadcn-components.md) |
| Theme and appearance ownership | [Theming](references/shadcn-theming.md) |
| Focus, keyboard behavior, or accessible forms | [Accessibility](references/shadcn-accessibility.md) |
| Layout or utility syntax | [Tailwind utilities](references/tailwind-utilities.md) |
| Breakpoints or responsive layout | [Responsive design](references/tailwind-responsive.md) |
| CSS theme mappings or utility customization | [Customization](references/tailwind-customization.md) |

Generic reference examples are topic guidance, not the project's component API. Use the installed declarations and existing Shell implementations, including their underlying primitives, as authority. Adapt example imports, text, colors, and sizing to this repository; do not install sample dependencies or recreate a UI/theme system. The project already uses CSS-based Tailwind theme mappings; no initialization or standalone config generator is needed for ordinary work.

## Verify the changed behavior

Review changed classes/styles for token ownership, appearance settings, and accessible interaction. Check desktop pointer/keyboard use and touch behavior where the changed surface supports it; mobile sizing examples must not override the Workbench density system. Run the owning package's relevant checks for code changes. Use browser verification only for a concrete rendering or interaction uncertainty, or when requested. Finish once the requested behavior and relevant checks pass.

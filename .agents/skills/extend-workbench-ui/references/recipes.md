# Workbench Extension Recipes

Use the matching current implementation as a starting point. Paths are relative to the repository
root. Read the relevant definition and public exports; do not copy the entire capability or infer
that every example's runtime dependencies are allowed in another owner.

## Find a matching example

| Task                                                      | Existing implementation                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Small Slot contribution                                   | `packages/client/ui-token-usage/src/token-usage-extension.ts`                 |
| One feature with desktop/mobile Slots and a Settings item | `packages/client/ui-settings-general/src/locale-selector-extension.ts`        |
| Shared Settings surface                                   | `packages/client/ui-settings/src/settings-extension.ts`                       |
| Theme Settings and background contribution                | `packages/client/ui-theme/src/appearance-extension.ts`                        |
| Complete Sidebar Section                                  | `packages/client/ui-conversation-list/src/extension.ts`                       |
| Active Message Renderer                                   | `packages/client/ui-conversation-nodes/src/message-presentation-extension.ts` |
| Workspace Surface, Command and tool rendering             | `packages/client/ui-terminal/src/extension.ts`                                |
| Pi tool presentation resolution                           | `packages/pi-ui/pi-ui-toolbox/src/skill-reading-extension.ts`                 |

For Workspace Surface / Opener examples, locate the public extension exported by
`@workbench/workspace-file-view`. For Pi settings, use the current owner named in
`packages/pi-runtime/integration.md`. Search current exports if an example moves; do not recreate a removed path.

## Minimal Slot registration

Inside an existing capability package, define a module-scoped extension and register its component:

```ts
import { defineExtension } from "@workbench/extension-sdk";

import { FeatureControl } from "./feature-control";

export const featureExtension = defineExtension({
  id: "workbench.example",
  name: "Example",
  version: "1.0.0",
  setup(context) {
    return context.slots.register("header.right", {
      id: "workbench.example.header",
      order: 50,
      component: FeatureControl,
    });
  },
});
```

This is a registration fragment; choose a real unique ID and verify the target mount. Localize
control and accessible copy in the owner's bundle. For registration fields accepting LocalizableText,
follow the typed descriptor pattern in the locale-selector example. Keep existing module metadata
conventions distinct from component display copy.

A Slot-only change does not need a new package, store, Provider, event stream or backend tool.

## Add to the static installation

1. Export the stable extension from its capability's public entry.
2. Add it to the appropriate existing semantic group. Runtime-neutral groups currently live in
   `packages/client/shell/src/extensions/builtin-extensions.ts`; Pi groups are exposed through
   `@workbench/pi-ui-extensions/installation`.
3. Inspect `packages/product/pi-workbench/src/extensions.ts` for group interleaving. Preserve existing
   activation order unless the feature requires a deliberate, reviewed change.
4. Confirm the group's consumer actually reaches the relevant installation and the host mounts the
   contribution. Merely exporting the object is insufficient.

Keep implementation in the capability owner. Brand and sidebar definitions, for example, are
imported from `ui-layout/extension` and `ui-conversation-list/extension` into Shell groups.
Do not recreate a Shell builtin directory to match historical examples. User uninstallability
requires an actual product installation flow; ordinary static registration does not establish one.

## Tool presentation change

Trace the exact tool name from its existing Pi contribution through the presentation registry to
`ui-tool` and the renderer fallback. Determine whether the change needs metadata, query summary,
detail rendering or backend execution before choosing an API.

- Put protocol parsing in the Pi owner and expose display results through SDK presentation fields.
- Keep generic timeline grouping and chrome independent of tool names.
- Extend the existing registration when one tool has multiple presentations; preserve skill-reading
  resolution and avoid duplicate `read` registration.
- Read the renderer section of [contracts.md](contracts.md#renderer-contract) for partial arguments,
  callback purity, error isolation and fallback requirements.
- For changed parsing/aggregation, run permitted pure-logic tests. Review rendering statically under
  the current no-UI-test constraint; verify types and affected consumers separately.

## Add a host contract only when needed

Locate the actual DOM owner before adding a Slot or host. Layout belongs to `ui-layout`, feature UI
to its capability, and installation/adaptation to Shell or the product composition as appropriate.

Update the SDK name/context, permitted public Host entry, real mount and calling contribution
together. Supply the declared context and preserve Portal and Provider scope. A new complete sidebar
destination should first consider `sidebarSections`; a persistent inspector should first consider
`workspace`. Neither requires inventing a feature-specific Slot.

Synchronize public guidance when the contract changes. Avoid copying API schemas into this skill;
link to source and explain only behavior that is easy to misuse.

# Workbench Extension Contracts

Read only the section needed for the contribution being changed. Paths below are relative to the
repository root. SDK declarations define available fields; Host and consumer code establish actual
behavior. A target refactor contract is not evidence that all consumers have been updated.

## Source map

| Concern                                  | Authoritative source                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring and public exports             | `packages/extension-platform/extension-sdk/src/authoring.ts`, `src/index.ts`                                                                |
| Extension context and lifecycle result   | `packages/extension-platform/extension-sdk/src/api/extension.ts`                                                                            |
| Contribution fields                      | Matching file in `packages/extension-platform/extension-sdk/src/api/`                                                                       |
| Activation and tracked registration      | `packages/extension-platform/extension-sdk/src/extension-manager.ts`, `packages/extension-platform/extension-host/src/extension-context.ts` |
| Component hooks and allowed Host entries | `packages/extension-platform/extension-host/src/index.ts`, package `exports` and applicable boundary rules                                  |
| Current installation order               | `packages/product/pi-workbench/src/extensions.ts` and its imported groups                                                                   |

API files: `slot.ts`, `sidebar-section.ts`, `panel.ts`, `command.ts`, `composer-command.ts`,
`settings.ts`, `main-view.ts`, `renderer.ts`, `opener.ts`, `workspace-surface.ts`.
Do not copy these complete interfaces into this reference.

## Extension lifecycle

Extensions are trusted, in-process, statically bundled contribution containers. `setup()` is
synchronous; registrations are tracked for rollback and deactivation. External resources must have
explicit disposal. Inspect the manager when changing cleanup or activation order, including failure
partway through setup. Define objects outside render and keep installation references stable.

A fixed product capability can be an extension. Package ownership, registry participation and
user uninstallability are independent decisions. Follow the actual product installation path rather
than assuming a catalog, persisted install state or optional metadata exists.

Register immutable definitions; dispose and register a replacement instead of mutating registered
snapshots. Stable identifiers are protocol values. Register localizable descriptors without resolving
and caching translated strings during setup.

## Slot contract

Check `api/slot.ts` for typed names and props, then find the actual `SlotHost` mount and context.
A declared legacy Slot can have no live host. Inspect responsive mounts before assuming one
contribution is available on both desktop and mobile.

- `shell.background` is a non-interactive background; do not cover content or intercept input.
- `shell.overlay` places controlled floating surfaces in the shared global layer; the feature owns
  open/close state and uses the owning Portal container.
- `thread.menu` receives a thread ID and `closeMenu`; preserve menu semantics and close behavior.
- `workspace.actions` and `workspace.empty.actions` are compact actions outside Surface lifecycle.
  Persistent inspector content uses Workspace Surface registration.
- `panel.right.*` does not provide a current right Panel host. Do not use it for new inspector UI.

If adding a Slot, update its typed name/context and owning host together. Give it semantic placement
rather than a feature-specific name. Feature implementation stays outside the generic host.

## Sidebar Section contract

`api/sidebar-section.ts` defines `context.sidebarSections`. Use it for a complete destination;
small heading or footer controls can use existing Slots. The host owns section selection, navigation
and optional search chrome. The feature owns filtering and content and receives `mobile`,
`searchQuery` and optional `onNavigate`.

The workspace thread list is implemented in `ui-conversation-list` and registered as a section.
Core installation membership does not require moving that implementation back to Shell. Inspect
`ui-sidebar` for shared chrome and the capability package for feature behavior.

## Panel contract

Registration defines a Panel without opening it. Use the public Panel service or a Command for
open/toggle; do not repeat title/close chrome inside its body. Although the type includes right,
the current layout mounts left/bottom Panel hosts and uses Workspace Surfaces for the inspector.
Inspect service location handling before changing fixed-location controls or persistence assumptions.

## Command contract

Global Commands serve palette/shortcut/action use. Composer Commands represent structured entities
compiled at submission; they are separate registries and lifecycles.

Check both Command shortcuts and standalone `keydown` listeners, including whether listeners reject
extra modifiers. Registration order affects conflicts; do not deliberately rely on a collision.
Command execution can reject: catch errors when calling it from an event handler.

For Composer parameter bindings, inspect `api/composer-command.ts` and the existing compiler before
changing scope, exclusivity, argument consumption or compatibility behavior. Read-only token display
must not acquire editor state or compilation responsibilities.

## Settings contract

Sections provide navigation; items own preference UI and persistence. The settings host owns
headings, search, scrolling and error isolation. An item can register before its section. Keep section
IDs stable, item IDs scoped to their section, and shared group title descriptors consistent.

Registration accepts localizable metadata; resolve it at render time. Use subscribed registry hooks
for host/tooling work, not as a replacement for synchronous feature registration.

## Main View contract

Use a Main View for transient central content. It does not provide URL identity, inspector resource
keys or persistent tab restoration. Inspect `api/main-view.ts` for navigation/breadcrumb props and
preserve the host's close behavior. Use a Workspace Surface for a persistent resource inspector.

## Renderer contract

Inspect `api/renderer.ts`, the Host's `hosts/renderer-host.tsx`, and the actual message/timeline
consumer. Preserve the matching order: predicate-matched block → exact tool/data name → caller
fallback. Predicates must be pure and streaming-safe; the first match wins. One complete Message
Renderer is active, while tool and data renderers have separate exact, case-sensitive name scopes.

A Renderer displays an existing block. Backend capabilities define/expose/execute tools or emit data.
Guard missing streaming arguments and unsuccessful statuses; preserve supplied fallback behavior.
Prefer `node`/`block` props to parallel conversation state.

Tool Presentation adds timeline behavior without replacing the detail renderer. Current SDK fields
include labels, `resolve`, `summarize`, `disclosureController`, `summaryComponent`, `getExpandable`,
`showCompletionIcon`, `group` and `getResourceStats`. Check the implementation of each consumer before
assuming a new field is operational. In particular:

- Protocol parsing and tool-specific classification belong to the contribution owner (Pi for Pi
  tools). Generic `ui-tool` consumes presentation contracts; do not add tool-name/argument guesses.
- Summary components own their query area; generic tool chrome owns status and disclosure.
- Resource statistics and resolver callbacks are pure. Preserve aggregation, status filtering and
  default behavior at the consumer; a thrown callback must not break the whole timeline.
- Summary component errors need the existing Host error boundary and fallback. Calling a React
  component directly inside `try/catch` does not establish an error boundary.
- Disclosure controllers may observe presentation state while details are collapsed; they must not
  execute or mutate a tool call.
- Compose alternative presentations under one registered tool owner. Inspect ordinary read and
  skill-reading resolution before adding another `read` registration.

For the current migration, consult `specs/006-ui-boundary-decoupling/contracts/public-boundaries.md`
and its validation evidence for target defaults, grouping and fallback invariants. Keep this
reference focused on durable contracts rather than task completion status.

## Opener and Workspace Surface contracts

Register resource routing with `context.openers` and a persistent inspector kind with
`context.workspace`. Callers use public opener hooks from `@workbench/workspace-runtime/react` and
handle rejection. Do not import another feature's component, store or private kind to open a resource.

`api/workspace-surface.ts` owns authoring fields; `@workbench/workspace-runtime` and its `/react`
entry own generic controllers, hooks and installation lifecycle. Inspect package exports and current
consumers for visual/product adapters rather than assuming an application-local right-workspace path.

A Surface owner keeps its kind, icon, resource key, scope, renderer, optional menu item, Runtime
bridge and domain service together. Generic inspector code handles tabs, layout, restoration and
feedback without feature-specific branches. Preserve opaque kinds, deduplication, scope, keep-alive,
unavailable-definition restoration and installation-scoped Provider identity when changing wiring.

## Uniqueness and ordering

| Registration                                                                                                                      | Uniqueness scope                                 |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Extension                                                                                                                         | Extension manager                                |
| Slot contribution                                                                                                                 | One Slot                                         |
| Settings item                                                                                                                     | One settings section                             |
| Complete Message Renderer                                                                                                         | One active renderer                              |
| Tool/data renderer or presentation                                                                                                | Exact name within its own registry               |
| Panel, Command, Composer Command, Sidebar Section, Settings section, Main View, Opener, Workspace Surface, matched block renderer | Stable ID/kind within the corresponding registry |

Slot, Sidebar Section and Settings contributions have numeric `order`; Panel, Command and Renderer
APIs do not have numeric priority. Preserve registration order for ties and predicate matching.
Inspect current product groups before moving a definition: activation order can affect cross-feature
behavior even if every ID stays the same.

## Error isolation and runtime boundary

Inspect the matching Host for render fallback and setup rollback. Public Host hooks are available to
mounted components; Host assembly uses allowed leaf hosts. Do not import internal registries or the
aggregate implementation into a feature. React boundaries do not catch event or arbitrary async errors.

Generic owners consume Workbench contracts and optional capabilities without Pi imports or Runtime
ID branches. Pi-specific contributions use the facades named in `packages/pi-runtime/integration.md`; do not add
raw endpoints, a second event stream or copied RPC types. Keep authoritative Session/editor state
in its existing owner and privileged execution outside browser extensions.

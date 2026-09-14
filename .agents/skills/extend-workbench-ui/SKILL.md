---
name: extend-workbench-ui
description: Add, modify, or review Workbench extension contributions, SDK/Host contracts, static installation groups, and contribution lifecycle. Skip ordinary component, styling, and capability-internal refactors that do not change these boundaries.
---

# Extend Workbench UI

Connect feature-owned UI through Workbench's typed, statically bundled extension platform.

## Choose the owner and contribution separately

A capability package owns implementation; an extension registers that capability with a host.
Fixed core features can use extensions. User uninstallability is a separate product decision and
must not be inferred from a package boundary or `defineExtension()`.

Follow the root and nearest `AGENTS.md`, then inspect the current owner, its public exports, and
actual installation consumers. During a refactor, distinguish implemented code from target contracts
and task completion evidence. Use the active plan for intended boundaries; verify API availability
in source before using it. Do not restore an old directory or compatibility layer from a recipe.

- Feature implementation stays in its capability package, including its extension definition.
- Shell assembles runtime-neutral capabilities and installation-scoped providers; `ui-layout` owns
  layout presentation. A new host belongs to the package that owns the rendered surface.
- SDK owns host-free contracts and the extension manager; Host integrates providers, services and
  shared React hosts.
- Product composition combines Shell and Pi groups. Generic client capabilities must not acquire
  Pi imports or protocol-specific branches to support a new contribution.

Use existing public contribution contracts:

| Need                                                                            | Contribution            |
| ------------------------------------------------------------------------------- | ----------------------- |
| Small control or indicator at a mounted location                                | Slot                    |
| Complete sidebar destination with shared navigation/search chrome               | Sidebar Section         |
| Host-managed left/bottom surface                                                | Panel                   |
| Action shared by palette, shortcut or controls                                  | Command                 |
| Structured token affecting Composer request compilation                         | Composer Command        |
| Message body, matched block, exact tool/data body, or timeline metadata         | Renderer / Presentation |
| Preference navigation or feature-owned preference UI                            | Settings section / item |
| Transient central page without URL identity or persistent inspector tabs        | Main View               |
| Resource-scoped inspector with tabs, restoration or keep-alive                  | Workspace Surface       |
| Cross-feature resource opening without importing the destination implementation | Opener                  |

Combine contributions that share a feature lifecycle. An ordinary reusable component or internal
helper needs no registration. If no existing Slot fits, first establish a semantic typed host
contract and its real mount; an SDK Slot declaration alone does not make UI visible.

## Inspect only the relevant contract

Read the matching section of [contracts.md](references/contracts.md) for lifecycle, matching,
ordering, or host behavior. It links to authoritative source rather than duplicating full types.
Use [recipes.md](references/recipes.md) when a concrete implementation or installation example helps.
Do not load both references in full for a small contribution change.

For a contract change, inspect the SDK API, its Host implementation, public export chain, and directly
affected consumers together. Business contributions use `@workbench/extension-sdk` and public hooks
from `@workbench/extension-host`; host assembly uses the explicitly permitted leaf entries. Do not
import registry internals or an aggregate Host implementation from a feature.

Runtime-neutral UI uses Workbench contracts and projections only where its owner permits them.
For example, conversation nodes adapt Session state for message blocks; a block must not bypass
explicit props by reading Session or Composer registries. Keep one authoritative conversation/editor
state. Unsupported optional capabilities should hide their entry or show an unavailable restored UI.

For Pi-specific contributions, read [packages/pi-runtime/integration.md](../../../packages/pi-runtime/integration.md) and use
its named client facade. Use `$pi-coding-agent-sdk` only when work reaches coding-agent sessions,
extensions or resource loading; use `$pi-ai-sdk` for direct Pi model/provider/stream APIs. A frontend
Renderer neither defines nor executes a model tool. Use `$ui-styling` for unresolved visual work.

## Register and install

1. Inspect the feature's existing extension and public exports. Search for the proposed stable ID,
   renderer name and shortcut; include standalone global `keydown` listeners in shortcut checks.
2. Define the extension once at module scope. Keep `setup()` synchronous and free of React hooks or
   render-time side effects. Register component types, not React nodes. Return external listeners,
   timers and subscriptions as Disposables; registry resources are tracked automatically, and may
   also be returned explicitly to make ownership clear.
3. Use the owner's typed `defineMessage(...)` descriptors for localizable registration fields.
   Resolve component copy with shared i18n and the owner's bundle. Do not freeze translated strings
   during setup; follow the nearest i18n instructions for dictionary placement.
4. Export from the capability's public entry and add to the existing semantic group. Inspect
   `packages/client/shell/src/extensions/builtin-extensions.ts`,
   `@workbench/pi-ui-extensions/installation`, and
   `packages/product/pi-workbench/src/extensions.ts` as applicable. Keep implementation in its owner;
   membership in a Shell group does not make Shell the implementation owner.
5. Preserve stable extension objects, group arrays, registration IDs and order. Check teardown and
   remount implications when installation changes. Static registration does not imply an existing
   user-installation catalog; verify such a product flow before extending it. Do not add runtime
   discovery or arbitrary JavaScript loading as part of ordinary contribution work.

## Validate and report proportionally

Check changed registration sites, uniqueness scopes, actual mounts, public imports, consumers,
fallbacks and disposal paths. Handle rejected Promises in event handlers; React boundaries cannot
catch arbitrary async errors. For tool rendering, account for partial arguments and all statuses.

Use pnpm for targeted formatting/lint and owner typechecks; include affected consumers for public
contract changes. Use relevant pure-logic tests and affected builds when needed. Follow current
repository/plan exclusions: do not add or execute UI, DOM, Hook-rendering or Browser/Electron smoke
tests during this refactor. Documentation-only edits need static and skill validation, not builds.

Report the contribution/contract change, implementation owner, installation point, relevant entry
points, checks performed and material unverified behavior. For a review, report findings instead of
an implementation handoff.

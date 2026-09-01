# Phase 2 Workbench Shell S2/S3 Evidence

Recorded: 2026-08-30

Baseline source revision: `77322072c64aa6a15d8ee8bf34927a91669db488`
(`refactor: split agent runtime into workspace packages`)

Branch: `codex/agent-runtime-workspace-refactor`

This is an additive record after
[Phase 2 Workbench Shell S1 Evidence](./phase-2-shell-s1-evidence.md). The S1 document remains the
historical evidence for the earlier pure state/layout extraction. This document records the later
controller/React-host boundary and draft-thread scope promotion; it does not retroactively change
S1's delivered boundary, artifact measurements, or residuals.

## Delivered S2 boundary

`@workbench/shell` now owns the platform-neutral RightWorkspace controller lifecycle, generic React
Provider/context, runtime-host mounting boundary, and runtime-neutral feedback claim/CAS store in
addition to the S1 layout/model primitives.

The package receives persistence, catalog/text validation, initial context, registry, and opener
construction as injected ports. It does not own a product storage key, settings field, legacy key,
application id, Pi Runtime composition, Next navigation, Electron, or Tauri. The Provider captures
one immutable installation; same-key prop changes are a development invariant, while a key change
creates a new owner. Stale controller and feedback mutations fail with stable disposal behavior.

Workspace Surface definitions, scopes, instances, registries, and authoring constants remain owned
by `@workbench/extension-sdk`. Shell exports controller/state/layout/React host contracts, not a
second SDK authoring barrel.

## Delivered S3 promotion invariant

Draft-to-remote thread promotion is a single controller transaction:

- `promoteThreadScope(fromThreadKey, nextContext)` derives the destination only from
  `nextContext.threadId`;
- all contribution-owned resource keys are calculated before one state and persistence commit;
- draft instance metadata, dirty state, parameters, placement, and order are retained;
- a destination duplicate is removed only when the known definition disallows duplicates;
- an unavailable definition still moves scope but retains its opaque resource key without guessing;
- history and active pointers are rewritten together; and
- product bindings make one controller call instead of retaining a root-local promotion helper.

This prevents a draft-key resource from surviving remote reveal and prevents duplicate File or other
surface tabs from being created by a separately updated scope/key state.

## Boundary and focused verification

| Gate                               | Result | Evidence                                                                                                                                                         |
| ---------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell package implementation suite | Pass   | `85/85` focused Shell tests passed.                                                                                                                              |
| RightWorkspace controller suite    | Pass   | `32/32` focused controller tests passed.                                                                                                                         |
| Root bindings/context suite        | Pass   | `4/4` focused product-binding/context tests passed.                                                                                                              |
| Promotion regression cases         | Pass   | Actual File-definition promotion, destination collision handling, unavailable-definition opaque keys, remote reveal, and lifecycle/history behavior are covered. |
| Shell boundary guards              | Pass   | The Shell leaf remains free of Pi, Next server, Electron, Tauri, Node production APIs, root aliases, raw WebSocket construction, and product endpoints.          |
| Repository validation              | Pass   | `pnpm check` completed with lint/format, workspace and transport guards, root plus 25 package typechecks, and the root/package test graph.                       |
| Fresh release artifact proof       | Pass   | See [Phase 2 Aggregate Release Evidence](./phase-2-aggregate-release-evidence.md).                                                                               |

## Current Shell residuals

1. `workbench/shell/main-view-host.tsx` remains root-owned because it owns the Next navigation key.
2. Product settings/localStorage, catalog policy, application context, Runtime feedback adapter,
   error-reporting binding, and presentation remain root composition concerns.
3. Panels, Command Palette, header/sidebar/actions, and the complete Shell assembly remain later
   work; they were not pulled into this capability merely for directory symmetry.
4. The resulting fresh release proof covers the current Linux Electron artifact, not a future
   static renderer, app relocation, or Tauri container.

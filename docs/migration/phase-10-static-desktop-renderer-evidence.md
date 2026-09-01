# Phase 10 static Desktop renderer evidence

## Scope and claim boundary

This document records the Phase 10 static-export inventory, shared renderer composition, and the
native Linux execution row completed on 2026-08-31. The in-product Runtime restart flow is complete
for Electron and Tauri on native Linux. The user limited this delivery's verification scope to the
local environment, so Phase 10 is complete for native Linux; Windows/macOS package rows remain
explicitly unverified and are not claimed by this evidence.
The target and gates are defined in
[`workbench-apps-packages-tauri-migration-plan.md`](../workbench-apps-packages-tauri-migration-plan.md#phase-10静态-desktop-renderer-与生产-tauri);
the earlier package split remains governed by
[`multi-package-agent-runtime-refactor-plan.md`](../multi-package-agent-runtime-refactor-plan.md).

## Static-export inventory and disposition

| Serverful Web concern                            | Current Web evidence                                                                                                                                                                                                                                  | Static Desktop disposition                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dynamic `[threadId]` route                       | [`apps/web/src/app/(workbench)/c/[threadId]/page.tsx`](<../../apps/web/src/app/(workbench)/c/%5BthreadId%5D/page.tsx>) mounts `WorkbenchThread` under a dynamic segment.                                                                              | Removed from the Desktop route graph. [`desktop-routes.ts`](../../apps/desktop-renderer/src/navigation/desktop-routes.ts) stores conversation identity in the `conversation` query parameter; [`desktop-navigation-provider.tsx`](../../apps/desktop-renderer/src/navigation/desktop-navigation-provider.tsx) owns `pushState`, `replaceState`, and `popstate`.        |
| Next API route handlers                          | `find apps/web/src/app -type f -name 'route.ts'` returns no files; Runtime APIs had already left the Next app.                                                                                                                                        | No route handler is recreated. Runtime HTTP and WebSocket traffic is built from the bootstrapped `RuntimeConnection` through `createRuntimeFetch` and `createRuntimeWebSocketFactory` in [`desktop-workbench.tsx`](../../apps/desktop-renderer/src/desktop/desktop-workbench.tsx).                                                                                     |
| Request cookies/headers and server i18n          | [`apps/web/src/i18n/server.ts`](../../apps/web/src/i18n/server.ts) reads the locale cookie and `Accept-Language`; [`apps/web/src/app/layout.tsx`](../../apps/web/src/app/layout.tsx) also reads request headers to derive the Web Runtime connection. | Removed from Desktop. [`desktop-renderer-application.tsx`](../../apps/desktop-renderer/src/desktop/desktop-renderer-application.tsx) selects a supported locale from `navigator.languages`, updates the document language, and supplies the locale to the client product tree. Both `en-US` and `zh-CN` bundles are owned under `apps/desktop-renderer/src/app/i18n/`. |
| `next/dynamic`                                   | A production-source search currently finds no `next/dynamic` import in `apps/web/src`.                                                                                                                                                                | Forbidden by [`static-export-boundary.test.ts`](../../apps/desktop-renderer/test/static-export-boundary.test.ts); the renderer uses normal client components.                                                                                                                                                                                                          |
| Server Actions                                   | A production-source search currently finds no `"use server"` directive in `apps/web/src`.                                                                                                                                                             | Forbidden by the same boundary test; bootstrap and navigation are client ports rather than actions.                                                                                                                                                                                                                                                                    |
| Rewrites, redirects, or Next proxy configuration | [`apps/web/next.config.ts`](../../apps/web/next.config.ts) has no `rewrites`, `redirects`, or `proxy` config, although the serverful Web host still owns its explicit Runtime sidecar proxy.                                                          | [`apps/desktop-renderer/next.config.ts`](../../apps/desktop-renderer/next.config.ts) has none of these keys, and the boundary test enforces their absence. Runtime access crosses the narrow Host connection, not a Next server.                                                                                                                                       |
| Image optimization                               | Web already sets `images.unoptimized: true`.                                                                                                                                                                                                          | Desktop also sets `images.unoptimized: true`; its icons and Pi logos are owned static files in [`apps/desktop-renderer/public`](../../apps/desktop-renderer/public). Production source is forbidden from importing `next/image`.                                                                                                                                       |

The Desktop app has exactly `src/app/layout.tsx` and `src/app/page.tsx` as route files. Its Next
configuration sets `output: "export"`. The boundary test additionally rejects imports from
`apps/web`, package-internal `src` paths, `next/headers`, and Server Actions. This inventory supports
the selected Next static-export renderer; no separate Vite renderer or duplicate product core is
needed for the currently identified server-only features.

## Product composition and provider boundary

[`desktop-workbench.tsx`](../../apps/desktop-renderer/src/desktop/desktop-workbench.tsx) is the
Desktop composition root. Its provider order is:

1. `WorkbenchApplicationProviders` owns shared i18n, settings, installation identity, and the
   bootstrapped Runtime connection.
2. `DesktopNavigationProvider` supplies static, query-backed navigation.
3. `WorkbenchApplicationShell` supplies the product Shell, main-view host, extension prefix,
   running-indicator catalog, branding/assets, and the container-neutral title-bar installation
   effect.
4. `DesktopAssistantRuntimeProvider` is selected through the Shell's public `runtimeProvider` seam;
   it creates the Pi client installation.
5. `InstalledRuntimeContributions` mounts `PiAgentRuntimeContributionsProvider` through the Shell's
   public runtime-contributions seam.
6. `WorkbenchThread` is the Shell content under that installed product tree.

The composition imports public entrypoints from `@workbench/shell`, `@workbench/host-client`,
`@workbench/host-contracts`, `@workbench/desktop-contracts`, `@workbench/extension-host`, and the Pi
client/contributions packages. It does not import `apps/web` source. Pi selection stays in this
application root and Pi-owned packages; the reusable Shell does not select Pi. Runtime bootstrap and
lifecycle restart in
[`runtime-bootstrap.ts`](../../apps/desktop-renderer/src/desktop/runtime-bootstrap.ts) consume only
the exact `window.workbenchDesktop.runtime` and `window.workbenchDesktop.lifecycle` public ports.
The app-owned `desktop.runtime.restart` extension contributes the localized command while Electron
and Tauri keep their container implementations outside the product tree.

## Artifact determinism and strict CSP

`next build` produces `apps/desktop-renderer/out`. The package `postbuild` then runs
[`build-desktop-renderer-artifact.ts`](../../apps/desktop-renderer/scripts/build-desktop-renderer-artifact.ts),
which copies the export to a temporary directory, validates its static-only tree, externalizes inline
scripts, removes source maps forbidden by the Desktop release budget, measures and hashes the
resulting files, writes `artifact-manifest.json`, and atomically publishes the canonical
`.desktop-build/desktop-renderer` artifact. Externalization and source-map removal therefore occur
before manifest resources, file hashes, and the content-derived build ID are fixed.

[`externalize-inline-scripts.ts`](../../apps/desktop-renderer/scripts/externalize-inline-scripts.ts)
walks HTML files in code-point order and converts executable classic inline scripts to deterministic
same-origin `/_next/static/desktop-inline/<sha256-prefix>.js` resources. It preserves source text,
element order, and existing attributes. It rejects symlinks, malformed or ambiguous script markup,
duplicate/encoded attributes, a pre-existing reserved output directory, and inline attributes whose
external form cannot preserve semantics (`async`, `defer`, `integrity`, and `blocking`). Data scripts
remain inline. Inline `module`, `importmap`, and `speculationrules` fail closed: in particular, moving
a module would change relative import and `import.meta.url` resolution. The focused test
[`externalize-inline-scripts.test.ts`](../../apps/desktop-renderer/test/externalize-inline-scripts.test.ts)
proves classic script order/content and absence of executable inline script, plus module rejection.

The Linux product row executes the strict style CSP:

- [`apps/desktop-renderer/src/app/globals.css`](../../apps/desktop-renderer/src/app/globals.css)
  imports the public `@workbench/shell/styles.css` and scans Shell and Pi contribution sources for
  Tailwind generation.
- [`packages/workbench/shell/src/styles.css`](../../packages/workbench/shell/src/styles.css) now
  bundles the code-editor, reviewable-diff, and appearance-background styles. The corresponding
  Shell test rejects their former runtime `<style>`/`cssText` forms.
- The Desktop title-bar probe uses individual DOM style properties rather than `cssText` in
  [`desktop-title-bar-overlay-sync.tsx`](../../apps/desktop-renderer/src/desktop/desktop-title-bar-overlay-sync.tsx).
- The admitted `index.html` has no inline style. Next-generated fallback pages retain framework
  fallback styling but are not the product entrypoint or navigation model.
- Electron serves the product under `script-src 'self'; style-src 'self'` from `workbench://app`;
  its native package smoke reached the hydrated Shell and Composer. Tauri uses the same strict
  directives; its Debian package smoke used `desktop.runtime.restart` through the command palette,
  reloaded the same window, and then created a real PTY through `terminal.toggle`. Neither container
  enables `unsafe-inline` or `unsafe-eval`.

## Executed evidence and pending matrix

Unless a row says otherwise, the product evidence below ran from the repository root on native
Linux x64/glibc. The final release replay ran from an isolated source-only Git snapshot created from
`git ls-files --cached --others --exclude-standard`, with deleted tracked paths and all
ignored/generated outputs omitted, then initialized as a fresh clean commit.

| Surface                               | Executed evidence                                                                                                                                                                                                                           | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolated clean-source release check   | `pnpm install --frozen-lockfile --offline`; full `pnpm check`                                                                                                                                                                               | The frozen offline install succeeded across all 35 workspace projects with zero downloads. Lint/format, permanent dependency/transport/ownership/source-closure boundaries, every app/package typecheck, and all root/app/package tests passed from the clean source-only snapshot. Both Next app typechecks now run `next typegen` before `tsc`, so ignored framework types are regenerated instead of inherited from the migration worktree.                                                                        |
| Boundaries and launchers              | `pnpm check:workspace-dependencies`; five focused root/launcher test files                                                                                                                                                                  | Passed; 13 focused tests, zero obsolete production topology matches.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Migration-worktree aggregate build    | `pnpm build`                                                                                                                                                                                                                                | Passed: Node Runtime, independent Web, static Desktop renderer, Electron-ABI Runtime, and exact composition.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Isolated clean-source aggregate build | `pnpm build`                                                                                                                                                                                                                                | Passed from fresh outputs after native-mode normalization: Node Runtime, independent Web, static Desktop renderer, Electron-ABI Runtime, and exact composition. The renderer contained 2,196 static files with build ID `sha256-8914057987a9f01cb13371ec873454b3c0d561f10392c30eb5afac228a158297`; its manifest SHA-256 was `433b509836ef961ff6d3bf8e469cb6f5ec52967e03a94b5c7b89047c61059c3e`. The snapshot remained source-clean after the check and release builds.                                                |
| Web regression                        | `pnpm --filter @workbench/web smoke:standalone`                                                                                                                                                                                             | HTTP 200 with 80,981 bytes of SSR HTML.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Shared renderer artifact              | Final clean-source aggregate build and both final container staging steps                                                                                                                                                                   | Build ID `sha256-8914057987a9f01cb13371ec873454b3c0d561f10392c30eb5afac228a158297`; 2,196 files; no source maps. Canonical, Electron-staged, and Tauri-staged manifest SHA-256 are all `433b509836ef961ff6d3bf8e469cb6f5ec52967e03a94b5c7b89047c61059c3e`.                                                                                                                                                                                                                                                            |
| Electron contracts                    | Lifecycle-focused main/process/package tests and the canonical package command                                                                                                                                                              | 33/33 focused tests passed; renderer/contract typechecks and focused lint/format passed.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Electron native directory package     | `pnpm --filter @workbench/desktop-electron run pack`                                                                                                                                                                                        | The same BrowserWindow replaced Runtime N with N+1 only after the old process group and origin were gone, reloaded the renderer, then repeated bootstrap/CSP-CORS/RPC/WS/PTY probes before exit 0 and zero residue. The post-normalization clean-source replay reran this packaged execution gate with 4,805 files, 86.5 MiB renderer, and 29.0 MiB Runtime; all three packaged native addons were `0644`. Executable: 221,097,208 bytes; SHA-256 `933487402a8ccb7de988e016827107b4c351bafe56a635120336896b74b414b3`. |
| Tauri Rust/security contracts         | `cargo fmt --check`, `cargo check`, `cargo clippy --all-targets -- -D warnings`, full `cargo test`, the focused sidecar-envelope test, Runtime artifact-builder test, Desktop Tauri typecheck, and the clean-source `stage:sidecar` command | Passed: 34/34 Rust, 14/14 focused Tauri TypeScript, and 47/47 Runtime artifact-builder tests. The clean-source staging entrypoint rebuilt and staged 10,152 Runtime files; its envelope SHA-256 was `20367735f0faf4688df10dbbfc46bc8ff9dc84c5f6876a6893d7a891c8de793f`. The main window is created only after Host ready; the local main capability exposes only `runtime_bootstrap` and `runtime_restart`. No remote URL, broad capability, application restart, or relaxed CSP was added.                           |
| Tauri Debian package                  | Clean-source `pnpm --filter @workbench/desktop-tauri run tauri:build:deb`                                                                                                                                                                   | `Pi Workbench_0.1.0_amd64.deb`, 100,835,980 bytes, SHA-256 `9f364676f14afc3081bf3d34810cd74455e7144bb702d37f1a373a19cdc46964`. Its link-free Runtime contained 10,152 files, 2,494 directories, and 87,498,918 logical bytes; Runtime tree SHA-256 was `ae26cb463806c4017219696c1ba6cf8b800aa43b93892c9a1f20e294c3c90ba8`.                                                                                                                                                                                            |
| Tauri product normal exit             | Exact clean-source final-`--deb` product smoke                                                                                                                                                                                              | Localized `desktop.runtime.restart` drained generation N before publishing N+1, retained the same Tauri/window identity, reloaded and reconnected the renderer, then localized `terminal.toggle` created a real PTY on N+1. Exactly two Runtime generations, exit 0, and zero residual processes.                                                                                                                                                                                                                     |
| Tauri product hard death              | Exact clean-source final-`--deb` hard-death product smoke                                                                                                                                                                                   | Exactly one Runtime generation; SIGKILL of the exact Tauri PID; watchdog emptied the exact PGID and Host port; unrelated decoy survived. The PTY remains outside the supported exact-PGID scope; escaped descendants remain explicitly unsupported.                                                                                                                                                                                                                                                                   |

The focused sidecar envelope matrix also covers Darwin, Windows, glibc, and musl target suffixes.
Its producer now executes pnpm's `npm_execpath` JavaScript entry through the current Node process,
accepts a directly executable package-manager binary, and rejects Windows `.cmd`/`.bat` shims rather
than enabling a shell. This closes the statically identifiable Windows staging failure but is not a
substitute for the pending native Windows package execution row.

The clean-source Debian replay first rejected a `node-pty` addon whose offline-install mode `0700`
was widened to `0755` by Debian materialization. The shared Runtime artifact producer now
normalizes policy-owned non-Windows native files before measuring the immutable inventory:
non-executable addons are `0644`, while the one policy-declared helper is `0755`. The Runtime
resolver and packaged smoke remain strict; no permission exception was added. The focused builder
test, fresh aggregate build, Electron packaged execution gate, and both Tauri product gates all
passed with the normalized payload.

The Electron renderer request uses an `Authorization` header, so Chromium must complete a CORS
preflight before returning the identity document. Page JavaScript cannot read the ACAO response
header unless the Host additionally exposes it; the smoke therefore proves the boundary through a
successful preflighted request, exact `location.origin === "workbench://app"`, the Host's exact
allowlist, and a malicious-Origin 403 rather than weakening production headers for observability.

The first Tauri restart attempt exposed a narrower readiness race: the Host connection was already
established while WebKit still displayed the bootstrap screen, so the English command was sent
before the command registry was painted; the later Chinese fallback correctly found no command in
the English locale. The harness now gives that first authenticated connection a bounded two-second
renderer settle before its first UI action. The final package also derives the Runtime allowlist
origin from the trusted main window URL, so the static renderer's `?conversation=` navigation does
not make restart fail closed after a conversation is opened.

The isolated clean-source replay therefore closes the frozen-install, full-check, fresh aggregate
build, Linux Electron package, and Linux Tauri package/security/native-smoke rows without relying on
ignored outputs from the migration worktree.

Phase 10 is complete for the explicitly requested local native-Linux scope. Windows/macOS
Electron/Tauri package, containment, and dependency rows were not tested and are not claimed.
Signing, notarization, and updater configuration are also not claimed.

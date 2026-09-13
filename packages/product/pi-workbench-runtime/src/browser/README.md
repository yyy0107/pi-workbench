# Workbench product Browser integration

Browser commands, script execution, session selection, and the Pi host adapter belong to the Node product.
The reusable browser engine and host contract remain in `@workbench/browser-server` and `@workbench/browser-contracts/host`.

Within the product, `src/browser/index.ts` owns the core tool and cancellation state; `tools.ts` owns named browser tools;
`script.ts` and `script-worker.ts` own script execution; `standalone-host.ts` reuses the existing Workbench host or the existing session-browser fallback.
`resources/extensions/browser/index.ts` owns tool registration and lifecycle binding.
`resources/skills/browser-use` is the only Skill source; read that Skill before browser use.

Public imports are `@workbench/pi-workbench-runtime/extensions/browser`, `/tools/browser`, and `/browser-resources`.

The product's `scripts/build-browser-package.mjs` generates the compatibility deployment at `internal-packages/browser`.
It contains `index.js`, `resources.js`, `skills/browser-use`, metadata, and browser-server third-party notices.
The installed identity `@workbench/pi-runtime-browser` and `packages/.builtin/browser` location remain stable for saved filters.
There is no separate Browser workspace package. Browser is loaded once through the generated Pi package; do not also register it inline.

The generated package preserves existing standalone Pi compatibility and requires the public Pi SDK peers.
In Workbench it reuses the shared BrowserManager, tabs, permissions and conversation isolation.

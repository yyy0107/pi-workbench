# @workbench/pi-ui-status

Owns Pi About and connection/version status, plus all four persisted Pi activity indicators. Internal wordmark geometry is shared by the light and dark renderers.

src owns real capability implementation/contracts and colocated bilingual dictionaries/styles. lib owns consumed internal helpers. Both keep TS/TSX with at most one subdirectory. Preserve client instances, extension IDs/order and disposal. Use public exports; tests live in tests/.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/pi-running-indicator.tsx` imports `lib/wordmark-pixels.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

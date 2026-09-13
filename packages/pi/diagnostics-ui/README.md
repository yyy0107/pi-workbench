# @workbench/pi-diagnostics-ui

Owns context trace and usage-statistics surfaces. Internal helpers project traces, select/cache details, index search, lay out spans/timelines and aggregate usage.

src owns real capability implementation/contracts and colocated bilingual dictionaries/styles. lib owns consumed internal helpers. Both keep TS/TSX with at most one subdirectory. Preserve client instances, extension IDs/order and disposal. Use public exports; tests live in tests/.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/use-context-trace.ts` imports `lib/context-trace-activation.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

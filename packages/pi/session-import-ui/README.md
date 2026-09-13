# @workbench/pi-session-import-ui

Owns external-session scanning and import selection UI. Internal helpers identify selected sessions and bound import batches; protocol IDs and the existing opt-in installation remain unchanged.

src owns real capability implementation/contracts and colocated bilingual dictionaries/styles. lib owns consumed internal helpers. Both keep TS/TSX with at most one subdirectory. Preserve client instances, extension IDs/order and disposal. Use public exports; tests live in tests/.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/external-session-import-settings-item.tsx` imports `lib/import-selection.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

# @workbench/automation-ui

Owns automation implementation and its bilingual translation bundle. Consumers use the package exports. The product installs the bundle and extension in its existing order. IDs, commands, storage formats and installation lifetimes are preserved. Tests live in tests/.

src contains the automation form, home, navigation contract and extension assembly, with colocated dictionaries. lib contains consumed schedule, validation/focus, trust-copy and registration-lifecycle helpers. Keep TS/TSX and shallow roots.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/automation-task-form.tsx` imports `lib/automation-invalid-focus.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

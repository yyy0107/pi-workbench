# @workbench/ui-terminal

Owns terminal implementation and its bilingual translation bundle. Consumers use the package exports. The product installs the bundle and extension in its existing order. IDs, commands, storage formats and installation lifetimes are preserved. Tests live in tests/.

src owns terminal surfaces, services, contracts and extension assembly with colocated dictionaries/styles. lib contains typed transcript/status/resize helpers consumed by these surfaces. All implementation remains TS/TSX.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/terminal-surface.tsx` imports `lib/terminal-resize-observer.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

The existing bash presentation owns its command summary and terminal grouping metadata while retaining its renderer and disclosure controller.

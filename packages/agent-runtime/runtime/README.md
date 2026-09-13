# `@workbench/agent-runtime-core`

React-free browser Agent Runtime contracts and notification primitives. Concrete adapters own
transport and protocol state; React bindings and Workbench UI consume only this package's stable
observable faces.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/index.ts` imports `lib/notifier.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

# @workbench/ui-agent-controls

Owns generic model selection and context/token usage UI. src contains components, state ownership, extension assembly and dictionaries; lib contains typed model mapping, reasoning labels, animation and throughput helpers used by those components. Keep TS/TSX and shallow roots.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/model-selector.tsx` imports `lib/model-selector-state.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

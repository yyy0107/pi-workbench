# @workbench/ui-agent-controls

Owns generic model selection and context/token usage UI. src contains components, state ownership, extension assembly and dictionaries; lib contains typed model mapping, reasoning labels, animation and throughput helpers used by those components. Keep TS/TSX and shallow roots.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/model-selector.tsx` imports `lib/model-selector-state.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

`./selector` exposes the reusable ModelSelector view, while the existing `./model-selector` entry owns its business connection. `./models` retains state helpers and exposes model option/effort types and filtering/grouping helpers. The view consumes `@workbench/ui-selectors` and `lib/model-selector-models.ts`.

本包同时拥有模型选择视图与业务连接器：`./selector` 为通用视图，`./model-selector` 保持既有业务入口，`./models` 提供状态与模型辅助。模型分组/过滤实现和既有测试随能力共置，视图复用 ui-selectors。

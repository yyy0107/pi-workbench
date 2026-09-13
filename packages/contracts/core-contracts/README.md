# `@workbench/core-contracts`

Workbench 拥有的、跨浏览器与服务端边界使用的基础 JSON-safe contracts。

## Public entries

- `@workbench/core-contracts`
- `@workbench/core-contracts/composer`
- `@workbench/core-contracts/composer/request`
- `@workbench/core-contracts/locale`
- `@workbench/core-contracts/model-selection`

本包不得依赖 React、Next.js、具体 UI 框架、Node 运行时 API、Pi 或其他 Agent Runtime。
具体 Runtime 的 wire DTO、UI 文案和应用状态不属于本包。

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/composer/request.ts` imports `lib/validation.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

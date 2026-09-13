# @workbench/ui-testkit

React 生命周期测试共用的最小 DOM 环境，只用作开发依赖。通过包公开入口使用 `installMinimalReactDomEnvironment` 和 `flushReactMicrotasks`。它不实现浏览器布局，布局断言应使用真实渲染验证。每次安装后必须在 finally 或测试清理钩子中调用 restore。

源码位于 src/，测试位于 tests/；运行 pnpm --filter @workbench/ui-testkit test。

Source roles: src/ owns capability implementation, contracts, components and composition with colocated dictionaries/styles; lib/ contains the internal helpers below; tests/ owns tests. Both source roots allow at most one subdirectory. Capability and helper source remains TypeScript (TS/TSX), checked by the package and its consumers.

Internal helpers: `lib/minimal-dom.ts`.

Example consumer: `src/react-dom-environment.ts` → `lib/minimal-dom.ts`.

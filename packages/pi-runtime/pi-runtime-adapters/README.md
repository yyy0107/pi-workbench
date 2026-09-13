# `@workbench/pi-runtime-adapters`

Pi Runtime 的 client/server 共用纯逻辑：Runtime 身份、命令投影、消息 reducer、模型能力与会话展示/
分页规则。

## Public entries

- `@workbench/pi-runtime-adapters/descriptor`
- `@workbench/pi-runtime-adapters/commands`
- `@workbench/pi-runtime-adapters/messages`
- `@workbench/pi-runtime-adapters/models`
- `@workbench/pi-runtime-adapters/sessions`

本包没有根入口，不拥有网络、文件系统、凭据、Pi coding-agent runtime 对象、React 或浏览器 UI
状态。它只把 Pi protocol 投影为可在 Runtime 两端复用的确定性逻辑。

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/commands.ts` imports `lib/prompt-template.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

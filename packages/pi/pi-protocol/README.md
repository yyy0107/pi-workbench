# `@workbench/pi-protocol`

Pi Runtime 在浏览器、Workbench Host 与 Pi server implementation 之间共享的 JSON-safe wire contracts。

## Public entries

- `@workbench/pi-protocol/attachments`
- `@workbench/pi-protocol/messages`
- `@workbench/pi-protocol/rpc`
- `@workbench/pi-protocol/stream`

本包没有根入口。调用方必须选择所需协议面，避免通过聚合 barrel 隐藏依赖。Pi runtime 对象、凭据、
文件系统句柄、React 与浏览器 UI 状态不得进入本包。

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/stream.ts` imports `lib/stream-validation.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

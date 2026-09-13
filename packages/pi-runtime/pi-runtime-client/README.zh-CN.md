# @workbench/pi-runtime-client

[English](README.md)

Pi 客户端安装、线程管理及面向产品的资源和配置 API。

每个客户端会话只接收有限的 `PiClientSessionDependencies` 合同。manager 通过回调绑定当前安装的传输、
目录、模型、反馈和分支操作，不把整个 manager 交给会话。消息投影仍由 `pi-conversation-adapter` 唯一维护，连接与
代际仍由 `pi-rpc-client` 唯一维护。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/fork-title.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/pi-runtime-client/usage-statistics`, `@workbench/pi-runtime-client/installation`, `@workbench/pi-runtime-client/errors`, `@workbench/pi-runtime-client/host`, `@workbench/pi-runtime-client/resources`, `@workbench/pi-runtime-client/configuration`, `@workbench/pi-runtime-client/workspace`, `@workbench/pi-runtime-client/external-import`, `@workbench/pi-runtime-client/context-trace`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/pi-runtime-client typecheck
pnpm --filter @workbench/pi-runtime-client test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/runtime/manager.ts` 引用 `lib/fork-title.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

Spec008 包内职责：`runtime/manager-catalog.ts` 拥有目录快照、排序、固定/归档更新与请求代次；`runtime/session-history.ts` 拥有规范历史、分支/分页状态、序列接纳、索引失效和分页去重；`runtime/session-attachments.ts` 拥有上传、提交准备与附件清理。manager 继续协调安装实例，session 通过有限合同协调一个会话，保持单一连接、消息图和原有 Host 事件通知时机。

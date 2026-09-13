# @workbench/pi-server

[English](README.md)

Pi 服务端安装、路由和依赖装配；选择原有共享实例并注入能力服务。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/compaction-rpc-validator.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/pi-server/installation`, `@workbench/pi-server/http`, `@workbench/pi-server/websocket`, `@workbench/pi-server/legacy`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/pi-server typecheck
pnpm --filter @workbench/pi-server test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/transport/compaction-rpc-validator.ts` 引用 `lib/compaction-rpc-validator.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

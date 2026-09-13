# @workbench/host-contracts

[English](README.md)

Runtime 能力、连接及宿主控制协议。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/control-ndjson.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/host-contracts`、`@workbench/host-contracts/runtime-connection`、`@workbench/host-contracts/runtime-capabilities`、`@workbench/host-contracts/host-control`、`@workbench/host-contracts/runtime-connected-web-control`、`@workbench/host-contracts/control-ndjson`、`@workbench/host-contracts/runtime-host-control`、`@workbench/host-contracts/runtime-host-identity`、`@workbench/host-contracts/runtime-artifact-manifest`、`@workbench/host-contracts/web-host-control`、`@workbench/host-contracts/web-artifact-manifest` 和 `@workbench/host-contracts/desktop-renderer-artifact-manifest`。RPC 信封与 issue/error 协议类型现在归 `@workbench/api/contracts`；本包负责 Runtime/Host connection 和 control 契约。

```bash
pnpm --filter @workbench/host-contracts typecheck
pnpm --filter @workbench/host-contracts test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/control-ndjson.ts` 引用 `lib/control-ndjson.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

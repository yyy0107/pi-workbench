# @workbench/automation-contracts

[English](README.md)

自动化持久化数据与调度输入契约。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/validation.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/automation-contracts`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/automation-contracts typecheck
pnpm --filter @workbench/automation-contracts test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/index.ts` 引用 `lib/validation.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

# @workbench/pi-product

[English](README.md)

Workbench 与 Pi 的应用及安装装配，拥有产品默认值与安装顺序。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/thinking-orb-renderer.tsx`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/pi-product/application`, `@workbench/pi-product/installation`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/pi-product typecheck
pnpm --filter @workbench/pi-product test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/running-indicator-defaults.tsx` 引用 `lib/thinking-orb-renderer.tsx`。实现保留 TS/TSX；既有构建工具保持原语言。

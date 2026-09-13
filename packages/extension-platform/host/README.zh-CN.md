# @workbench/extension-host

[English](README.md)

扩展安装、生命周期、服务容器与界面 Host。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/breadcrumbs.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/extension-host`, `@workbench/extension-host/internal`, `@workbench/extension-host/installation`, `@workbench/extension-host/services`, `@workbench/extension-host/command-palette`, `@workbench/extension-host/i18n/en-US`, `@workbench/extension-host/i18n/zh-CN`, `@workbench/extension-host/hosts/extension-error-boundary`, `@workbench/extension-host/hosts/main-view-host`, `@workbench/extension-host/hosts/main-view-sidebar-host`, `@workbench/extension-host/hosts/panel-host`, `@workbench/extension-host/hosts/renderer-host`, `@workbench/extension-host/hosts/slot-host`, `@workbench/extension-host/hosts/sidebar-section-host`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/extension-host typecheck
pnpm --filter @workbench/extension-host test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/services/main-view-service.ts` 引用 `lib/breadcrumbs.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

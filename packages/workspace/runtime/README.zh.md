# 工作区运行时

拥有检查工作区控制器、Surface/反馈存储、React Host、持久化、标签/调整尺寸和工作区目录选择。根入口提供控制器，`/react` 提供安装及资源 Hook，`/presentation` 提供公共视图；`/persistence`、`/directory-store` 提供状态工厂，`/i18n` 为无 React 词典入口，`/translations` 为翻译 Hook。

注册表、打开器、词典校验器和持久化端口都是固定安装输入，更换安装需重挂载 Provider。文件、浏览器、终端等具体 Surface 通过扩展注册表提供。保持原 ID、关闭/重试/释放规则和持久化格式。运行 `pnpm --filter @workbench/workspace-runtime test` 和 `typecheck`。

包内分工：src/ 放能力实现、契约、组件及装配，词典/样式随组件共置；lib/ 放下列内部辅助源码，tests/ 放测试。两处源码最多一级子目录。能力和辅助源码统一保留 TS/TSX，由所属包与消费者进行类型检查。

内部辅助：`lib/legacy-storage.ts`, `lib/surface-mount-policy.ts`, `lib/workspace-split-layout.ts`, `lib/workspace-tab-a11y.ts`, `lib/workspace-tab-layout.ts`.

实际调用示例：`src/index.ts` → `lib/surface-mount-policy.ts`.

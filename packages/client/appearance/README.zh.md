# 外观能力

拥有外观偏好、主题选择、字体栈及安装级设置存储，通过 `@workbench/appearance` 公开使用，字体 CSS 工具从 `/fonts` 导入。宿主提供 React 和设置端口，本包不注册业务界面。

持久化键与旧格式迁移保持原有语义。测试覆盖解析、迁移、异步加载、用户更新和释放；验证命令为 `pnpm --filter @workbench/appearance test` 和 `typecheck`。

包内分工：src/ 放能力实现、契约、组件及装配，词典/样式随组件共置；lib/ 放下列内部辅助源码，tests/ 放测试。两处源码最多一级子目录。能力和辅助源码统一保留 TS/TSX，由所属包与消费者进行类型检查。

内部辅助：`lib/legacy-preferences.ts`.

实际调用示例：`src/appearance-preferences.ts` → `lib/legacy-preferences.ts`.

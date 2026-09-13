# Shell 公共 Context

提供安装级 DOM ID、导航、展示、固定 Runtime 连接和运行指示器契约，以及布局读取信号和尺寸策略。每项能力有明确的公开子入口，根入口统一导出。

宿主负责安装 Provider，本包不注册扩展，不定义产品品牌、动画目录或进程级可变单例。运行 `pnpm --filter @workbench/shell-context test` 和 `typecheck` 验证。

包内分工：src/ 放能力实现、契约、组件及装配，词典/样式随组件共置；lib/ 放下列内部辅助源码，tests/ 放测试。两处源码最多一级子目录。能力和辅助源码统一保留 TS/TSX，由所属包与消费者进行类型检查。

内部辅助：`lib/layout/thread-content-width.ts`, `lib/workbench-shell-owner.ts`.

实际调用示例：`src/dom.tsx` → `lib/workbench-shell-owner.ts`.

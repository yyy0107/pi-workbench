# Spec 002 验证与继续执行

## Spec Kit 与 Agent 派发

运行 `.specify/scripts/bash/check-prerequisites.sh --json`，应定位本 Spec。已生成 [tasks.md](tasks.md)（T001–T024），使用 `$speckit-implement` 从 T001 开始实施。按 plan.md 的 Multi-Agent Dispatch 分工：独立能力迁移优先 `gpt-5.6-luna`，跨包契约/生命周期/集成优先 `gpt-5.6-sol`；前置未完成不得并行，共享文件由主 Agent 统一协调。

## 用户明确的验证范围

不新增、不运行 UI 测试：组件渲染/交互、DOM 快照、视觉回归、Browser/Electron UI 自动化和手工交互冒烟均不执行。既有 UI 测试文件保留、随 owner 迁移并修正路径，不以此为理由删除。记录“按用户约束不执行”，不能报告通过，也不作为任务完成阻塞。

UI 只做源码与静态审查：公开 props、Provider/实例生命周期、事件清理、词典键和插值、主题/密度/圆角 token、样式扫描及 Portal 归属。保留 lint、类型、结构/依赖检查、构建及相关非 UI 逻辑测试。

## 实施时命令

在仓库根使用现有 pnpm/Node 环境。仅在目录/依赖发生变化时更新锁文件与安装：

```bash
pnpm install --lockfile-only
pnpm install --frozen-lockfile
pnpm lint
pnpm check:workspace-dependencies
pnpm check:package-structure
pnpm typecheck
pnpm build
```

逐能力迁移时优先运行所属包与直接消费者的 `pnpm --filter <name> typecheck`，收口再运行全仓类型检查。非 UI 测试按现有 runner 精确选择文件：先检查测试内容与加载依赖，排除会启动渲染、DOM、Browser 或 Electron 窗口的测试；纯排序、编码、存储/端口逻辑或结构检查按其真实行为分类，不以文件名中的 ui 或包目录决定。

不得直接运行 `pnpm check`、`pnpm test`、含 UI 用例的包级 test 或带 UI 自动化的 pack/smoke。若已有聚合入口混合 UI 与非 UI，拆成独立安全命令或通过现有 runner 选择非 UI 文件，不修改全局测试脚本以永久禁用 UI 测试。执行前检查脚本及前后置钩子，保证构建等命令也不间接运行 UI 测试。

## 完成条件

1. workspace 六包新根与原 name 正确，活跃代码/配置无失效旧路径；源码 exports 可解析。
2. src/lib 真实职责及浅目录正确，公开入口、workspace:*、依赖无环检查通过。
3. 既有测试文件迁移清单逐项对应；只执行本轮相关非 UI 用例，记录确切命令和结果。
4. 静态审查 sidebar/panels/layout/command palette 保持 ID、顺序、持久化键、服务实例、事件释放和 Portal 作用域。
5. 双语键/参数与 CSS/token/资源路径静态检查通过，相关应用构建完成。
6. 本目录 tasks.md/validation.md 记录本轮证据及 UI 测试排除范围；不修改 Spec 001 验收记录，不以历史结果替代本轮验证。

接口见 [contracts/client-components.md](contracts/client-components.md)，管理对象见 [data-model.md](data-model.md)。

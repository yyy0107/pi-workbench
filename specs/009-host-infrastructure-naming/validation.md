# Spec009 验证记录

基线 `aa87792b`；完成日期 2026-09-13。当前工作区保留用户已有六处 skill 修改，本期没有提交或推送。

## 实施结果

- 原 4 个 Host 相关包调整为 6 个明确能力包，99 个库包、104 个工作区项目。
- 迁移 85 个原包文件，33 个公开入口全部映射到实际存在的新入口，无兼容转发包。
- `packages/host`、`client/host-client` 和 `client/host-contracts` 已移除；消费者、依赖、锁文件、构建配置与源码扫描同步迁移。
- 新增 2 个真实内部辅助文件：流式日志脱敏与共用规范路径校验；未改变现有行为。
- 新边界生产依赖允许列表覆盖六包，传输层和产物读取层不得反向依赖应用进程或产品策略；工作区检查同时禁止依赖环。
- 包结构与架构扫描显式识别 `packages/build` 为源码领域，同时继续忽略包内生成的 build 目录；包含回归用例。
- 六包共 12 份中英文 README，新增 build/process/transport 领域导航，更新包总导航和命名约定。

## 检查结果

| 检查                                       | 结果                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --offline`                   | 通过；重建 workspace 链接并更新锁文件，无第三方版本升级                                                              |
| `pnpm install --frozen-lockfile --offline` | 通过；104 个工作区项目                                                                                               |
| `pnpm check:workspace-dependencies`        | 通过；公开入口、依赖、无环与 Runtime 所有权检查                                                                      |
| `pnpm check:package-structure`             | 通过；99 库包、548 个库测试文件、0 迁移违规                                                                          |
| `pnpm typecheck`                           | 应用及库包全部通过；新增脱敏测试后补跑 application-process 类型检查通过                                              |
| `pnpm lint`                                | 通过；最终规格文档补齐后再次做格式与差异检查                                                                         |
| `pnpm build`                               | Runtime、Web standalone、Desktop Renderer 静态产物及 Electron Runtime 组合全部通过                                   |
| README 静态检查                            | 六包 33 个公开入口完整且双语一致，26 处 TS 导入符号和 4 处 CJS 导入符号有效；全部受影响 README 共 333 处本地链接有效 |
| 源码 AST 核对                              | 40 个迁移源码模块除引用归属和明确提取的 helper 外声明一致；helper 与原函数声明一致                                   |
| 迁移清单与历史记录                         | 85 个目标文件存在，旧文件移除；Spec001–008 未改写；6 处既有 skill 文件哈希不变                                       |

## 非 UI 测试

精确执行清单见 [non-ui-tests.json](non-ui-tests.json)：70 个测试文件覆盖 530 项测试，其中 529 项通过、1 项按既有平台条件跳过。

执行过程：

1. 首轮 69 文件、528 项：525 通过，2 失败，1 跳过。
2. 两项失败为 Settings/Automation 公开依赖断言仍期待旧 Host server，实际代码早已使用 api。将断言改为实际依赖，并移除仅因旧断言而保留的开发依赖；两项定向重跑通过。
3. 新增进程流式脱敏测试文件，2 项通过：逐字节切分 UTF-8、跨块凭据、普通文本尾部冲刷和失败日志接收端。

未重复运行已经通过且没有后续行为修改的测试。跳过项为 `real Windows census preserves exact Unicode, quoted, and multiline argv`，当前平台 Linux；Windows 模拟进程树/身份检查通过。

不新增或执行 UI/DOM/Hook 渲染测试、Browser/Electron 界面自动化或交互冒烟。现有 UI 测试仅迁移导入并静态审查；清单中单独列出排除文件。`staged-api-only-runtime-smoke.test.cjs` 是已有控制逻辑的模拟测试，没有启动 Electron 界面。

## 构建证据

- Runtime Node 和 Electron Node 两种目标均生成 `server.mjs`，保留既有 Pi、PTY、Tree-sitter、ws 外部依赖规则。
- Web 生成 `web-server.mjs` 与 Next standalone 产物。
- Desktop Renderer 生成 `index.html` 与 1967 个静态文件，再与 Electron Runtime 目标组合成功。
- 构建日志没有先前的 `::highlight` CSS 解析告警。

本机详细日志位于 `/tmp/host-refactor-{install,frozen-install,typecheck,process-typecheck,boundaries,structure,tests,tests-rerun,redactor-tests,lint,build}.log`，这些临时日志不作为仓库必需文件。

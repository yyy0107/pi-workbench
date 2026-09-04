# Workbench 公共层

Web 与 Desktop 共用产品装配；Runtime app 组合公共服务和 Pi 适配器。公共服务不导入 Pi SDK、Pi 实现或应用源码。HTTP/WS 地址、请求封装、扩展 ID、设置键和持久化格式保持兼容。

## 代码归属

| 所有者                                                               | 公开入口与职责                                                                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `scripts/sync-static-assets.mjs`                                     | 图标和文件预览资源清单、复制与版本指纹；两端脚本传入各自 public 目录及包内依赖解析器                            |
| `@workbench/host-artifact-policy/filesystem`                         | 按路径段判断包含关系、规范路径校验、真实目录身份读取和比较                                                      |
| `@workbench/pi-product`                                              | `/application` 安装公共 Shell Provider、Pi 文案、品牌、运行指示器和固定扩展顺序；`/installation` 装配连接及能力 |
| `@workbench/host-contracts/rpc`                                      | ClientRequest、ServerResponse、错误与校验问题的公共封装                                                         |
| `@workbench/host-client/rpc`                                         | 请求 ID、公共请求收发、响应匹配、取消信号与传输错误                                                             |
| `@workbench/host-server/rpc`                                         | 校验器、信任与 loopback 检查、载体限制、首个匹配路由分发及领域错误投影                                          |
| `@workbench/services-client`                                         | 按 `/settings`、`/automation`、`/host`、`/workspace`、`/attachment-understanding` 导出客户端工厂                |
| `@workbench/settings-server/rpc`、`@workbench/automation-server/rpc` | 各自领域的 validator、请求预算、取消及服务委派                                                                  |
| `@workbench/local-host-server`                                       | `/directories`、`/picker`、`/applications`、`/service`、`/rpc`：原生目录操作、选择和应用发现/启动               |
| `@workbench/workspace-server`                                        | `/files`、`/git`、`/http`、`/rpc`：文件与 Git 服务、路径授权、版本冲突、GET/HEAD/Range 内容读取                 |
| `@workbench/attachment-understanding-server`                         | `/contracts`、`/settings`、`/task`、`/rpc`：识别策略、生命周期、OCR、受限 HTTP、结果投影和设置存储              |

## 装配和生命周期

`PiWorkbenchApplicationProviders` 接收应用词典、locale、installation ID 和 RuntimeConnection，复用 Shell 的设置与 i18n Provider。`PiWorkbenchShell` 接收导航组件、资源 URL、持久化适配器和平台扩展。默认扩展顺序定义一次，Desktop 生命周期扩展按原顺序追加。

每次安装创建自己的客户端和 Pi manager。Shell 与 Pi 共用该安装的 Settings 客户端，其缓存、并发加载合并和串行更新队列保持不变。`PiAgentRuntimeInstallationOptions.services` 显式接收公共能力，Pi 补充模型、会话、交互、上下文及项目资源信任能力。通用 UI capability hooks 不变；错误经 `WorkbenchAgentCapabilityError` 到达 UI。文件搜索也使用公共 Workspace 客户端。

`apps/runtime-node/src/composition/installed-pi-server.ts` 创建一个服务图，组合公共领域路由和 Pi 路由。公共路由沿用 `/api/<method>`；Pi 的 `respond`、历史导出、兼容 HTTP 与事件连接继续由 Pi 适配器负责。请求预算归领域路由所有。Automation 沿用既有唯一调度实例，Pi 沿用既有事件连接。

Workspace 服务通过 `resolveWorkspaceRoot(workspaceId)` 获取根目录。Pi 的 `workspace-service-bindings.ts` 适配 WorkspaceStore 与 mutation coordinator，Git 变更保持“检查忙碌状态 → 修改 → 重载”；没有资源变化时跳过重载。Runtime 创建同一个文件服务供 RPC、内容流和 `PiAgentHostBindings.workspaceFiles` 使用，Composer 文件引用通过该绑定读取。会话目录、工作区与会话关系、资源信任及 `host.describe` 中的 Pi 信息仍归 Pi。

附件任务接收标准附件、设置快照或设置读取失败、取消信号、模型能力查询、多模态准备/执行及状态发布回调。任务返回 native、preprocessed、failed 或 cancelled，使用既有状态机和有界结果投影。OCR 凭据只进入服务端识别请求；状态与 RPC 设置视图不携带凭据。网络目标限制、DNS 固定、超时和响应大小限制由迁移后的同一 HTTP 实现负责。

`installed-attachment-understanding.ts` 保留旧环境变量和设置文件迁移语义，并将设置读取端口注入 Pi。Pi 保留 native-only 快速路径、ModelRuntime 配置刷新、会话忙碌租约、取消释放和历史消息格式；只有 Pi 会话适配器的一个 finally 出口持久化终态。取消后迟到的识别结果不会变成成功终态。

静态资源指纹只在复制成功后写入；命中指纹但目标缺失时仍补齐。构建路径计算允许根内的 `..cache`，拒绝真正的父目录逃逸和跨卷路径；真实文件系统检查另外验证符号链接、规范路径和目录身份。Next standalone 修复、Runtime 原生依赖、manifest 和发布恢复仍由各构建器负责。

## 验证

测试随实现迁到公共包；Pi 会话、模型与持久化集成测试留在 Pi。新增任务测试覆盖非法结果、取消迟到结果、凭据隔离和唯一终态；Workspace 适配测试验证忙碌拒绝与重载顺序。产品测试覆盖扩展顺序、双语目录及安装隔离。原 RPC、文件范围请求、设置迁移和资源复制测试继续约束行为。

`scripts/check-workspace-dependencies.mjs` 对公共服务使用显式生产依赖允许列表，拒绝 Pi 和应用依赖；架构测试校验服务、路由和装配的新归属。最终验证使用 `pnpm typecheck`、受影响包测试、`pnpm check:workspace-dependencies` 和 `pnpm build`。

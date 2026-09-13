# Spec 007 实施记录

基线 `383fe578`；103 个来源哈希全部一致。既有 `.agents/skills/` 修改保留。无 checklists 或 extensions hooks。现有 .gitignore 覆盖依赖、构建及环境文件，本次无发布。

## T001–T004

已核对来源/消费者和公共合同。所有权以 ownership-map.md 与 source-inventory.json 为准；精确非 UI 文件候选清单见 non-ui-tests.json，执行前逐项确认无 UI harness。客户端实际消费者还有 services-client 与 pi-client/integration。现有 readTrustedJsonPost 也属于通用服务端能力，用于非信封 JSON POST，应一并迁移且保持信任/UTF-8/预算顺序。根入口仅协议类型，transport 必填；不修改业务方法或默认预算。

T001–T003 已验证；T004 待完成测试导入审查。

T004：31 个精确候选测试均为 node:test，未发现 UI 测试框架；后续新增测试同样使用 Request/Response。T006：已先创建真实 contracts 与包配置以支持测试接线；T005 测试提取先于 errors/validator 实现。

## T005–T011 / US1

迁移 errors/validation 测试先于其实现；contracts scaffold 提前用于接线。pnpm offline 首次缺 @next/env 元数据，普通 pnpm install --ignore-scripts 后成功，随后离线安装通过。新增 packages/transport/* workspace，保留 SDK 0.85.1。

`node --import ./scripts/register-typescript-test-loader.mjs --test packages/transport/api/tests/errors.test.ts packages/transport/api/tests/validation.test.ts packages/host/host-server/tests/rpc.test.ts`：28/28 通过。`pnpm --filter @workbench/api --filter @workbench/host-server --filter @workbench/pi-protocol --filter @workbench/server-core typecheck`：全部通过。host-contracts/rpc 与 server-core/rpc-domain-error 源码/exports 删除且源码零引用；旧 Host POST 暂保留本地 request-envelope helpers，US3 将迁回 api 并合并内部 helper。

## T012–T017 / US2

新 client 测试先于实现，9 项通过；Host 默认 resolver 迁回 runtime-fetch，services-client 与 Pi facade 内部注入必填 transport，facade options 保持可选。client/Host fetch/services/Pi transport injection 精确 8 文件：30/30 通过（/tmp/spec007-us2-tests.log）。api、host-client、services-client、pi-transport-client 类型通过；pi-client 首次发现测试 fixture 错用必填 options，改引用 services-client/errors 的 facade options 后类型通过（/tmp/spec007-us2-types-fix.log）。未执行 UI 测试。旧 host-client/rpc 实现及 exports 已删除。

## T018–T025 / US3 与边界

通用 POST、route-group、projector、readTrustedJsonPost 从旧 host-server/rpc 迁入 api/server，复用原 server-core/request-trust。Pi 与四个领域 server 接线完成，settings 24 MiB 预算保留。三个共享 helper 从过渡 Host 文件合并回 api/lib，四个旧通用源文件和 exports 全部删除。

精确白名单见 non-ui-tests.json：44 个文件，272/272 通过（/tmp/spec007-nonui-tests.log），包括 auth-before-parser、trust-before-read、取消信号及 UTF-8 精确预算新增用例。新的静态 API 传递导入与旧入口检查加在既有 refactor-architecture-boundaries.test.mjs，5/5 通过；两项 workspace/structure 检查器测试文件共 23/23 通过。Sol 对照基线逐段复核通用实现，未发现语义差异。

## T027 / 依赖与结构

清除领域包因旧通用 RPC 产生的 host-server 生产依赖，测试确需宿主 harness 的保留 devDependency。同步现有允许依赖策略、manifests、workspace glob 与 lock。pnpm check:workspace-dependencies 通过；pnpm check:package-structure：94 libraries、538 test files、0 tracked migration violations。pnpm install --offline --frozen-lockfile --ignore-scripts 通过。

全仓 typecheck 首次在 Electron Node 环境遇到 globalThis.location 类型缺失；改用局部可选环境类型声明后全仓通过，Host fetch 精确 6/6 重跑通过。pnpm lint 通过。完整构建现已通过，最终结果见下表。

## T026–T032 / 最终收口

迁移映射覆盖全部 103 项基线来源/消费者：保留 owner 的文件同步导入/文档/依赖；4 个通用旧源码入口删除；3 个旧测试文件迁移，validator 原断言拆到独立测试且没有减少覆盖。额外变更、测试与新包文件由当前 diff 和 non-ui-tests.json 列明。54 个领域 src/lib 文件对比基线 AST（排除导入及 export-from 声明与位置信息）完全一致，见 domain-body-audit.json；Pi facade 唯一行为接线变化为显式默认 transport 注入，已由非 UI 测试覆盖。

新包及原 owner 双语 README 已同步实际入口与边界；无新的 UI 文案/词典。源码与当前 README 中旧入口引用为零。公共根仅协议类型；validation/errors/client 的传递源码图不包含服务端，server-core 无反向 api 边。没有旧转发文件、空目录包或未使用 helper。

| 验证                              | 结果                                                    | 证据                                            |
| --------------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| 精确非 UI 行为测试                | 44 文件，272/272 PASS                                   | non-ui-tests.json；/tmp/spec007-nonui-tests.log |
| API/旧入口静态边界                | 5/5 PASS                                                | /tmp/spec007-boundaries.log                     |
| workspace/structure 检查器测试    | 23/23 PASS                                              | /tmp/spec007-checker-tests.log                  |
| Host resolver 类型修复后相关测试  | 6/6 PASS                                                | /tmp/spec007-host-fetch-final.log               |
| 冻结锁文件离线安装                | PASS                                                    | /tmp/spec007-frozen.log                         |
| pnpm check:workspace-dependencies | PASS，生产图无环                                        | /tmp/spec007-deps.log                           |
| pnpm check:package-structure      | PASS，94 库包，538 测试文件，0 迁移违规                 | /tmp/spec007-structure.log                      |
| pnpm typecheck                    | PASS，所有应用和库包                                    | /tmp/spec007-types.log                          |
| pnpm lint                         | PASS                                                    | /tmp/spec007-lint.log                           |
| pnpm build                        | PASS，Runtime / Web / Electron                          | /tmp/spec007-build.log                          |
| 领域 AST 对照                     | 54 文件，0 实现差异                                     | domain-body-audit.json                          |
| 客户端产物审查                    | Web 283 / Desktop 280 个 JS chunk 未命中 RPC 服务端标记 | artifact-audit.json；结合传递源码图检查         |
| git diff --check                  | PASS                                                    | 完成前执行                                      |

产物：`.desktop-build/web/artifact-manifest.json`、`.desktop-build/desktop-renderer/artifact-manifest.json`、`.desktop-build/runtime-node/node-linux-x64-glibc-abi137/artifact-manifest.json`、`.desktop-build/runtime-node/electron-node-linux-x64-glibc-abi148-electron43.4.1/artifact-manifest.json`。客户端检查针对实际 Next 静态 JS，字符串未命中作为源码传递导入检查的补充，不单独充当依赖隔离证明。

构建存在已由 Spec006 记录的 Pi `::highlight(pi-prompt-placeholder)` CSS warning，Web/Desktop 各一次；对应 CSS 本期未修改，未阻断构建。本期没有执行 UI、DOM、Hook render、Browser 或 Electron 交互冒烟，未验证其渲染/交互表现。`.agents/skills/` 用户已有修改保持；未提交、推送或发布。前后 extensions hooks 均不存在。

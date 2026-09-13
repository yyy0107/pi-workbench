# Tasks — Spec 007 API / RPC 基础能力提取

**输入**：[spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[公共合同](contracts/public-api.md)、[所有权映射](ownership-map.md)、[验证指南](quickstart.md)。
**基线**：`383fe578`，分支 `codex/package-refactor`。状态：32/32 项已实施并验证；逐阶段证据见 [validation.md](validation.md)。

## 执行约定

所有路径相对仓库根。`[P]` 仅表示所列前置完成后可与指定的不同文件任务并行，不表示可跳过依赖。每项完成需记录修改范围、实际验证命令与结果到 `specs/007-api-rpc-extraction/validation.md`；失败保持未勾选。

只新增 `packages/transport/api`（`@workbench/api`），93 → 94 个库包。根入口只导出类型；真实 TS/TSX 的 src/lib 最多一级子目录，禁止空壳、无消费者 helper、内部深层导入和最终转发入口。业务 DTO、method、URL、协议版本、持久化格式与安装实例保持。

不新增或执行 UI、DOM、fake DOM、Hook render、视觉、交互、Browser、Electron 冒烟测试。既有 UI 测试只允许保留、迁移和必要导入/fixture 更新。允许按本清单执行 RPC/HTTP 等非 UI 测试；禁止宽泛 `pnpm test` / `pnpm check`。不新增 UI 文案或空词典。只用 pnpm；实施不自动提交、推送或发布。

主 Agent负责公共合同、Host transport 注入、所有 package.json/exports/tsconfig、锁文件、共享检查脚本和集成；gpt-5.6-luna 负责确定边界的引用与文档搬迁；gpt-5.6-sol 负责校验、请求、错误和取消语义。同一文件唯一 writer，最多两个并行写入子 Agent；子 Agent交回所需依赖清单，由主 Agent集中更新。

## Phase 1：Setup — 基线与范围（2 项）

- [x] T001 核对 `specs/007-api-rpc-extraction/source-inventory.json` 的路径/哈希与 `383fe578`，检查实际变更文件最近的 AGENTS.md，在 `specs/007-api-rpc-extraction/validation.md` 记录基线、用户既有修改及禁止测试范围；不恢复或覆盖无关改动。
- [x] T002 依赖 T001，复核 `packages/client/host-client/src/rpc.ts`、`packages/host/host-server/src/rpc.ts` 及清单内所有消费者，在 `specs/007-api-rpc-extraction/ownership-map.md` 补齐逐文件迁移/保留/测试归属和无 options 调用点，记录旧 exports、method、默认及领域预算、认证/信任/解析次序；验收为每个旧入口有消费者与目标对应。

## Phase 2：Foundational — 冻结合同与验证门槛（2 项）

- [x] T003 依赖 T002，核对并冻结 `specs/007-api-rpc-extraction/contracts/public-api.md`：明确 callRpc 必填 transport、facade 签名不变、RuntimeFetch 结构兼容、类型根入口、错误品牌和子入口允许依赖；在 `specs/007-api-rpc-extraction/ownership-map.md` 分配唯一 writer，确认 server-core 无反向 api 依赖。
- [x] T004 依赖 T003，在 `specs/007-api-rpc-extraction/quickstart.md` 建立精确非 UI 测试文件白名单及迁移后路径，逐项审阅运行器/导入是否触发 UI；涵盖 api 单测、host-client/runtime-fetch、Host trust/auth/conformance、领域 routes 与 runtime-node 集成，记录既有断言和验证命令。新测试路径必须标注待创建。

**门槛**：T001–T004 完成后才能迁移源码；不以空包作为基础阶段产物。

## Phase 3：US1 / P1 — 单一契约、错误与校验器（7 项，MVP）

**独立验收**：新包纯入口提供相同信封、issue、品牌错误和 validator 类型推导；旧 Host server 使用这些实现后仍能工作，无重复通用定义；尚未迁移的网络调用继续使用原宿主装配。

- [x] T005 [US1] 依赖 T004，从 `packages/host/host-server/tests/rpc.test.ts` 提取校验/错误断言至 `packages/transport/api/tests/validation.test.ts`，从 `packages/server/server-core/tests/rpc-domain-error.test.ts` 迁移品牌断言至 `packages/transport/api/tests/errors.test.ts`；保留原覆盖并补齐 required/optional/nullable、嵌套 issue path、当前/legacy 品牌与无品牌对象拒绝，记录迁移对应关系；接线完成前不得标记故事验收通过。
- [x] T006 [US1] 依赖 T005，将 `packages/client/host-contracts/src/rpc.ts` 的中立类型迁入 `packages/transport/api/src/contracts.ts`，创建仅类型导出的 `src/index.ts`、真实包 `package.json`、`tsconfig.json` 与中英文 README；由主 Agent同步 workspace 依赖和 `pnpm-lock.yaml`，只发布已存在的入口；验证信封字段与 undefined JSON 语义未变。
- [x] T007 [P] [US1] 依赖 T006，将 `packages/server/server-core/src/rpc-domain-error.ts` 的品牌实现和 `packages/host/host-server/src/rpc.ts` 的纯业务错误构造迁入 `packages/transport/api/src/errors.ts`；保留两种 Symbol.for、Error options、code/details 与可公开错误范围，运行 T005 errors 测试；不编辑旧 host-server 文件，交主 Agent接线。
- [x] T008 [P] [US1] 依赖 T006，从 `packages/host/host-server/src/rpc.ts` 提取原 validator 至 `packages/transport/api/src/validation.ts`，提取实际复用 issue/path 辅助至 `lib/validation-issues.ts`；保持泛型推导、联合/细化与问题顺序，不编辑旧源文件；依赖 T007 如有 errors 导入再集成，运行 T005 validation 测试。
- [x] T009 [US1] 依赖 T007、T008，由主 Agent删除 `packages/host/host-server/src/rpc.ts` 中已迁出的重复错误/validator 定义并改用新实现；同步 T002 列出的 validator/error 消费者（含领域错误子类），同步各 package.json/exports 和 `pnpm-lock.yaml`，保持旧 POST 装配工作；不得形成 server-core → api 依赖。
- [x] T010 [US1] 依赖 T009，切换 `packages/pi/pi-protocol/src/rpc.ts` 及 T002 清单内信封类型引用至 `@workbench/api/contracts`；保留 Pi 业务 DTO 与合法领域类型再导出，删除 `packages/client/host-contracts/src/rpc.ts`、`packages/server/server-core/src/rpc-domain-error.ts` 及对应旧 exports，更新测试导入；确认两个旧入口全仓可执行代码零引用。
- [x] T011 [US1] 依赖 T010，执行 `packages/transport/api/tests/validation.test.ts`、`tests/errors.test.ts` 与仍归 Host 的受影响 RPC 测试，检查新包及受影响包类型、纯入口依赖和真实 lib 消费；在 `specs/007-api-rpc-extraction/validation.md` 记录 US1 验收证据，类型推导不得以 any 掩盖。

## Phase 4：US2 / P1 — 显式 transport 的通用客户端（6 项）

**独立验收**：受控 fetch 可独立调用 api/client；正常值、无值、错误、畸形响应与取消保持；Host 同源 URL 限制、Desktop Bearer 和实例级注入不变。

- [x] T012 [US2] 依赖 T011，在 `packages/transport/api/tests/client.test.ts` 建立非 UI 契约测试（优先迁移 T004 找到的既有断言）：覆盖 POST 路径/信封、rpcId、正常/undefined 值、非成功 HTTP、无效 JSON/result、业务错误、AbortSignal 和 transport 拒绝；用 Request/Response 与受控 transport，不创建 DOM。
- [x] T013 [P] [US2] 依赖 T012，由主 Agent将 `packages/client/host-client/src/rpc.ts` 的默认同源解析与 resolveRuntimeFetch 移至 `packages/client/host-client/src/runtime-fetch.ts`，同步旧内部调用，保留非浏览器 fallback、RuntimeConnection URL 限制与认证头覆盖；更新 `packages/client/host-client/tests/runtime-fetch.test.ts` 的非 UI 行为覆盖。
- [x] T014 [P] [US2] 依赖 T012，将通用 callRpc/RpcClientError/createRpcId 迁入 `packages/transport/api/src/client.ts`，响应信封校验迁入实际调用的 `lib/response-envelope.ts`；options 必填 RpcTransport，不导入 Host/Pi/Node，不设置全局 transport，运行 T012 测试；不编辑 T013 的 Host 文件。
- [x] T015 [US2] 依赖 T013、T014，将 `packages/pi/pi-transport-client/src/api.ts`、`src/client-transport.ts` 及 T002 清单中其余客户端 facade 全部接入 `@workbench/api/client`，通过 host-client/runtime-fetch 注入显式或原默认 transport；保留 facade 公共签名、Pi 错误适配和安装实例，不修改 connections/WebSocket 生命周期；主 Agent同步依赖和入口。
- [x] T016 [US2] 依赖 T015，更新并运行 `packages/pi/pi-client/tests/runtime/transport-injection.test.ts` 与 `packages/client/host-client/tests/runtime-fetch.test.ts` 的非 UI 断言；验证无 options 调用、同源/跨源限制、Desktop token 覆盖、两个安装 transport 隔离和取消传递，按 T004 审查结果执行，不借用 UI harness。
- [x] T017 [US2] 依赖 T016，删除 `packages/client/host-client/src/rpc.ts` 与旧 rpc export，核对 T002 全部调用点和测试引用，运行 api client 测试及受影响类型检查；在 `specs/007-api-rpc-extraction/validation.md` 记录旧入口零引用、浏览器中立依赖和 US2 结果。

## Phase 5：US3 / P1 — 通用服务端处理与领域接线（7 项）

**独立验收**：新 server 入口可组合原领域 handlers；状态码、method 匹配、预算、信任检查、错误投影、路由顺序和取消保持，业务 server 不再为 validator/handler 依赖 host-server/rpc。

- [x] T018 [US3] 依赖 T017，将 `packages/host/host-server/tests/rpc.test.ts` 的剩余通用 POST 用例与 `tests/rpc-route-group.test.ts` 迁入 `packages/transport/api/tests/server.test.ts`、`tests/route-group.test.ts`；保留 Request/Response、状态、method、预算、trust、取消、未知异常遮蔽和分发顺序断言，真实宿主 auth/conformance 测试留原包。
- [x] T019 [US3] 依赖 T018，将 `packages/host/host-server/src/rpc.ts` 的 POST/context/options、handleRpcPost、route-group/dispatch、领域错误 projector 迁入 `packages/transport/api/src/server.ts`；复用 validation/errors 与 `@workbench/server-core/request-trust`，保留默认 1 MiB、解析次序及精确状态/错误语义；由主 Agent公开 server 入口和依赖，运行 T018 通用测试。
- [x] T020 [US3] 依赖 T019，切换 `packages/host/host-server/src/` 内 T002 清单消费者及 `apps/runtime-node/src/terminal-shell-rpc.ts`、`src/installed-api-only-runtime-host.ts`、`src/runtime-rpc-warmup.ts` 的实际相关引用至 api/server；未引用旧 RPC 的文件只核对不修改，保留 listen/auth/router 装配与 signal 传播。
- [x] T021 [P] [US3] 依赖 T020，切换 `packages/pi/pi-server/src/transport/rpc-router.ts`、`rpc-route-composition.ts`、`runtime-http-router.ts` 与清单内 validators/routes 到 api/server、api/validation、api/errors；保留 `rpc-request-budgets.ts`、领域 DTO/handler/service 注入和 Pi SDK 对象归属，更新对应 `packages/pi/pi-server/tests/transport/` 精确非 UI 测试引用。
- [x] T022 [P] [US3] 依赖 T020，切换 `packages/server/settings-server/src/rpc.ts`、`packages/server/automation-server/src/rpc.ts`、`packages/server/workspace-server/src/rpc.ts` 及 file/git routes、`packages/server/local-host-server/src/rpc.ts` 及 host/local-app routes 的剩余公共引用；保留领域 service 注入和设置更新 24 MiB 预算，更新各包根 tests 对应 route 测试引用，不编辑 Pi 或共享 manifests。
- [x] T023 [US3] 依赖 T021、T022，由主 Agent汇总依赖/exports 与 `pnpm-lock.yaml`，删除 `packages/host/host-server/src/rpc.ts` 和旧 rpc export；检查所有业务 routes、Host 与 runtime-node 的新入口接线、错误白名单及 method/预算与 T002 基线一致，不保留转发实现。
- [x] T024 [US3] 依赖 T023，执行 T004 白名单内 api/server/group、`packages/host/host-server/tests/runtime-transport-auth.test.ts`、`tests/runtime-transport-conformance.test.ts`、`packages/server/server-core/tests/request-trust.test.ts`、受影响领域 routes 与 runtime-node 非 UI 集成测试；覆盖 Host/Origin/trusted-host/loopback、认证与解析顺序，记录 US3 命令/结果到 `specs/007-api-rpc-extraction/validation.md`。

## Phase 6：US4 / P2 — 全仓消费者与公共边界收口（5 项）

**独立验收**：94 个有效库包，生产依赖无环，所有旧通用入口清零；客户端产物无服务端传递依赖；测试所有权与公开文档符合最终代码。

- [x] T025 [US4] 依赖 T024，扩充既有 `scripts/refactor-architecture-boundaries.test.mjs` 的静态边界检查：拒绝 api 根/client/errors/validation 传递引入 Node/server-core/Host/Pi，拒绝 api/server → 业务 server 与 server-core → api，拒绝旧通用入口和深层导入；复用既有检查机制，不新增平行框架，运行该精确非 UI 检查。
- [x] T026 [P] [US4] 依赖 T025，更新 `packages/transport/api/README.md`、`README.zh-CN.md` 及 `specs/007-api-rpc-extraction/ownership-map.md` 清单内原 owner 中英文 README：给出明确 transport 与 server 子入口示例，解释领域 DTO/Host connection 保留边界；清除过时导入，不改无关 `.agents/skills/` 文件。
- [x] T027 [P] [US4] 依赖 T025，主 Agent审计 `packages/transport/api/package.json`、`tsconfig.json`、所有消费者 package.json 与 `pnpm-lock.yaml`，删除仅由旧 RPC 导致的多余依赖；用 `scripts/check-workspace-dependencies.mjs`、`scripts/check-package-structure.mjs` 检查 94 库包、无环、显式 exports、真实 src/lib 和浅层 TS/TSX，不删除仍用于宿主装配的依赖。
- [x] T028 [US4] 依赖 T026、T027，对照 `specs/007-api-rpc-extraction/source-inventory.json` 与 T002 映射逐文件核销源码/测试去向；核对四个旧通用入口零引用、没有重复校验/错误/默认 fetch 实现、method/DTO/URL/版本未改，迁移测试断言未丢失；将结果写入 `specs/007-api-rpc-extraction/validation.md`。
- [x] T029 [US4] 依赖 T028，复核 `specs/007-api-rpc-extraction/contracts/public-api.md` 与实现导出一致，结合 `scripts/refactor-architecture-boundaries.test.mjs` 和受影响包类型检查验证 US4；同步 `specs/007-api-rpc-extraction/quickstart.md` 精确最终测试路径、记录尚待完整构建验证的产物边界。

## Phase 7：Polish — 最终验证与记录（3 项）

- [x] T030 依赖 T029，执行 `specs/007-api-rpc-extraction/quickstart.md` 最终白名单中尚未验证或集成后受影响的精确非 UI 测试，复核正常/错误/预算/取消/trust/auth 全部已有证据；将实际通过数与失败项写入 `specs/007-api-rpc-extraction/validation.md`，不运行宽泛包级测试或机械重复已通过且未变化的测试。
- [x] T031 依赖 T030，按根 `package.json` 执行 `pnpm check:workspace-dependencies`、`pnpm check:package-structure`、`pnpm lint`、`pnpm typecheck`、`pnpm build`；检查 Web/Electron 客户端构建输出或构建模块清单中 api client 的依赖闭包不含服务端模块，服务端产物允许使用 api/server；记录实际产物路径与结果到 `specs/007-api-rpc-extraction/validation.md`，不启动 UI 冒烟。
- [x] T032 依赖 T031，执行 `git diff --check`，复核 `specs/007-api-rpc-extraction/tasks.md` 各项证据后再勾选并同步 `spec.md`、`plan.md`、`quickstart.md` 与根 `AGENTS.md` 的 007 完成状态；保留 Spec006 历史与无关修改，汇报 94 包、验证结果和实际限制，不自动提交/推送。

## 依赖顺序与并行示例

主链：Setup T001–T002 → Foundational T003–T004 → US1 T005–T011 → US2 T012–T017 → US3 T018–T024 → US4 T025–T029 → 收口 T030–T032。

| 故事 | 允许的并行窗口      | 派发与文件边界                                                                                                                                                            |
| ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US1  | T006 后 T007 / T008 | 两个 Sol 分别编辑 errors 与 validation/helper；只读同一个旧 host-server/rpc 源，T009 主 Agent串行删旧定义并接线。若 validator 依赖 errors，先等 T007 接口落定再运行验证。 |
| US2  | T012 后 T013 / T014 | 主 Agent编辑 Host runtime-fetch；Sol 编辑 api client/helper。T015 必须等待两者完成。                                                                                      |
| US3  | T020 后 T021 / T022 | Sol 编辑 Pi RPC 边界；Luna 按冻结合同迁移其余领域引用，涉及语义变化回交主 Agent或 Sol；T023 主 Agent集中更新 manifests。                                                  |
| US4  | T025 后 T026 / T027 | Luna 更新双语文档；主 Agent处理 manifests/lock/结构检查。T028 等待两者。                                                                                                  |

除这些窗口外默认串行；尤其旧 `host-server/src/rpc.ts`、根检查脚本、manifests/lock 不能多 writer。US2 与 US3 虽共享 US1 基础，当前任务选择串行接线，便于区分客户端与服务端行为回归。

## 实施策略与完成条件

MVP 为 T001–T011：把通用协议、品牌错误和 validator 归到一个包，同时接好现有使用者并独立验证；此时不声称整个网络抽离完成。后续继续 US2 客户端、US3 服务端和 US4 全仓收口。用户授权整期实施后，阶段验收通过即继续，不重复请求确认。

每个故事以独立验收门槛判断完成，最终以 T031 的全仓静态/类型/构建结果及各阶段非 UI 行为证据收口。只有完成 T032 才能将 007 标为已实施；本次实施与验收已完成，结果见 validation.md。

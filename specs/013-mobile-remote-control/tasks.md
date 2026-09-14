# Tasks: Workbench Mobile Remote Control

**Input**: Design documents from `/specs/013-mobile-remote-control/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: 本功能的规格、计划和安全门明确要求协议、状态机、持久化、集成、密码学与构建验证，因此各用户故事均包含非 UI 测试任务。按照仓库约束，不新增、不运行 UI/DOM/Hook 渲染测试或 UI 交互冒烟。

**Organization**: 任务按用户故事组织；所有实现使用 pnpm，所有新增库包遵守浅层 `src/`/`lib/`、公开 exports、TS/TSX、包根 `tests/` 和中英文 README 约束。任务只有在其验证通过并把证据写入 `specs/013-mobile-remote-control/validation.md` 后才可勾选。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：满足其已声明前置任务后，可与同一 wave 中修改不同文件的任务并行。
- **[US1]…[US5]**：对应 `spec.md` 中的五个用户故事。
- 每项任务均给出目标文件；测试任务必须先提交失败断言，再实现对应能力。

---

## Phase 1: Setup（共享工程初始化）

**Purpose**: 建立实施证据、四个能力包、两个应用和明确的仓库检查入口，不提前放入空壳业务实现。

- [x] T001 记录当前分支、工作树、包数量、相关公开 Pi/Runtime 入口与既有检查基线到 `specs/013-mobile-remote-control/validation.md`；保留用户已有未提交修改，完成条件是基线命令、结果和未执行 UI 测试约束均可追溯
- [x] T002 [P] 创建 `@workbench/remote-control-contracts` 的 `packages/contracts/remote-control-contracts/package.json`、`tsconfig.json`、`README.md`、`README.zh-CN.md` 和显式 exports 骨架；不创建无消费者 helper，完成条件是包名与叶目录一致
- [x] T003 [P] 创建 `@workbench/remote-control-client` 的 `packages/transport/remote-control-client/package.json`、`tsconfig.json`、`README.md`、`README.zh-CN.md` 和显式 exports 骨架；依赖仅指向远控合同和允许的基础合同
- [x] T004 [P] 创建 `@workbench/remote-control-relay-server` 的 `packages/server/remote-control-relay-server/package.json`、`tsconfig.json`、`README.md`、`README.zh-CN.md` 和显式 exports 骨架；确保生产依赖不包含 Pi、Electron 或客户端 UI
- [x] T005 [P] 创建 `@workbench/pi-runtime-remote-control` 的 `packages/pi-runtime/pi-runtime-remote-control/package.json`、`tsconfig.json`、`README.md`、`README.zh-CN.md` 和显式 exports 骨架；声明只使用公开 Pi RPC/Runtime transport 入口
- [x] T006 [P] 创建 Relay 装配应用的 `apps/remote-control-relay/package.json`、`tsconfig.json`、`src/main.ts` 和 `src/configuration.ts`，先提供可测试的配置解析与空生命周期而不开放会话 API
- [x] T007 [P] 使用 pnpm/Expo SDK 57 初始化 `apps/mobile/package.json`、`app.config.ts`、`eas.json`、`tsconfig.json`、`src/app/_layout.tsx` 和 `src/app/index.tsx`；固定 Expo 兼容的 React 19.2.3/RN 0.86，不提交生成的 `ios/`/`android/`
- [x] T008 在根 `package.json` 与 `scripts/check-remote-control-boundaries.mjs` 中增加 mobile/Relay 独立脚本和远控依赖边界检查入口，并在 `scripts/check-remote-control-boundaries.test.mjs` 固定允许/禁止的包图；验证 `pnpm-workspace.yaml` 现有 glob 已覆盖全部新目录

**Checkpoint**: 新目录、包名、配置和检查入口已经存在；尚未声称任何远控业务可用。

---

## Phase 2: Foundational（所有用户故事的阻塞基础）

**Purpose**: 先完成封闭协议、输出预算、认证状态机、存储端口和 E2EE 阻塞门；任何会话内容都不得在本阶段安全门通过前接入 Relay。

**⚠️ CRITICAL**: T017 的 E2EE 结论是硬门。若 Node↔Expo/React Native 互操作或安全审查失败，停止后续用户故事，不得自动降级为 TLS-only。

- [x] T009 在 `packages/contracts/remote-control-contracts/tests/protocol-codecs.test.ts` 先写失败测试，覆盖版本、额外字段、非法 discriminant、ID/时间/cursor、JSON 深度、UTF-8 字节与有效有界错误
- [x] T010 [P] 在 `packages/contracts/remote-control-contracts/src/protocol.ts` 定义 v1 pairing、socket、sealed envelope、scope、command、result、projection、cursor、event、snapshot、push 和稳定错误的闭合 TS 类型
- [x] T011 [P] 在 `packages/contracts/remote-control-contracts/lib/bounds.ts` 与 `lib/canonical-json.ts` 实现 UTF-8 聚合预算、深度/数组限制、canonical command digest 输入和 ASCII ID 校验辅助逻辑
- [x] T012 在 `packages/contracts/remote-control-contracts/src/codecs.ts` 实现严格解析器与协议版本协商，消费 T010/T011 并使 T009 通过；禁止 `{method:string,payload:unknown}` 或任何 catch-all 转发结构
- [x] T013 在 `packages/contracts/remote-control-contracts/src/index.ts` 和 `package.json` exports 完成按 `protocol`、`codecs`、`crypto` 的公开入口，并在双语 README 记录所有预算与明确排除的工具箱/终端/文件/浏览器/扩展/模型设置能力
- [x] T014 [P] 在 `packages/contracts/remote-control-contracts/tests/hpke-vectors.test.ts` 先写 RFC 9180 known-answer、错误 key、AAD/header/ciphertext/keyId 篡改、expiry 和 key rotation 失败测试
- [x] T015 [P] 在 `apps/mobile/tests/hpke-interop.test.ts` 与 `apps/mobile/src/platform/crypto.ts` 建立不依赖 Expo Go 的 Node→React Native、React Native→Node 互操作 harness，并先固定双向失败断言和 production bundle 可加载断言
- [x] T016 使用 pnpm 安装通过审查的 HPKE 候选并在 `packages/contracts/remote-control-contracts/src/crypto.ts` 实现 RFC 9180 authenticated-mode sealed envelope；锁定无 GHSA-73g8-5h73-26h4 风险的版本，使 T014/T015 通过且不引入不安全 WebCrypto polyfill
- [x] T017 把 HPKE 依赖版本、维护/审计状态、供应链检查、RFC 向量、Node↔Expo 双向结果和是否允许继续实施记录到 `specs/013-mobile-remote-control/validation.md`；只有结论为 PASS 才能解锁 T027 之后任务，失败则记录 BLOCKED 并停止
- [x] T018 [P] 在 `packages/transport/remote-control-client/tests/connection-state.test.ts` 先写认证首帧、五秒超时、凭据不进 URL、协议不兼容、full-jitter backoff 与 1 MiB/10 秒背压的状态机测试
- [x] T019 [P] 在 `packages/transport/remote-control-client/src/ports.ts` 和 `src/types.ts` 定义 fetch/socket/clock/random/projection-store/lifecycle/notification 结构端口与 `signed-out` 到 `ready/reconnecting/suspended/incompatible/revoked` 状态
- [x] T020 在 `packages/transport/remote-control-client/src/client.ts`、`src/connection.ts` 和 `lib/backoff.ts` 实现首帧认证、严格解码、连接生命周期与注入式 backoff，使 T018 通过且包内无 Expo/React/SQLite/SecureStore/Pi 依赖
- [x] T021 [P] 在 `packages/server/remote-control-relay-server/tests/security-boundary.test.ts` 先写 principal 绑定、scope、revocation、ticket 一次性、pre-auth 帧、版本、速率/大小、脱敏错误与无会话正文持久化测试
- [x] T022 [P] 在 `packages/server/remote-control-relay-server/src/ports.ts`、`src/errors.ts`、`lib/redaction.ts` 和 `lib/limits.ts` 定义身份、事务存储、推送、审计、连接、时间端口及有界脱敏策略
- [x] T023 [P] 在 `apps/remote-control-relay/src/configuration.ts` 和 `apps/remote-control-relay/tests/configuration.test.ts` 实现 OIDC、PostgreSQL、TLS/trusted-proxy、push、限额、健康检查配置解析；缺少生产 secret 或错误 proxy 配置时 fail closed
- [x] T024 在 `apps/remote-control-relay/src/migrations/001_remote_security_metadata.sql` 创建 account reference、machine、mobile device、device authorization、public key、ticket 和 security audit 基础表；禁止 conversation/message/tool/snapshot/session-event 表
- [x] T025 在 `apps/remote-control-relay/src/providers/postgres-store.ts` 与 `apps/remote-control-relay/tests/postgres-store.test.ts` 实现 T024 的事务 adapter、schema version、迁移锁、账号隔离和 mode-safe secret/token 加密字段
- [x] T026 在 `packages/client/i18n/package.json`、`packages/client/i18n/tests/runtime.test.ts` 与 `apps/mobile/tests/dependency-resolution.test.ts` 将共享 i18n React peer 调整为 `>=19.2.0 <20`，验证 Web/Desktop 现状不回退且 mobile 只解析一份 Expo 兼容 React

**Checkpoint**: 合同、客户端/服务端基础端口和 E2EE 门完成；只在 T017 PASS 后进入用户故事。

---

## Phase 3: User Story 1 — 配对并查看电脑会话（Priority: P1）🎯 MVP

**Goal**: 用户能够通过短时一次性 QR 或手动码配对电脑，看到电脑状态和活动会话列表，并可单独撤销手机。

**Independent Test**: 使用真实 Relay/desktop bridge 的非 UI harness 配对一台手机，列出在线电脑及其活动会话；断开电脑后返回带 `lastSeenAt` 的 stale 列表；撤销该手机后新读请求在一分钟内失败，其他设备仍可用。

### Tests for User Story 1

- [x] T027 [P] [US1] 在 `packages/contracts/remote-control-contracts/tests/pairing.test.ts` 先写 QR/手动 payload、两分钟默认/五分钟硬上限、transcript/safety code、账号/key 替换、重复/并发/过期/拒绝的合同失败测试
- [x] T028 [P] [US1] 在 `packages/server/remote-control-relay-server/tests/pairing-service.test.ts` 先写 invitation 原子消费、同账号 claim、电脑确认、独立 device authorization、撤销传播和安全审计测试
- [x] T029 [P] [US1] 在 `packages/pi-runtime/pi-runtime-remote-control/tests/session-catalog-projection.test.ts` 先写 session/workspace 投影测试，证明 cwd/rootPath、工具参数/结果、附件、unknown projection 和本机 token 不会进入手机列表
- [x] T030 [P] [US1] 在 `apps/desktop-electron/test/remote-control-lifecycle.test.cjs` 先写 machine credential/private key 只经 fail-closed `safeStorage`、RuntimeConnection 不进 renderer/argv/env/log、bridge 单实例及 Runtime 重启换代测试
- [x] T031 [P] [US1] 在 `packages/transport/remote-control-client/tests/pairing-state.test.ts` 和 `apps/mobile/tests/installation-state.test.ts` 先写登录、QR/手动 claim、等待电脑确认、撤销、iOS 安装 sentinel 清理与 stale catalog 状态测试

### Implementation for User Story 1

- [x] T032 [P] [US1] 在 `packages/server/remote-control-relay-server/src/pairing-service.ts` 实现 desktop-created invitation、secret verifier、authenticated phone claim、canonical transcript、安全码和电脑最终确认，满足 T027/T028
- [x] T033 [P] [US1] 在 `packages/server/remote-control-relay-server/src/device-service.ts` 实现 mobile device/device authorization 的列表、双重账号机器绑定、独立 revoke、revision 与无内容安全审计
- [x] T034 [US1] 在 `packages/server/remote-control-relay-server/src/http-api.ts` 暴露 `/pairings`、claim、confirm、`/devices`、revoke 和 `/machines` 的严格有界 handler，并由 T032/T033 服务驱动
- [x] T035 [US1] 在 `packages/server/remote-control-relay-server/src/socket-service.ts` 实现手机/电脑单次 ticket、五秒/16 KiB 首帧认证、协议协商、fenced machine lease 和 online/offline/reconnecting/incompatible presence
- [x] T036 [US1] 在 `apps/remote-control-relay/src/providers/oidc.ts`、`src/providers/websocket.ts` 和 `src/main.ts` 装配身份校验、HTTP/WSS、PostgreSQL store、优雅停机与健康/就绪检查，不加入会话内容存储
- [x] T037 [P] [US1] 在 `packages/pi-runtime/pi-runtime-remote-control/src/pairing.ts`、`src/device-authorizations.ts` 和 `src/relay-connection.ts` 实现 desktop invitation、paired key/scope registry、独立撤销和带 lease 的出站 Relay 连接
- [x] T038 [US1] 在 `packages/pi-runtime/pi-runtime-remote-control/src/session-catalog.ts` 与 `lib/session-sanitizer.ts` 使用公开 Pi RPC/workspace API 生成最多 100 项/192 KiB 的活动会话投影，只暴露 opaque workspaceId/displayName
- [x] T039 [US1] 在 `packages/pi-runtime/pi-runtime-remote-control/src/bridge.ts` 和 `src/index.ts` 组合配对、设备授权、presence 与 session catalog；对每次读取再次检查 account/machine/device/scope/revocation
- [x] T040 [US1] 在 `apps/desktop-electron/src/desktop-services.cjs` 和 `src/main.cjs` 注入 `safeStorage` credential/key port，并在获取当前 `RuntimeConnection` 后创建/销毁唯一 bridge generation；保持 Runtime 只监听 loopback
- [x] T041 [US1] 在 `apps/desktop-electron/src/desktop-renderer-protocol.cjs`、`src/preload.cjs` 和 `packages/client/services-client/src/host.ts` 增加仅供本机 renderer 使用的创建/确认/取消配对、列出/撤销设备 API；不得返回 machine credential、private key 或 sidecar token
- [x] T042 [US1] 在 `packages/client/ui-settings-general/src/remote-device-settings-item.tsx` 和 `src/general-settings-contribution.ts` 添加桌面端 QR、安全码确认、设备列表和 revoke 控件，复用现有共享控件/token，不创建远程会话 UI
- [x] T043 [P] [US1] 在 `apps/mobile/src/platform/secure-store.ts`、`src/platform/sqlite.ts` 和 `src/state/installation.ts` 实现分离凭据/key、installation sentinel、WAL/migration/bound params 及 logout/revoke 清理
- [x] T044 [US1] 在 `apps/mobile/src/features/auth.ts`、`src/features/pairing.ts` 和 `src/app/pair.tsx` 实现系统浏览器 Authorization Code + PKCE、QR 扫描、手动码、safety code 和等待 desktop confirmation 状态
- [x] T045 [US1] 在 `apps/mobile/src/features/machines.ts`、`src/features/session-catalog.ts`、`src/app/index.tsx` 和 `src/app/machines/[machineId]/sessions/index.tsx` 实现授权电脑状态、最近活动排序、活动会话列表、offline stale 标记和 mutation 禁用
- [x] T046 [P] [US1] 在 `packages/client/ui-settings-general/src/i18n/en-US.ts`、`src/i18n/zh-CN.ts`、`apps/mobile/src/i18n/en-US.ts`、`apps/mobile/src/i18n/zh-CN.ts` 和 `apps/mobile/src/i18n/index.ts` 添加 US1 全部可见/aria/错误文案并保持 key/插值一致
- [x] T047 [US1] 在 `apps/remote-control-relay/tests/pair-list-revoke.integration.test.ts` 运行配对→session list→offline stale→revoke 的非 UI 集成路径，并把 SC-001/SC-002/SC-008、失败路径和未执行真机 QR 检查记录到 `specs/013-mobile-remote-control/validation.md`

**Checkpoint**: US1 可在非 UI 集成 harness 中独立配对、查看 session catalog、识别离线和撤销；这是建议的第一阶段 MVP。

---

## Phase 4: User Story 2 — 查看并控制一个会话（Priority: P1）

**Goal**: 已授权手机可读取有界对话、发送纯文本、停止运行和回答普通问题；工具活动只显示非交互摘要。

**Independent Test**: 使用预配对 authorization fixture 打开一个会话、分页读取历史、发送一次文本并观察同一 run、停止运行、回答普通问题；重复/断连提交不产生第二次副作用，敏感工具审批和原始工具内容始终不可达。

### Tests for User Story 2

- [x] T048 [P] [US2] 在 `packages/contracts/remote-control-contracts/tests/conversation-operations.test.ts` 先写 bounded history、text-only send、stop、普通 question answer 和所有 toolbox/file/terminal/browser/tool approval/raw RPC 变体不存在或解析失败的合同测试
- [x] T049 [P] [US2] 在 `packages/pi-runtime/pi-runtime-remote-control/tests/conversation-sanitizer.test.ts` 先写 hostile Pi fixture，覆盖 path、file source、attachment、tool args/result、reasoning、raw error、unknown host event 与超大多字节内容脱敏/分页
- [x] T050 [P] [US2] 在 `packages/pi-runtime/pi-runtime-remote-control/tests/operation-ledger.test.ts` 先写 intent 前/后、domain effect 后/result 前四个 crash cut、same-ID same-digest、ID conflict、七天/10,000 保留和 incomplete 不逐出测试
- [x] T051 [P] [US2] 在 `packages/transport/remote-control-client/tests/conversation-state.test.ts` 先写 history pagination、stream delta、accepted/terminal/appliedCursor、outcome-unknown 和离线只保留 draft 不自动发送测试
- [x] T052 [P] [US2] 在 `packages/server/remote-control-relay-server/tests/sealed-routing.test.ts` 先写 E2EE opaque routing、current lease、device scope、expiry、delivery ack 非 domain result 和 Relay 无法读取/持久化正文测试

### Implementation for User Story 2

- [x] T053 [P] [US2] 在 `packages/pi-runtime/pi-runtime-remote-control/src/conversation-projection.ts` 与 `lib/conversation-sanitizer.ts` 实现 50 项/192 KiB history page、16 KiB delta、2 KiB activity summary 和普通 question 投影，使 T049 通过
- [x] T054 [P] [US2] 在 `packages/pi-runtime/pi-runtime-remote-control/src/operation-ledger.ts` 与 `src/sqlite-ledger.ts` 实现 mode-0600 Node SQLite schema、canonical digest、事务 intent/result、retention 和 startup reconciliation，使 T050 通过
- [x] T055 [US2] 在 `packages/pi-runtime/pi-rpc-contracts/src/rpc.ts`、`packages/pi-sdk/pi-sdk-sessions/src/session-rpc-service.ts`、`packages/pi-sdk/pi-sdk-sessions/src/session-event-journal.ts` 和 `packages/pi-runtime/pi-runtime-server/tests/sessions/session-rpc-service.test.ts` 增加向后兼容的 client mutation/message identity 持久去重，证明 bridge 崩溃后同一 send 不会再次触发 prompt
- [x] T056 [US2] 在 `packages/pi-runtime/pi-runtime-remote-control/src/command-adapter.ts` 实现 read history、send single text block、stop 和 pending ordinary-question answer 的 exhaustive mapping；禁止 attachment/composer command/tool approval fallback
- [x] T057 [US2] 在 `packages/pi-runtime/pi-runtime-remote-control/src/operation-service.ts` 组合 ledger、授权、expiry、interaction revision、local command 和 sealed accepted/terminal result，并在同一 ID 重试时返回原结果
- [x] T058 [P] [US2] 在 `packages/server/remote-control-relay-server/src/sealed-router.ts` 和 `lib/pending-delivery.ts` 实现当前 lease 下的有界密文路由、receipt、expiry、rate limit 与无 durable payload cache，使 T052 通过
- [x] T059 [US2] 在 `packages/transport/remote-control-client/src/conversation.ts`、`src/operations.ts` 和 `lib/bounded-pages.ts` 实现 history/delta reducer、operation persistence/status recovery 与 appliedCursor 协调，使 T051 通过
- [x] T060 [P] [US2] 在 `apps/mobile/src/platform/sqlite.ts` 和 `src/state/conversation-store.ts` 增加 bounded/LRU conversation、pending operation 与 draft schema，凭据和原始工具 payload 禁止入库
- [x] T061 [US2] 在 `apps/mobile/src/features/conversation.ts` 和 `src/app/machines/[machineId]/sessions/[sessionId].tsx` 实现有界 history、assistant streaming、run state、普通 question 和 generic activity summary 页面
- [x] T062 [US2] 在 `apps/mobile/src/components/text-composer.tsx`、`src/components/run-controls.tsx` 和 `src/components/ordinary-question.tsx` 实现纯文本发送、stop 与普通回答；offline/unknown outcome 时保留 draft 并禁止隐式重发
- [x] T063 [US2] 在 `apps/mobile/src/state/remote-session.ts` 将 operation accepted、terminal result、appliedCursor、revision conflict、stale 和 reconnect 状态连接到会话页面，确保 optimistic 状态不覆盖权威结果
- [x] T064 [P] [US2] 在 `apps/mobile/src/i18n/en-US.ts` 和 `apps/mobile/src/i18n/zh-CN.ts` 添加 history、run、send、stop、普通问题、桌面查看工具详情、outcome-unknown 与 retry 文案并校验插值一致
- [x] T065 [US2] 在 `apps/remote-control-relay/tests/conversation-control.integration.test.ts` 验证 read→send→stream→stop→ordinary answer、重复 send、Relay 读不到 plaintext 和敏感 approval 被拒绝的非 UI 端到端流程
- [x] T066 [US2] 将 US2 聚焦测试、SC-003/SC-007、四个 crash cut、UTF-8/大单行预算和未执行真机会话 UI 风险写入 `specs/013-mobile-remote-control/validation.md`，所有对应命令通过后再勾选本阶段

**Checkpoint**: US2 可使用预配对 fixture 独立读取并控制一个会话，且发送操作在崩溃/重试下不重复。

---

## Phase 5: User Story 3 — 管理多个会话（Priority: P2）

**Goal**: 手机可创建、切换、重命名、置顶/取消置顶和归档会话，并保留每个会话独立的 draft/read/unread/run 状态。

**Independent Test**: 使用预配对电脑创建两个会话，切换并保存不同草稿，重命名/置顶一个、归档另一个；重复请求与两手机 revision conflict 后仍与电脑权威状态一致，活动列表不显示归档会话且手机无恢复/删除入口。

### Tests for User Story 3

- [x] T067 [P] [US3] 在 `packages/contracts/remote-control-contracts/tests/session-management.test.ts` 先写 create/rename/setPinned/setArchived(true)、known workspaceId、title bytes、entity revision 与 unarchive/delete/cwd/path 解析拒绝测试
- [x] T068 [P] [US3] 在 `packages/pi-runtime/pi-runtime-remote-control/tests/session-management.test.ts` 先写 public Pi API 映射、固定 create identity、set-to-value 重放、revision conflict 和 archived filter 测试
- [x] T069 [P] [US3] 在 `packages/transport/remote-control-client/tests/multi-session-state.test.ts` 先写 200 summaries 排序/切换、每 session draft/read/unread/run 隔离、mutation pending/reconcile 和一秒 reducer 预算测试
- [x] T070 [P] [US3] 在 `apps/mobile/tests/session-cache.test.ts` 先写 draft/read marker 的 SQLite round-trip、LRU、snapshot 保留本地 draft、logout/revoke 清除和不会自动提交测试

### Implementation for User Story 3

- [x] T071 [P] [US3] 在 `packages/pi-runtime/pi-runtime-remote-control/src/workspace-projection.ts` 生成手机可选的 opaque workspaceId/displayName catalog，删除 rootPath/cwd 并为默认 workspace 提供明确标记
- [x] T072 [US3] 在 `packages/pi-runtime/pi-runtime-remote-control/src/command-adapter.ts` 增加 create、rename、setPinned 和 setArchived(true) 的 public Pi/workspace API 映射；不存在 unarchive/delete/toggle 或任意 path 分支
- [x] T073 [US3] 在 `packages/pi-runtime/pi-runtime-remote-control/src/operation-service.ts` 增加固定 requestedSessionId、set-to-value reconciliation、entity revision conflict 和 appliedCursor result，使 T068 通过
- [x] T074 [US3] 在 `packages/transport/remote-control-client/src/session-management.ts` 实现 create/open/rename/pin/archive operation、稳定 recent/pinned 排序与 conflict 后权威替换，使 T069 通过
- [x] T075 [P] [US3] 在 `apps/mobile/src/state/session-store.ts` 和 `apps/mobile/src/platform/sqlite.ts` 实现 `(machineId,sessionId)` draft/read/unread/run 隔离、200 项 bounded catalog 与 LRU retention，使 T070 通过
- [x] T076 [US3] 在 `apps/mobile/src/features/session-catalog.ts` 和 `src/app/machines/[machineId]/sessions/index.tsx` 添加 create、快速切换、pinned 分组、recent order、unread/run 指示和新建后按权威 ID 打开
- [x] T077 [US3] 在 `apps/mobile/src/components/session-actions.tsx` 实现 rename、pin/unpin、archive 和 revision conflict 状态；不渲染 restore/delete/toolbox 菜单项
- [x] T078 [US3] 在 `apps/mobile/src/state/remote-session.ts` 连接跨会话 draft/read/unread/run 与 navigation lifecycle，确保切换或 snapshot 不覆盖未发送 draft
- [x] T079 [P] [US3] 在 `apps/mobile/src/i18n/en-US.ts` 和 `apps/mobile/src/i18n/zh-CN.ts` 添加 create/switch/rename/pin/unpin/archive/conflict/unread 文案和 accessibility label 并保持 key parity
- [x] T080 [US3] 在 `apps/remote-control-relay/tests/multi-session-management.integration.test.ts` 验证两个会话、重复 mutation、两手机 conflict、归档过滤和 200-session profile，并把 SC-005 及未执行真机交互预算写入 `specs/013-mobile-remote-control/validation.md`

**Checkpoint**: US3 可独立管理多个会话，且所有组织操作均为幂等 set-to-value；手机仍无归档恢复或删除能力。

---

## Phase 6: User Story 4 — 接收可操作通知（Priority: P2）

**Goal**: App 不活跃时，仅为完成、失败或需要普通输入发送隐私安全通知；点击后打开目标并进行权威同步。

**Independent Test**: 使用预配对设备把 app lifecycle 置为 background，依次产生 eligible transition；每个 transition 最多一个 generic hint，payload 无标题/正文/代码/路径/工具/错误详情，duplicate/drop/out-of-order 只触发 `needsSync`，点击后同步正确 session。

### Tests for User Story 4

- [x] T081 [P] [US4] 在 `packages/contracts/remote-control-contracts/tests/push-hint.test.ts` 先写仅 version/hintId/machineId/sessionId/kind 可用、额外敏感字段和超 4 KiB payload 被拒绝的合同测试
- [x] T082 [P] [US4] 在 `packages/server/remote-control-relay-server/tests/notification-service.test.ts` 先写 registration rotation、transition dedupe/collapse、ticket/receipt、DeviceNotRegistered、revoked device 和日志无 token/content 测试
- [x] T083 [P] [US4] 在 `packages/transport/remote-control-client/tests/notification-state.test.ts` 先写 duplicate/drop/out-of-order hint、permission denied、notification tap route 与只设置 `needsSync` 不改变权威状态测试

### Implementation for User Story 4

- [x] T084 [P] [US4] 在 `apps/remote-control-relay/src/migrations/002_notification_registrations.sql` 和 `src/providers/postgres-store.ts` 增加 encrypted provider token、environment、revision、receipt health 与 active/invalid/revoked 状态
- [x] T085 [US4] 在 `packages/server/remote-control-relay-server/src/notification-service.ts` 和 `src/http-api.ts` 实现注册/删除、eligible transition dedupe、generic push intent 与 revoked/invalid token 停发，使 T082 通过
- [x] T086 [US4] 在 `apps/remote-control-relay/src/providers/expo-push.ts` 实现 Expo Push tickets/receipts、collapse key、`DeviceNotRegistered` 失效处理；provider port 保留未来 native APNs/FCM token 路径
- [x] T087 [P] [US4] 在 `packages/pi-runtime/pi-runtime-remote-control/src/notification-intents.ts` 从权威 run/ordinary-input transition 产生 content-free completion/failure/input-needed intent，抑制 streaming/tool routine 更新
- [x] T088 [US4] 在 `apps/mobile/src/platform/notifications.ts` 和 `src/state/notification-state.ts` 实现 permission/registration/rotation、响应 listener、hint dedupe 和 `needsSync`，不把 push 当事件日志
- [x] T089 [US4] 在 `apps/mobile/src/app/_layout.tsx` 与 `src/app/+native-intent.tsx` 将通知中的 opaque machine/session ID 规范化到内部路由，并在显示前完成 account/device/machine/session 授权与同步
- [x] T090 [US4] 在 `apps/mobile/src/features/notification-preferences.ts` 添加 opt-in/denied/retry 状态；权限拒绝不阻止前台控制，不提供锁屏敏感内容预览开关
- [x] T091 [P] [US4] 在 `apps/mobile/src/i18n/en-US.ts`、`apps/mobile/src/i18n/zh-CN.ts`、`apps/desktop-electron/src/i18n/en-US.cjs` 和 `src/i18n/zh-CN.cjs` 添加 generic completion/failure/input-needed、permission 和 revoked registration 文案
- [x] T092 [US4] 在 `apps/remote-control-relay/tests/notifications.integration.test.ts` 验证 background transition→push hint→tap→authoritative sync、重复/丢失/乱序和 privacy scan，并把 SC-006 与未执行 iOS/Doze 真机门写入 `specs/013-mobile-remote-control/validation.md`

**Checkpoint**: US4 可独立证明通知是隐私安全提示而非状态同步；OS 交付延迟不被伪装成应用保证。

---

## Phase 7: User Story 5 — 网络变化后的安全恢复（Priority: P3）

**Goal**: 手机在 Wi-Fi/蜂窝、前后台、断连、电脑/Runtime 重启和不确定操作结果后，无重复副作用地恢复权威状态。

**Independent Test**: 使用预配对 fixture 在 send 已受理但 ack 前断线，切换网络并重启 Runtime；手机用同一 operationId 恢复结果，检测 epoch 变化并事务应用 snapshot，五秒内收敛且没有第二条 prompt；离线新操作始终需要用户重新确认。

### Tests for User Story 5

- [x] T093 [P] [US5] 在 `packages/contracts/remote-control-contracts/tests/synchronization.test.ts` 先写 decimal uint64 cursor、duplicate/exact-next/gap/epoch、snapshot chunks/complete、cursor_expired 和 snapshot_required 合同测试
- [x] T094 [P] [US5] 在 `packages/pi-runtime/pi-runtime-remote-control/tests/replay-snapshot.test.ts` 先写 10,000 events/10 MiB/15 min 淘汰、snapshot 并发缓冲、overflow、Runtime restart 新 epoch、old lease fencing 和 appliedCursor 测试
- [x] T095 [P] [US5] 在 `packages/transport/remote-control-client/tests/recovery.test.ts` 先写 reconnect hello、full-jitter 1–30 秒、duplicate/gap/epoch、snapshot fallback、unresolved operations 和 AppState suspend/resume 测试
- [x] T096 [P] [US5] 在 `apps/mobile/tests/projection-store.test.ts` 先写 snapshot+cursor 单事务、失败回滚、stale flag、cache replacement 保留 draft、中文/emoji/长单行和 storage failure 测试
- [x] T097 [P] [US5] 在 `packages/server/remote-control-relay-server/tests/backpressure-lease.test.ts` 先写 1 MiB/10 秒 slow consumer、旧 lease、offline immediate reject、command expiry 和无界队列不存在测试

### Implementation for User Story 5

- [x] T098 [P] [US5] 在 `packages/pi-runtime/pi-runtime-remote-control/src/projection.ts` 与 `lib/event-ring.ts` 实现原子 mobile-safe projection、epoch/offset、三重 replay retention、contiguous event 和 Runtime generation reset，使 T094 通过
- [x] T099 [US5] 在 `packages/pi-runtime/pi-runtime-remote-control/src/snapshot-service.ts` 实现先取 baseCursor、并发事件缓冲、bounded chunk、complete、overflow→snapshot_required 和随后 replay
- [x] T100 [P] [US5] 在 `packages/transport/remote-control-client/src/synchronization.ts`、`src/recovery.ts` 和 `src/cursor.ts` 实现 exact-next reducer、gap/epoch stop、replay/snapshot 协商、unresolved operation status 与 appliedCursor 收敛，使 T095 通过
- [x] T101 [US5] 在 `apps/mobile/src/platform/app-state.ts`、`src/platform/network.ts` 和 `src/state/remote-client.ts` 实现 active-only WSS、background 停 heartbeat/reconnect、foreground/network/push 一次即时恢复和 capped full-jitter backoff
- [x] T102 [US5] 在 `apps/mobile/src/platform/sqlite.ts` 和 `src/state/projection-store.ts` 实现 snapshot+baseCursor 事务替换、contiguous batch、失败回滚、stale cache 和 bounded retention，使 T096 通过
- [x] T103 [US5] 在 `apps/mobile/src/components/connection-status.tsx`、`src/features/machines.ts` 和 `src/features/conversation.ts` 显示 offline/reconnecting/resyncing/incompatible/stale/outcome-checking，并在非 ready 状态禁用 mutation 但保留 draft
- [x] T104 [US5] 在 `packages/transport/remote-control-client/src/operations.ts` 和 `apps/mobile/src/state/remote-session.ts` 实现 timeout 后同 operationId status recovery、not-found 后显式用户重试和 expired 操作绝不自动重发
- [x] T105 [US5] 在 `packages/server/remote-control-relay-server/src/socket-service.ts`、`src/sealed-router.ts` 和 `lib/pending-delivery.ts` 完成 slow-consumer close、lease generation fencing、desktop offline immediate rejection 与 per-command expiry，使 T097 通过
- [x] T106 [US5] 在 `apps/remote-control-relay/tests/network-recovery.integration.test.ts` 注入 ack 丢失、网络切换、desktop lease 更替和 Runtime restart，验证同一 prompt 不重复、snapshot 后五秒内收敛和 stale mutation 被阻止
- [x] T107 [P] [US5] 在 `packages/transport/remote-control-client/tests/performance.test.ts` 建立 200 sessions、10,000 events、bounded history 和 multibyte payload 的确定性性能/内存基准，记录 reference profile 而不运行 UI
- [x] T108 [US5] 将 T093–T107 结果、SC-004、replay/snapshot 容量、恢复耗时和未执行真实 Wi-Fi/蜂窝/AppState 设备门写入 `specs/013-mobile-remote-control/validation.md`

**Checkpoint**: US5 可在确定性非 UI harness 中证明断线、重试和 Runtime 重启后的 at-most-once effect 与权威收敛。

---

## Phase 8: Polish & Cross-Cutting Concerns（收口）

**Purpose**: 横切安全、包边界、i18n、性能、文档与构建收口；不新增产品范围。

- [x] T109 [P] 在 `scripts/remote-control-privacy-audit.test.mjs` 添加对 Relay schema/log fixtures/push/errors、desktop projection 和 mobile cache 的敏感字段扫描，覆盖 prompt/title/path/answer/token/key/tool args/result/ciphertext body 泄露
- [x] T110 [P] 在 `scripts/check-remote-control-boundaries.mjs` 与 `scripts/check-remote-control-boundaries.test.mjs` 完成依赖/源码规则：mobile 禁止桌面 UI/Shell/Pi/Runtime/toolbox，Relay 禁止 Pi，contracts 禁止 React/Node，bridge 禁止 app/private StreamHub，所有包禁止 deep import/cycle
- [x] T111 [P] 在 `apps/remote-control-relay/tests/security-regression.integration.test.ts` 汇总 pairing race、credential audience/scope/rotation、ticket/DPoP replay、revocation active-socket、E2EE tamper、rate/size/depth 和 credential-free audit 回归
- [x] T112 [P] 在 `apps/mobile/tests/i18n-parity.test.ts` 和 `packages/client/ui-settings-general/tests/i18n-parity.test.ts` 验证 `en-US`/`zh-CN` key 与插值一致、`en-US` 最终 fallback、错误码映射完整且用户内容/ID/路径不翻译
- [x] T113 在 `specs/013-mobile-remote-control/validation.md` 完成手机与桌面新增 UI 的静态审查：共享控件/token、浅/深色、密度、圆角、Dynamic Type、安全区、reduced motion、touch target、aria/accessibility 文案；明确不启动 UI 测试或交互冒烟
- [x] T114 [P] 更新 `packages/contracts/remote-control-contracts/README.md`、`README.zh-CN.md`、`packages/transport/remote-control-client/README.md`、`README.zh-CN.md`、`packages/server/remote-control-relay-server/README.md`、`README.zh-CN.md`、`packages/pi-runtime/pi-runtime-remote-control/README.md` 和 `README.zh-CN.md`，记录 owner、公开入口、预算、生命周期、禁用能力和验证方法
- [x] T115 在 `apps/mobile/package.json`、`apps/remote-control-relay/package.json` 和根 `package.json` 固化 `expo:check`、`doctor`、`export`、本地 Android release、Relay build/migrate 与 remote focused test 脚本；不把 mobile/Relay 隐式塞进既有 desktop `pnpm build`
- [x] T116 在 `specs/013-mobile-remote-control/validation.md` 记录 `pnpm install --frozen-lockfile`、mobile Expo dependency check/Doctor、单 React/RN 解析和 lockfile 安全审查；使用 `pnpm-lock.yaml`，不得生成 `package-lock.json` 或 yarn lock
- [x] T117 在 `specs/013-mobile-remote-control/validation.md` 记录四个新包、Relay app、mobile 纯逻辑、Pi session idempotency、Electron lifecycle 和全部远控 integration 的精确非 UI 测试命令与结果；不运行 UI/DOM/Hook 测试
- [x] T118 在 `specs/013-mobile-remote-control/validation.md` 记录 mobile production export、本地 Android release compile、Relay production build/migration dry-run 和 Electron packaged build；EAS/iOS 仅配置并列为未执行外部构建门，不上传源码或制品
- [x] T119 在 `specs/013-mobile-remote-control/validation.md` 记录 `pnpm lint`、`pnpm format`、`pnpm check:workspace-dependencies`、`pnpm check:package-structure`、`pnpm typecheck`、`pnpm build` 结果及任何与用户既有脏工作树无关的基线失败
- [x] T120 对照 `specs/013-mobile-remote-control/spec.md`、`plan.md`、`data-model.md`、`contracts/` 和 `quickstart.md` 完成最终范围/合同/实现一致性审查，在 `specs/013-mobile-remote-control/validation.md` 逐项映射 FR-001–FR-024、SC-001–SC-009，并列出所有未执行真机/UI/release gate；仅在无未解释失败时标记任务完成

**Checkpoint**: 所有选择的用户故事及横切验证有可追溯证据；未授权的发布、部署、EAS 上传和 UI 测试均未执行。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 — Setup (T001–T008)**: 无前置；T002–T007 可并行，T008 在包/app 目录存在后收口脚本。
- **Phase 2 — Foundational (T009–T026)**: 依赖 Phase 1；T017 是所有用户故事的 E2EE 阻塞门。T024→T025 串行，T009→T012→T013 串行，其他标记 `[P]` 的测试/端口工作可按文件并行。
- **Phase 3 — US1 (T027–T047)**: 依赖 Phase 2 且 T017 PASS；提供推荐 MVP。测试 T027–T031 先失败，随后 Relay、desktop、mobile 三条实现线可并行，最终汇合到 T047。
- **Phase 4 — US2 (T048–T066)**: 依赖 Phase 2 且 T017 PASS；可用预配对 fixture 独立开发，不要求 US1 UI 完成。T055 的权威 send identity 是 T056/T057/T065 的硬前置。
- **Phase 5 — US3 (T067–T080)**: 依赖 Phase 2 且 T017 PASS；可用预配对/session fixture 独立开发。产品集成顺序建议在 US2 后，以复用会话详情 navigation。
- **Phase 6 — US4 (T081–T092)**: 依赖 Phase 2 且 T017 PASS；可用 synthetic authoritative transitions 独立开发。完整产品体验依赖 US1 路由和至少一个会话状态生产者。
- **Phase 7 — US5 (T093–T108)**: 依赖 Phase 2 且 T017 PASS；可用 synthetic stream/operation fixture 独立开发。最终 T106 同时验证 US1/US2 的真实 bridge 生命周期和 send 幂等。
- **Phase 8 — Polish (T109–T120)**: 依赖计划纳入发布的全部用户故事；T109–T114 可先按不同文件并行，T115–T120 按脚本→安装→测试→构建→全局检查→一致性审查顺序完成。

### User Story Dependency Graph

```text
Setup
  └── Foundational + E2EE PASS
        ├── US1 Pair/List ───────────────┐
        ├── US2 Read/Control ────────────┼── Polish/Release Readiness
        ├── US3 Multi-session Manage ────┤
        ├── US4 Notifications ───────────┤
        └── US5 Recovery ────────────────┘
```

Story phases can be developed against fixtures after Foundation, but recommended product integration order is `US1 → US2 → US3 → US4 → US5` because it yields a usable paired shell first and layers control, organization, notification, then hard recovery.

### Entity and Contract Placement

- Account, DesktopMachine, MobileDevice, DeviceAuthorization and PairingInvitation are first realized in Foundation/US1 through T024–T045.
- RemoteSessionSummary and workspace projection begin in US1 through T029/T038/T045 and are extended for organization in US3.
- RemoteConversationPage/Item, RemoteInteraction and RemoteOperation are implemented in US2 through T048–T063.
- NotificationRegistration/PushHint are implemented in US4 through T081–T091.
- RemoteProjection/Cursor/Event and replay/snapshot recovery are completed in US5 through T093–T105.
- SecurityAuditEvent starts in Foundation/US1 and receives full cross-story coverage in T111/T120.

### Within Each User Story

1. 写入失败测试和 hostile fixtures。
2. 实现实体/存储/纯逻辑。
3. 实现服务与协议 handler。
4. 实现 desktop/mobile adapter 与页面。
5. 运行该故事的独立非 UI 集成路径。
6. 把精确命令、结果和未执行 gate 记录到 `validation.md` 后才勾选。

---

## Parallel Execution Examples

### US1 — Pair and inspect

```text
Wave 1: T027 + T028 + T029 + T030 + T031
Wave 2: T032/T033（Relay） + T037（desktop） + T043（mobile storage） + T046（i18n）
Wave 3: T034→T036, T038→T041, T044→T045
Join:   T042 + T047
```

### US2 — Follow and control

```text
Wave 1: T048 + T049 + T050 + T051 + T052
Wave 2: T053（projection） + T054（ledger） + T058（Relay） + T060（mobile storage） + T064（i18n）
Wave 3: T055 → T056 → T057; T059 → T061 → T063; T062 after T061
Join:   T065 → T066
```

### US3 — Multi-session management

```text
Wave 1: T067 + T068 + T069 + T070
Wave 2: T071（workspace projection） + T075（mobile store） + T079（i18n）
Wave 3: T072 → T073; T074; T076 → T078
Join:   T077 + T080
```

### US4 — Notifications

```text
Wave 1: T081 + T082 + T083
Wave 2: T084（migration） + T087（desktop intent） + T091（i18n）
Wave 3: T085 → T086; T088 → T090
Join:   T089 + T092
```

### US5 — Recovery

```text
Wave 1: T093 + T094 + T095 + T096 + T097
Wave 2: T098（desktop projection） + T100（client sync） + T107（benchmark harness）
Wave 3: T099; T101→T104; T102→T103; T105
Join:   T106 → T108
```

---

## Implementation Strategy

### MVP First: US1 only

1. 完成 Phase 1。
2. 完成 Phase 2，并确保 T017 E2EE 门为 PASS。
3. 完成 Phase 3（US1）。
4. 在 T047 停止并独立验证配对、电脑 presence、会话列表、offline stale 与 revoke。
5. 不部署、不发布；先由用户确认架构和 MVP 体验，再进入会话控制。

### Incremental Delivery

1. **US1**：安全配对和查看多会话，形成最小可用远程壳。
2. **US2**：加入对话阅读、文本发送、停止和普通问题回答。
3. **US3**：加入创建、切换、重命名、置顶和归档。
4. **US4**：加入隐私安全的后台通知提示。
5. **US5**：完成断线、重试、Runtime 重启和快照恢复硬化。
6. **Polish**：执行全局非 UI 验证并明确保留真机/发布 gate。

### Scope Stop Rules

- E2EE 门失败：停止，不自动改用 TLS-only。
- 无法在权威 session owner 中证明 send idempotency：停止 US2 send，不以 bridge 内存去重代替。
- 任一协议/投影出现 terminal、file、browser、tool approval、extension、model settings 或 raw Runtime fallback：任务失败，不以 UI 隐藏作为修复。工具输入和原始结果仅允许通过已实现的显式、有界、截断并加密的 `RemoteToolCallV1` / `tool-result` 投影传输。
- 需要外部部署、EAS 上传、商店签名或生产凭据：记录 gate 并请求单独授权，不在本任务清单内执行。
- UI/DOM/Hook 测试或 UI 交互冒烟：继续保持不新增、不运行，只做静态审查并记录真实设备 gate。

---

## Notes

- `[P]` 表示满足显式前置后可修改不同文件并行，不表示绕过 E2EE、测试先行或 story checkpoint。
- 所有输入/输出预算按 UTF-8 bytes 计算，一次结果的全部文本块和 details 共用预算。
- Relay 的 delivery acknowledgement 不是电脑执行结果；手机只信任 desktop-authenticated terminal result/contiguous projection。
- 任务不得修改现有稳定扩展 ID、本机 Runtime credential 语义或会话持久化格式，除 T055 明确的向后兼容 idempotency 扩展。
- 实施时每次编辑继续读取目标目录最近的 `AGENTS.md`；若使用 UI 样式或 Pi SDK 能力，按触发规则读取对应 skill。
- 完成标记必须附验证证据；基线或环境阻塞需要准确记录，不能把未执行项写成通过。

## Phase 10: Shared Conversation Presentation

- [x] T127 新增 `@workbench/ui-remote-conversation`，把封闭的 `RemoteConversationItemV1` 投影适配到电脑端共享的消息对、用户消息、Markdown、工具调用和折叠策略；普通问题与输入框继续由原生层负责
- [x] T128 用 `apps/mobile/src/components/remote-conversation.dom.tsx` 替换 React Native 消息/工具转录重写，并删除不再使用的 `activity-summary.tsx` 与 `tool-transcript.tsx`
- [x] T129 收紧远控边界检查：手机只允许从专用 DOM 入口导入 `@workbench/ui-remote-conversation`，继续拒绝其他桌面 UI、Shell、Runtime、扩展与工具箱入口
- [x] T130 完成共享包与 mobile 类型检查、纯转录模型测试、远控边界测试、Expo 依赖检查、包结构检查和 Android production export；不新增、不运行 UI/DOM/Hook 测试或交互冒烟
- [x] T131 修复 Expo SDK 57 DOM WebView 在属性注入与原生视图卸载竞态中的未处理 Promise：稳定 DOM 组件及其属性，并用锁定的 `@expo/dom-webview` pnpm 补丁只忽略已销毁视图错误；验证补丁可重装且 Android/DOM production export 通过
- [x] T132 修复共享对话 DOM bundle 混用移动端 React 19.2.3 与桌面 ReactDOM 19.2.8 导致的白屏：在 mobile Metro 解析器中强制 React、JSX runtime 与 ReactDOM client 使用应用内同版本入口，并验证开发 bundle 无 invalid-hook 崩溃且 Android/DOM production export 通过
- [x] T133 修复历史读取同时投影 `message_start` 与 `message_end` 导致的用户/AI 重复消息；手机初始化以权威最新页替换旧缓存，而不是把同一生命周期再次合并
- [x] T134 将远控历史切换到电脑端相同的 `piHistoryFromSessionEvents → piHistoryToThreadMessages → conversationNodesFromPiConversation` 标准节点管线，并让移动 DOM 直接挂载 `ConversationList`、`ConversationNodeSeat`、`WorkbenchMessage` 与共享工具块呈现；协议只传输经过白名单、有界处理的文本、推理、工具输入/原始结果和上下文组成摘要，实时生命周期事件触发标准历史回读
- [x] T135 补齐共享消息呈现所需的只读 `WorkbenchAgentRuntimeEnvironmentProvider`，并给电脑端 `WorkbenchMessagePresentation` 增加显式 `showFileChanges` 可选能力；移动远程扩展关闭依赖右侧工作区的文件变更入口，但继续复用相同的用户消息、AI 消息、工具、推理和上下文呈现

## Workbench 项目约定

遵循 `.specify/memory/constitution.md`：库包根 `packages/<领域>/<能力>`，`src` 为真实能力实现/契约/装配，`lib` 为有实际消费者的内部辅助源码，两处均最多一级子目录；能力与辅助源码保持 TS/TSX，跨包仅走公开 exports，生产依赖图无环，tests 位于包根。使用 pnpm；全部新用户文案提供 `en-US` 和 `zh-CN`；只在相关验证完成并记录后勾选任务。

## Phase 9: Convergence

- [x] T121 CRITICAL：在 `packages/contracts/remote-control-contracts/src/protocol.ts`、`src/codecs.ts`、协议文档与合同测试中增加严格、有界、端到端加密的 session catalog、conversation history、cursor replay/snapshot 和 operation-status 请求/响应控制合同，并确保 Relay 只见路由元数据，满足 FR-004、FR-005、FR-011（missing）
- [x] T122 CRITICAL：在 `packages/pi-runtime/pi-runtime-remote-control` 与 `apps/desktop-electron/src/desktop-remote-control.cjs` 把 HPKE 帧认证/解密、逐请求授权、operation ledger/service、Pi command adapter、event ring、snapshot/replay、结果重新加密和 Runtime generation 生命周期装配到正式 desktop Relay observer，满足 FR-004–FR-012、FR-019 与 plan: Desktop bridge（partial）
- [x] T123 CRITICAL：在 `apps/mobile/src/state/mobile-app.tsx` 及 app-local transport/platform adapter 中实现 mobile socket ticket/proof、无凭据 URL 的 active-only WSS、HPKE 请求/结果关联、cursor/operation recovery，并把真实 remote ports 注入 machine/session/conversation features，满足 FR-004–FR-013、FR-016、FR-019、FR-021 与 US1/US2/US3/US5（missing）
- [x] T124 在 `packages/pi-runtime/pi-runtime-remote-control`、`apps/desktop-electron` 和 Relay 通知入口中把权威 completed/failed/input-needed 状态变化连接到 content-free notification intent，并验证 active-app 抑制、去重和撤销复查，满足 FR-014 与 US4（partial）
- [x] T125 在 `apps/remote-control-relay/tests` 增加从正式 mobile transport、Relay WSS business-frame handler 和 Electron desktop frame processor 出发的非 UI 闭环集成测试，覆盖 pair/list/read/send/stop/manage/reconnect/snapshot/revoke，记录 SC-002–SC-004、SC-008 代理结果且不使用仅测试注入的远程 seam，满足 Phase E（partial）
- [x] T126 在 `apps/remote-control-relay/src/main.ts`、`packages/server/remote-control-relay-server/src/socket-service.ts` 及聚焦测试中验证正式 WSS 密文路由已按 account/machine/device/current lease 查找目标，只返回有界 receipt/error、记录无正文 audit 且不持久化帧内容，满足 FR-019、FR-022（partial）

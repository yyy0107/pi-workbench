# Spec008 implementation validation

## Baseline and setup

User authorized implementation after specification review. Baseline HEAD f95cc7379a42e30e9a1b03aa149e45d1f4c0af2b; initial packages unchanged. 2,623 source/config/document hashes captured in source-inventory.json. Existing six skill files remain unrelated modifications.

T001–T003 complete: requirements checklist 16/16; research/owners/contracts frozen; ignore files already cover dependencies/artifacts/env; no publishing. Installed Pi SDK 0.85.1 public declarations verified. No extensions.yml hooks for plan/tasks/implement. setup-plan/setup-tasks resolved Spec008. Missing update-agent-context.sh handled by a narrow AGENTS context note.

No UI, DOM, Hook-rendering, Browser or Electron interaction tests are authorized. Download picker/DOM fixtures migrate but remain excluded. No implementation task is complete until its relevant checks below pass.

## W1/W4 checkpoint

T004–T009 and T018–T021 complete: neutral catalog/browser/file reader contracts, concrete-type dependency removal, real catalog move to workspace-server and helper extraction, Pi event adapter and old export removal. Initial exact test baseline 24/24; migrated catalog/settings/protocol/adapter/source boundaries plus icon tests 32/32 PASS (/tmp/spec008-catalog-tests.log). Browser/protocol and five contract/service/ports package typechecks PASS. New test initially assumed create emitted one event; baseline implementation emits workspace-changed followed by order-changed, and the corrected assertion verifies both once in original order. No production behavior was changed to fit the test.

W2 T010 package/source extraction complete; integration and fixture checks remain tracked under T011/T012. File download DOM tests moved but excluded. W3 closure verification identified SDK root React re-export; added direct workspace-surfaces public entry to existing API declaration and narrowed runtime constants import. New capability closure checks now pass 9/9; structure reports 96 libraries with zero tracked migration violations.

Offline install encountered missing React metadata after peer graph updates; normal pnpm install --ignore-scripts completed, frozen offline validation remains a final task.

## W2/W3 integration checkpoint

T011–T017 complete. All icon/save and workspace UI imports migrated; explicit asset provider installed in ui-layout; old exports and source copies removed. Existing UI fixtures moved or imports updated without execution. Workspace-runtime now contains only TS headless state, controller, persistence, draft, feedback, installation and directory projection; new ui-workspace owns React/DOM/i18n/styles. Core runtime closure requires the direct SDK workspace-surfaces entry to avoid the React helper at the SDK root.

Core state/persistence/controller/feedback/installation tests: 55/55 PASS. workspace-runtime, ui-workspace, ui-layout and Shell typechecks PASS. Combined extension/source/architecture/RPC domain-error boundary tests: 33/33 PASS (`/tmp/spec008-root-boundaries.log`). Existing RPC boundary fixture still pointed at the pre-Spec007 Host projector; updated it to the actual API server owner before running. Catalog adapter preserves the prior explicit publishHost: undefined override as well as its lazy default publisher.

Client attachment controller now owns upload promises and operations exclusively; original methods/maps removed from PiClientSession. Five attachment tests and pi-client typecheck PASS; remaining US4 history/catalog/server decomposition is still in progress.

## Integration in progress

Full `pnpm typecheck` PASS; final changed session packages will be checked again after their remaining logic extraction. Frozen offline install PASS across 101 workspace projects (96 libraries plus apps/root). Dependency/Host ownership and package structure checks PASS. Three browser host resolver contract tests PASS using fake host/approval callbacks (no browser or UI mounted).

A combined stable regression run passed 228 cases and failed one subprocess load because new server state constructors used TypeScript parameter properties unsupported by Node strip-only mode. Replaced those with explicit fields; the exact workspace protocol subprocess file subsequently passed 5/5. This is recorded as a corrected implementation issue, not a waived test.

## 最终实施验收（2026-09-13）

35 项任务全部实施并通过相应验证。W1–W6 的最终所有者见 ownership-map.md；公开合同见 contracts/public-boundaries.md。源文件变更及 SHA-256 见 migration-inventory.json，依赖度量见 dependency-result.json。

### 结果与度量

| 项目                                  | 基线         | 最终     | 解释                                                                              |
| ------------------------------------- | ------------ | -------- | --------------------------------------------------------------------------------- |
| 库包                                  | 94           | 96       | 仅新增 ui-file-presentation、ui-workspace；目录服务和合同复用既有包               |
| 库包内部生产/optional/peer 依赖边     | 598          | 611      | 拆分后的消费者显式声明 core/UI 依赖；此数包含类型依赖，不是打包大小或耦合改善比例 |
| pi-server-ports 内部依赖              | 4            | 3        | 删除 pi-browser、workspace-server 实现依赖，使用中立 browser/file/catalog 合同    |
| workspace-runtime 内部依赖            | 8            | 3        | 删除 UI、i18n、Host、Shell 实现边；运行闭包不加载 React/DOM                       |
| pi-session-server/session-registry.ts | 5,062 行     | 2,023 行 | 活跃会话类、投影、内部合同与状态/资源 owner 分离；行数只是职责迁移辅助证据        |
| 包结构违规                            | 基线既有记录 | 0        | 96 库包、547 测试文件，源码/辅助目录满足浅层规范                                  |

文件呈现的图标与下载各保留一份实现；ui-attachment/ui-message-blocks 不再以生产依赖引入 workspace-files。工作区 UI、CSS、词典、Hook/DOM 代码归 ui-workspace；headless 安装实例拥有唯一 store/controller/draft/feedback。通用 catalog 核心零 Pi 实现依赖，Pi adapter 保留原 Host 事件形状、持久化后的通知顺序和 publisher 覆盖规则。

会话拆分不仅移动字段：客户端目录 owner 执行快照/顺序/固定/归档投影，history owner 执行序列/分页/索引规则，attachment owner 执行上传与清理；原 manager/session 负责安装和事件编排。服务端 HostedPiSession 已完全移出 registry，通过有限协作操作装配；其余冷目录、scratch、lifecycle、mutation 和 fork 各有唯一 owner。HMR 接管保留旧对象、Map/Set、启动 Promise、catalog task、fork tail 和 scratch timer；旧闭包的标量写入仍反映到新 owner。

### 验证结果

| 验证                                    | 实际结果                                                        | 日志                                  |
| --------------------------------------- | --------------------------------------------------------------- | ------------------------------------- |
| non-ui-tests.json 精确集合              | 84 文件，665 PASS，0 fail/skip                                  | /tmp/spec008-final-tests.log          |
| 加强后的 HMR/启动/fork 回归             | 5 PASS；覆盖旧 Map/Set/Promise/timer 身份与晚到标量更新         | /tmp/spec008-hmr-final.log            |
| 全仓 pnpm typecheck                     | PASS，包含 apps 与 packages                                     | /tmp/spec008-typecheck-final.log      |
| 最后会话包类型检查                      | pi-client、pi-session-server PASS                               | /tmp/spec008-session-types-final.log  |
| pnpm lint                               | PASS；新增 unused import 已清理，最终格式检查通过               | /tmp/spec008-lint-final.log           |
| workspace dependencies / Host ownership | PASS                                                            | /tmp/spec008-deps-final.log           |
| package structure                       | PASS；96 库包，0 违规                                           | /tmp/spec008-structure-final.log      |
| pnpm build                              | Runtime、Web、Electron renderer 与 Electron Runtime 组合均 PASS | /tmp/spec008-build-final.log          |
| frozen offline install                  | PASS；101 workspace projects                                    | /tmp/spec008-frozen-install-final.log |
| git diff --check 与逐文件哈希复核       | PASS                                                            | 工作树与 migration-inventory.json     |

额外静态对照：去除新加入的窄端口绑定后，HostedPiSession 的 AST 与迁移前类相同；38 个提取的投影声明 AST 完全相同。新架构测试阻止 Hosted 类回到 registry、focused owner 回依赖整个 registry/manager、旧入口恢复、headless 核心加载 UI/DOM，以及图标重新耦合文件树/Shell。

完整非 UI 集合首次执行发现两处测试归属问题：conversation assembler 仍向已删除的私有 baseMessages 字段注入数据，现改为唯一 history owner；旧 session-protocol-boundary fixture 仍读取 Spec007 之前 host-server/rpc.ts，现指向真实 api/server owner。修正后全集合通过。复核还恢复了原目录 changed/removed/order 通知时机，并保留原字段相等判断和线性重排复杂度；没有以改产品行为来绕过失败断言。

### 范围与未验证项

新增或执行 UI、DOM、Hook 渲染、Browser/Electron 交互冒烟测试均为 0。既有 UI/下载测试仅移动或调整入口；未声称实际视觉和交互已经验证。图标资源供应、CSS/token/Portal 与 Provider 生命周期经过静态审查。Node browser-host resolver 测试使用 mock host/approval 回调，没有启动浏览器或挂载界面。

构建仍报告未修改文件 `packages/pi/pi-ui-settings/src/prompt-placeholder-highlight.module.css` 的 `::highlight` 解析警告；构建成功，本期不改变该样式行为。原有六处 .agents/skills 修改保持，不纳入本期；Spec001–007 原完成记录未改动。未提交、推送或发布制品。

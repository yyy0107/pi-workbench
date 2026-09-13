# Plan: 按产品职责细分 UI 能力

**Spec**: [spec.md](spec.md)；**基线**: 8ee7ee24；**分支**: codex/package-refactor；状态：已实施并通过允许范围内的验证，见 validation.md。

## Summary

本轮按参考文本的产品职责粒度，确定15个目标 owner：ui-model-selection、ui-token-usage、ui-theme、ui-settings-general、pi-ui-settings-models、ui-attachment、ui-input-trigger、ui-user-questions、ui-todo、ui-message-queue、ui-message-actions、ui-user-message-index、ui-settings-archived-chats、ui-side-chat、ui-tool。

覆盖 ui-agent-controls、ui-settings、pi-ui-settings、composer 和 conversation 内部能力。完成后删除空出的 ui-agent-controls，其余包保留明确职责。预计75→89个库包，仅为规划核对；不以目录数量判断完成。详细来源见 package-map.md 和 capability-inventory.json。

## Technical Context

- TypeScript ^7.0.2、React ^19.2.8、pnpm 11.22.0；沿用当前 Base UI、Lexical、SDK 和构建系统，不升级依赖。
- 内部 workspace 库；服务 Web 与 Desktop renderer，Runtime/协议兼容通过构建和静态边界确认。
- 无新存储/协议。保留 settings revision、session identity、queue状态、scratch lease、扩展ID和释放边界。
- 不新增订阅、Context副本或渲染层；helper原实现提取，不承诺未经测量的性能改善。
- 验证：精确非UI用例、源码/词典/CSS静态合同、结构/依赖、lint/typecheck/build；所有UI测试保留且 excluded-by-user。

## Constitution Check

| Gate                | 研究前 | 设计后                                                                              |
| ------------------- | ------ | ----------------------------------------------------------------------------------- |
| 具体职责/两级包根   | PASS   | PASS：15项均有真实来源，Pi模型保持Pi领域                                            |
| 真实src/lib与浅层TS | PASS   | PASS：现有helper随owner；settings容器和tool disclosure提取真实算法，禁止空目录      |
| 基础复用/生产无环   | PASS   | PASS：底层contracts复用；tool policy不回引conversation；side-chat仅单向消费会话视图 |
| 完整渐进迁移        | PASS   | PASS：每波包含词典、CSS、测试、入口和所有消费者                                     |
| 验证后完成          | PASS   | PASS：004 独立结构/依赖、纯逻辑、lint、类型和构建通过；UI 排除遵用户约束            |

无新增宪法例外。参考树的lib生成产物、invariant入口和tsdown配置不改变本仓lib手写TS/TSX约定。

## Project Structure

```text
packages/client/
  ui-settings/                 # 保留设置容器/request/registry视图
  ui-settings-general/         # 语言与通用会话偏好
  ui-theme/                    # 外观设置/背景/颜色
  ui-model-selection/          # 模型选择/推理档位
  ui-token-usage/               # 上下文与Token统计
packages/pi/
  pi-ui-settings/              # 保留agent配置
  pi-ui-settings-models/       # Pi provider/model配置
packages/conversation/
  composer/                    # 保留编辑器/提交/输入装配
  conversation/                # 保留会话/消息装配与视口
  ui-attachment/
  ui-input-trigger/
  ui-user-questions/
  ui-todo/
  ui-message-queue/
  ui-message-actions/
  ui-user-message-index/
  ui-settings-archived-chats/
  ui-side-chat/
  ui-tool/
```

每个新包含实际src/lib、tests、显式exports、tsconfig和双语README。词典统一src/i18n/{index,en-US,zh-CN}.ts。目标不是将所有包挪到client；领域分类仍与当前全仓规范一致。

## Implementation Waves

### W0：冻结接口、资源与测试映射

以 capability-inventory.json 的真实文件清单生成 tasks.md；为每项补上旧→新 public exports、测试逐文件去向、双语完整键/插值、共享CSS selector切片与原顺序、外部消费者和锁文件项。混合装配测试留原包，只改导入。提取 settings-sidebar 的 normalizeSearchText/matchesSearchText/groupSettingsSections 到原包lib，保留容器真实helper。此阶段不改变UI行为。

### W1：独立叶能力

Luna按顺序处理 model selection/token usage、theme/general；Sol处理user questions/todo及各会话独立扩展。每位同时只写一个完整owner，主Agent接通共享文件。附件可在独立槽位处理，但最多两位实施子Agent。

Model与Token完成后删除ui-agent-controls；reasoning-effort-label与model-selector-state/模型词典同迁ui-model-selection。Theme不搬appearance-store；general不搬settings容器。各新bundle仅移动其使用键，公共设置分组文案仍归ui-settings。

### W2：输入触发和Pi模型设置

input-trigger保持composer-document/history/submit在composer，通过当前core-contracts的请求类型、结构参数和token操作回调连接。不得为了拆包再建立第二套编辑器状态。Pi models留Pi领域，只迁客户端配置UI和helper；服务端provider认证/执行能力不搬。

### W3：工具展示与侧聊

先从message-presentation-policy提取defaultMessageDisclosureOpen、相关类型与实际默认表到ui-tool/lib/message-disclosure-policy.ts；conversation与Context都消费同一公开入口。随后整体迁ToolCall/ReasoningPanel/ToolGroup/timeline/Context/diff与timeline模型。通用file/image/text/source渲染及会话总presentation留conversation，工具专属键和样式由ui-tool拥有；跨边界共用文案通过所属bundle显式注册或由props传描述符，不复制字典。Todo识别改ui-todo/model。禁止ui-tool生产依赖conversation。

side-chat使用conversation公共视图和composer，Shell直接安装扩展；移除旧conversation/side-chat出口，conversation不回引该新owner。原session provider、lease、promote/dismiss和清理次序保持。

### W4：共享集成与验收

主Agent统一更新Shell builtin groups、Pi contributions装配、i18n runtime bundle列表、CSS入口、manifests、锁文件、Tailwind扫描和静态守卫。所有ID/顺序保持。对旧引用和空目录做全仓收口；按quickstart验证后才能勾选任务。

## Dependency and Dispatch

```text
W0 → W1 → W2 → W3 → W4
ui-selectors → 被 ui-model-selection 消费
ui-todo/model → 被 ui-tool / conversation presentation 消费
ui-tool → 被 conversation 消费
conversation + composer → 被 ui-side-chat 消费
ui-settings 容器 → 被各设置贡献通过request/registry消费
Shell / Pi产品装配 → 注册所有目标扩展与bundle
```

箭头表示被消费，不表示必须为每条关系新增依赖。最终依赖由实际imports验证，无生产兼容转发。Luna负责接口清晰的组件/设置迁移；Sol负责交互生命周期、输入触发、tool/side-chat依赖切断；主Agent负责共享集成。已通过 speckit-tasks 生成 25 项任务并完成，分派与共享集成以 tasks.md 为准。

## Planning Verification

已读取附件全部顶层能力，逐项对照见 reference-map.md。15组sourceFiles均对应当前真实文件，尚未移动源码；该清单覆盖核心整文件，W0须展开词典/测试/共享资源的逐项映射。未运行产品测试或构建。参考功能不存在或边界尚未独立的项目在reference-map中明确记录，不创建空包。

setup-plan已指向004；实际Git分支未变。无extensions.yml，before/after hooks跳过；update-agent-context.sh不存在，手动在根AGENTS增加当前计划路径。

本轮清单静态校验：15个目标包均未占用，104个核心来源文件全部存在，无重复owner；文档格式及git diff --check通过。这不是完整迁移验收，词典/测试/共享CSS将在W0任务中逐项展开。

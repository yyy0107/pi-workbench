# Feature Specification: Workbench 产品工具归属

**Feature Branch**: `codex/package-refactor`

**Created**: 2026-09-13

**Status**: Accepted

**Input**: 用户确认自定义工具与产品提示、交互规则应归 product/pi-workbench-runtime，逐项收回现有 pi-runtime-tools 中的产品能力。

## User Scenarios & Testing

### User Story 1 - 在产品包中找到产品工具 (Priority: P1)

维护者查找 Workbench 的 bash、设置、Todo、用户询问、搜索、审查和 Trace 行为时，从产品 Runtime 包进入唯一实现。

**Why this priority**: 按产品所有权归类比按工具技术类型拆包更易查找。

**Independent Test**: 核对所有公开入口、文档与消费者。

**Acceptance Scenarios**:

1. **Given** 一个 Workbench 专属工具，**When** 查找产品包，**Then** 可找到定义、提示、辅助逻辑与测试。
2. **Given** 通用终端/工作区能力，**When** 检查依赖，**Then** 继续可以独立复用，不反向依赖产品。

### User Story 2 - SDK 不依赖产品实现 (Priority: P1)

接入者可以使用 SDK 会话服务，并由装配方提供产品策略。

**Why this priority**: 只移动源码可能产生反向依赖。

**Independent Test**: 检查依赖闭包与注入合同，并运行工具覆盖及审查行为测试。

**Acceptance Scenarios**:

1. **Given** SDK 会话需要工具覆盖或审查记录，**When** 运行，**Then** 使用现有装配方注入的策略，SDK 不导入产品实现。

### User Story 3 - 安装与行为兼容 (Priority: P1)

用户在开发和打包环境中继续获得相同工具、资源启停及会话行为。

**Why this priority**: 所有权调整不应丢失工具或复制无关产品资源。

**Independent Test**: 非 UI 测试、类型和构建；核对部署快照和资源内容。

**Acceptance Scenarios**:

1. **Given** 原有会话和设置，**When** 更新产品，**Then** 工具标识、参数、提示、顺序、输出与持久化兼容。
2. **Given** 安装工具源码快照，**When** 部署，**Then** 只复制工具相关文件及许可证，Skills/Prompts 不被重复部署到扩展目录。

### Edge Cases

- 每个自定义工具在 src/<tool-name>/ 独占一个浅层目录，专属辅助实现、说明和许可证共置；Todo 状态归 src/rpiv-todo，独立导入不聚合加载 bash。
- 仅删除明确已退役的官方快照文件，保留用户未知文件。
- Browser 同时是可供独立 Pi CLI 使用的完整包，保持其现有独立边界。

## Requirements

- **FR-001**: 将 Workbench 工具定义、提示、默认交互、Todo 状态和扩展结果处理归产品 Runtime，删除空的工具包。
- **FR-002**: 通用 PTY/工作区/SDK 能力保持原所有者，生产依赖无环，SDK 不依赖产品。
- **FR-003**: 工具覆盖选择和审查解析通过明确注入合同接入会话服务。
- **FR-004**: 全部消费者、公开入口、资源构建清单及当前文档同步迁移。
- **FR-005**: 稳定工具/扩展标识、参数、提示、顺序、取消、输出预算和数据格式不变。
- **FR-007**: 每个自定义工具一个目录；共享装配归 src/tool-runtime，复用辅助归 lib；resources 仅放 Pi 资源类型，不能以 rpiv-todo 等工具名建立资源分类。
- **FR-008**: resources/extensions/<name>/index.ts 承载实际工具/事件注册，src 保留工具执行、状态与共享投影；保持静态依赖注入，避免文件发现重复注册。
- **FR-006**: 相关非 UI 行为、结构/依赖、类型与构建检查通过后记录完成。

## Success Criteria

- **SC-001**: 全部产品工具具有唯一可找到的产品入口，无旧包兼容壳。
- **SC-002**: SDK 与通用基础能力无产品反向依赖。
- **SC-003**: 相关行为测试和产物构建通过，工具快照不含重复 Skills/Prompts。

## Assumptions

保留未提交 Spec009/010 与用户已有修改；不运行 UI/DOM/Hook 渲染测试或交互冒烟，不升级依赖，不提交或推送。Browser 保留独立 CLI 复用边界。

## Workbench 项目约定

使用 pnpm、两级包目录和浅层 TypeScript src/lib；源码迁移、合同与资源部署分别验证。

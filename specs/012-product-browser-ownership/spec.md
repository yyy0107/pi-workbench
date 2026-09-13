# Feature Specification: Browser 产品归属

**Feature Branch**: `codex/package-refactor`

**Created**: 2026-09-13

**Status**: Accepted

**Input**: Browser 首先是 Workbench 能力，配套 Pi 工具扩展和 Skills 也应归产品。

## User Scenarios & Testing

### User Story 1 - 从产品中找到浏览器工具和技能 (Priority: P1)

维护者在产品能力目录中找到 Browser 的工具、扩展和 browser-use 技能，并能追踪到通用浏览器服务。

**Why this priority**: 消除此前 Browser 特例造成的所有权混淆。

**Independent Test**: 校验源码归属、公开入口、文档和完整文件映射。

**Acceptance Scenarios**:

1. **Given** 查找 Browser Pi 接入，**When** 浏览产品目录，**Then** 工具实现、扩展入口和 Skill 各归对应目录且只有一份源码。
2. **Given** 复用浏览器引擎，**When** 检查基础能力，**Then** 不依赖产品或 Pi。

### User Story 2 - 升级后保持浏览器行为与设置 (Priority: P1)

已有用户继续获得同样的浏览器控制、权限、会话隔离和资源启停体验。

**Why this priority**: 包归属调整不能重置开关或重复加载工具。

**Independent Test**: 工具、生命周期、安装过滤和构建资源测试。

**Acceptance Scenarios**:

1. **Given** 已保存资源开关，**When** 升级部署，**Then** 原有安装标识、过滤规则和路径保持有效。
2. **Given** 开发环境或构建产物，**When** 加载 Browser，**Then** 只注册一份扩展和一份技能。

### Edge Cases

- 产品内的 Skill 源码不能同时以普通内置 Skill 和安装包 Skill 重复部署。
- Browser 的现有独立会话回退、权限和取消行为保持。
- 用户修改与此前已提交规格保持原样。

## Requirements

- **FR-001**: Browser 的 Pi 工具、注册入口和配套技能归产品，删除独立工作区包。
- **FR-002**: 通用浏览器引擎和合同保持独立，无产品反向依赖。
- **FR-003**: 保持工具名称、参数、提示、权限、取消和会话隔离行为。
- **FR-004**: 保持已保存资源启停和安装标识，避免重复发现或重复注册。
- **FR-005**: 更新源码导航、依赖、部署与构建，并完成相关非 UI 验证。

## Success Criteria

- **SC-001**: 产品是 Browser Pi 接入和 browser-use 技能的唯一源码所有者。
- **SC-002**: 所有相关消费者均能从产品入口接入，不再依赖旧工作区包。
- **SC-003**: 相关逻辑、类型、依赖、资源部署和构建验证全部通过。

## Assumptions

本次调整源码与构建所有权，兼容已有 Pi 安装包标识和过滤语义。保留独立 Pi 会话兼容能力，不改变浏览器功能。不运行 UI 测试，不提交或推送。

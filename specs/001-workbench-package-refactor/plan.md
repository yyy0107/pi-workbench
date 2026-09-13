# Implementation Plan: Workbench 领域能力拆包

**Branch**: `codex/package-refactor` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

## Summary

以现有 34 个库包为基线，按 [package-map.md](package-map.md) 提取 35 个能力包，具体数量不作为验收。现有两级包根保留；深层 Agent/Pi 根压为两级。每个包同时含 src（真实能力源码）和 lib（内部辅助源码），两者至多一级目录，测试归 tests/，接口与构建通过自动检查验证。

## Technical Context

TypeScript/React/Next.js/Electron/pnpm 单仓；Pi SDK 0.85.1，源码 exports 与当前 app bundling 保持。Node 测试运行器及 oxfmt/oxlint 延用。没有新业务数据模型或数据迁移。覆盖 Web、Desktop renderer/Electron、Runtime node。性能目标是保留现有语义和实例数量，检查产物遗漏与重复依赖。

## Constitution Check

- 满足：目标包根固定两级，src/lib 各一级且分工明确，显式 exports、测试归属、i18n/UI/Pi 所有权均在合同中定义。
- 现状不满足的目录和引用记录在精确迁移基线；新违规立即失败，已迁移项从基线删除，最终清零。
- 使用最近 AGENTS.md，不覆盖用户改动，不升级 SDK，不发布制品。

## Project Structure

`packages/<domain>/<capability>/{package.json,tsconfig.json,src,lib,tests,README.md,README.zh-CN.md}`。
`src/index.ts`、`src/<one-directory>/<file>` 和 `lib/<one-directory>/<file>` 合法；两处均禁止第二层子目录。
`src` 承载真实业务实现、服务、组件、契约和注册装配，词典与样式随组件共置；`lib` 只放有实际消费者的内部辅助源码，统一保留 TS/TSX。禁止按 exports 列表批量生成 src 转导出壳。保留现有 strict 类型检查，不引入手写 JS 转换。保持现有源码 exports 和 app bundling，编译结果仍使用现有应用产物目录。
需要原目录结构的非源码资源归包根 assets/skills；CSS/图片在 src 或 lib 均遵守深度。

设计文档包括 spec、research、package-map、contracts/package-boundaries、data-model、quickstart；tasks 是唯一进度清单。Spec Kit feature.json 明确选择当前 Spec，不依赖 Git 分支前缀。

## Implementation Phases

0. 校准模块解析器和依赖检查，抽出共享测试环境，建立结构/引用基线与测试发现基线。
1. 调整 Agent/Pi 包根、tests/、工作区与配置路径，更新 Runtime 内置资源打包、静态资产和架构检查。
2. 先 settings-runtime，再通用 i18n、无业务 UI、appearance 与 shell-context。迁移期间同一 i18n Provider/runtime 服务新旧 bundle；临时 Shell facade 只转接类型，不自建翻译逻辑。
3. 用户补充 src/lib 分工后，先执行 T052（规范与检查）和 T053（回迁已提取能力包）；T028 已按当时约束迁移。用户再次指出 src 空壳问题后，T054 修订职责与语言规则，T055 逐包修正已迁移的 19 包，按用户最终要求全部保留 TS/TSX；T029 及后续采用 constitution 3.1.0，原有其他库包在各自迁移或 T048 收口。此前完成任务的证据保留，最终验收按新要求重新核对。

4. 先 code-highlighting 与 Markdown，再 workspace runtime/files 与各 Surface，再 composer/conversation，其余功能和 Pi UI。工作区 FileLink 通过可注入链接内容/菜单避免 files 与 file-view 循环。
5. 先提取 Pi 纯消息/投影/累积器（T041），再提取依赖累积器的 transport（T040），以此保持依赖无环。服务端 ports 先行，移除资源服务的 registry 默认导入，由 composition 注入已有 Dependencies；模型 Trace 用回调；tools 用工厂。StreamHub 留 server，通过 publisher port 注入。
6. 删除临时转发和过渡基线，更新规范/技能/文档，完成全量检查、产物及跨宿主冒烟。

## Interface Decisions

- i18n base 使用空基础 catalog + 显式 bundles；Provider 接收 locale/onLocaleChange/bundles。Shell 装配保持 settings hydration/revision/cookie 行为，逐个能力迁走字典并用现有 bundle factory 保持类型安全。
- settings runtime 不 re-export 设置页面；UI 不读文件业务 service；代码块直接渲染，不绕行 Markdown parser。
- Pi resource Dependencies 改为显式传入已有 session access 与 mutation coordinator；ModelService 的 trust 与 request observation 经窄函数传入。服务端 ports 不含具体实例。
- stable extension IDs/order 与 Settings/Runtime 安装作用域不变。相同 Pi SDK peer context 保持，stdout helpers 使用同一 SDK instance。
- 样式以 @workbench/shell/styles.css 聚合；全局基础归 UI，区域样式随包；应用 @source 覆盖新 frontend workspace roots。

## Validation Strategy

每项能力迁移须运行所属包及直接消费者类型检查和相关测试；结构/引用检查用于所有变更。包根和资产变更验证对应应用构建。最终完整 pnpm check/build、Desktop native smoke 与 Web/Desktop 集成冒烟。测试输出记录到任务证据，不把未验证事项勾选。

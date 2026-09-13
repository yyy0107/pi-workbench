# Spec 007 — API / RPC 基础能力提取

状态：已实施，32/32 项任务验证完成；分支 codex/package-refactor；基线为 Spec006 提交 `383fe578`。实施清单见 [tasks.md](tasks.md)。

## 用户需求

下一阶段将 API、RPC 公共能力提取到一个包。统一公共入口，保留领域业务和宿主职责，不重复实现传输、校验和错误处理。

## User Stories

- US1 / P1：通用信封、RPC 错误与校验器由 @workbench/api 提供，客户端/服务端引用同一契约。
- US2 / P1：客户端通用 RPC 调用不依赖 Host/Pi 实现；宿主地址、认证和同源 transport 由上层注入，所有调用保持原行为。
- US3 / P1：服务端通用 POST 处理、请求校验、错误投影和 route-group 分发使用统一包；领域 handler 仍在所属 server 包。
- US4 / P2：全仓消费者、exports、测试、README、依赖和构建完成迁移，旧通用实现与转发入口删除。

## 约束与验收

只新增 packages/transport/api（@workbench/api），目标 94 个库包；不合并业务 DTO/handler，不重命名 URL、RPC method、信封字段、错误码或持久化格式。保留状态码、request ID 校验、取消、请求体预算、Host/Origin/trusted-host 检查与 Desktop Bearer 行为。

根入口只提供环境中立契约；client/validation 不可传递导入 Node/server-core/Pi；server 显式入口可复用 server-core 的请求信任策略。严格 exports，无循环，无旧转发终态；TS/TSX、真实 src/lib、最多一级子目录、pnpm。

不新增或执行 UI/DOM/Hook/Browser/Electron 冒烟测试；RPC/HTTP/校验器等非 UI 行为测试允许且必须按风险执行。Luna 做边界确定的契约/引用迁移，Sol 做校验/请求/错误/取消语义，主 Agent负责接口、transport 注入、manifest/lock 与集成。规划阶段不改生产代码，不提交或推送。

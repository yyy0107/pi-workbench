# @workbench/remote-control-client

[English](README.md) · [包目录](../../README.md) · [Spec014](../../../specs/014-direct-paired-access/plan.md)

Workbench 手机远程客户端的平台无关连接与投影状态。本包通过注入端口负责认证时序、重连/退避、游标恢复、有界快照和远程操作跟踪；Expo 与原生存储仍由应用拥有。

## 公开能力与生命周期

稳定聚合 API 使用根入口；也可按 owner 使用 `/profiles`、`/connection`、`/endpoint-policy`、`/ports`、`/types`、`/conversation`、`/operations`、`/session-management`、`/recovery`、`/synchronization` 和 `/cursor`。本包不依赖 React、React Native、Expo、SQLite、SecureStore、Pi、Electron 或任何账号/Relay/Tailscale provider。保留的对话视图包含有界的只读助手/工具转录，在实时文本增量到达时保留工具调用，并显式标记协议边界发生的截断；它不提供工具调用或审批入口。

每个连接档案固定一个电脑安装身份，并以用户控制的优先级保存一至八个明确批准的局域网/Tailscale 接入点。客户端派生无凭据、固定路径的 `ws://` URL，在新鲜桌面 challenge 中验证固定身份，并在任何业务帧之前发送已配对手机的 P-256 proof。Resume 只包含最后已应用游标和最多 100 个未决 operation ID。应用进入后台/非活动态时暂停连接，回到前台或可达性恢复时触发一次权威同步。失败使用一至三十秒 capped full jitter；身份不匹配、撤销、不兼容与暂停会抑制自动重连。

事件只在 exact-next 游标应用；重复事件被忽略，gap 或 epoch 变化会停止应用并要求快照。快照完成时通过注入 store 原子替换投影与 base cursor。不确定操作使用同一 ID 查询，绝不自动重发；服务端确认 not-found 后，必须由用户显式创建新重试。

会话视图最多保留 200 项，本地草稿限制为 64 KiB UTF-8。禁止能力包括工具箱、终端/文件/浏览器控制、工具调用或审批、扩展、模型/Provider 设置、任意 RPC、取消归档和删除。

## 验证

```bash
pnpm --filter @workbench/remote-control-client typecheck
pnpm --filter @workbench/remote-control-client test
```

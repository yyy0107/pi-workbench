# @workbench/remote-control-direct-server

[English](README.md) · [包目录](../../README.md) · [Spec014](../../../specs/014-direct-paired-access/plan.md)

Workbench Remote 的可复用内嵌直连网关能力。Electron 主进程拥有具体网络监听器，并注入本地加密持久化和当前受限 Pi 远控帧处理器。本包负责局域网/Tailscale 地址策略、无账号配对、已配对设备的 challenge 认证、严格 socket 时序、限额、重放保护和撤销感知的业务分发。

本包不拥有 Electron、Pi/Runtime、React/UI、Tailscale 集成、账号/OIDC、PostgreSQL、推送、公共发现、NAT 穿透或可部署 Relay。

仅允许用户明确选择的 RFC1918/IPv6 ULA 或 Tailscale CGNAT/IPv6/MagicDNS 形式接入点。Socket URL 是无凭据的 `ws://<host>:<port>/remote/v1/direct`；即使传输层是普通 WebSocket，应用层 HPKE 仍保护配对与业务内容。监听器默认关闭，必须先验证新鲜的设备签名 challenge 才会分发业务帧，并执行帧预算、背压、重放、授权 revision 与撤销检查。

配对邀请两分钟后过期且只能使用一次。手机用 base-mode HPKE 提交加密 claim；电脑与手机显示相同的六位安全码，只有用户在电脑上确认后才返回授权。后续连接必须先通过新鲜的 P-256 签名 challenge 与持久化授权 revision 校验，任何业务帧才会被接受。设备被撤销时，其活跃 socket 会立即关闭。

网关总连接上限为 32，同一来源地址最多 8 个；认证帧限制 16 KiB，密封帧限制 256 KiB。若发送会让 Socket 积压超过 1 MiB，会立即拒绝；单次发送持续背压十秒也会断开慢消费者。配对 claim 最多尝试五次。错误和诊断均有界，并脱敏 secret、challenge、配对码、密钥材料与密文。

公开源码入口在 `package.json` 中显式声明。协议不存在 catch-all RPC 能力：工具箱、终端、文件、浏览器、扩展、模型/Provider 设置、任意工具审批及原始 Runtime/Pi RPC 均被禁止。实现与验证由 `specs/014-direct-paired-access/tasks.md` 跟踪。

## 验证

```bash
pnpm --filter @workbench/remote-control-direct-server typecheck
pnpm --filter @workbench/remote-control-direct-server test
```

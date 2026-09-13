# @workbench/pi-rpc-client

src 拥有 Pi RPC/HTTP 操作、安装级传输快照与双 WebSocket 的 generation/重连/watermark 控制；lib 在 connections.ts 分发前解析并校验流帧。两处保留 TS 浅目录。消息累积复用 pi-conversation/accumulator，不复制实现；结合客户端失效通知的 API 集成测试保留在 pi/client/tests/transport，本包执行连接行为测试。

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/connections.ts` 引用 `lib/stream-frame-parser.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

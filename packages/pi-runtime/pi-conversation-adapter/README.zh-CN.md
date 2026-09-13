# @workbench/pi-conversation-adapter

src 拥有规范化 Pi 消息契约、解析、历史/RPC 投影、消息累积器、可观察会话组装和队列操作；lib 提供事件转换、token 估算、用量/时序/统计辅助，由 messages.ts 和 Pi client session 消费。两处保留 TS，最多一级子目录，不接管 HTTP/WebSocket 或 SDK 会话实例。包测试覆盖解析/重放/增量/队列；含 PiSessionManager 的组装集成测试保留在 pi/client/tests/conversation。

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/conversation-node-projection.ts` 引用 `lib/conversation-events.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

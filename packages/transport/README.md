# 传输与 RPC

| 包                                                                   | 职责                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| [runtime-transport-client](runtime-transport-client/README.zh-CN.md) | Runtime HTTP/WebSocket 客户端载体、地址和认证握手             |
| [runtime-transport-server](runtime-transport-server/README.zh-CN.md) | Node HTTP/WebSocket 服务入口、认证、Fetch 适配与 Runtime 代理 |
| [api](api/README.zh-CN.md)                                           | 通用 RPC 信封、校验、错误、客户端调用与服务端处理             |

RuntimeConnection 和控制协议见 [runtime-contracts](../contracts/runtime-contracts/README.zh-CN.md)。Pi 的具体 RPC 协议及客户端在 [pi-runtime](../pi-runtime/README.md)，进程启动与关闭在 [process](../process/README.md)，构建产物读取在 [build](../build/README.md)。客户端传输不拥有全局连接单例；应用安装负责注入连接。

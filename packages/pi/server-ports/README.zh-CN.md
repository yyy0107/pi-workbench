# @workbench/pi-server-ports

src 定义 Host/工具偏好、扩展 UI、窄会话访问与流发布契约；lib 保留内置资源偏好回退逻辑，由 server 的 Host binding 适配器调用。两处保留 TS，最多一级子目录。binding 全局存储、session registry 与 StreamHub 实现留装配所有者；SDK 对象只在服务端使用，不进入 wire payload。测试位于 tests/。

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/resource-preference.ts` 引用 `lib/read-builtin-preference.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

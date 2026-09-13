# @workbench/pi-model-server

src 拥有 provider/模型配置、认证/目录操作及受保护的 SDK services 构造；lib 提供 ModelService 使用的既有图片输入探针。Host 装配显式注入项目信任与请求时的 Trace 观测查找；保持模块级 host fetch 捕获和 ModelRuntime WeakSet，不创建第二套 runtime 或凭据所有者。保留 TS 浅目录。配置测试位于 tests/，模型/信任/Trace 装配与 RPC 集成测试留在 pi/server/tests。

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/image-probe.ts` 引用 `lib/image-input-probe.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

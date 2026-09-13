# @workbench/pi-diagnostics-ui

Owns context trace and usage-statistics surfaces. Internal helpers project traces, select/cache details, index search, lay out spans/timelines and aggregate usage.

src 拥有真实能力实现/契约及共置双语词典/样式，lib 拥有实际被调用的内部辅助模块。两处保留 TS/TSX，最多一级子目录。保持客户端实例、扩展 ID/顺序和资源释放行为；只使用公开入口，测试位于 tests/。

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/use-context-trace.ts` 引用 `lib/context-trace-activation.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

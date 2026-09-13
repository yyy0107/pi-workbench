# @workbench/pi-ui-session-import

Owns external-session scanning and import selection UI. Internal helpers identify selected sessions and bound import batches; protocol IDs and the existing opt-in installation remain unchanged.

src 拥有真实能力实现/契约及共置双语词典/样式，lib 拥有实际被调用的内部辅助模块。两处保留 TS/TSX，最多一级子目录。保持客户端实例、扩展 ID/顺序和资源释放行为；只使用公开入口，测试位于 tests/。

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/external-session-import-settings-item.tsx` 引用 `lib/import-selection.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

# @workbench/pi-settings-ui

src 拥有 Pi 模型配置、Agent 设置、缓存提示、配置文件操作及双语词典/样式；lib 拥有草稿转换、凭据链接及提示词占位符高亮辅助模块。保留 TS/TSX，最多一级子目录。产品保持原有扩展安装顺序、Pi 客户端实例、自动保存和资源释放行为。测试位于 tests/。

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/model-config-model-row.tsx` 引用 `lib/model-config-draft.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

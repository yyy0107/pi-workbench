# @workbench/pi-resources-server

src 拥有资源目录、Skills/Extensions/Packages/提示词、设置/信任/工作区领域服务、持久化及变更/重载协调；lib 提供路径、解析、名称、文件读取、更新元数据和启用规则辅助，由 src 资源服务实际消费。两处保留 TS，最多一级子目录。会话访问、工具集合、共享缓存选择和事件发布由 server 的 resource-composition 适配器显式装配。资源文件位于 resources/，沿用原有 artifact 路径；纯辅助测试位于 tests/，完整服务/Host 集成测试留在 pi/server/tests。

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/extension-name.ts` 引用 `lib/extension-name.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

工作区协议适配仍归本包，目录存储已归 @workbench/workspace-server/catalog，DTO 和操作端口来自 agent-runtime-contracts/workspace-catalog。旧 workspace-store 导出已删除，宿主事件投影归 Pi server 装配。

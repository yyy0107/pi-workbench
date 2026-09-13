# 产品工具迁移计划

基线为已验证的 Spec009/010 工作区。库包 98 → 97，删除 pi-runtime-tools。工具按 product/pi-workbench-runtime/src/<tool-name>/ 分目录；Todo 实现、状态、校验、说明与许可证共置 src/rpiv-todo；共享装配归 src/tool-runtime，共享搜索辅助归 lib。完整文件/公开入口映射见 migration-inventory.json。

- 产品公开 `/tools/bash` 等独立入口；原工具根的准备/错误处理为 `/tools`；Todo 条目为 `/todo/*`。产品已有 resources/extensions 等入口保留。
- SDK session-runtime-dependencies 新增工具覆盖选择及工作区审查解析回调。Runtime server 使用产品实现注入，SDK 删除产品实现导入。
- 产品 tool-resources 维护工具源码快照白名单，构建器和开发部署共用；不复制产品全部 src/lib/resources。旧的官方平铺快照按精确文件名退役，未知文件保留。
- 默认内联扩展顺序、工具标识、Schema、提示、输出预算和会话注入保持原样；Browser 的独立 Pi Package 不在本次合并范围。
- 现有代码文档与 skill 路由只改必要所有权说明，保留其他用户编辑。历史 Specs001–010 与旧映射保持完成记录。

验证包括完整依赖/结构/类型/lint、工具/Todo/会话/审查/部署精选非 UI 测试与完整构建。新增无产品反向依赖、独立入口及快照白名单检查。

## 用户补充：每个工具独占目录

Bash、Ask User、Grep、Find、Todo、Settings、Review 各自拥有目录。生命周期 Hook 继续按自身能力目录组织。删除六个多余转发文件，将单一所有者的辅助实现收回工具目录；公开 29 个入口保持。resources 只承载 Pi 资源类型，当前为 skills/prompts；rpiv-todo 的来源说明与 MIT 许可证迁到工具目录。开发部署和 Runtime 产物沿用同一份更新后的源码清单，已知旧快照逐文件退役，不递归删除用户未知文件。嵌套退役路径拒绝符号链接父目录。

## 扩展资源入口

按用户确认，8 组扩展的实际注册入口迁入 resources/extensions/<name>/index.ts。Ask User、Todo、Settings 的工具定义与执行保留在 src，注册、恢复/清理和生命周期事件归资源入口。纯投影/诊断辅助仍归 src。原有 29 个入口保留，增加 8 个明确的 /extensions/<name> 入口；旧混合 /tools 入口解析到同一资源模块。产品继续静态注入，SDK 不依赖产品、不重复发现加载。资源 TS 纳入 typecheck，结构检查只对本产品的明确扩展入口路径开放例外。开发部署与 Runtime 构建共用更新后的快照清单。

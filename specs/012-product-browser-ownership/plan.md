# Browser 产品迁移计划

基线为 9632f518，保留六份已有 skill 编辑。97 → 96 个库包。

- 工具执行、脚本、worker、宿主适配放 product/pi-workbench-runtime/src/browser；Pi 注册入口为 resources/extensions/browser/index.ts；唯一 Skill 源码为 resources/skills/browser-use。
- browser-contracts/browser-server 保留通用浏览器能力。Browser 的 Pi 代码不下沉到通用包。
- 产品构建脚本生成既有 internal-packages/browser 兼容产物，保留包名 @workbench/pi-runtime-browser、安装路径 packages/.builtin/browser、扩展/Skill 过滤和单次 package 加载语义。这是产品生成的部署文件，不是新的 workspace 包。
- 通用 Skills 复制明确跳过 browser-use；只随 Browser 兼容产物安装。Browser 不加入默认 inline extension 列表。
- 产品入口 extensions/browser、tools/browser、browser-resources 替代旧工作区入口；包测试迁移为产品部署产物测试。工具 Schema、提示和执行体保持。
- 验证迁移哈希、无旧 workspace 依赖、实际产物单份 Skill 与扩展加载、已保存启停、工具/脚本/宿主生命周期、类型、结构、依赖及构建。排除 UI 和真实浏览器交互测试。

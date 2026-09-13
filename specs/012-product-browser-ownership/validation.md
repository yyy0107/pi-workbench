# Browser 产品迁移验证

基线：9632f518。保留此前六份未提交技能配置修改，本轮不提交或推送。

## 最终归属

- Browser Pi 核心工具、具名工具、脚本与宿主适配：product/pi-workbench-runtime/src/browser。
- 实际注册与生命周期入口：resources/extensions/browser/index.ts。
- browser-use 唯一 Skill 源码：resources/skills/browser-use，含五份参考文档。
- 独立 pi-runtime-browser 工作区包已删除，97 → 96 个库包；产品增加三个明确入口，共 40 个公开入口。
- browser-server/browser-contracts 保持通用职责，无 Pi 产品反向依赖。

## 安装兼容

产品脚本生成既有 internal-packages/browser 产物。旧 @workbench/pi-runtime-browser 名称仅保留为已安装 Pi package 的稳定身份；packages/.builtin/browser、扩展/技能过滤、默认关闭和用户保存选择保持不变。Browser 不加入产品 inline 列表，仍通过既有 package 机制加载一次。

browser-use 在产品资源源目录统一维护；普通内置 Skill 复制与 internal-skills 构建复制跳过它，只有 Browser 安装产物携带其可加载副本。源码快照和运行代码继续沿原有部署路径管理。

## 验证结果

| 检查                                 | 结果                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| 冻结锁文件离线安装                   | 通过，101 个 workspace projects                                                |
| 全量 typecheck                       | 通过                                                                           |
| 包结构检查                           | 96 个库包、549 个库测试文件、0 项已跟踪违规                                    |
| 工作区依赖和 Host 所有权检查         | 通过                                                                           |
| 精选非 UI 测试                       | 55 个文件、417 项全部通过                                                      |
| Runtime artifact 追加单份 Skill 验证 | 51 项重跑全部通过，与上述测试范围重叠                                          |
| Node Runtime 构建                    | 通过                                                                           |
| 实际产物检查                         | 具备产品 Browser 扩展源码和安装 Skill，无 internal-skills/browser-use 重复副本 |
| 工具定义 AST 比对                    | 核心及具名工具 Schema、提示与执行体保持一致                                    |
| 脚本/宿主源码比对                    | 声明保持一致；worker 源码未变                                                  |
| Skill 哈希                           | SKILL.md 和五份参考文档均字节一致                                              |
| 第三方锁文件记录                     | packages 与 snapshots 均未变，无依赖升级                                       |
| 产品中英文 README                    | 40 个公开入口、80 行入口说明、128 个本地链接、10 个导入符号通过                |
| 变更文档链接                         | 335 个本地链接无缺失                                                           |

初轮测试保留了“直接将 workspace 根当 Pi package 加载”的旧假设；现已改为验证产品的实际开发部署入口。现有工具、脚本、独立会话宿主、安装过滤和单次加载测试保留。输出处理未引入新行为；defineTool 使用 SDK 公开的类型推导辅助函数。

按用户约束，未运行 UI/DOM/Hook 渲染、真实浏览器或 Electron 交互冒烟。测试使用既有模拟宿主和 faux 模型。本轮仅重建受影响的 Node Runtime，未重复前端构建。

最终 `pnpm lint` 通过（2932 个文件），`git diff --check` 通过。

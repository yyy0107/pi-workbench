# 实施验证指南

以下为实施验证指南；本次实际命令结果与 UI 排除项见 validation.md。先读取根和受影响包最近 AGENTS.md；以当前未提交树和 source-inventory.json 为起点。文件 hash 漂移时先核对差异，不恢复旧内容覆盖用户修改。

## 静态与类型

```bash
pnpm check:workspace-dependencies
pnpm check:package-structure
pnpm lint
pnpm typecheck
```

按 public-boundaries.md 检查 import/exports/manifest 和动态装配，不仅扫描字符串。重点验证 ui-tool 无工具名称/参数解析、blocks 无 Session/composer、layout 无会话依赖、ui 无 selectors 反向 dev 依赖。按 ownership-map 核对 CSS DOM owner、资源入口顺序、Portal 和双语词典键/插值。

## 精确纯逻辑检查

先人工检查测试及其传递导入，建立允许/排除清单；不能因扩展名 .ts 就认定非 UI。禁止调用 pnpm test、pnpm check 或包级宽泛 test 命令，避免带入 UI 用例。

已确认纯逻辑文件可以逐个使用仓库现有 loader 执行：

```bash
node --import ./scripts/register-typescript-test-loader.mjs --test <已审查的纯逻辑测试文件>
```

下一阶段只为非平凡变化补充必要纯逻辑案例：

- Pi diff 解析：正常 edit/write、缺失/畸形结果、无 diff、状态过滤；失败不阻断原始 details。
- 通用 timeline：显式 presentation 分组、parallel key 优先、source indices、不注册/resolve 抛错、统计聚合与当前 basename/行数语义保持。
- Composer：现有提交策略、文本解析与建议映射的输入/输出；不渲染 hook 或编辑器。
- sidebar：投影和原 move/pin/save 事务错误阶段；不渲染菜单。
- theme：纯颜色正规化/页面选择；不使用 fake DOM 验证 Range/Color。

UI/DOM/fake DOM/Hook 渲染/视觉/交互测试以及 Browser/Electron 冒烟均不新增、不执行。保留这些既有文件；selector 三项断言只搬迁，不扩写。用静态生命周期核对记录覆盖附件失效请求、retry finally、Composer IME/ref、scroll Strict Effects、theme timer/RAF；明确这些不是渲染行为测试通过的证据。

## 构建与最终证据

```bash
pnpm build
```

不启动 Browser 或 Electron。记录每条命令的结果；失败不勾完成。清点 93 个库包与原有测试去向，新增纯逻辑用例单列；核对 UI 排除清单、生产无环、真实 src/lib、无深层导入、无旧转发、无多余空目录。将未执行的 UI 验证和残余风险写入实施 validation.md。

规划阶段仅验证文档；实施阶段的类型检查、构建与精确纯逻辑执行结果单独记录在 validation.md。

实施核对修正：现有 check-workbench-style-scope.mjs 需要 renderer WebSocket，属于已排除的 UI 检查；不连接渲染器，改为 CSS 选择器/DOM owner、公开资源入口及 token 静态审查。

# @workbench/ui-selectors

负责共享的可搜索选择器、带动画的下拉选择器和工作区选择器。标签与校验文案由调用方提供，
本包不创建第二套翻译 bundle。选择器弹层继续使用基础 UI 提供的当前 Workbench Portal。

`lib/selector-dropdown-metrics.ts` 存放动画选择器 Hook 实际使用的过渡时间辅助函数，现有
选择器行为和公开组件类型保持不变。

SearchableSelector 的基础断言归本包保留；按当前不执行 UI 测试约束排除执行。

## 统一下拉外观

普通菜单、设置下拉、模型下拉和可搜索选择器共用 `@workbench/ui` 的
`menu-styles.ts` 中的弹层、条目和滚动区域样式。

- 弹层根据内容撑开，空间允许时至少与触发器等宽，并受定位层提供的可用宽度限制，默认限制高度。
- 单行条目使用 `--form-control-height` 和默认控件内边距；路径和说明可自然增加行数，
  业务组件不再设置另一套固定行高。
- 圆角、阴影、颜色和条目状态来自共享样式；滚动条沿用全局外观，默认不预留滚动条空间。
- 固定搜索行使用 `SearchableSelectorSearch`，可压缩的滚动列表使用
  `SearchableSelectorList`，底部操作区不参与压缩。弹层继续使用所属 Workbench 的 Portal。
- 业务封装只保留语义和布局，不覆盖弹层宽度、条目间距、圆角或阴影。时间选择器的双列
  布局等结构性例外，应在实现附近说明尺寸用途。

`DropdownMenuContent`、`ContextMenuContent`、`SearchableSelectorContent` 及其设置、子菜单、
模型封装支持以下参数：

| 参数                    | 默认值  | 行为                                                                         |
| ----------------------- | ------- | ---------------------------------------------------------------------------- |
| `reserveScrollbarSpace` | `false` | 开启时，即使未溢出也预留滚动条宽度。                                         |
| `limitHeight`           | `true`  | 面板上限为八个标准条目高度与可用高度的较小值；关闭后面板及列表均随内容撑高。 |

短菜单使用 `reserveScrollbarSpace={false}`，也可设置 `limitHeight={false}`。
分支菜单仅在选项超过八项时预留空间。`WorkspaceSelector` 同样暴露这两个参数，默认以八项
为预留空间的阈值。可搜索弹层将参数传给列表，固定搜索行和底部操作不会另留滚动条空位。

# @workbench/ui-selectors

负责共享的可搜索选择器、带动画的下拉选择器和工作区选择器。标签与校验文案由调用方提供，
本包不创建第二套翻译 bundle。选择器弹层继续使用基础 UI 提供的当前 Workbench Portal。

`lib/selector-dropdown-metrics.ts` 存放动画选择器 Hook 实际使用的过渡时间辅助函数，现有
选择器行为和公开组件类型保持不变。

SearchableSelector 的基础断言归本包保留；按当前不执行 UI 测试约束排除执行。

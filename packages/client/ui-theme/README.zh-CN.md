# @workbench/ui-theme

Owns appearance settings, background effects, color selection, appearance state, and their scoped styles. Shell remains the CSS aggregation point.

负责外观设置、背景效果、颜色选择、外观状态及其作用域样式。Shell 仍是 CSS 聚合入口。

AppearanceSettingsItem 只分派设置分区；主题、字体、界面和背景页拥有实际 JSX，page model 保持状态装配，控件保留 Range/Color 各自提交生命周期。

# @workbench/ui-settings

src 拥有设置导航、分组界面、外观与语言控件、背景图状态及共置双语词典/样式；lib 拥有实际被调用的语言显示名、外观分页与默认值辅助模块。两处均保留 TS/TSX，最多一级子目录。产品装配保持扩展顺序、偏好保存、locale hydration 及释放行为；消费者使用公开入口，测试位于 tests/。

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/appearance-reset-action.tsx` 引用 `lib/appearance-settings-pages.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

颜色选择器归本包：`./color-picker` 公开组件与 normalizeHexColor，`./color-picker.css` 由 Shell 在原位置聚合。组件与纯逻辑测试消费 lib/normalize-hex-color.ts，七个 ui.colorPicker 翻译键原样归属已安装的 settings bundle。

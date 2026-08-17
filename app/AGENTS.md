# App i18n 规范

- 本目录只负责请求/路由级 locale 解析、校验和 Provider 装配；组件词典仍由各组件拥有。
- 从共享支持列表校验 locale，未知值回退到 `en-US`。不要在 layout、页面或 API route 中复制支持列表。
- 根 layout 的 `<html lang>` 必须反映当前 locale；引入 RTL 语言时同时设置 `dir`。不要通过客户端 effect 延迟修正这些属性。
- Metadata、错误页、loading 和 not-found 等路由文案使用 `app` 命名空间，并在服务端按当前 locale 解析。
- Server Component 优先在服务端取翻译；只有需要交互或响应运行时切换的边界才使用客户端 i18n Hook。
- API 返回稳定错误码和结构化参数，不返回仅供 UI 展示的硬编码英文/中文句子；由界面负责翻译。
- 不为了国际化擅自改变 URL 结构。locale 前缀、cookie 或用户设置的优先级必须由统一配置决定。

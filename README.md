# Pi Workbench

基于 Next.js 与 assistant-ui 的单应用 AI Workbench。第一版采用静态内置扩展，不加载远程 JavaScript 插件。

## 本地开发

```bash
pnpm install
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## Electron 桌面端

启动带热更新的桌面应用：

```bash
pnpm electron:dev
```

生成当前平台可直接运行的应用目录，或生成安装包：

```bash
pnpm electron:pack
pnpm electron:dist
```

产物写入 `dist-electron/`。桌面端会在本机回环地址启动同一套 Next.js 自定义服务器，
因此 WebSocket、终端和 Pi API 与 Web 版使用相同实现。

常用检查：

```bash
pnpm lint
pnpm build
```

## 开发文档

- [Workbench 扩展组件开发指南](docs/extensions.md)
- [项目级 Agent Skill：Extend Workbench UI](.agents/skills/extend-workbench-ui/SKILL.md)

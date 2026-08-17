# Pi Workbench

基于 Next.js 与 assistant-ui 的单应用 AI Workbench。第一版采用静态内置扩展，不加载远程 JavaScript 插件。

## 本地开发

```bash
pnpm install
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

常用检查：

```bash
pnpm lint
pnpm build
```

## 开发文档

- [Workbench 扩展组件开发指南](docs/extensions.md)
- [项目级 Agent Skill：Extend Workbench UI](.agents/skills/extend-workbench-ui/SKILL.md)

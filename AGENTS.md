# AGENTS.md

## 包管理：pnpm（不要用 npm/yarn）

本项目使用 **pnpm** 作为包管理器。

- 安装依赖：`pnpm install`
- 新增依赖：`pnpm add <package>`（生产）/ `pnpm add -D <package>`（开发）
- 移除依赖：`pnpm remove <package>`
- 升级依赖：`pnpm update`
- 检查过期：`pnpm outdated`

禁止使用 `npm install` / `npm i` / `yarn`，避免生成 `package-lock.json` 破坏锁文件一致性（锁文件为 `pnpm-lock.yaml`）。

## 常用命令

```bash
pnpm dev          # 启动开发服务器（next dev --turbopack）
pnpm build        # 生产构建
pnpm start        # 启动生产服务器
pnpm lint         # oxlint + oxfmt --check
pnpm lint:fix     # oxlint --fix && oxfmt
pnpm format       # oxfmt --check
pnpm format:fix   # oxfmt
```

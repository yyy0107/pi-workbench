# 验证步骤

1. `pnpm install` 更新工作区链接与锁文件；`pnpm install --frozen-lockfile --offline` 验证可重复安装。
2. `pnpm check:workspace-dependencies`、`pnpm check:package-structure` 检查导出、依赖与目录。
3. `pnpm typecheck`、`pnpm lint`。
4. 对 migration-inventory.json 所列迁移测试及受影响应用/脚本非 UI 白名单执行现有 TypeScript 测试运行器，不启动全量 UI 测试。
5. `pnpm build` 验证 Runtime、Web 和 Electron 制品。
6. 检查新包 README 的完整 export 列表、源码链接；核对旧 Spec 与迁移源码的稳定协议、错误文案和控制行为。

实际命令、测试数量、结果与限制记录到 validation.md。

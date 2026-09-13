# 实施验证指南

32 项任务已实施。下列门槛均已验证，结果见 [validation.md](validation.md)，精确非 UI 白名单见 [non-ui-tests.json](non-ui-tests.json)。

1. 检查 source-inventory.json 与当前工作树，记录差异；基线为 Spec006 提交 `383fe578`，不恢复 HEAD 覆盖后续或无关工作树修改。列明精确测试文件与禁止执行的 UI 清单。
2. 迁移并执行 RPC/validator/client/route-group/领域错误的既有非 UI 用例。覆盖正常/业务错误/未知异常、畸形响应/JSON、rpcId 不匹配、method 不匹配、optional/nullable/issue path、请求预算与取消；网络测试可用受控 Request/Response 和本地非 UI server。
3. 精确执行现有 Host/Origin/trusted-host/loopback/transport-auth 非 UI conformance，以及设置/工作区/Pi 受影响 route 测试；保留 Desktop token header 覆盖和 URL 限制。不是运行 Electron UI 冒烟。
4. 检查 api/client/root/validation 的传递导入与浏览器构建产物没有 Node/server-core/Pi；检查生产图无环与旧入口零引用。

```bash
pnpm check:workspace-dependencies
pnpm check:package-structure
pnpm lint
pnpm typecheck
pnpm build
```

精确测试使用已审查文件与现有 loader：`node --import ./scripts/register-typescript-test-loader.mjs --test <已审查非UI文件>`。不调用 pnpm test/check 或宽泛包级 test，不运行 Browser/DOM/Hook/Electron 交互冒烟。目标 94 libraries；任务完成证据记录实际命令与未验证项，失败不勾选。未经用户要求不提交/推送。

## 本次实际验证

44 个精确非 UI 测试文件共 272 项通过；白名单内包含 API 5 文件、Host request/auth/conformance、services-client、Pi 和领域 RPC，以及 runtime-node 的受影响测试。以下命令从仓库根读取固定清单并传给现有 loader，不执行目录发现或 UI 测试：

```bash
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {spawnSync} from "node:child_process"; const files=JSON.parse(readFileSync("specs/007-api-rpc-extraction/non-ui-tests.json","utf8")); const result=spawnSync(process.execPath,["--import","./scripts/register-typescript-test-loader.mjs","--test",...files],{stdio:"inherit"}); if(result.error) throw result.error; process.exit(result.status ?? 1);'
node --test scripts/refactor-architecture-boundaries.test.mjs
node --test scripts/check-workspace-dependencies.test.mjs scripts/check-package-structure.test.mjs
pnpm install --offline --frozen-lockfile --ignore-scripts
```

静态边界 5 项、检查器行为 23 项通过。客户端产物审查见 artifact-audit.json；领域 AST 审查见 domain-body-audit.json。构建保留 Spec006 已记录的 `::highlight(pi-prompt-placeholder)` CSS 警告；未执行 UI 渲染/交互验证。

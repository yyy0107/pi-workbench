<!-- Sync Impact Report: 3.0.0 → 3.1.0. 用户明确撤回 JS 选择，能力与内部辅助源码保留 TS/TSX；撤销本轮 JS 转换及检查配置。同步 Spec/Plan/模板/研究/边界/清单/任务；无未定占位符。 -->
<!-- Previous Sync Impact Report: 2.0.0 → 3.0.0. 原则 II 从入口/实现机械分层改为能力源码/内部辅助分工；新增 JavaScript 选择与检查要求。已同步 spec、plan、package-map、contracts、research、quickstart、requirements、tasks 及 plan/spec/tasks 模板。T054 规范与检查、T055 已迁移包复核；T029 依赖 T055。无未定占位符。 -->
<!-- Previous Sync Impact Report: 1.0.0 → 2.0.0. 用户确认 lib/ 为手写内部源码。更新原则 II、spec/plan/package-map/contracts/tasks/checklist；新增 T052/T053，T048/T050/T051 按新结构验收。 -->
<!-- Previous Sync Impact Report: template → 1.0.0. Adopted five principles; added migration and validation rules. Plan/spec/tasks templates reviewed and aligned via the project conventions below. No deferred placeholders. -->

# Workbench Constitution

## Core Principles

### I. 按领域划分具体能力

库包根必须为 `packages/<领域>/<能力包>`。领域仅分类，不建立聚合工作区包；包内不得嵌套工作区包。每个能力包必须具有独立职责、公开入口、依赖声明、测试和中英文 README。应用保留在 `apps/*`。

### II. 浅层源码与显式接口

每个库包必须同时拥有实际使用的 `src/` 与 `lib/`，按职责放置文件：

- `src/` 承载能力本身：业务实现、服务/适配器、组件、公开契约、注册装配，以及所属词典与样式。`index.ts` 可以组织导出，也可以包含装配；整个 src 不得只剩转导出或空壳。
- `lib/` 承载该能力内部使用的辅助实现，例如文本/路径处理、集合算法、底层缓存、协议编码等。不得将完整服务、页面或全部业务实现整体下移；不得为凑目录新增无用 helper 或复制源码。辅助模块须有实际消费者和明确职责，不以是否导出来决定其归属。
- `src/` 与 `lib/` 的能力和辅助源码统一保留 `.ts`/`.tsx`，不将现有 TS 转为 JS，也不为本次拆包引入手写 JS 实现。保持 strict 类型检查。仓库既有构建脚本和尚未迁移的 CommonJS 工具按原有用途维护，不因本条批量改写。

lib 仍为手写源码，构建产物使用现有输出目录；参考仓库 lib 为生成产物的事实不自动变更本项目已确认约定。两处均最多一级子目录，例如 `src/components/button.tsx`、`lib/components/button.tsx`；不得在任一处出现第二层子目录。禁止将业务源码移到其他目录规避限制。跨包仅通过明确 exports 和 workspace 依赖访问，禁止内部源码导入；包内源码与测试模块向上相对引用最多两层。生产依赖图必须无环。

### III. 统一基础能力与所有权

产品装配依赖功能，功能依赖公共运行时和基础组件，基础层依赖契约。i18n 使用唯一共享配置与运行时，词典与能力包共置。UI 复用全局主题、密度、圆角和 Portal。Pi 服务端对象留在服务端，各能力复用原有安装/会话实例与销毁边界。

### IV. 渐进迁移与行为兼容

每次迁移同步更新全部仓内消费者、样式资源、测试和文档。保留 Web/Desktop/Runtime 功能、扩展 ID、安装顺序、协议和持久化格式。已迁移包违规为零，未迁移包只允许明确基线中的现有违规且不得增加；最终删除基线与临时转发。

### V. 验证后记录完成

测试归所属包根 tests/，迁移期间兼容 test/ 和共置测试并核对清单。完成任务必须同时完成相关验证，失败不可勾选；使用 tasks.md 记录证据和阻塞。先按影响范围验证，最终运行完整检查、构建和跨宿主冒烟。

## 项目约束

本文件补充 [AGENTS.md](../../AGENTS.md)，各组件细则继续以最近的 AGENTS.md 为准，不复制到全局。只使用 pnpm，保留现有构建系统、源码 exports 与 SDK 版本。业务文案必须提供 en-US 和 zh-CN。非源码资源可归包根 assets/skills，必须由公开资源入口定位并纳入产物验证。

## 开发流程

单一 Spec 记录本次重构。实施顺序：规范和基线 → 工作区与工具 → 公共基础 → 前端能力 → Pi 实现 → 收口。源码移动前更新包映射；实现后按 quickstart 验证。检查清单用于规范完备性，最终行为验收是任务，不提前勾选。未经用户要求不发布、不上传制品。

## Governance

修改原则须同步 spec、plan、tasks 与可执行检查；新增原则提升次版本，兼容澄清提升修订版本，破坏性改变提升主版本。用户已授权当前重构，阶段通过后继续执行。Converge 必须检查实际代码，不能只检查任务状态。

**Version**: 3.1.0 | **Ratified**: 2026-09-12 | **Last Amended**: 2026-09-12

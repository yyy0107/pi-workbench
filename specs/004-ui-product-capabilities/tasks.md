# Tasks: 产品UI能力细分（Spec 004）

输入：spec.md、plan.md、research.md、data-model.md、contracts/public-capabilities.md。用户已授权生成任务并实施。相对路径从仓库根起算。UI/DOM/fake DOM/交互测试全部excluded-by-user，既有文件保留；主Agent统一共享集成，Luna/Sol按完整能力派发。

## Phase 1: Setup

- [x] T001 读取技能、计划、AGENTS及工作树，运行setup-tasks并确认specs/004-ui-product-capabilities为当前feature。

## Phase 2: Foundation

- [x] T002 将specs/004-ui-product-capabilities/capability-inventory.json展开为完整迁移映射，冻结测试/词典/样式和公开API；每个能力必须先登记再移动。
- [x] T003 提取packages/client/ui-settings/src/settings-sidebar.tsx的搜索分组辅助至lib/settings-section-search.ts，保留容器真实src/lib。

## Phase 3: US1 — 独立产品能力（P1）

目标：15项完整owner，原包收窄。验收：所有来源有去向，真实helper被消费，完成标记等待共享接线和类型/结构检查。

- [x] T004 [US1] 将packages/client/ui-agent-controls中清单能力迁入packages/client/ui-model-selection，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W1依赖顺序执行。
- [x] T005 [US1] 将packages/client/ui-agent-controls中清单能力迁入packages/client/ui-token-usage，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W1依赖顺序执行。
- [x] T006 [US1] 将packages/client/ui-settings中清单能力迁入packages/client/ui-theme，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W1依赖顺序执行。
- [x] T007 [US1] 将packages/client/ui-settings中清单能力迁入packages/client/ui-settings-general，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W1依赖顺序执行。
- [x] T008 [US1] 将packages/pi/pi-ui-settings中清单能力迁入packages/pi/pi-ui-settings-models，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W2依赖顺序执行。
- [x] T009 [US1] 将packages/conversation/composer中清单能力迁入packages/conversation/ui-attachment，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W1依赖顺序执行。
- [x] T010 [US1] 将packages/conversation/composer中清单能力迁入packages/conversation/ui-input-trigger，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W2依赖顺序执行。
- [x] T011 [US1] 将packages/conversation/conversation中清单能力迁入packages/conversation/ui-user-questions，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W1依赖顺序执行。
- [x] T012 [US1] 将packages/conversation/conversation中清单能力迁入packages/conversation/ui-todo，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W1依赖顺序执行。
- [x] T013 [US1] 将packages/conversation/conversation中清单能力迁入packages/conversation/ui-message-queue，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W1依赖顺序执行。
- [x] T014 [US1] 将packages/conversation/conversation中清单能力迁入packages/conversation/ui-message-actions，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W1依赖顺序执行。
- [x] T015 [US1] 将packages/conversation/conversation中清单能力迁入packages/conversation/ui-user-message-index，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W1依赖顺序执行。
- [x] T016 [US1] 将packages/conversation/conversation中清单能力迁入packages/conversation/ui-settings-archived-chats，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W1依赖顺序执行。
- [x] T017 [US1] 将packages/conversation/conversation中清单能力迁入packages/conversation/ui-side-chat，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W3依赖顺序执行。
- [x] T018 [US1] 将packages/conversation/conversation中清单能力迁入packages/conversation/ui-tool，同步本地src/lib/词典/CSS/既有测试/README及公开入口；按W3依赖顺序执行。

## Phase 4: US2 — 公共契约与装配（P1）

目标：所有新owner通过公开入口组合且生产无环。验收：实际imports、生命周期/词典唯一性、CSS顺序、类型通过。

- [x] T019 同步packages/client/shell/src/extensions/builtin-extensions.ts及Pi contributions原组原顺序，更新全部消费者并删除旧ui-agent-controls包和旧能力转导出。
- [x] T020 同步packages/client/shell/src/i18n/runtime.ts与Pi产品bundle安装、旧词典键删除和跨能力共享描述符，保持唯一键及原插值。
- [x] T021 同步packages/client/shell/src/styles.css及conversation/composer样式聚合，保持原选择器内容、Portal范围和层叠顺序。
- [x] T022 更新相关package.json/tsconfig.json和pnpm-lock.yaml，补静态守卫扫描根及文档路径，禁止生产回引或内部路径。

## Phase 5: US3 — 验证后交付（P1）

目标：完成允许范围的独立证据。验收：全清单、静态合同、相关非UI检查及构建通过。

- [x] T023 核对specs/004-ui-product-capabilities/contracts/public-capabilities.md，逐文件对比props/事件/Context/副作用清理、ID、双语键插值、CSS和既有测试保留。
- [x] T024 按specs/004-ui-product-capabilities/quickstart.md精确筛选纯逻辑测试，执行结构/依赖、lint、全仓typecheck/build并修复迁移失败。

## Phase 6: 收口

- [x] T025 删除迁移后空目录并更新specs/004-ui-product-capabilities/{spec,plan,capability-inventory,validation}状态与证据，执行git diff --check。

## Dependencies and parallel work

T001→T002（逐能力完成登记）→T003与各迁移；W1叶能力先行，input-trigger/Pi models其次，ui-todo/model先于ui-tool，side-chat只单向消费conversation/composer。源码交付后逐项T019–T022接通，T023/T024验收后勾选，最后T025。

Luna独占client模型/用量/主题/通用设置及随后Pi模型配置；Sol独占附件/输入触发/提问/Todo/tool；主Agent独占队列/消息操作/消息索引/归档/侧聊及共享文件。并行任务不写同一来源文件，词典主文件由主Agent最终收口，子Agent仅生成目标bundle并报告原键删除清单。每个owner开始前展开对应T002文件映射，不能先搬后猜。最小交付是模型/Token完整分离，本次持续完成全部15项；不提交/推送。

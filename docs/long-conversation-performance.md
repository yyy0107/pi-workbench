# 长会话渲染优化与验证记录

日期：2026-09-06。主验收规模为 1,000 条已加载消息，100 条检查短会话退化，5,000 条用于压力验证。

v0.2.2 更新：为规避 Electron / Chromium 在复制时触发的 `HitTestResult::GetPosition` display-lock 崩溃，已移除对话行的 `content-visibility: auto`。以下浏览器测量记录对应移除前的实现，尚未重新测量 v0.2.2 的长会话性能。

## 实现

- Pi 投影先比较原始消息引用、分支字段和运行状态，再转换变化的消息；Composer 更新跳过历史消息处理。历史回放继续使用语义比较，删除消息及释放 Session 时清理缓存。
- `useConversationNodes()` 保持原有完整节点订阅，新增字段选择和节点范围参数。列表仅订阅结构元数据；消息正文和 steering 分组分别订阅自身内容。消息操作栏和错误展示复用结构上下文，消除每条消息再次订阅整段历史产生的二次方开销。
- 活动助手正文在数学与引用预处理之前使用 `useDeferredValue`；结束时使用最新完整文本。保留 Runtime 微任务发布，状态更新不依赖动画帧。
- 已结束轮次使用 `content-visibility: auto` 和浏览器记忆高度。保留 DOM、原生查找、选择与展开状态；滚动锚点覆盖内容尺寸变化，并与折叠动画的滚动锁协调。滚动记录增加可选消息标识和视口内偏移，兼容旧像素记录。

未引入依赖、虚拟列表、全局状态库、RPC 变更或永久性能监控入口。历史加载策略保持首次 8 条、前插 50 条。

## 测量方法

基线源码：`f7fd548114c01ed45b0812f56e1db2d45ceae62a`。基准使用同一固定样本：交替用户/助手消息、Markdown、200 行代码、本地 SVG 图片、工具结果，以及一条 50,000 字符正文和 100 个工具块的助手消息。既有折叠策略保持有效。

机器：Linux x64，Intel Core i5-12600KF，16 个逻辑处理器，约 61 GiB 内存，Node.js v24.16.0。浏览器为 Chromium 152，1280 × 720 CSS 像素；100/1,000 条前后对比 DPR 均为 1.3333，5,000 条压力测试 DPR 为 1。

每个场景运行六轮，丢弃第一轮预热，报告后五轮各自 P95 的中位数。投影测试每轮执行 30 次正文增量和 30 次 Composer 更新。浏览器测试每轮请求以 30 Hz 发送 90 次正文增量，每三次增量模拟一次输入，并等待最后正文实际显示。

浏览器基准以生产模式打包真实 `ConversationList`、消息渲染器、滚动 Hook、Pi assembler 和相关 Provider，输入控件使用调用真实会话 action 的受控原生 input。输入延迟从调用 `setComposerText` 到下一次动画帧后的任务执行计算；这是会话更新到绘制的近似值，不包含完整 Lexical Composer、操作系统键盘分发、真实模型或网络延迟。基线卡顿会拖慢定时器，故另记录 90 次增量实际发送所需时间。

## 投影结果

单位：毫秒；数值为五轮 P95 的中位数。

| 已加载消息 | 正文增量：优化前 | 正文增量：优化后 | Composer：优化前 | Composer：优化后 |
| ---------- | ---------------: | ---------------: | ---------------: | ---------------: |
| 100        |            0.896 |            0.063 |            1.143 |            0.001 |
| 1,000      |            5.266 |            0.316 |            5.647 |            0.005 |
| 5,000      |           30.887 |            0.944 |           34.956 |            0.003 |

1,000 条投影耗时满足 P95 ≤ 16ms。未变化消息的正文访问计数由定向测试约束，输入更新不会转换历史正文。流式更新仍保留一次轻量 O(n) 引用扫描。

## 浏览器结果

单位：毫秒；下表输入与流式延迟为五轮 P95 的中位数。

| 已加载消息 | 输入：优化前 | 输入：优化后 | 流式：优化前 | 流式：优化后 |
| ---------- | -----------: | -----------: | -----------: | -----------: |
| 100        |         22.0 |         10.6 |         23.0 |          9.7 |
| 1,000      |        814.4 |         12.3 |        869.0 |         13.5 |
| 5,000      |         未测 |         59.8 |         未测 |         64.2 |

1,000 条五轮输入 P95 原始值为：优化前 `838.0, 846.4, 808.8, 814.4, 745.9`；优化后 `12.8, 108.1, 11.1, 11.9, 12.3`。中位数低于 100ms，但同一标签页先测基线再导航到优化版时，第二轮 108.1ms 略超目标；保留该结果，不从比较中删除。

针对超限，关闭原标签页后在独立页面复核，保持相同尺寸与 DPR。无 CPU 采样开销的五轮输入 P95 为 `11.2, 12.3, 44.2, 11.9, 12.4`，流式 P95 为 `12.7, 13.4, 45.5, 13.7, 13.2`；五轮均满足 100ms 输入目标，末尾正文均完整。独立的 CPU 诊断轮也未复现超限，六轮共采样到约 399ms GC、5.49s 脚本、0.58s 布局和 0.30s 样式计算。这支持页面生命周期与内存状态会影响尾延迟的判断，但无法证明原先 108.1ms 完全由 GC 导致；不将单机器复核解释为所有负载下的延迟保证。

1,000 条五轮流式 P95 为：优化前 `870.6, 888.9, 869.0, 858.1, 840.1`；优化后 `13.5, 76.6, 12.7, 13.0, 23.5`。90 次增量发送时间从每轮 32.46–33.80 秒降至约 2.973 秒，五轮末尾正文均包含最后增量。

同样的 1,000 条 DOM 保留约 19,842 个元素。节点订阅从 1,005,500 降至 5,500；每轮 90 次正文增量与 30 次输入的节点读取从 273,957,270 降至 96,360。改善主要来自解除重复订阅和历史投影，而非减少已加载消息。

5,000 条输入 P95 五轮为 `90.7, 25.1, 66.4, 22.6, 59.8`；流式 P95 为 `64.2, 29.1, 72.8, 28.0, 66.1`。每轮增量发送时间约 2.978 秒，五轮 5,000 条消息均保留且末尾正文完整，无崩溃。

100 条五轮输入 P95 为：优化前 `22.5, 21.2, 22.0, 21.0, 29.3`；优化后 `11.2, 40.6, 9.4, 8.9, 10.6`。流式 P95 为：优化前 `22.8, 23.1, 23.0, 22.6, 29.8`；优化后 `10.6, 73.9, 9.7, 9.4, 9.5`。输入和流式的中位耗时均下降，满足短会话不退化的验收口径。

## 阅读、滚动和生命周期

| 场景                       | 结果                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| 1,000 条历史前插 50 条     | 同一可见文本行偏移 −0.105 CSS px                                          |
| 1,000 条视口缩窄到 600px   | 同一可见文本行偏移 −0.539 CSS px                                          |
| 1,000 条卸载、重新挂载恢复 | 消息偏移 0 CSS px                                                         |
| 5,000 条前插 / 缩窄 / 恢复 | −0.105 / −0.129 / 0 CSS px                                                |
| 原生查找与跨消息选择       | 5,000 条已加载历史中查找成功，跨消息选择保留文本                          |
| 展开代码后离屏再返回       | 200 行代码保持展开，组件仍在 DOM 中                                       |
| 折叠与外观                 | 折叠内容未暴露到无障碍树；浅色、深色和 600px 会话视口完成检查             |
| 卸载会话                   | 节点订阅计数归零；定向测试验证 Session 切换、观察器、事件监听和定时器清理 |

文本行锚点使用同一个 DOM Range 比较，避免把换行后消息盒子的顶边变化误判为阅读位置漂移。恢复测试在相同最终宽度下比较消息偏移；跨设备、跨字体恢复不作像素精度保证。

5,000 条保留约 99,060 个 DOM 元素、27,500 个节点订阅。压力测试五轮的 JS 堆快照从约 1.39 GB 增至 2.56 GB，六轮前的快照约 0.84 GB；这些是未控制 GC 的过程快照，不能作为常驻内存或泄漏结论。当前浏览器接口不能强制 GC，浏览器导航和开发工具也可能保留对象。订阅清理已验证；本方案保留 DOM，内存仍随已加载历史增长，不承诺恒定内存。

## 检查结果与边界

- 108 项定向测试通过：投影缓存、回放、分支、运行状态、完整及选择式订阅、steering 元数据修订、范围和 Session 切换、消息操作与错误可见性、Markdown、滚动恢复及重叠折叠锁。包含动画帧暂停时 Runtime 仍推进的回归测试。
- `@workbench/agent-runtime-client`、`@workbench/agent-runtime-pi-client`、`@workbench/shell` 类型检查通过；改动文件 oxlint、oxfmt 和 `git diff --check` 通过。
- `pnpm build` 通过，覆盖 Runtime、Web 和 Electron 构建。
- 浏览器实际渲染与性能验证在 Chromium 中完成。当前工具无法操作原生应用，因此没有完成独立 Electron 宿主中的手动交互复核；Electron 构建和暂停动画帧的自动回归已通过。
- 5,000 条只执行优化后的浏览器压力测试；该规模的投影有前后对比，未执行浏览器基线。不将性能时间阈值写入普通单测。

## 复现

在仓库根目录运行，使用已有 pnpm 依赖；浏览器打包脚本复用现有构建 CSS，因此先运行 `pnpm build`。

```bash
pnpm exec tsx scripts/bench-conversation-projection.ts --baseline=f7fd548114c01ed45b0812f56e1db2d45ceae62a
pnpm exec tsx scripts/bench-conversation-projection.ts

node scripts/serve-conversation-benchmark.mjs --baseline=f7fd548114c01ed45b0812f56e1db2d45ceae62a
node scripts/serve-conversation-benchmark.mjs --serve
```

以固定 1280 × 720 CSS 像素打开 `http://localhost:4178/baseline/?count=1000` 与 `http://localhost:4178/optimized/?count=1000`，点击 **Run stream**；等结果 `stream.run` 为 `5`，`runs` 即五次有效记录。将 `count` 改为 `100` 或 `5000` 切换规模。不要同时运行多个场景；保留环境字段和每轮结果。

**Verify anchors** 检查前插、缩窄与恢复；**Verify reading** 检查浏览器原生查找和跨消息选择；**Toggle conversation** 卸载后用 **Read selection** 读取订阅计数。展开代码、滚动离屏再返回，可检查组件状态保留。

```bash
pnpm --filter @workbench/agent-runtime-client --filter @workbench/agent-runtime-pi-client --filter @workbench/shell typecheck
node --import ./scripts/register-typescript-test-loader.mjs --test \
  packages/agent-runtime/core/client/test/conversation-node-selection.test.ts \
  packages/agent-runtime/runtimes/pi/client/test/conversation/conversation-assembler.test.ts \
  packages/agent-runtime/runtimes/pi/client/test/runtime/manager-generation.test.ts \
  packages/workbench/shell/test/conversation-node-subscription.test.tsx \
  packages/workbench/shell/src/chat/workbench-conversation-viewport.test.ts \
  packages/workbench/shell/src/chat/message-action-visibility.test.ts \
  packages/workbench/shell/src/chat/workbench-message-error.test.ts \
  packages/workbench/shell/src/chat/markdown/markdown-text.test.tsx \
  packages/workbench/shell/src/thread-scroll-state.test.tsx \
  packages/workbench/shell/src/elements/use-disclosure-scroll-lock.test.tsx
```

## 选择式订阅 API

```ts
useConversationNodes<T>({
  nodeKeys, // 可选；省略时为当前会话全部节点
  select, // (node: ConversationNode) => T
  isEqual, // 可选；默认 Object.is
});
```

结果保持节点顺序并跳过缺失节点；选中字段未变化时保留数组引用。使用稳定的选择器和比较函数可以复用订阅缓存。无参数调用继续返回完整节点，既有消费者无需迁移。

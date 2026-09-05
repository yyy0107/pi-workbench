// Official Pi 0.84.2 documentation and examples (MIT); see ../LICENSE.pi.
export const piBuiltinPromptsZhCN = {
  "pi-extension": {
    title: "创建 Pi 扩展",
    description: "定义 Pi 扩展入口、加载位置和会话生命周期。",
    content: `---
description: "定义 Pi 扩展入口、加载位置和会话生命周期。"
argument-hint: "[扩展行为和安装范围]"
---
创建 Pi 扩展：\${ARGUMENTS:-当前对话中的扩展需求}。

来源：@earendil-works/pi-coding-agent 0.84.2 — docs/extensions.md 的 Writing an Extension、Extension Locations、Long-lived resources and shutdown；examples/extensions/session-name.ts。

## 扩展入口

扩展默认导出一个接收 \`ExtensionAPI\` 的工厂函数，支持同步或异步。Pi 通过 jiti 加载扩展，TypeScript 无需预编译。

工厂返回 \`Promise\` 时，Pi 会等待其完成后再继续启动。因此异步初始化先于 \`session_start\`、\`resources_discover\`，也先于提交通过 \`pi.registerProvider()\` 排队注册的 Provider。

## 位置与重载

| 位置 | 范围 |
| --- | --- |
| \`~/.pi/agent/extensions/*.ts\` | 全局，所有项目 |
| \`~/.pi/agent/extensions/*/index.ts\` | 全局，子目录 |
| \`.pi/extensions/*.ts\` | 当前项目 |
| \`.pi/extensions/*/index.ts\` | 当前项目，子目录 |

项目受信任后才加载 \`.pi/extensions\`。\`pi -e ./path.ts\` 用于临时测试；自动发现目录中的扩展可通过 \`/reload\` 热重载。

## 长期资源与关闭

扩展工厂可能在不会启动会话的调用中运行。不要在工厂中启动后台进程、Socket、文件监听器或定时器。

将后台资源的启动延迟到 \`session_start\`，或真正需要它的命令、工具、事件中。注册幂等的 \`session_shutdown\` 处理器，关闭所创建的会话资源。

## 官方示例：session-name.ts

保存为 \`.pi/extensions/session-name.ts\` 并 \`/reload\`。\`/session-name Release review\` 设置会话名称；\`/session-name\` 显示当前名称。示例使用 \`ctx.ui.notify\`，交互 UI 方法要求 \`ctx.hasUI\`。

\`\`\`ts
/**
 * Session naming example.
 *
 * Shows setSessionName/getSessionName to give sessions friendly names
 * that appear in the session selector instead of the first message.
 *
 * Usage: /session-name [name] - set or show session name
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("session-name", {
		description: "Set or show session name (usage: /session-name [new name])",
		handler: async (args, ctx) => {
			const name = args.trim();

			if (name) {
				pi.setSessionName(name);
				ctx.ui.notify(\`Session named: \${name}\`, "info");
			} else {
				const current = pi.getSessionName();
				ctx.ui.notify(current ? \`Session: \${current}\` : "No session name set", "info");
			}
		},
	});
}
\`\`\`
`,
  },
  "pi-hook": {
    title: "创建 Pi 钩子",
    description: "选择 Pi 生命周期事件，使用对应的返回契约。",
    content: `---
description: "选择 Pi 生命周期事件，使用对应的返回契约。"
argument-hint: "[事件、触发条件和需要观察或修改的数据]"
---
创建 Pi 生命周期钩子：\${ARGUMENTS:-当前对话中的事件和目标行为}。

来源：@earendil-works/pi-coding-agent 0.84.2 — docs/extensions.md 的 before_agent_start、tool_call、tool_result、input、agent_start / agent_end / agent_settled。

## before_agent_start

用户提交提示词后、Agent 循环开始前触发，可注入消息或修改系统提示词。

\`event.systemPrompt\` 和 \`ctx.getSystemPrompt()\` 都包含前序处理器对系统提示词的修改；后续 \`before_agent_start\` 处理器仍可继续修改。

## tool_call

在 \`tool_execution_start\` 之后、工具执行之前触发，可阻止执行。使用 \`isToolCallEventType\` 收窄事件并获得带类型的输入。

- 直接修改 \`event.input\` 会影响实际执行参数。
- 后续 \`tool_call\` 处理器可见前序处理器对参数的修改。
- 修改后不会再次校验参数。
- 返回 \`{ block: true, reason?: string, terminate?: boolean }\` 控制阻止行为。
- \`terminate\` 仅适用于被阻止的调用；整批最终结果均要求终止时，Agent 才会提前停止。

并行模式下，同一消息的工具调用按顺序预检查，随后并行执行；\`tool_call\` 中的 \`ctx.sessionManager\` 不保证包含同一消息内其他工具的结果。

## tool_result

处理器按扩展加载顺序执行，各自读取前序处理器修改后的最新结果。可返回 \`content\`、\`details\`、\`isError\`、\`usage\` 的部分补丁；未返回的字段保持原值。处理器内的异步操作使用 \`ctx.signal\`。

## input 与运行结束

\`input\` 在扩展命令检查之后、Skill 和模板展开之前触发。返回行为：

- \`continue\`：原样继续；处理器不返回内容时也采用此行为。
- \`transform\`：修改文本或图片后继续展开。
- \`handled\`：跳过 Agent，第一个返回该结果的处理器生效。

输入转换按处理器顺序串联。\`agent_end\` 只结束一次底层运行，之后仍可能自动重试、压缩重试或处理后续消息；等待全部自动续跑结束应使用 \`agent_settled\`。

## 官方示例：before_agent_start

以下保留官方事件示例，仅补上 import 和默认工厂入口。保存为 \`.pi/extensions/run-context.ts\` 并 \`/reload\`，它会注入持久化上下文消息，并追加本轮系统指令。

\`\`\`ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    // event.prompt - user's prompt text
    // event.images - attached images (if any)
    // event.systemPrompt - current chained system prompt for this handler
    //   (includes changes from earlier before_agent_start handlers)
    // event.systemPromptOptions - structured options used to build the system prompt
    //   .customPrompt - any custom system prompt (from --system-prompt, SYSTEM.md, or custom templates)
    //   .selectedTools - tools currently active in the prompt
    //   .toolSnippets - one-line descriptions for each tool
    //   .promptGuidelines - custom guideline bullets
    //   .appendSystemPrompt - text from --append-system-prompt flags
    //   .cwd - working directory
    //   .contextFiles - AGENTS.md files and other loaded context files
    //   .skills - loaded skills

    return {
      // Inject a persistent message (stored in session, sent to LLM)
      message: {
        customType: "my-extension",
        content: "Additional context for the LLM",
        display: true,
      },
      // Replace the system prompt for this turn (chained across extensions)
      systemPrompt: event.systemPrompt + "\\n\\nExtra instructions for this turn...",
    };
  });
}
\`\`\`
`,
  },
  "pi-tool": {
    title: "创建 Pi 工具",
    description: "注册 Pi 模型工具，定义参数类型和 SDK 结果。",
    content: `---
description: "注册 Pi 模型工具，定义参数类型和 SDK 结果。"
argument-hint: "[工具用途、参数、输出和副作用]"
---
创建 Pi 模型工具：\${ARGUMENTS:-当前对话中的工具输入、输出和目标行为}。

来源：@earendil-works/pi-coding-agent 0.84.2 — docs/extensions.md 的 pi.registerTool(definition)、Custom Tools、Tool Definition；examples/extensions/hello.ts。

## 注册与参数

\`pi.registerTool()\` 可在扩展加载时或启动后调用。新工具立即刷新到当前会话，出现在 \`pi.getAllTools()\` 中，并可由模型调用，无需 \`/reload\`；运行时通过 \`pi.setActiveTools()\` 启停工具。

工具定义包含 \`name\`、\`label\`、\`description\`、\`parameters\` 和 \`execute\`。参数使用 TypeBox；字符串枚举使用 \`@earendil-works/pi-ai\` 的 \`StringEnum\`，Google API 不支持 \`Type.Union\` / \`Type.Literal\` 的对应写法。

\`promptSnippet\` 将工具加入默认提示词的 \`Available tools\`；\`promptGuidelines\` 在工具启用时追加到默认 \`Guidelines\`。每条 guideline 必须写明对应工具名。

## 执行与结果

执行签名为 \`execute(toolCallId, params, signal, onUpdate, ctx)\`。

- 检查取消信号，将 \`signal\` 传给 \`pi.exec\` 等异步操作。
- \`onUpdate\` 流式报告进度；\`content\` 发给模型，\`details\` 用于渲染和状态。
- 执行失败必须从 \`execute\` 抛出异常；无论返回对象中放什么字段，正常返回都不会设置失败标记。
- 工具内嵌套调用模型时，通过 \`usage\` 返回合并后的 \`Usage\`。
- 修改文件的工具使用 \`withFileMutationQueue()\`；相对 \`ctx.cwd\` 解析实际目标路径，并将整个“读—改—写”过程放入队列，而非仅排队最后的写入。

## 官方示例：hello.ts

保存为 \`.pi/extensions/hello.ts\` 并 \`/reload\`。模型以 \`{"name":"Ada"}\` 调用 \`hello\`，返回 \`Hello, Ada!\` 和 \`details: { greeted: "Ada" }\`。此示例无 I/O 或副作用。

\`\`\`ts
/**
 * Hello Tool - Minimal custom tool example
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const helloTool = defineTool({
	name: "hello",
	label: "Hello",
	description: "A simple greeting tool",
	parameters: Type.Object({
		name: Type.String({ description: "Name to greet" }),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		return {
			content: [{ type: "text", text: \`Hello, \${params.name}!\` }],
			details: { greeted: params.name },
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(helloTool);
}
\`\`\`
`,
  },
  "pi-skill": {
    title: "创建 Pi Skill",
    description: "定义 Pi 技能发现、frontmatter、指令和调用方式。",
    content: `---
description: "定义 Pi 技能发现、frontmatter、指令和调用方式。"
argument-hint: "[技能用途、触发场景和配套资源]"
---
创建 Pi Skill：\${ARGUMENTS:-当前对话中的技能使用场景}。

来源：@earendil-works/pi-coding-agent 0.84.2 — docs/skills.md 的 Locations、Skill Commands、Frontmatter、Name Rules、Validation、Example。

## 发现与调用

全局技能从 \`~/.pi/agent/skills/\`、\`~/.agents/skills/\` 加载；项目受信任后加载 \`.pi/skills/\`、\`.agents/skills/\`。项目 \`.agents/skills/\` 还会向上查找到 Git 根目录；非 Git 项目查找到文件系统根目录。

所有技能位置都会递归发现包含 \`SKILL.md\` 的目录；\`.agents/skills/\` 根目录下单独的 \`.md\` 文件会被忽略。

技能注册为 \`/skill:name\` 命令。命令后的参数以 \`User: <args>\` 追加到技能正文；设置中的 \`enableSkillCommands\` 控制命令是否可用。

## Frontmatter

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| \`name\` | 是 | 1–64 字符，只允许小写字母、数字和连字符；不能以连字符开头、结尾或连续使用 |
| \`description\` | 是 | 最多 1024 字符，说明技能用途和使用场景 |
| \`disable-model-invocation\` | 否 | 为 true 时不出现在系统提示词中，需用户通过 \`/skill:name\` 调用 |

Pi 不要求名称与父目录同名。缺少 description 的技能不会加载；重名时发出警告并保留最先发现的技能。

只有描述始终进入上下文，完整指令按需读取。脚本、资源和参考文档使用相对技能目录的路径。

## 官方示例：Brave Search

官方 \`docs/skills.md\` 示例包含 \`brave-search/SKILL.md\`、\`search.js\`、\`content.js\`。以下照搬 SKILL.md，仅按本仓库包管理约定将 \`npm install\` 改为 \`pnpm install\`。引用的脚本也必须实现，官方文档没有提供这两个脚本的源码。

\`/skill:brave-search Pi extension events\` 将搜索词传入技能，按工作流搜索结果并提取选中页面的内容。

\`\`\`\`markdown
---
name: brave-search
description: Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content.
---

# Brave Search

## Setup

\`\`\`bash
cd /path/to/brave-search && pnpm install
\`\`\`

## Search

\`\`\`bash
./search.js "query"              # Basic search
./search.js "query" --content    # Include page content
\`\`\`

## Extract Page Content

\`\`\`bash
./content.js https://example.com
\`\`\`
\`\`\`\`
`,
  },
};

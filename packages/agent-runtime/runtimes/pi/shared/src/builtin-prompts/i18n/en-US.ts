// Official Pi 0.84.2 documentation and examples (MIT); see ../LICENSE.pi.
export const piBuiltinPromptsEnUS = {
  "pi-extension": {
    title: "Create a Pi extension",
    description: "Define the Pi extension entry, loading location, and session lifecycle.",
    content: `---
description: "Define the Pi extension entry, loading location, and session lifecycle."
argument-hint: "[extension behavior and installation scope]"
---
Create a Pi extension for: \${ARGUMENTS:-the extension requirements in this conversation}.

Source: @earendil-works/pi-coding-agent 0.84.2 — docs/extensions.md: Writing an Extension, Extension Locations, Long-lived resources and shutdown; examples/extensions/session-name.ts.

## Extension entry

An extension exports a default factory function that receives \`ExtensionAPI\`. The factory can be synchronous or asynchronous. Extensions are loaded via jiti, so TypeScript works without compilation.

If the factory returns a \`Promise\`, pi awaits it before continuing startup. That means async initialization completes before \`session_start\`, before \`resources_discover\`, and before provider registrations queued via \`pi.registerProvider()\` are flushed.

## Locations and reload

| Location | Scope |
| --- | --- |
| \`~/.pi/agent/extensions/*.ts\` | Global (all projects) |
| \`~/.pi/agent/extensions/*/index.ts\` | Global (subdirectory) |
| \`.pi/extensions/*.ts\` | Project-local |
| \`.pi/extensions/*/index.ts\` | Project-local (subdirectory) |

Project-local \`.pi/extensions\` entries load only after the project is trusted. Use \`pi -e ./path.ts\` only for quick tests. Extensions in auto-discovered locations can be hot-reloaded with \`/reload\`.

## Long-lived resources and shutdown

Extension factories may run in invocations that never start a session. Do not start background resources such as processes, sockets, file watchers, or timers from the factory.

Defer background resource startup until \`session_start\` or the command/tool/event that needs the resource. Register an idempotent \`session_shutdown\` handler to close any session-scoped resources you start.

## Official example: session-name.ts

Save as \`.pi/extensions/session-name.ts\` and \`/reload\`. \`/session-name Release review\` sets the session name; \`/session-name\` shows it. This example uses \`ctx.ui.notify\`; interactive UI methods require \`ctx.hasUI\`.

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
    title: "Create a Pi hook",
    description: "Choose Pi lifecycle events and use their exact return contracts.",
    content: `---
description: "Choose Pi lifecycle events and use their exact return contracts."
argument-hint: "[event, trigger, and data to observe or change]"
---
Create a Pi lifecycle hook for: \${ARGUMENTS:-the event and behavior in this conversation}.

Source: @earendil-works/pi-coding-agent 0.84.2 — docs/extensions.md: before_agent_start, tool_call, tool_result, input, agent_start / agent_end / agent_settled.

## before_agent_start

Fired after user submits prompt, before agent loop. Can inject a message and/or modify the system prompt.

Inside \`before_agent_start\`, \`event.systemPrompt\` and \`ctx.getSystemPrompt()\` both reflect the chained system prompt as of the current handler. Later \`before_agent_start\` handlers can still modify it again.

## tool_call

Fired after \`tool_execution_start\`, before the tool executes. Can block. Use \`isToolCallEventType\` to narrow and get typed inputs.

- Mutations to \`event.input\` affect the actual tool execution.
- Later \`tool_call\` handlers see mutations made by earlier handlers.
- No re-validation is performed after your mutation.
- Return values from \`tool_call\` control blocking via \`{ block: true, reason?: string, terminate?: boolean }\`.
- \`terminate\` only applies to a blocked call; the agent stops early only when every finalized result in the batch is terminating.

In parallel tool execution mode, sibling tool calls are preflighted sequentially, then executed concurrently. \`tool_call\` is not guaranteed to see sibling tool results from that same assistant message in \`ctx.sessionManager\`.

## tool_result

Handlers run in extension load order. Each handler sees the latest result after previous handler changes. Handlers can return partial patches (\`content\`, \`details\`, \`isError\`, or \`usage\`); omitted fields keep their current values. Use \`ctx.signal\` for nested async work inside the handler.

## input and run completion

\`input\` fires after extension commands are checked but before skill and template expansion. Results:

- \`continue\` — pass through unchanged (default if handler returns nothing).
- \`transform\` — modify text/images, then continue to expansion.
- \`handled\` — skip agent entirely (first handler to return this wins).

Transforms chain across handlers. \`agent_end\` ends one low-level run; Pi may still auto-retry, auto-compact and retry, or continue with queued follow-up messages. Use \`agent_settled\` when Pi must have finished all automatic continuation.

## Official example: before_agent_start

The official event example below only adds an import and default factory. Save as \`.pi/extensions/run-context.ts\` and \`/reload\`. It injects a persistent context message and appends instructions for the current run.

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
    title: "Create a Pi tool",
    description: "Register a Pi model tool with typed inputs and SDK-compliant results.",
    content: `---
description: "Register a Pi model tool with typed inputs and SDK-compliant results."
argument-hint: "[tool purpose, parameters, output, and side effects]"
---
Create a model-callable Pi tool for: \${ARGUMENTS:-the tool inputs, outputs, and behavior in this conversation}.

Source: @earendil-works/pi-coding-agent 0.84.2 — docs/extensions.md: pi.registerTool(definition), Custom Tools, Tool Definition; examples/extensions/hello.ts.

## Registration and parameters

\`pi.registerTool()\` works both during extension load and after startup. New tools are refreshed immediately in the same session, so they appear in \`pi.getAllTools()\` and are callable by the LLM without \`/reload\`. Use \`pi.setActiveTools()\` to enable or disable tools at runtime.

A tool definition has \`name\`, \`label\`, \`description\`, \`parameters\`, and \`execute\`. Parameters use TypeBox. Use \`StringEnum\` from \`@earendil-works/pi-ai\` for string enums. \`Type.Union\`/\`Type.Literal\` doesn't work with Google's API.

Use \`promptSnippet\` to opt a custom tool into a one-line entry in \`Available tools\`, and \`promptGuidelines\` to append tool-specific bullets to the default \`Guidelines\` section when the tool is active. Each guideline must name the tool it refers to.

## Execution and result

The execute signature is \`execute(toolCallId, params, signal, onUpdate, ctx)\`.

- Check for cancellation and pass \`signal\` to async operations such as \`pi.exec\`.
- \`onUpdate\` streams progress updates. \`content\` is sent to the LLM; \`details\` is for rendering and state.
- To mark a tool execution as failed, throw an error from \`execute\`. Returning a value never sets the error flag regardless of what properties you include in the return object.
- If a tool makes nested LLM calls, return their combined \`Usage\` as \`usage\`.
- If your custom tool mutates files, use \`withFileMutationQueue()\`. Resolve the real target path relative to \`ctx.cwd\` and queue the entire read-modify-write window, not just the final write.

## Official example: hello.ts

Save as \`.pi/extensions/hello.ts\` and \`/reload\`. A model call to \`hello\` with \`{"name":"Ada"}\` returns \`Hello, Ada!\` and \`details: { greeted: "Ada" }\`. The example has no I/O or side effects.

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
    title: "Create a Pi Skill",
    description: "Define Pi Skill discovery, frontmatter, instructions, and invocation.",
    content: `---
description: "Define Pi Skill discovery, frontmatter, instructions, and invocation."
argument-hint: "[skill purpose, trigger, and supporting resources]"
---
Create a Pi Skill for: \${ARGUMENTS:-the skill use case in this conversation}.

Source: @earendil-works/pi-coding-agent 0.84.2 — docs/skills.md: Locations, Skill Commands, Frontmatter, Name Rules, Validation, Example.

## Discovery and invocation

Pi loads global skills from \`~/.pi/agent/skills/\` and \`~/.agents/skills/\`; project skills from \`.pi/skills/\` and \`.agents/skills/\` after project trust. Project \`.agents/skills/\` is also searched in ancestor directories up to the Git root, or filesystem root outside a repository.

In all skill locations, directories containing \`SKILL.md\` are discovered recursively. In \`.agents/skills/\` locations, root \`.md\` files are ignored.

Skills register as \`/skill:name\` commands. Arguments after the command are appended to the skill content as \`User: <args>\`. \`enableSkillCommands\` in settings controls command availability.

## Frontmatter

| Field | Required | Rule |
| --- | --- | --- |
| \`name\` | Yes | 1–64 characters; lowercase letters, numbers, and hyphens only; no leading/trailing or consecutive hyphens |
| \`description\` | Yes | Max 1024 characters; what the skill does and when to use it |
| \`disable-model-invocation\` | No | When true, hidden from the system prompt; users must use \`/skill:name\` |

Pi does not require the name to match the parent directory. Skills with missing description are not loaded. Name collisions warn and keep the first skill found.

Only descriptions are always in context; full instructions load on demand. Use relative paths from the skill directory for scripts, assets, and reference documentation.

## Official example: Brave Search

The official \`docs/skills.md\` example contains \`brave-search/SKILL.md\`, \`search.js\`, and \`content.js\`. The SKILL.md below is copied with only \`npm install\` changed to \`pnpm install\` for this repository. The referenced scripts must also be implemented; the documentation does not provide them.

\`/skill:brave-search Pi extension events\` invokes the skill with that search query. The workflow searches for results and extracts a selected page's content.

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

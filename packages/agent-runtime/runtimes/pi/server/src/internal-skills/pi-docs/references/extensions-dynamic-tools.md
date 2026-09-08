# Extension deferred tool loading

> Pi 0.84.2 documentation snapshot. Source: `docs/extensions.md`, lines [2335–2471](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/docs/extensions.md#L2335-L2471).
> See [Pi Docs](../SKILL.md#extension-reference-topics) for topic routing and version checks. License: [MIT](../LICENSE.pi).

### Dynamic Tool Loading

Extensions can register many tools while keeping only a small initial set active. A tool can then add more tools with `pi.setActiveTools()` during execution. Pi detects purely additive changes, records the newly available tool names on that tool result, and applies the updated active set before the next model request.

This works with every model. Models with native deferred-loading support preserve the stable prompt prefix and load the new definitions at the tool-result position. Other models use the fallback described below.

The lifecycle is:

1. Register every tool with `pi.registerTool()` so it appears in `pi.getAllTools()`.
2. Keep loader tools, such as `search_tools`, active and leave searchable tools inactive.
3. During loader execution, call `pi.setActiveTools([...currentTools, ...matchingTools])`. The change must be additive: do not remove currently active tools in the same call.
4. Pi records which tools were added on the loader's tool result.
5. Before the next model response, Pi exposes the added definitions using native deferred loading when supported, or the normal active tool list otherwise.

You do not need to return provider-specific tool references or mark the loader as a special search tool. The active-tool change is the signal. Names passed to `pi.setActiveTools()` must already be registered; unknown names are ignored.

#### Models with native deferred loading

- **Anthropic**
  - **Models:** Sonnet, Opus, Fable version 4.5 or newer (without Haiku)
  - **Native representation:** Deferred definitions use `defer_loading`; the load point uses `tool_reference` content.
- **OpenAI**
  - **Models:** `gpt-5.4` and newer family
  - **Native representation:** Pi adds completed client `tool_search_call` and `tool_search_output` items at the load point.

For a verified custom model or proxy, native handling can be enabled with `compat.supportsToolReferences: true` for `anthropic-messages`, or `compat.supportsToolSearch: true` for `openai-responses` and `openai-codex-responses`. Leave these disabled unless the endpoint and model accept the corresponding native protocol.

#### Fallback behavior

For all other models and providers, dynamic activation still works: Pi sends the complete current active tool list normally on the next request. The model can call the newly activated tools, but adding their definitions may invalidate the provider's cached prompt prefix.

Pi also uses this safe fallback when the active set is not purely additive, such as replacing one group of tools with another. Tool removals therefore work, but they do not use deferred loading.

For the best cache behavior, keep the loader tool active for the whole session and add tools instead of replacing the active set. Also note that activating a tool with `promptSnippet` or `promptGuidelines` rebuilds the system prompt; that system-prompt change can invalidate the prefix even when the provider supports deferred schemas. Lazily loaded tools should usually rely on their tool `description` and omit active-only prompt metadata.

#### Search tool example

The following extension registers two searchable tools, removes them from the initial active set, and keeps only `search_tools` as their loader. The example uses simple keyword matching, but the search implementation could use BM25, embeddings, a remote catalog, or project-specific routing.

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SEARCHABLE_TOOL_NAMES = new Set(["lookup_weather", "search_issues"]);

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "lookup_weather",
    label: "Lookup Weather",
    description: "Look up the current weather for a city",
    parameters: Type.Object({ city: Type.String() }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `Weather for ${params.city}: sunny` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "search_issues",
    label: "Search Issues",
    description: "Search project issues by keyword",
    parameters: Type.Object({ query: Type.String() }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `No open issues matching ${params.query}` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "search_tools",
    label: "Search Tools",
    description: "Search for and enable tools relevant to a task",
    promptSnippet: "Search for additional tools when the active tools cannot perform the task",
    promptGuidelines: [
      "Use search_tools when a task requires a capability that is not currently available.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Capability or task to search for" }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    async execute(_toolCallId, params) {
      const terms = params.query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const matches = pi.getAllTools()
        .filter((tool) => SEARCHABLE_TOOL_NAMES.has(tool.name))
        .map((tool) => ({
          tool,
          score: terms.reduce(
            (score, term) =>
              score + (`${tool.name} ${tool.description}`.toLowerCase().includes(term) ? 1 : 0),
            0,
          ),
        }))
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, params.limit ?? 3)
        .map((match) => match.tool.name);

      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: `No tools found for: ${params.query}` }],
          details: { matches: [] },
        };
      }

      const active = pi.getActiveTools();
      const added = matches.filter((name) => !active.includes(name));
      pi.setActiveTools([...new Set([...active, ...added])]);

      return {
        content: [{
          type: "text",
          text: added.length > 0
            ? `Loaded tools: ${added.join(", ")}`
            : `Matching tools already active: ${matches.join(", ")}`,
        }],
        details: { matches, added },
      };
    },
  });

  pi.on("session_start", () => {
    // Keep searchable tools registered but initially inactive. Preserve built-ins
    // and tools owned by other extensions, and keep the loader itself active.
    const initialTools = pi.getActiveTools().filter(
      (name) => !SEARCHABLE_TOOL_NAMES.has(name),
    );
    pi.setActiveTools([...new Set([...initialTools, "search_tools"])]);
  });
}
```

When `search_tools` adds a match, the model receives that definition on the immediately following request. On a native-capable model the definition is anchored after the search result without changing the initial tool-schema prefix. On other models it appears in the normal tool list on that same following request.

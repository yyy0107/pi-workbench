import {
  createFindToolDefinition,
  createGrepToolDefinition,
  truncateHead,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Keep Pi's search, ignore rules, cancellation and truncation; add bounded multi-root search. */
export function createEnhancedSearchTools(cwd: string) {
  const definitions = [
    createGrepToolDefinition(cwd),
    ...(process.platform === "win32" ? [] : [createFindToolDefinition(cwd)]),
  ];
  return definitions.map((base) => {
    const parameters = Type.Object({
      ...base.parameters.properties,
      paths: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 8 })),
    });
    return {
      name: base.name,
      label: base.label,
      promptSnippet: base.promptSnippet,
      description: `${base.description} Workbench: optionally search up to 8 directories using paths instead of path. Grep includes 2 context lines unless context is specified. Combined output remains limited to 50 KB.`,
      parameters,
      async execute(id, params, signal, onUpdate, ctx) {
        const roots = params.paths ?? [params.path];
        const results = [];
        for (const root of roots) {
          const result = await base.execute(
            id,
            {
              ...params,
              path: root,
              ...(base.name === "grep"
                ? {
                    context:
                      "context" in params && typeof params.context === "number"
                        ? params.context
                        : 2,
                  }
                : {}),
            },
            signal,
            onUpdate,
            ctx,
          );
          results.push({ path: root ?? cwd, result });
        }
        if (results.length === 1) return results[0]!.result;
        const text = results
          .map(
            ({ path, result }) =>
              `## ${path}\n${result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")}`,
          )
          .join("\n\n");
        const truncated = truncateHead(text, { maxLines: Number.MAX_SAFE_INTEGER });
        return {
          content: [
            {
              type: "text",
              text:
                truncated.content +
                (truncated.truncated
                  ? "\n[Combined output truncated. Search fewer directories or refine the pattern.]"
                  : ""),
            },
          ],
          details: {
            searches: results.map(({ path, result }) => ({ path, details: result.details })),
            truncation: truncated,
          },
        };
      },
    } satisfies ToolDefinition<typeof parameters>;
  });
}

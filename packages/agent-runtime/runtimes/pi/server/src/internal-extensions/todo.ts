import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Each replacement is a normal tool result, so Pi persists and restores it with the branch. */
export const todoExtension: ExtensionFactory = (pi) => {
  pi.registerTool({
    name: "workbench_todo",
    label: "Todo",
    description:
      "Replace the current task checklist. Use for multi-step work; keep it updated as steps finish. Previous lists remain in conversation history. This does not schedule tasks or execute work.",
    promptSnippet: "Track progress on multi-step work with a task checklist",
    parameters: Type.Object(
      {
        items: Type.Array(
          Type.Object(
            {
              text: Type.String({ minLength: 1, maxLength: 500 }),
              status: Type.Union([
                Type.Literal("pending"),
                Type.Literal("in_progress"),
                Type.Literal("completed"),
              ]),
            },
            { additionalProperties: false },
          ),
          { maxItems: 100 },
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_id, { items }) {
      return {
        content: [{ type: "text", text: JSON.stringify({ items }) }],
        details: { items },
      };
    },
  });
};

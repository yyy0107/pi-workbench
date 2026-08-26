import assert from "node:assert/strict";
import test from "node:test";

import { PromptService } from "./prompt-service";

test("lists prompts from the requested scope without a Pi session", async () => {
  const targets: unknown[] = [];
  const service = new PromptService({
    scopedResources: {
      get: async (target) => {
        targets.push(target);
        return {
          resourceLoader: {
            getPrompts: () => ({
              prompts: [
                {
                  name: "user-review",
                  description: "Review user changes.",
                  argumentHint: "[path]",
                  sourceInfo: { source: "auto", scope: "user", origin: "top-level" },
                },
                {
                  name: "project-review",
                  sourceInfo: { source: "auto", scope: "project", origin: "top-level" },
                },
              ],
              errors: [],
            }),
          },
        } as never;
      },
    },
  });

  assert.deepEqual(await service.list({ target: { scope: "user" } }), {
    prompts: [
      {
        kind: "prompt",
        name: "user-review",
        invocationName: "user-review",
        effect: "prompt-transform",
        exclusive: false,
        description: "Review user changes.",
        argumentHint: "[path]",
        source: "auto",
        scope: "user",
        origin: "top-level",
      },
    ],
  });
  assert.deepEqual(targets, [{ scope: "user" }]);
});

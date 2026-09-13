import type { MessageFormatters } from "@workbench/i18n/runtime";
export const messages = {
  workbench: {
    chat: {
      composer: {
        commandSuggestions: "Command suggestions",
        commandParameters: {
          close: "Close command parameters",
          disabled: "Disabled",
          done: "Done",
          edit: ({ command }: { command: string }) => `Edit parameters for ${command}`,
          enabled: "Enabled",
          notSet: "Not set",
          optional: "Optional",
          required: "Required",
          reset: "Reset",
          selectPlaceholder: "Select a value",
          title: "Command parameters",
          valuePlaceholder: ({ parameter }: { parameter: string }) => `Enter ${parameter}`,
          errors: {
            integer: "Enter a whole number.",
            invalidChoice: "Select a valid value.",
            invalidNumber: "Enter a valid number.",
            maximum: ({ limit }: { limit: string }) => `Enter ${limit} or less.`,
            maxLength: ({ limit }: { limit: string }) => `Use no more than ${limit} characters.`,
            minimum: ({ limit }: { limit: string }) => `Enter ${limit} or more.`,
            minLength: ({ limit }: { limit: string }) => `Use at least ${limit} characters.`,
            required: "Enter a value.",
          },
        },
        commandGroups: {
          builtin: (
            { runtimeName, count }: { runtimeName: string; count: number },
            { number }: MessageFormatters,
          ) => `${runtimeName} built-ins (${number(count)})`,
          extension: ({ count }: { count: number }, { number }: MessageFormatters) =>
            `Extensions (${number(count)})`,
          prompt: ({ count }: { count: number }, { number }: MessageFormatters) =>
            `Prompt templates (${number(count)})`,
          skill: ({ count }: { count: number }, { number }: MessageFormatters) =>
            `Skills (${number(count)})`,
          workbench: ({ count }: { count: number }, { number }: MessageFormatters) =>
            `Workbench (${number(count)})`,
        },
        commandScopes: {
          user: "User",
          project: "Project",
          temporary: "Temporary",
          manualOnly: "Manual only",
        },
        builtinCommands: {
          compact: {
            label: "Compact",
            description: "Manually compact the conversation context",
            argumentHint: "[optional instructions]",
          },
          reload: {
            label: "Reload",
            description: "Reload extensions, skills, prompts, and context files",
          },
        },
      },
    },
  },
};

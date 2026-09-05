import type { ExtensionFactory, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { QuestionAnswerItem } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { QuestionItem } from "@workbench/agent-runtime-pi-protocol/stream";
import type { WorkbenchExtensionUIContext } from "../sessions/interactive-response-registry";

/** Stable model-facing name owned by Workbench's hidden Pi extension. */
export const ASK_USER_TOOL_NAME = "ask_user";

interface AskUserDetails {
  questions: QuestionItem[];
  answers: QuestionAnswerItem[];
  cancelled: boolean;
  disabled?: boolean;
}

export interface AskUserCapabilitySettings {
  readAutoContinue?(): Promise<boolean>;
  subscribeAutoContinue?(listener: (enabled: boolean) => void): () => void;
  readEnabled(): Promise<boolean>;
  subscribe(listener: (enabled: boolean) => void): () => void;
}

const OptionSchema = Type.Object(
  {
    label: Type.String({ minLength: 1, maxLength: 120, description: "Option label" }),
    description: Type.Optional(
      Type.String({ maxLength: 500, description: "Short explanation of the option" }),
    ),
    recommended: Type.Optional(
      Type.Boolean({
        description: "Mark this as the recommended choice; use true on at most one option",
      }),
    ),
  },
  { additionalProperties: false },
);

const QuestionSchema = Type.Object(
  {
    id: Type.String({
      minLength: 1,
      maxLength: 64,
      description: "Stable identifier used to match the answer",
    }),
    header: Type.Optional(
      Type.String({ maxLength: 80, description: "Short category shown above the question" }),
    ),
    question: Type.String({
      minLength: 1,
      maxLength: 500,
      description: "The question shown to the user",
    }),
    detail: Type.Optional(
      Type.String({ maxLength: 1_000, description: "Optional context needed to answer" }),
    ),
    options: Type.Optional(
      Type.Array(OptionSchema, {
        minItems: 1,
        maxItems: 12,
        description:
          "Choices. Provide at least two unless allowCustom is true. Omit this field to request only a free-text answer.",
      }),
    ),
    allowCustom: Type.Optional(
      Type.Boolean({
        description:
          "Show an additional free-text answer beside the choices. Use when the listed choices may not cover the user's answer.",
      }),
    ),
    multiSelect: Type.Optional(
      Type.Boolean({ description: "Allow more than one option to be selected" }),
    ),
    required: Type.Optional(
      Type.Boolean({ description: "Require an answer before submission; defaults to true" }),
    ),
  },
  { additionalProperties: false },
);

const AskUserParameters = Type.Object(
  {
    questions: Type.Array(QuestionSchema, {
      minItems: 1,
      maxItems: 8,
      description: "Questions displayed together in one paginated Ask User card",
    }),
  },
  { additionalProperties: false },
);

const DEFAULT_ASK_USER_CAPABILITY_SETTINGS = Object.freeze({
  async readEnabled() {
    return true;
  },
  subscribe() {
    return () => undefined;
  },
}) satisfies AskUserCapabilitySettings;

async function readEnabledOrDefault(settings: AskUserCapabilitySettings): Promise<boolean> {
  try {
    return await settings.readEnabled();
  } catch (error) {
    console.error("[workbench-pi] Ask User preference could not be read.", error);
    return true;
  }
}

function normalizeQuestions(questions: QuestionItem[]): QuestionItem[] {
  const ids = new Set<string>();
  return questions.map((question) => {
    if (ids.has(question.id)) throw new Error(`Duplicate Ask User question id: ${question.id}`);
    ids.add(question.id);

    const optionLabels = new Set<string>();
    let recommendedOptions = 0;
    for (const option of question.options ?? []) {
      if (optionLabels.has(option.label)) {
        throw new Error(
          `Duplicate option label in Ask User question ${question.id}: ${option.label}`,
        );
      }
      optionLabels.add(option.label);
      if (option.recommended) recommendedOptions += 1;
    }

    if (recommendedOptions > 1) {
      throw new Error(`Ask User question ${question.id} cannot recommend more than one option`);
    }

    if (question.allowCustom && !question.options?.length) {
      throw new Error(
        `Ask User question ${question.id} cannot use allowCustom without choice options`,
      );
    }

    if (question.options?.length === 1 && !question.allowCustom) {
      throw new Error(
        `Ask User question ${question.id} must provide at least two options or allow a custom answer`,
      );
    }

    if (question.multiSelect && !question.options?.length) {
      throw new Error(`Ask User question ${question.id} cannot use multiSelect without options`);
    }

    return {
      ...question,
      ...(question.options === undefined
        ? {}
        : { options: question.options.map((option) => ({ ...option })) }),
      multiSelect: question.multiSelect === true,
      required: question.required !== false,
    };
  });
}

function toolResult(
  questions: QuestionItem[],
  answers: QuestionAnswerItem[] | undefined,
  disabled = false,
): { content: Array<{ type: "text"; text: string }>; details: AskUserDetails } {
  if (!answers) {
    return {
      content: [
        {
          type: "text",
          text: disabled
            ? "Ask User is disabled in Workbench settings; no answers were requested."
            : "Ask User was cancelled; no answers were submitted.",
        },
      ],
      details: {
        questions,
        answers: [],
        cancelled: true,
        ...(disabled ? { disabled: true } : {}),
      },
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `The user submitted these answers:\n${JSON.stringify(answers, null, 2)}`,
      },
    ],
    details: { questions, answers, cancelled: false },
  };
}

function setToolEnabled(pi: Parameters<ExtensionFactory>[0], enabled: boolean): void {
  const activeTools = pi.getActiveTools();
  const currentlyEnabled = activeTools.includes(ASK_USER_TOOL_NAME);
  if (enabled === currentlyEnabled) return;
  pi.setActiveTools(
    enabled
      ? [...activeTools, ASK_USER_TOOL_NAME]
      : activeTools.filter((toolName) => toolName !== ASK_USER_TOOL_NAME),
  );
}

export function createAskUserExtension(
  settings: AskUserCapabilitySettings = DEFAULT_ASK_USER_CAPABILITY_SETTINGS,
): ExtensionFactory {
  return (pi) => {
    let unsubscribe: (() => void) | undefined;

    pi.registerTool({
      name: ASK_USER_TOOL_NAME,
      label: "Ask User",
      description:
        "Ask the user one or more structured questions and wait for their answers. Use this only when a missing decision or required detail materially changes the work; continue directly when a safe default is available.",
      promptSnippet: "Ask the user one or more structured clarification questions",
      promptGuidelines: [
        "Use ask_user only for decisions or missing information that cannot be resolved safely from available context.",
        "Keep ask_user questions concise and use stable unique ids.",
        "For a choice question, provide at least two distinct options. If the choices may not cover the user's answer, set allowCustom: true so they can type another answer; a single option is valid only with allowCustom.",
        "When one choice is preferable, put it first and set recommended: true on that option; never mark more than one option per question.",
        "Group related ask_user questions into one tool call so the user can answer them in a single paginated card.",
      ],
      parameters: AskUserParameters,
      executionMode: "sequential",

      async execute(_toolCallId, params, signal, _onUpdate, context) {
        const questions = normalizeQuestions(params.questions);
        if (!(await readEnabledOrDefault(settings))) return toolResult(questions, undefined, true);
        if (!context.hasUI) throw new Error("Ask User requires an interactive Workbench host");

        const ui = context.ui as ExtensionUIContext & Partial<WorkbenchExtensionUIContext>;
        if (typeof ui.workbenchAskUser !== "function") {
          throw new Error("Ask User requires the Workbench question UI");
        }
        const answers = await ui.workbenchAskUser(questions, { signal });
        return toolResult(questions, answers);
      },
    });

    pi.on("session_start", async () => {
      unsubscribe ??= settings.subscribe((enabled) => setToolEnabled(pi, enabled));
      setToolEnabled(pi, await readEnabledOrDefault(settings));
    });

    pi.on("session_shutdown", () => {
      unsubscribe?.();
      unsubscribe = undefined;
    });
  };
}

export const askUserExtension = createAskUserExtension();

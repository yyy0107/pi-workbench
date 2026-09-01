"use client";

import type { EnrichedPartState } from "@assistant-ui/react";
import type { GenerativeUILibrary } from "@assistant-ui/react-generative-ui";
import { defaultGenerativeUILibrary, renderGenerativeUI } from "@assistant-ui/react-generative-ui";

import type { MessagePartRendererProps } from "@workbench/extension-sdk";
import { useI18n } from "../../../i18n";

import styles from "./generative-ui.module.css";
import { GENERATIVE_UI_COMPONENT_NAMES, readGenerativeUISpec } from "./generative-ui-spec";

const library = Object.fromEntries(
  GENERATIVE_UI_COMPONENT_NAMES.map((name) => [name, defaultGenerativeUILibrary[name]]),
) as GenerativeUILibrary;

function partSpec(part: EnrichedPartState): unknown | undefined {
  if (part.type === "text") return readGenerativeUISpec(part.text);
  if (part.type === "generative-ui") return readGenerativeUISpec(part.spec);
  return undefined;
}

export function canRenderGenerativeUIPart(part: EnrichedPartState): boolean {
  return partSpec(part) !== undefined;
}

function GenerativeUISpec({ preview = false, spec }: { preview?: boolean; spec: unknown }) {
  return (
    <div
      data-aui-theme="elements"
      className={preview ? `${styles.root} ${styles.preview}` : styles.root}
    >
      {renderGenerativeUI(spec, library, { status: "done" })}
    </div>
  );
}

export function GenerativeUIRenderer({ part }: MessagePartRendererProps) {
  const spec = partSpec(part);
  if (spec === undefined) return null;

  return <GenerativeUISpec spec={spec} />;
}

export function GenerativeUIPreview() {
  const { t } = useI18n();
  const spec = {
    $type: "Card",
    children: [
      {
        $type: "Row",
        align: "center",
        children: [
          {
            $type: "Col",
            gap: 1,
            children: [
              {
                $type: "Header",
                text: t("extensions.generativeUi.preview.title"),
                size: "md",
              },
              {
                $type: "Caption",
                value: t("extensions.generativeUi.preview.caption"),
              },
            ],
          },
          { $type: "Spacer" },
          {
            $type: "Button",
            label: t("extensions.generativeUi.preview.action"),
            buttonStyle: "outline",
          },
        ],
      },
      { $type: "Divider" },
      {
        $type: "Text",
        value: t("extensions.generativeUi.preview.body"),
        color: "secondary",
      },
    ],
  };

  return <GenerativeUISpec preview spec={spec} />;
}

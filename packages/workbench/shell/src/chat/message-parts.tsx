"use client";

import { MessagePrimitive, useAuiState } from "@assistant-ui/react";
import { Loader2Icon } from "lucide-react";

import { File } from "../assistant-ui/file";
import { Image } from "../assistant-ui/image";
import { isSharedMessagePartLeaf, MessagePartLeaf } from "../assistant-ui/message-part-leaves";
import { useI18n } from "../i18n";
import {
  MessagePartRendererHost,
  MessageRendererHost,
} from "@workbench/extension-host/hosts/renderer-host";

import { WorkbenchComposerMessageText } from "./composer-message-text";

function DefaultWorkbenchMessageParts() {
  const { t } = useI18n();
  const role = useAuiState((state) => state.message.role);

  return (
    <MessagePrimitive.Parts>
      {({ part }) => {
        switch (part.type) {
          case "text": {
            if (part.status.type === "running" && part.text === "") {
              return (
                <span className="my-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  {t("workbench.chat.generating")}
                </span>
              );
            }

            if (role === "user") return <WorkbenchComposerMessageText text={part.text} />;

            const fallback = <p className="whitespace-pre-wrap">{part.text}</p>;
            return <MessagePartRendererHost part={part} fallback={fallback} />;
          }
          case "reasoning":
            return (
              <pre className="text-muted-foreground my-2 whitespace-pre-wrap text-xs">
                {part.text}
              </pre>
            );
          case "image":
            return <Image {...part} />;
          case "file":
            return <File {...part} />;
          default:
            return isSharedMessagePartLeaf(part) ? (
              <MessagePartLeaf
                part={part}
                sourceFallbackLabel={t("workbench.chat.sourceFallback")}
              />
            ) : null;
        }
      }}
    </MessagePrimitive.Parts>
  );
}

export function WorkbenchMessageParts() {
  return <MessageRendererHost fallback={<DefaultWorkbenchMessageParts />} />;
}

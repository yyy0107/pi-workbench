"use client";

import { useEffect, useRef, useState } from "react";
import { FileTextIcon } from "lucide-react";
import { useConversationSession } from "@workbench/agent-runtime-client";
import type { PastedTextAttachment } from "@workbench/agent-runtime-contracts/composer-attachments";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../ui/dialog";
import { useI18n } from "../i18n";

export function PastedTextAttachmentPreview({ attachment }: { attachment: PastedTextAttachment }) {
  const { t } = useI18n();
  const session = useConversationSession();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [nextOffset, setNextOffset] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const read = session.actions.readPastedTextAttachment;

  const load = async (offset: number, current: number) => {
    setLoading(true);
    setFailed(false);
    try {
      if (!read) throw new Error("Text attachment reading is unavailable");
      const page = await read({ id: attachment.id, offset });
      if (generation.current !== current) return;
      setText((previous) => (offset === 0 ? page.text : previous + page.text));
      setNextOffset(page.nextOffset);
    } catch {
      if (generation.current === current) setFailed(true);
    } finally {
      if (generation.current === current) setLoading(false);
    }
  };

  useEffect(() => {
    const current = ++generation.current;
    setText("");
    setNextOffset(undefined);
    setFailed(false);
    if (open) void load(0, current);
    return () => {
      generation.current++;
    };
  }, [open, attachment.id, read]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            className="h-auto max-w-full justify-start text-start"
            aria-label={t("chatContent.textAttachment.preview")}
          />
        }
      >
        <FileTextIcon />
        <span className="min-w-0">
          <span className="block truncate">
            {attachment.preview || t("chatContent.textAttachment.title")}
          </span>
          <span className="text-muted-foreground block text-xs">
            {t("chatContent.textAttachment.characters", { count: attachment.characterCount })}
          </span>
        </span>
      </DialogTrigger>
      <DialogContent closeLabel={t("assistant.common.close")} className="max-w-3xl">
        <DialogTitle>{t("chatContent.textAttachment.title")}</DialogTitle>
        <pre className="bg-muted max-h-[60vh] overflow-auto rounded-[var(--radius-md)] p-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
          {text}
        </pre>
        {failed && (
          <p role="alert" className="text-destructive">
            {t("chatContent.textAttachment.unavailable")}
          </p>
        )}
        {(failed || nextOffset !== undefined) && (
          <Button
            variant="ghost"
            disabled={loading}
            onClick={() => void load(nextOffset ?? 0, generation.current)}
          >
            {t(failed ? "chatContent.textAttachment.retry" : "chatContent.textAttachment.loadMore")}
          </Button>
        )}
        {loading && (
          <p role="status" className="text-muted-foreground">
            {t("chatContent.textAttachment.loading")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

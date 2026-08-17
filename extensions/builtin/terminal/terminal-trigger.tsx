"use client";

import { TerminalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePanelService } from "@/platform/extensions";

export function TerminalTrigger() {
  const panels = usePanelService();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="md:hidden"
      aria-label="Toggle terminal"
      onClick={() => panels.toggle("terminal")}
    >
      <TerminalIcon className="size-4" />
    </Button>
  );
}

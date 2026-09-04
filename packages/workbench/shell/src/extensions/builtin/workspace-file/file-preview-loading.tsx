import { LoaderCircleIcon } from "lucide-react";

import { cn } from "@workbench/shell/utils";

export interface FilePreviewLoadingProps {
  label: string;
  className?: string;
}

export function FilePreviewLoading({ label, className }: Readonly<FilePreviewLoadingProps>) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "text-muted-foreground flex size-full flex-col items-center justify-center gap-2.5 p-8 text-center text-sm",
        className,
      )}
    >
      <LoaderCircleIcon
        aria-hidden="true"
        className="size-5 animate-spin motion-reduce:animate-none"
      />
      <span>{label}</span>
    </div>
  );
}

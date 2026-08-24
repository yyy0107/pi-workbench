import { FileWarningIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface FilePreviewUnavailableProps {
  title: string;
  description: string;
  className?: string;
}

export function FilePreviewUnavailable({
  title,
  description,
  className,
}: Readonly<FilePreviewUnavailableProps>) {
  return (
    <div
      role="alert"
      className={cn(
        "bg-background/95 flex size-full items-center justify-center p-8 text-center",
        className,
      )}
    >
      <div className="flex max-w-sm flex-col items-center">
        <FileWarningIcon
          aria-hidden="true"
          className="text-muted-foreground mb-4 size-10 stroke-[1.6]"
        />
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-muted-foreground mt-2 text-sm">{description}</p>
      </div>
    </div>
  );
}

import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "../utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-[var(--input-control-height)] w-full min-w-0 rounded-[var(--input-control-radius)] border [border-color:var(--input-control-border)] [background:var(--input-control-background)] px-2.5 pt-[var(--input-control-padding-block-start)] pb-[var(--input-control-padding-block-end)] text-base leading-[var(--control-text-line-height)] transition-colors outline-none file:inline-flex file:h-[var(--control-hit-compact)] file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:[background:var(--input-control-background-disabled)] disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "../utils";

type SwitchSize = "default" | "compact";

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & { size?: SwitchSize }) {
  const compact = size === "compact";

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-[var(--switch-track-radius)] [background:var(--switch-track-background)] p-[var(--switch-track-padding)] transition-colors outline-none data-checked:[background:var(--switch-track-background-checked)] data-disabled:cursor-not-allowed data-disabled:opacity-50 data-focused:ring-3 data-focused:[--tw-ring-color:color-mix(in_oklab,var(--control-focus-ring)_50%,transparent)]",
        compact
          ? "h-[var(--switch-compact-track-height)] w-[var(--switch-compact-track-width)]"
          : "h-[var(--switch-track-height)] w-[var(--switch-track-width)]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-[var(--switch-thumb-radius)] [background:var(--switch-thumb-background)] shadow-xs transition-transform",
          compact
            ? "size-[var(--switch-compact-thumb-size)] data-checked:translate-x-[var(--switch-compact-thumb-translate)]"
            : "size-[var(--switch-thumb-size)] data-checked:translate-x-[var(--switch-thumb-translate)]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };

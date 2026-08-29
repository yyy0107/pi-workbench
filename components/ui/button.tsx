import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const iconButtonInteractionStyles = [
  "[&:not([data-frame=none]):hover:not(:active)]:[background:var(--icon-frame-background-hover)]!",
  "[&:not([data-frame=none]):focus-visible:not(:active)]:[background:var(--icon-frame-background-hover)]!",
  "[&:not([data-frame=none]):active]:[background:var(--icon-frame-background-active)]!",
  "[&:not([data-selection=none])]:aria-expanded:[background:var(--icon-frame-background-selected)]!",
  "[&:not([data-selection=none])]:aria-expanded:[color:var(--icon-frame-foreground-selected)]!",
  "[&:not([data-selection=none])]:aria-pressed:[background:var(--icon-frame-background-selected)]!",
  "[&:not([data-selection=none])]:aria-pressed:[color:var(--icon-frame-foreground-selected)]!",
  "[&:not([data-selection=none])]:data-[state=open]:[background:var(--icon-frame-background-selected)]!",
  "[&:not([data-selection=none])]:data-[state=open]:[color:var(--icon-frame-foreground-selected)]!",
  "[&:not([data-selection=none])]:data-[state=on]:[background:var(--icon-frame-background-selected)]!",
  "[&:not([data-selection=none])]:data-[state=on]:[color:var(--icon-frame-foreground-selected)]!",
  "[&:not([data-selection=none])]:data-popup-open:[background:var(--icon-frame-background-selected)]!",
  "[&:not([data-selection=none])]:data-popup-open:[color:var(--icon-frame-foreground-selected)]!",
].join(" ");

const iconButtonStyles = cn(
  "aui-button-icon size-[var(--icon-frame-size-default)]! min-h-[var(--icon-frame-size-default)] min-w-[var(--icon-frame-size-default)] p-0! [&_svg]:size-[var(--icon-size-md)]! [&_svg.lucide]:[stroke-width:1.5]!",
  iconButtonInteractionStyles,
);
const compactIconButtonStyles = cn(
  "aui-button-icon size-[var(--icon-frame-size-compact)]! min-h-[var(--icon-frame-size-compact)] min-w-[var(--icon-frame-size-compact)] p-0! [&_svg]:size-[var(--icon-size-md)]! [&_svg.lucide]:[stroke-width:1.5]!",
  iconButtonInteractionStyles,
);

const selectableButtonStateStyles = [
  "[&:not([data-selection=none])]:aria-expanded:[background:var(--button-background-selected)]",
  "[&:not([data-selection=none])]:aria-expanded:[color:var(--button-foreground-selected)]",
  "[&:not([data-selection=none])]:aria-pressed:[background:var(--button-background-selected)]",
  "[&:not([data-selection=none])]:aria-pressed:[color:var(--button-foreground-selected)]",
  "[&:not([data-selection=none])]:aria-selected:[background:var(--button-background-selected)]",
  "[&:not([data-selection=none])]:aria-selected:[color:var(--button-foreground-selected)]",
  "[&:not([data-selection=none])]:aria-[current=page]:[background:var(--button-background-selected)]",
  "[&:not([data-selection=none])]:aria-[current=page]:[color:var(--button-foreground-selected)]",
  "[&:not([data-selection=none])]:data-[state=open]:[background:var(--button-background-selected)]",
  "[&:not([data-selection=none])]:data-[state=open]:[color:var(--button-foreground-selected)]",
  "[&:not([data-selection=none])]:data-[state=on]:[background:var(--button-background-selected)]",
  "[&:not([data-selection=none])]:data-[state=on]:[color:var(--button-foreground-selected)]",
  "[&:not([data-selection=none])]:data-popup-open:[background:var(--button-background-selected)]",
  "[&:not([data-selection=none])]:data-popup-open:[color:var(--button-foreground-selected)]",
].join(" ");

const neutralButtonInteractionStyles = [
  "[&:not([data-frame=none])]:hover:[background:var(--button-background-hover)]",
  "[&:not([data-frame=none])]:active:[background:var(--button-background-active)]",
].join(" ");

const buttonVariants = cva(
  cn(
    "group/button inline-flex min-h-[var(--button-height-compact)] min-w-[var(--button-height-compact)] shrink-0 items-center justify-center rounded-[var(--button-radius)] border border-transparent bg-clip-padding pt-[var(--button-content-padding-block-start)] pb-[var(--button-content-padding-block-end)] text-sm leading-[var(--control-text-line-height)]! font-medium whitespace-nowrap transition-all outline-none select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg.lucide]:[stroke-width:1.5]! [&_svg:not([class*='size-'])]:size-[var(--icon-size-md)]",
    selectableButtonStateStyles,
  ),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline: cn(
          "border-border bg-background hover:text-foreground dark:border-input dark:[background:var(--input-control-background)]",
          neutralButtonInteractionStyles,
        ),
        secondary: cn("bg-secondary text-secondary-foreground", neutralButtonInteractionStyles),
        ghost: cn("hover:text-foreground", neutralButtonInteractionStyles),
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-[var(--button-height-default)] min-w-[var(--button-height-compact)] gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-[var(--button-height-compact)] min-h-[var(--button-height-compact)] min-w-[var(--button-height-compact)] gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-[var(--icon-size-sm)]",
        sm: "h-[var(--button-height-default)] min-h-[var(--button-height-default)] min-w-[var(--button-height-compact)] gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-[var(--icon-size-sm)]",
        lg: "h-[var(--button-height-large)] min-h-[var(--button-height-default)] min-w-[var(--button-height-compact)] gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: iconButtonStyles,
        "icon-sm": compactIconButtonStyles,
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };

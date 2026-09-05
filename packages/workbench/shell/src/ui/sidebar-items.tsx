"use client";

import {
  cloneElement,
  useCallback,
  useId,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { ChevronRightIcon } from "lucide-react";

import type { SidebarDragBinding } from "../hooks/use-sidebar-pointer-reorder";
import { cn } from "../utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
import { collapsePanel } from "./surface";

export function SidebarGroup({
  header,
  children,
  indent = false,
  animateContent = false,
  dropPosition,
  className,
  ...props
}: Omit<ComponentProps<typeof Collapsible>, "children"> & {
  header: ReactNode;
  children: ReactNode;
  indent?: boolean;
  animateContent?: boolean;
  dropPosition?: SidebarDragBinding["dropPosition"];
}) {
  const [contentHeight, setContentHeight] = useState<number>();
  const measureContent = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const measure = () => setContentHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Collapsible
      render={<section />}
      data-slot="sidebar-group"
      data-sidebar-drop={dropPosition}
      className={cn("sidebar-group", className)}
      {...props}
    >
      {header}
      <CollapsibleContent
        className={cn(collapsePanel, "sidebar-group-content outline-none")}
        data-indent={indent || undefined}
        data-animate-content={animateContent || undefined}
        style={(state) =>
          animateContent &&
          state.open &&
          state.transitionStatus === "idle" &&
          contentHeight !== undefined
            ? ({ "--collapsible-panel-height": `${contentHeight}px` } as CSSProperties)
            : undefined
        }
      >
        {animateContent ? <div ref={measureContent}>{children}</div> : children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A section heading is a disclosure and drop target, with no selectable row state. */
export function SidebarSectionHeading({
  label,
  expanded,
  description,
  actions,
  drag,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  label: ReactNode;
  expanded: boolean;
  description?: ReactNode;
  actions?: ReactNode;
  drag?: Pick<SidebarDragBinding, "ref" | "dropPosition" | "shouldSuppressClick">;
}) {
  const labelId = useId();
  const descriptionId = useId();

  return (
    <div
      {...props}
      ref={drag?.ref ?? props.ref}
      data-slot="sidebar-section-heading"
      data-sidebar-drop={drag?.dropPosition}
      className={cn("sidebar-section-heading", className)}
    >
      <CollapsibleTrigger
        type="button"
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        className="sidebar-section-trigger"
        onClick={(event) => {
          if (drag?.shouldSuppressClick()) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      />
      <h2 id={labelId} className="sidebar-section-label">
        {label}
      </h2>
      <span className="sidebar-section-chevron" aria-hidden="true">
        <ChevronRightIcon className={expanded ? "rotate-90" : undefined} />
      </span>
      {actions}
      {description ? (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      ) : null}
    </div>
  );
}

export interface SidebarRowProps extends Omit<ComponentProps<"div">, "children"> {
  icon?: ReactNode;
  hoverIcon?: ReactNode;
  label: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
  variant?: "folder" | "item";
  active?: boolean;
  menuOpen?: boolean;
  trigger?: ReactElement<ComponentProps<"button">>;
  onActivate?: ComponentProps<"button">["onClick"];
  drag?: SidebarDragBinding;
}

/** Row styles size the primary button; action buttons remain siblings, including in collapsible rows. */
export function SidebarRow({
  icon,
  hoverIcon,
  label,
  status,
  actions,
  description,
  variant = "item",
  active = false,
  menuOpen = false,
  trigger = <button />,
  onActivate,
  drag,
  className,
  ...props
}: SidebarRowProps) {
  const labelId = useId();
  const descriptionId = useId();
  const statusId = useId();
  const hasHoverIcon = hoverIcon !== undefined && hoverIcon !== null;

  return (
    <div
      {...props}
      ref={drag?.ref ?? props.ref}
      data-slot="sidebar-row"
      data-variant={variant}
      data-active={active || undefined}
      data-menu-open={menuOpen || undefined}
      data-has-actions={Boolean(actions) || undefined}
      data-has-hover-icon={hasHoverIcon || undefined}
      data-dragging={drag?.dragging || undefined}
      data-draggable={drag?.enabled || undefined}
      data-sidebar-drop={drag?.dropPosition}
      data-workbench-selection-surface=""
      data-workbench-selection-mode={variant === "item" ? "foreground" : undefined}
      className={cn("sidebar-row", className)}
      onPointerDown={drag?.onPointerDown ?? props.onPointerDown}
    >
      {cloneElement(trigger, {
        type: "button",
        "aria-labelledby": labelId,
        "aria-describedby":
          [description && descriptionId, status && statusId].filter(Boolean).join(" ") || undefined,
        "aria-current": active && variant === "item" ? "page" : undefined,
        className: cn(trigger.props.className, "sidebar-row-trigger"),
        onClick: (event) => {
          if (drag?.shouldSuppressClick()) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          trigger.props.onClick?.(event);
          if (!event.defaultPrevented) onActivate?.(event);
        },
      })}
      <span className="sidebar-row-icon" aria-hidden="true">
        <span data-icon="default">{icon}</span>
        {hasHoverIcon ? <span data-icon="hover">{hoverIcon}</span> : null}
      </span>
      <span id={labelId} className="sidebar-row-label">
        {label}
      </span>
      {status ? (
        <span id={statusId} className="sidebar-row-status">
          {status}
        </span>
      ) : null}
      {actions}
      {description ? (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      ) : null}
    </div>
  );
}

export function SidebarStatus({
  secondary = false,
  className,
  ...props
}: ComponentProps<"span"> & { secondary?: boolean }) {
  return (
    <span
      data-slot="sidebar-status"
      data-secondary={secondary || undefined}
      className={cn("sidebar-status", className)}
      {...props}
    />
  );
}

/** Put shared controls in children; desktop/mobile slots contain additional quick actions. */
export function SidebarActions({
  children,
  desktop,
  mobile,
  className,
  ...props
}: ComponentProps<"div"> & { desktop?: ReactNode; mobile?: ReactNode }) {
  return (
    <div
      data-slot="sidebar-actions"
      data-sidebar-actions=""
      data-sidebar-actions-mobile-touch=""
      className={cn("sidebar-row-actions", className)}
      {...props}
    >
      {children}
      {desktop ? <div className="sidebar-actions-desktop">{desktop}</div> : null}
      {mobile ? <div className="sidebar-actions-mobile">{mobile}</div> : null}
    </div>
  );
}

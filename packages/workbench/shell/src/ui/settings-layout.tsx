"use client";

import * as React from "react";

import { cn } from "../utils";

/** Props for one visually and semantically grouped settings section. */
export interface SettingsGroupProps extends Omit<React.ComponentProps<"section">, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  headerClassName?: string;
  contentClassName?: string;
}

function SettingsGroup({
  title,
  description,
  headerClassName,
  contentClassName,
  className,
  children,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: SettingsGroupProps) {
  const generatedTitleId = React.useId();
  const titleId = title ? generatedTitleId : undefined;
  return (
    <section
      data-slot="settings-group"
      aria-labelledby={titleId ?? ariaLabelledBy}
      className={cn("min-w-0", className)}
      {...props}
    >
      {title || description ? (
        <div
          data-slot="settings-group-header"
          className={cn("border-b border-border py-3", headerClassName)}
        >
          {title ? (
            <h3 id={titleId} className="text-sm font-semibold text-foreground">
              {title}
            </h3>
          ) : null}
          {description ? (
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div
        data-slot="settings-group-content"
        className={cn("divide-y divide-border", contentClassName)}
      >
        {children}
      </div>
    </section>
  );
}

/** A responsive label/description and control row inside a SettingsGroup. */
export interface SettingsRowProps extends React.ComponentProps<"div"> {
  label: React.ReactNode;
  description?: React.ReactNode;
  contentClassName?: string;
  controlClassName?: string;
}

function SettingsRow({
  label,
  description,
  contentClassName,
  controlClassName,
  className,
  children,
  ...props
}: SettingsRowProps) {
  return (
    <div
      data-slot="settings-row"
      className={cn(
        "grid min-w-0 gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)] sm:items-center",
        className,
      )}
      {...props}
    >
      <div data-slot="settings-row-content" className={cn("min-w-0", contentClassName)}>
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description ? (
          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</div>
        ) : null}
      </div>
      <div
        data-slot="settings-row-control"
        className={cn("min-w-0 sm:justify-self-end", controlClassName)}
      >
        {children}
      </div>
    </div>
  );
}

/** A stacked field layout for labelled controls and validation feedback. */
export interface SettingsFieldProps extends React.ComponentProps<"div"> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  labelClassName?: string;
  contentClassName?: string;
}

function SettingsField({
  label,
  description,
  error,
  labelClassName,
  contentClassName,
  className,
  children,
  ...props
}: SettingsFieldProps) {
  return (
    <div data-slot="settings-field" className={cn("grid min-w-0 gap-1.5", className)} {...props}>
      {label ? (
        <div
          data-slot="settings-field-label"
          className={cn("text-sm font-medium text-foreground", labelClassName)}
        >
          {label}
        </div>
      ) : null}
      {description ? (
        <div className="text-xs leading-5 text-muted-foreground">{description}</div>
      ) : null}
      <div data-slot="settings-field-content" className={cn("min-w-0", contentClassName)}>
        {children}
      </div>
      {error ? (
        <div role="alert" className="text-xs leading-5 text-danger-foreground">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export { SettingsField, SettingsGroup, SettingsRow };

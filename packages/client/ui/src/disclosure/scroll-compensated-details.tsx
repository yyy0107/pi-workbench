"use client";

import { useCallback, type ComponentProps } from "react";

import { useDisclosureScrollLock } from "./use-disclosure-scroll-lock";

const ignoreOpenChange = () => undefined;

export function ScrollCompensatedDetails({
  onClickCapture,
  ...props
}: Omit<ComponentProps<"details">, "ref">) {
  const [detailsRef, , prepareDisclosureTransition] =
    useDisclosureScrollLock<HTMLDetailsElement>(ignoreOpenChange);
  const handleClickCapture = useCallback<NonNullable<ComponentProps<"details">["onClickCapture"]>>(
    (event) => {
      onClickCapture?.(event);
      if (event.defaultPrevented) return;

      const summary = event.currentTarget.querySelector(":scope > summary");
      if (summary?.contains(event.target as Node)) {
        prepareDisclosureTransition(!event.currentTarget.open);
      }
    },
    [onClickCapture, prepareDisclosureTransition],
  );

  return <details ref={detailsRef} onClickCapture={handleClickCapture} {...props} />;
}

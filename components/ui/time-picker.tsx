"use client";

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, "0"));

export interface TimePickerLabels {
  time: string;
  hour: string;
  minute: string;
}

export interface TimePickerProps {
  value: string;
  labels: TimePickerLabels;
  className?: string;
  describedBy?: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  onValueChange(value: string): void;
}

function selectedTimeParts(value: string): readonly [hour: string, minute: string] {
  if (!TIME_PATTERN.test(value)) return ["00", "00"];
  const [hour = "00", minute = "00"] = value.split(":");
  return [hour, minute];
}

const TimePicker = React.forwardRef<HTMLButtonElement, TimePickerProps>(function TimePicker(
  {
    value,
    labels,
    className,
    describedBy,
    disabled = false,
    invalid = false,
    required = false,
    onValueChange,
  },
  ref,
) {
  const [hour, minute] = selectedTimeParts(value);
  const selectedTime = `${hour}:${minute}`;
  const selectedHourRef = React.useRef<HTMLDivElement>(null);
  const selectedMinuteRef = React.useRef<HTMLDivElement>(null);

  return (
    <DropdownMenu
      disabled={disabled}
      onOpenChangeComplete={(open) => {
        if (!open) return;
        selectedHourRef.current?.scrollIntoView({ block: "center" });
        selectedMinuteRef.current?.scrollIntoView({ block: "center" });
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            ref={ref}
            type="button"
            disabled={disabled}
            variant="outline"
            size="sm"
            aria-label={labels.time}
            aria-required={required}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={cn(
              "h-[var(--dropdown-control-height)]! min-h-[var(--dropdown-control-height)]! w-28 justify-between rounded-[var(--input-control-radius)] px-2.5 font-normal tabular-nums",
              className,
            )}
          >
            {selectedTime}
            <ChevronDownIcon aria-hidden="true" data-icon="inline-end" />
          </Button>
        }
      />
      <DropdownMenuContent
        align="center"
        className="grid h-[min(18rem,var(--available-height))] w-40 min-w-40 grid-cols-2 overflow-hidden p-0"
      >
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <span className="border-b px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
            {labels.hour}
          </span>
          <DropdownMenuRadioGroup
            value={hour}
            aria-label={labels.hour}
            className="min-h-0 overflow-y-auto p-1"
            onValueChange={(nextHour) => {
              if (HOURS.includes(nextHour)) onValueChange(`${nextHour}:${minute}`);
            }}
          >
            {HOURS.map((candidate) => (
              <DropdownMenuRadioItem
                key={candidate}
                ref={candidate === hour ? selectedHourRef : undefined}
                value={candidate}
                closeOnClick={false}
                className="justify-center py-1.5 pr-6 pl-1.5 tabular-nums"
              >
                {candidate}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </div>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-s">
          <span className="border-b px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
            {labels.minute}
          </span>
          <DropdownMenuRadioGroup
            value={minute}
            aria-label={labels.minute}
            className="min-h-0 overflow-y-auto p-1"
            onValueChange={(nextMinute) => {
              if (MINUTES.includes(nextMinute)) onValueChange(`${hour}:${nextMinute}`);
            }}
          >
            {MINUTES.map((candidate) => (
              <DropdownMenuRadioItem
                key={candidate}
                ref={candidate === minute ? selectedMinuteRef : undefined}
                value={candidate}
                closeOnClick={false}
                className="justify-center py-1.5 pr-6 pl-1.5 tabular-nums"
              >
                {candidate}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export { TimePicker };

"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { usePiUsageStatisticsClient } from "@workbench/agent-runtime-pi-client/usage-statistics";
import type { UsageStatisticsValue } from "@workbench/agent-runtime-pi-protocol/rpc";
import type { SettingsItemComponentProps } from "@workbench/extension-sdk";
import { formatCompactDuration } from "@workbench/shell/format-duration";
import {
  Button,
  DropdownMenu,
  DropdownMenuRadioGroup,
  SettingsDropdownContent,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
  Skeleton,
  Surface,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";
import {
  activityCalendar,
  smoothTrendPath,
  usageDays,
  usageTrendSeries,
  type ActivityMode,
} from "./usage-statistics-data";
import styles from "./usage-statistics.module.css";
import { withTooltip } from "@workbench/shell/ui";

const SERIES_COLORS = [
  "var(--info)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
const MODES = ["daily", "weekly", "cumulative"] as const;
const RANGES = [7, 30] as const;

function TokenActivity({ snapshot }: { snapshot: UsageStatisticsValue }) {
  const { date, number, t } = usePiI18n();
  const [mode, setMode] = useState<ActivityMode>("daily");
  const calendar = useMemo(
    () => activityCalendar(snapshot.days, snapshot.today, mode),
    [snapshot, mode],
  );
  const maximum = Math.max(0, ...calendar.values.map((day) => day.value));
  const label = (key: string) =>
    date(new Date(`${key}T00:00:00Z`), {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  return (
    <Surface variant="muted" className="rounded-xl p-4 sm:p-5">
      <Tabs value={mode} onValueChange={(value) => setMode(value as ActivityMode)}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium">{t("extensions.usageStatistics.activity")}</h3>
          <TabsList aria-label={t("extensions.usageStatistics.activityMode")}>
            {MODES.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(`extensions.usageStatistics.modes.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value={mode}>
          <div className="overflow-x-auto pb-1">
            <div className={styles.calendar}>
              <div
                className={styles.cells}
                style={{ gridTemplateColumns: `repeat(${calendar.columns}, minmax(0, 1fr))` }}
                role="img"
                aria-label={t("extensions.usageStatistics.activitySummary", {
                  start: label(calendar.values[0]!.date),
                  end: label(snapshot.today),
                })}
              >
                {Array.from({ length: calendar.columns * 7 }, (_, index) => {
                  const day = calendar.values[index - calendar.leading];
                  const intensity =
                    day?.value && maximum > 0
                      ? Math.max(1, Math.ceil((day.value / maximum) * 4))
                      : 0;
                  return withTooltip(
                    <span
                      key={index}
                      className={styles.cell}
                      data-level={intensity}
                      style={{ visibility: day ? undefined : "hidden" }}
                      title={
                        day
                          ? t(
                              mode === "weekly"
                                ? "extensions.usageStatistics.weekValue"
                                : "extensions.usageStatistics.dayValue",
                              {
                                date: label(mode === "weekly" ? day.week : day.date),
                                count: number(day.value),
                              },
                            )
                          : undefined
                      }
                    />,
                    0,
                  );
                })}
              </div>
              <div
                className="mt-2 grid text-xs text-muted-foreground"
                style={{ gridTemplateColumns: `repeat(${calendar.columns}, minmax(0, 1fr))` }}
                aria-hidden="true"
              >
                {calendar.values.flatMap((day, index) =>
                  day.date.endsWith("-01")
                    ? [
                        <span
                          key={day.date}
                          className="whitespace-nowrap"
                          style={{
                            gridColumn: `${Math.min(Math.floor((index + calendar.leading) / 7) + 1, calendar.columns - 2)} / span 3`,
                            textAlign:
                              Math.floor((index + calendar.leading) / 7) >= calendar.columns - 3
                                ? "end"
                                : undefined,
                          }}
                        >
                          {date(new Date(`${day.date}T00:00:00Z`), {
                            month: "short",
                            timeZone: "UTC",
                          })}
                        </span>,
                      ]
                    : [],
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>{t(`extensions.usageStatistics.modeDescriptions.${mode}`)}</p>
            <div className="flex items-center gap-1.5" aria-hidden="true">
              <span>{number(0)}</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <span
                  key={level}
                  className={`${styles.cell} ${styles.legendCell}`}
                  data-level={level}
                />
              ))}
              <span>{number(maximum, { notation: "compact", maximumFractionDigits: 1 })}</span>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </Surface>
  );
}

function TokenTrend({ snapshot }: { snapshot: UsageStatisticsValue }) {
  const { date, number, t } = usePiI18n();
  const [range, setRange] = useState<number>(7);
  const [group, setGroup] = useState("");
  const days = useMemo(() => usageDays(snapshot.days, snapshot.today, range), [snapshot, range]);
  const providers = useMemo(
    () =>
      [
        ...new Set(snapshot.days.flatMap((day) => day.models.map((model) => model.provider))),
      ].sort(),
    [snapshot],
  );
  const provider = providers.find((value) => JSON.stringify(value) === group);
  const series = useMemo(() => usageTrendSeries(days, provider), [days, provider]);
  const maximum = Math.max(1, ...series.flatMap((item) => item.values));
  const x = (index: number) => 60 + (index / (days.length - 1)) * 660;
  const y = (value: number) => 220 - (value / maximum) * 180;
  const dateLabel = (key: string) =>
    date(new Date(`${key}T00:00:00Z`), { month: "short", day: "numeric", timeZone: "UTC" });
  const providerLabel = (value: string) => value || t("extensions.usageStatistics.unknownProvider");
  const seriesLabel = (item: { provider: string; model: string }) =>
    provider === undefined
      ? providerLabel(item.provider)
      : item.model || t("extensions.usageStatistics.unknownModel");
  return (
    <Tabs value={range} onValueChange={(value) => setRange(Number(value))}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {t("extensions.usageStatistics.timeRange")}
        </span>
        <TabsList aria-label={t("extensions.usageStatistics.timeRange")}>
          {RANGES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t("extensions.usageStatistics.recentDays", { count: value })}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value={range}>
        <Surface variant="muted" className="rounded-xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-medium">{t("extensions.usageStatistics.trend")}</h3>
            <DropdownMenu>
              <SettingsDropdownTrigger
                aria-label={t("extensions.usageStatistics.providerGroup")}
                className="max-w-64 justify-between"
              >
                <span className="min-w-0 truncate">
                  {provider === undefined
                    ? t("extensions.usageStatistics.allProviders")
                    : providerLabel(provider)}
                </span>
                <ChevronDownIcon aria-hidden="true" className="text-muted-foreground" />
              </SettingsDropdownTrigger>
              <SettingsDropdownContent align="end">
                <DropdownMenuRadioGroup
                  value={provider === undefined ? "" : group}
                  onValueChange={(value) => setGroup(value)}
                >
                  <SettingsDropdownRadioItem value="">
                    {t("extensions.usageStatistics.allProviders")}
                  </SettingsDropdownRadioItem>
                  {providers.map((value) => (
                    <SettingsDropdownRadioItem key={value} value={JSON.stringify(value)}>
                      <span className="truncate">{providerLabel(value)}</span>
                    </SettingsDropdownRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </SettingsDropdownContent>
            </DropdownMenu>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t(
              provider === undefined
                ? "extensions.usageStatistics.providerGroupingHint"
                : "extensions.usageStatistics.modelGroupingHint",
            )}
          </p>
          {series.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {t("extensions.usageStatistics.noRangeUsage")}
            </p>
          ) : (
            <>
              <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                {series.map((item, index) =>
                  withTooltip(
                    <li
                      key={item.id}
                      className="flex min-w-0 items-center gap-2"
                      title={item.provider}
                    >
                      <svg width="20" height="8" className="shrink-0" aria-hidden="true">
                        <line
                          x1="0"
                          x2="20"
                          y1="4"
                          y2="4"
                          stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                          strokeWidth="2"
                          strokeDasharray={index === 0 ? undefined : `${index + 2} 2`}
                        />
                      </svg>
                      <span className="break-all">{seriesLabel(item)}</span>
                      <span className="tabular-nums">
                        {number(item.total, { notation: "compact", maximumFractionDigits: 1 })}
                      </span>
                    </li>,
                  ),
                )}
              </ul>
              <div className="mt-3 overflow-x-auto">
                <svg
                  viewBox="0 0 750 260"
                  className={styles.trend}
                  role="group"
                  aria-label={t("extensions.usageStatistics.trend")}
                >
                  {[0, 1, 2, 3].map((tick) => {
                    const value = (maximum * tick) / 3;
                    return (
                      <g key={tick}>
                        <line
                          x1="60"
                          x2="720"
                          y1={y(value)}
                          y2={y(value)}
                          stroke="var(--border)"
                          strokeDasharray="3 4"
                        />
                        <text
                          x="50"
                          y={y(value) + 4}
                          textAnchor="end"
                          fill="var(--muted-foreground)"
                          fontSize="11"
                        >
                          {number(value, { notation: "compact", maximumFractionDigits: 1 })}
                        </text>
                      </g>
                    );
                  })}
                  <g
                    key={JSON.stringify([range, provider, snapshot.generatedAt])}
                    className={styles.trendDrawing}
                  >
                    {series.map((item, seriesIndex) => (
                      <g key={item.id}>
                        <path
                          d={smoothTrendPath(
                            item.values.map((value, index) => ({ x: x(index), y: y(value) })),
                          )}
                          fill="none"
                          stroke={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeDasharray={seriesIndex === 0 ? undefined : `${seriesIndex + 2} 2`}
                        />
                        {item.values.map((value, index) => (
                          <Tooltip key={days[index]!.date}>
                            <TooltipTrigger
                              delay={0}
                              render={
                                <circle
                                  cx={x(index)}
                                  cy={y(value)}
                                  r="3"
                                  fill={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}
                                  className={styles.trendPoint}
                                  tabIndex={0}
                                  onPointerDown={(event) => event.preventDefault()}
                                  aria-label={t("extensions.usageStatistics.modelDayValue", {
                                    date: dateLabel(days[index]!.date),
                                    model: seriesLabel(item),
                                    count: number(value),
                                  })}
                                />
                              }
                            />
                            <TooltipContent
                              sideOffset={10}
                              className="gap-2 rounded-xl border border-border bg-popover py-2 text-sm text-popover-foreground shadow-lg [&>div[aria-hidden=true]]:hidden"
                            >
                              <svg width="8" height="8" className="shrink-0" aria-hidden="true">
                                <circle
                                  cx="4"
                                  cy="4"
                                  r="4"
                                  fill={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}
                                />
                              </svg>
                              <span className="min-w-0 break-all text-muted-foreground">
                                {seriesLabel(item)}
                              </span>
                              <span className="shrink-0 tabular-nums">
                                {t("extensions.usageStatistics.tokenValue", {
                                  count: number(value, {
                                    notation: "compact",
                                    maximumFractionDigits: 1,
                                  }),
                                })}
                              </span>
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </g>
                    ))}
                  </g>
                  {days.map((day, index) =>
                    index === days.length - 1 || index % Math.ceil(days.length / 7) === 0 ? (
                      <text
                        key={day.date}
                        x={x(index)}
                        y="248"
                        textAnchor={
                          index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"
                        }
                        fill="var(--muted-foreground)"
                        fontSize="11"
                      >
                        {dateLabel(day.date)}
                      </text>
                    ) : null,
                  )}
                </svg>
              </div>
            </>
          )}
        </Surface>
      </TabsContent>
    </Tabs>
  );
}

export function UsageStatisticsSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const client = usePiUsageStatisticsClient();
  const { date, number, locale, t } = usePiI18n();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [result, setResult] = useState<{ client: typeof client; value: UsageStatisticsValue }>();
  const snapshot =
    result?.client === client && result.value.timeZone === timeZone
      ? result.value
      : client.getSnapshot(timeZone);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void client
      .read(timeZone, controller.signal, (value) => {
        if (!controller.signal.aborted) setResult({ client, value });
      })
      .then(
        (value) => {
          if (!controller.signal.aborted) setResult({ client, value });
        },
        () => {
          if (!controller.signal.aborted) setFailed(true);
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client, revision, timeZone]);

  const metrics = snapshot
    ? ([
        {
          label: "totalTokens",
          value: number(snapshot.totalTokens, { notation: "compact", maximumFractionDigits: 1 }),
          hint: "tokenDefinition",
        },
        {
          label: "peakTokens",
          value: number(snapshot.peakDailyTokens, {
            notation: "compact",
            maximumFractionDigits: 1,
          }),
          hint: "peakDefinition",
        },
        {
          label: "longestChat",
          value:
            formatCompactDuration(Math.floor(snapshot.longestChatMs / 60_000) * 60_000, locale) ||
            number(0, { style: "unit", unit: "minute", unitDisplay: "long" }),
          hint: "durationDefinition",
        },
        {
          label: "currentStreak",
          value: number(snapshot.currentStreak, {
            style: "unit",
            unit: "day",
            unitDisplay: "long",
          }),
          hint: "streakDefinition",
        },
        {
          label: "longestStreak",
          value: number(snapshot.longestStreak, {
            style: "unit",
            unit: "day",
            unitDisplay: "long",
          }),
          hint: "streakDefinition",
        },
      ] as const)
    : [];

  return (
    <div
      data-settings-section={sectionId}
      data-settings-item={itemId}
      className="min-w-0 space-y-6 pb-4"
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>
          {snapshot
            ? t("extensions.usageStatistics.updatedAt", {
                time: date(new Date(snapshot.generatedAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              })
            : t("extensions.usageStatistics.allConversations")}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCwIcon />
          {t("extensions.usageStatistics.refresh")}
        </Button>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-danger-foreground">
          {t("extensions.usageStatistics.loadFailed")}
        </p>
      )}
      {loading && !snapshot && (
        <div role="status" className="space-y-6">
          <span className="sr-only">{t("extensions.usageStatistics.loading")}</span>
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      )}
      {snapshot && (
        <>
          <Surface variant="muted" className="rounded-xl p-3 sm:p-4">
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-y-5">
              {metrics.map((metric) =>
                withTooltip(
                  <div
                    key={metric.label}
                    className="flex flex-col-reverse gap-1.5 px-3 text-center"
                    title={t(`extensions.usageStatistics.${metric.hint}`)}
                  >
                    <dt className="text-xs text-muted-foreground">
                      {t(`extensions.usageStatistics.${metric.label}`)}
                    </dt>
                    <dd className="text-lg font-medium tabular-nums">{metric.value}</dd>
                  </div>,
                ),
              )}
            </dl>
          </Surface>
          {snapshot.days.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("extensions.usageStatistics.empty")}</p>
          )}
          <TokenActivity snapshot={snapshot} />
          <TokenTrend snapshot={snapshot} />
          <p className="text-xs leading-5 text-muted-foreground">
            {t("extensions.usageStatistics.scope", { timeZone: snapshot.timeZone })}
          </p>
        </>
      )}
    </div>
  );
}

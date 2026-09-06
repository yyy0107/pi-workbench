"use client";

import {
  AlertCircleIcon,
  ArrowRightIcon,
  GitBranchIcon,
  GitForkIcon,
  LoaderCircleIcon,
  PlusIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "@workbench/shell/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workbench/shell/ui";
import { Input } from "@workbench/shell/ui";
import {
  SearchableSelector,
  SearchableSelectorCollection,
  SearchableSelectorContent,
  SearchableSelectorEmpty,
  SearchableSelectorGroup,
  SearchableSelectorGroupLabel,
  SearchableSelectorInput,
  SearchableSelectorItem,
  SearchableSelectorList,
  SearchableSelectorTrigger,
} from "@workbench/shell/ui";
import { FileTypeIcon } from "@workbench/shell/workspace-file-tree";
import { useI18n } from "@workbench/shell/i18n";
import { cn } from "@workbench/shell/utils";
import { useMainViewService } from "@workbench/extension-host";
import { useCurrentSession, useThreadList } from "@workbench/agent-runtime-client";
import { WorkbenchAgentCapabilityError } from "@workbench/agent-runtime-client";
import { useWorkbenchWorkspaceCapability } from "@workbench/agent-runtime-client/context";
import type { WorkbenchWorkspaceGitStatus } from "@workbench/agent-runtime-contracts/runtime-capabilities";
import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";

import { publishGitBranchStatus, subscribeGitBranchStatus } from "./git-branch-status-bus";

const GitGraphDialog = lazy(() =>
  import("./git-graph-dialog").then((module) => ({ default: module.GitGraphDialog })),
);

type BranchActionError = "session-busy" | "invalid" | "exists" | "switch" | "create";
type GitBranchSelectorPlacement = "composer" | "header";

function branchActionError(error: unknown, fallback: "switch" | "create"): BranchActionError {
  if (!(error instanceof WorkbenchAgentCapabilityError)) return fallback;
  if (error.code === "busy") return "session-busy";
  if (error.code === "invalid-request") return "invalid";
  if (error.code === "conflict") return "exists";
  return fallback;
}

function GitBranchSelector({
  placement,
  workspaceId,
}: Readonly<{
  placement: GitBranchSelectorPlacement;
  workspaceId?: string;
}>) {
  const { t } = useI18n();
  const workspaceClient = useWorkbenchWorkspaceCapability();
  const activeWorkspaceId = useRef(workspaceId);
  activeWorkspaceId.current = workspaceId;

  const [status, setStatus] = useState<WorkbenchWorkspaceGitStatus>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [switchingBranch, setSwitchingBranch] = useState<string>();
  const [pendingBranch, setPendingBranch] = useState<string>();
  const [switchError, setSwitchError] = useState<BranchActionError>();
  const [createOpen, setCreateOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [graphMounted, setGraphMounted] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<BranchActionError>();
  const requestRevision = useRef(0);
  const branchNameId = useId();

  const loadStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (!workspaceId || !workspaceClient) return;
      const revision = ++requestRevision.current;
      setLoading(true);
      setLoadError(false);
      try {
        const nextStatus = await workspaceClient.describeGit(
          workspaceId,
          signal ? { signal } : undefined,
        );
        if (revision === requestRevision.current && activeWorkspaceId.current === workspaceId) {
          setStatus(nextStatus);
        }
      } catch {
        if (signal?.aborted) return;
        if (revision === requestRevision.current && activeWorkspaceId.current === workspaceId) {
          setLoadError(true);
        }
      } finally {
        if (revision === requestRevision.current && activeWorkspaceId.current === workspaceId) {
          setLoading(false);
        }
      }
    },
    [workspaceClient, workspaceId],
  );

  useEffect(() => {
    requestRevision.current += 1;
    setStatus(undefined);
    setLoadError(false);
    setPendingBranch(undefined);
    setSwitchError(undefined);
    setGraphOpen(false);
    setMenuOpen(false);
    setQuery("");
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus, workspaceId]);

  useEffect(() => {
    if (!workspaceClient) return;
    const unsubscribe = subscribeGitBranchStatus(
      workspaceClient,
      (changedWorkspaceId, nextStatus) => {
        if (
          changedWorkspaceId !== workspaceId ||
          activeWorkspaceId.current !== changedWorkspaceId
        ) {
          return;
        }
        requestRevision.current += 1;
        setStatus(nextStatus);
        setLoading(false);
        setLoadError(false);
      },
    );
    return unsubscribe;
  }, [workspaceClient, workspaceId]);

  const repository = status?.repository ? status : undefined;
  const errorMessage = (error: BranchActionError): string => {
    switch (error) {
      case "session-busy":
        return t("extensions.gitBranch.errors.sessionBusy");
      case "invalid":
        return t("extensions.gitBranch.errors.invalidName");
      case "exists":
        return t("extensions.gitBranch.errors.alreadyExists");
      case "switch":
        return t("extensions.gitBranch.errors.switchFailed");
      case "create":
        return t("extensions.gitBranch.errors.createFailed");
    }
  };

  const switchBranch = async (branch: string) => {
    if (!workspaceId || !workspaceClient || switchingBranch || branch === repository?.branch)
      return;
    setSwitchingBranch(branch);
    setSwitchError(undefined);
    try {
      const nextStatus = await workspaceClient.switchGitBranch(workspaceId, branch);
      if (activeWorkspaceId.current === workspaceId) {
        setStatus(nextStatus);
        publishGitBranchStatus(workspaceClient, workspaceId, nextStatus);
        setPendingBranch(undefined);
        setMenuOpen(false);
        setQuery("");
      }
    } catch (error) {
      if (activeWorkspaceId.current === workspaceId) {
        setSwitchError(branchActionError(error, "switch"));
      }
    } finally {
      if (activeWorkspaceId.current === workspaceId) setSwitchingBranch(undefined);
    }
  };

  const requestBranchSwitch = (branch: string) => {
    if (branch === repository?.branch) return;
    setMenuOpen(false);
    setQuery("");
    setSwitchError(undefined);
    setPendingBranch(branch);
  };

  const createBranch = async () => {
    const branch = branchName.trim();
    if (!workspaceId || !workspaceClient || !branch || creating) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      const nextStatus = await workspaceClient.createGitBranch(workspaceId, branch);
      if (activeWorkspaceId.current === workspaceId) {
        setStatus(nextStatus);
        publishGitBranchStatus(workspaceClient, workspaceId, nextStatus);
        setCreateOpen(false);
        setBranchName("");
      }
    } catch (error) {
      if (activeWorkspaceId.current === workspaceId) {
        setCreateError(branchActionError(error, "create"));
      }
    } finally {
      if (activeWorkspaceId.current === workspaceId) setCreating(false);
    }
  };

  if (!workspaceId || !workspaceClient) return null;
  if (!status && loading) return null;
  if (status && !status.repository) return null;
  if (!repository) {
    if (!loadError) return null;
    return (
      <Button
        type="button"
        variant="ghost"
        aria-label={t("extensions.gitBranch.retry")}
        title={t("extensions.gitBranch.loadError")}
        className={cn(
          "px-2 text-destructive",
          placement === "header"
            ? "border-border/60 bg-muted/70 h-[var(--button-height-default)] max-w-36 rounded-md border text-sm font-medium sm:max-w-48"
            : "max-w-56 rounded-full text-base font-normal",
        )}
        onClick={() => void loadStatus()}
      >
        <AlertCircleIcon aria-hidden="true" />
        <span className="truncate">{t("extensions.gitBranch.loadError")}</span>
      </Button>
    );
  }

  const headLabel = repository.branch
    ? repository.branch
    : repository.detachedHead
      ? t("extensions.gitBranch.detachedAt", { revision: repository.detachedHead })
      : t("extensions.gitBranch.detachedHead");
  const busy = switchingBranch !== undefined;

  return (
    <>
      <SearchableSelector<string>
        items={repository.branches}
        value={repository.branch ?? null}
        open={menuOpen}
        inputValue={query}
        onInputValueChange={setQuery}
        onOpenChange={(open) => {
          if (busy) return;
          setMenuOpen(open);
          if (open) void loadStatus();
          else setQuery("");
        }}
        onValueChange={(branch) => {
          if (branch) requestBranchSwitch(branch);
        }}
      >
        <SearchableSelectorTrigger
          disabled={busy}
          aria-label={t("extensions.gitBranch.select")}
          title={headLabel}
          type="button"
          className={cn(
            "min-w-0 px-2",
            placement === "header"
              ? "border-border/60 bg-muted/70 text-muted-foreground h-[var(--button-height-default)] max-w-36 rounded-md text-sm font-medium sm:max-w-48"
              : "max-w-56 rounded-full border-0 [background:transparent] text-base font-normal hover:[background:var(--button-background-hover)]",
          )}
        >
          {busy || loading ? (
            <LoaderCircleIcon
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <GitBranchIcon aria-hidden="true" />
          )}
          <span className="min-w-0 truncate">
            {switchingBranch
              ? t("extensions.gitBranch.switching", { branch: switchingBranch })
              : headLabel}
          </span>
        </SearchableSelectorTrigger>

        <SearchableSelectorContent
          align="start"
          side="bottom"
          sideOffset={6}
          className="grid max-h-[min(336px,var(--available-height))] w-80 max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] rounded-2xl p-0 shadow-xl ring-1 ring-foreground/15"
        >
          <div className="flex h-11 items-center gap-2 border-b px-3">
            <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <SearchableSelectorInput
              autoFocus
              aria-label={t("extensions.gitBranch.searchLabel")}
              placeholder={t("extensions.gitBranch.searchPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="h-full min-w-0 flex-1 border-0 px-0"
            />
          </div>

          <div className="flex min-h-0 flex-col p-1">
            {!repository.branch && !query.trim() ? (
              <div
                aria-disabled="true"
                className="text-muted-foreground flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm opacity-70"
              >
                <GitBranchIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{headLabel}</span>
                  {repository.changedFileCount > 0 ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {t("extensions.gitBranch.changedFiles", {
                        count: repository.changedFileCount,
                      })}
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}
            <SearchableSelectorEmpty>
              {repository.branches.length
                ? t("extensions.gitBranch.noSearchResults")
                : t("extensions.gitBranch.noBranches")}
            </SearchableSelectorEmpty>
            <SearchableSelectorList className="max-h-none min-h-0 flex-1 p-0">
              <SearchableSelectorGroup items={repository.branches}>
                <SearchableSelectorGroupLabel className="px-2.5 py-1.5 text-sm">
                  {t("extensions.gitBranch.branches")}
                </SearchableSelectorGroupLabel>
                <SearchableSelectorCollection>
                  {(branch: string) => {
                    const current = branch === repository.branch;
                    return (
                      <SearchableSelectorItem
                        key={branch}
                        value={branch}
                        disabled={busy}
                        className={cn(
                          "gap-2.5 rounded-lg px-2.5 pe-9 text-sm",
                          current && repository.changedFileCount > 0 ? "min-h-14" : "min-h-9",
                        )}
                      >
                        <GitBranchIcon
                          aria-hidden="true"
                          className="size-4 text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{branch}</span>
                          {current && repository.changedFileCount > 0 ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {t("extensions.gitBranch.changedFiles", {
                                count: repository.changedFileCount,
                              })}
                            </span>
                          ) : null}
                        </span>
                        {switchingBranch === branch ? (
                          <LoaderCircleIcon
                            aria-hidden="true"
                            className="absolute end-2 size-4 animate-spin motion-reduce:animate-none"
                          />
                        ) : null}
                      </SearchableSelectorItem>
                    );
                  }}
                </SearchableSelectorCollection>
              </SearchableSelectorGroup>
            </SearchableSelectorList>
          </div>

          <div className="border-t p-1">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              className="min-h-9 w-full justify-start gap-2.5 rounded-lg px-2.5 text-sm"
              onClick={() => {
                setMenuOpen(false);
                setBranchName("");
                setCreateError(undefined);
                setCreateOpen(true);
              }}
            >
              <PlusIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              {t("extensions.gitBranch.createAction")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              className="min-h-9 w-full justify-start gap-2.5 rounded-lg px-2.5 text-sm"
              onClick={() => {
                setMenuOpen(false);
                setGraphMounted(true);
                setGraphOpen(true);
              }}
            >
              <GitForkIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              {t("extensions.gitBranch.graph.action")}
            </Button>
          </div>
        </SearchableSelectorContent>
      </SearchableSelector>

      <Dialog
        open={pendingBranch !== undefined}
        onOpenChange={(open) => {
          if (open || busy) return;
          setPendingBranch(undefined);
          setSwitchError(undefined);
        }}
      >
        <DialogContent
          closeLabel={t("extensions.gitBranch.cancelSwitch")}
          showCloseButton={!busy}
          className="gap-0 overflow-hidden p-0 sm:max-w-xl"
        >
          <DialogHeader className="gap-2 px-5 pt-5 pb-4 pe-12">
            <DialogTitle>
              {t(
                repository.changedFileCount > 0
                  ? "extensions.gitBranch.switchWithChangesTitle"
                  : "extensions.gitBranch.switchTitle",
              )}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-foreground">{headLabel}</span>
              <ArrowRightIcon aria-hidden="true" className="size-3.5" />
              <span className="font-medium text-foreground">{pendingBranch}</span>
            </DialogDescription>
          </DialogHeader>

          {repository.changedFileCount > 0 ? (
            <div className="grid gap-4 px-5 pb-5">
              <div className="border-warning/20 bg-warning/10 text-warning-foreground flex items-start gap-2.5 rounded-lg border p-3 text-sm leading-5">
                <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <p>{t("extensions.gitBranch.switchWarning")}</p>
              </div>

              <section className="overflow-hidden rounded-lg border bg-muted/30">
                <header className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
                  <h3 className="font-medium">{t("extensions.gitBranch.affectedFiles")}</h3>
                  <span className="shrink-0 text-muted-foreground">
                    {t("extensions.gitBranch.changedFiles", {
                      count: repository.changedFileCount,
                    })}
                  </span>
                </header>
                <div className="max-h-52 overflow-y-auto p-1">
                  {repository.changedFiles.map((file) => {
                    const additions = file.additions ?? 0;
                    const deletions = file.deletions ?? 0;
                    const hasLineStats =
                      file.additions !== undefined || file.deletions !== undefined;
                    return (
                      <div
                        key={`${file.kind}:${file.path}`}
                        className="flex min-h-10 items-center gap-2 rounded-md px-2.5 py-1.5 hover:bg-muted"
                      >
                        <FileTypeIcon path={file.path} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate" title={file.path}>
                          {file.path}
                        </span>
                        {hasLineStats ? (
                          <span
                            className="flex shrink-0 items-center gap-2 font-mono text-xs"
                            aria-label={t("extensions.gitBranch.lineChanges", {
                              additions,
                              deletions,
                            })}
                          >
                            <span aria-hidden="true" className="text-aui-accent">
                              +{additions}
                            </span>
                            <span aria-hidden="true" className="text-destructive">
                              -{deletions}
                            </span>
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                  {repository.changedFilesTruncated ? (
                    <p className="px-2.5 py-2 text-xs text-muted-foreground">
                      {t("extensions.gitBranch.changedFilesTruncated")}
                    </p>
                  ) : null}
                </div>
              </section>
            </div>
          ) : (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              {t("extensions.gitBranch.switchDescription")}
            </p>
          )}

          {switchError ? (
            <p role="alert" className="px-5 pb-4 text-sm leading-5 text-destructive">
              {errorMessage(switchError)}
            </p>
          ) : null}

          <DialogFooter closeLabel={t("extensions.gitBranch.cancelSwitch")} className="m-0">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPendingBranch(undefined);
                setSwitchError(undefined);
              }}
            >
              {t("extensions.gitBranch.cancelSwitch")}
            </Button>
            <Button
              type="button"
              disabled={busy || !pendingBranch}
              onClick={() => {
                if (pendingBranch) void switchBranch(pendingBranch);
              }}
            >
              {busy ? (
                <LoaderCircleIcon
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : null}
              {t(
                busy ? "extensions.gitBranch.switchingShort" : "extensions.gitBranch.confirmSwitch",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (creating) return;
          setCreateOpen(open);
          if (!open) {
            setBranchName("");
            setCreateError(undefined);
          }
        }}
      >
        <DialogContent
          closeLabel={t("extensions.gitBranch.cancelCreate")}
          showCloseButton={!creating}
        >
          <DialogHeader>
            <DialogTitle>{t("extensions.gitBranch.createTitle")}</DialogTitle>
            <DialogDescription>{t("extensions.gitBranch.createDescription")}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void createBranch();
            }}
          >
            <label className="grid gap-1.5 text-sm font-medium" htmlFor={branchNameId}>
              {t("extensions.gitBranch.branchName")}
              <Input
                id={branchNameId}
                autoFocus
                value={branchName}
                disabled={creating}
                aria-invalid={createError === "invalid" || createError === "exists"}
                placeholder={t("extensions.gitBranch.branchNamePlaceholder")}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setBranchName(event.currentTarget.value);
                  setCreateError(undefined);
                }}
              />
            </label>
            {createError ? (
              <p role="alert" className="text-sm leading-5 text-destructive">
                {errorMessage(createError)}
              </p>
            ) : null}
            <DialogFooter closeLabel={t("extensions.gitBranch.cancelCreate")} className="m-0">
              <Button
                type="button"
                variant="outline"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
              >
                {t("extensions.gitBranch.cancelCreate")}
              </Button>
              <Button type="submit" disabled={creating || !branchName.trim()}>
                {creating ? (
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : null}
                {t(creating ? "extensions.gitBranch.creating" : "extensions.gitBranch.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {graphMounted ? (
        <Suspense fallback={null}>
          <GitGraphDialog open={graphOpen} workspaceId={workspaceId} onOpenChange={setGraphOpen} />
        </Suspense>
      ) : null}
    </>
  );
}

export function ComposerGitBranchSelector() {
  const { draftWorkspace } = useWorkspaceSelection();
  return <GitBranchSelector placement="composer" workspaceId={draftWorkspace?.id} />;
}

export function HeaderGitBranchSelector() {
  const mainViews = useMainViewService();
  const activeMainView = useSyncExternalStore(
    mainViews.subscribe,
    mainViews.getSnapshot,
    mainViews.getInitialSnapshot,
  );
  const current = useCurrentSession();
  const currentThread = useThreadList((snapshot) =>
    snapshot.threads.find((thread) => thread.threadId === current.threadId),
  );
  const { draftWorkspace } = useWorkspaceSelection();

  if (activeMainView) return null;
  return (
    <GitBranchSelector
      placement="header"
      workspaceId={current.isNewThread ? draftWorkspace?.id : currentThread?.workspace?.id}
    />
  );
}

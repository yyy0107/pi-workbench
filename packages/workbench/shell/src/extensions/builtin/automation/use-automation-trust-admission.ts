"use client";

import { useCallback, useState } from "react";

import type { WorkbenchRuntimeHostCapability } from "@workbench/agent-runtime-client/capabilities";

interface PendingAutomationTrust {
  path: string;
  onTrusted: () => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export function useAutomationTrustAdmission(
  host: WorkbenchRuntimeHostCapability,
  onError: (error: unknown) => void,
) {
  const { describeProjectTrust, updateProjectTrust } = host;
  const [pending, setPending] = useState<PendingAutomationTrust>();
  const [savingDecision, setSavingDecision] = useState<"trust" | "decline">();
  const [saveError, setSaveError] = useState(false);

  const admit = useCallback(
    async (
      targetPath: string,
      onTrusted: () => void | Promise<void>,
      pendingErrorHandler?: (error: unknown) => void,
    ) => {
      setSaveError(false);
      const trust = await describeProjectTrust(targetPath);
      if (trust.trusted === true) {
        await onTrusted();
        return true;
      }
      setPending({
        path: trust.path,
        onTrusted,
        ...(pendingErrorHandler ? { onError: pendingErrorHandler } : {}),
      });
      return false;
    },
    [describeProjectTrust],
  );

  const confirm = useCallback(async () => {
    if (!pending || savingDecision) return;
    setSavingDecision("trust");
    setSaveError(false);
    try {
      await updateProjectTrust(pending.path, true);
    } catch {
      setSaveError(true);
      setSavingDecision(undefined);
      return;
    }
    const onTrusted = pending.onTrusted;
    const pendingErrorHandler = pending.onError;
    try {
      await onTrusted();
    } catch (error) {
      (pendingErrorHandler ?? onError)(error);
    } finally {
      setPending(undefined);
      setSavingDecision(undefined);
    }
  }, [onError, pending, savingDecision, updateProjectTrust]);

  const decline = useCallback(async () => {
    if (!pending || savingDecision) return;
    setSavingDecision("decline");
    setSaveError(false);
    try {
      await updateProjectTrust(pending.path, false);
      setPending(undefined);
    } catch {
      setSaveError(true);
    } finally {
      setSavingDecision(undefined);
    }
  }, [pending, savingDecision, updateProjectTrust]);

  const cancel = useCallback(() => {
    if (savingDecision) return;
    setPending(undefined);
    setSaveError(false);
  }, [savingDecision]);

  return {
    admit,
    dialog: {
      error: saveError ? ("save" as const) : undefined,
      open: pending !== undefined,
      path: pending?.path ?? "",
      savingDecision,
      onCancel: cancel,
      onConfirm: confirm,
      onDecline: decline,
    },
  };
}

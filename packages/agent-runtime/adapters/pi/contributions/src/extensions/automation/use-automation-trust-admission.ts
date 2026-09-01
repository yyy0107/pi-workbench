"use client";

import { useCallback, useState } from "react";

import { usePiAutomationClient } from "@workbench/agent-runtime-pi-client/automation";

interface PendingAutomationTrust {
  path: string;
  onTrusted: () => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export function useAutomationTrustAdmission(onError: (error: unknown) => void) {
  const { describeProjectTrust, updateProjectTrust } = usePiAutomationClient();
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
      const trust = await describeProjectTrust({ path: targetPath });
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
      await updateProjectTrust({ path: pending.path, trusted: true });
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
      await updateProjectTrust({ path: pending.path, trusted: false });
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

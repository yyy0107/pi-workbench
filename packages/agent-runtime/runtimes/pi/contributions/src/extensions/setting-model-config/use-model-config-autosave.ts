import { useCallback, useEffect, useRef, useState } from "react";

/** Serializes writes and flushes newer edits on navigation or unmount. */
export function useModelConfigAutosave({
  changeKey,
  enabled,
  getChangeKey,
  save,
}: {
  changeKey: string | undefined;
  enabled: boolean;
  getChangeKey(): string | undefined;
  save(): Promise<boolean>;
}) {
  const latest = useRef({ getChangeKey, save });
  latest.current = { getChangeKey, save };
  const inFlight = useRef<Promise<boolean> | undefined>(undefined);
  const mounted = useRef(true);
  const [saving, setSaving] = useState(false);

  const flushSave = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const operation = Promise.resolve().then(async () => {
      if (mounted.current) setSaving(true);
      try {
        while (true) {
          const snapshot = latest.current;
          const key = snapshot.getChangeKey();
          if (key === undefined) return true;
          if (!(await snapshot.save().catch(() => false))) return false;
        }
      } finally {
        inFlight.current = undefined;
        if (mounted.current) setSaving(false);
      }
    });
    inFlight.current = operation;
    return operation;
  }, []);

  useEffect(() => {
    if (!enabled || changeKey === undefined) return;
    const timer = setTimeout(() => void flushSave(), 700);
    return () => clearTimeout(timer);
  }, [changeKey, enabled, flushSave]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void flushSave();
    };
  }, [flushSave]);

  return { saving, flushSave };
}

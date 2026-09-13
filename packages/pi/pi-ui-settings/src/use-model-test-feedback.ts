import { useEffect, useState } from "react";

export function useModelTestFeedback<T>(result: T | undefined): T | undefined {
  const [expiredResult, setExpiredResult] = useState<T>();
  useEffect(() => {
    if (result === undefined) return;
    const timer = setTimeout(() => setExpiredResult(result), 3000);
    return () => clearTimeout(timer);
  }, [result]);
  return result === expiredResult ? undefined : result;
}

"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

import { useI18n } from "@/i18n";
import { useExtensionErrorReporter } from "@/platform/extensions";

class SurfaceErrorBoundary extends Component<
  Readonly<{
    children: ReactNode;
    fallback: (retry: () => void) => ReactNode;
    onError(error: Error): void;
  }>,
  { error?: Error }
> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error);
  }

  render() {
    if (this.state.error) return this.props.fallback(() => this.setState({ error: undefined }));
    return this.props.children;
  }
}

export function WorkspaceSurfaceBoundary({
  surfaceId,
  children,
}: Readonly<{ surfaceId: string; children: ReactNode }>) {
  const { t } = useI18n();
  const reportError = useExtensionErrorReporter();

  return (
    <SurfaceErrorBoundary
      onError={(error) => reportError(error, { source: "workspace", contributionId: surfaceId })}
      fallback={(retry) => (
        <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-3 p-8 text-center text-sm">
          <p>{t("rightWorkspace.status.error")}</p>
          <button
            type="button"
            className="text-foreground hover:bg-muted h-8 rounded-lg border px-3 text-xs"
            onClick={retry}
          >
            {t("rightWorkspace.status.retry")}
          </button>
        </div>
      )}
    >
      {children}
    </SurfaceErrorBoundary>
  );
}

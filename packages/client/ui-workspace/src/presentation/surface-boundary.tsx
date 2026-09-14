"use client";
import { workspaceTranslationBundle } from "../i18n";
import { useI18n } from "@workbench/i18n";

import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@workbench/ui";

import { useExtensionErrorReporter } from "@workbench/extension-host";

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
  onRetry,
}: Readonly<{ surfaceId: string; children: ReactNode; onRetry?: () => void }>) {
  const { t } = useI18n(workspaceTranslationBundle);
  const reportError = useExtensionErrorReporter();

  return (
    <SurfaceErrorBoundary
      onError={(error) => reportError(error, { source: "workspace", contributionId: surfaceId })}
      fallback={(retry) => (
        <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-3 p-8 text-center text-sm">
          <p>{t("rightWorkspace.status.error")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => {
              onRetry?.();
              retry();
            }}
          >
            {t("rightWorkspace.status.retry")}
          </Button>
        </div>
      )}
    >
      {children}
    </SurfaceErrorBoundary>
  );
}

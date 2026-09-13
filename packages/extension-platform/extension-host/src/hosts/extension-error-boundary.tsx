"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

import type { ExtensionErrorHandler, ExtensionErrorSource } from "../extension-context";

export interface ExtensionErrorBoundaryProps {
  children: ReactNode;
  contributionId: string;
  source?: Exclude<ExtensionErrorSource, "command" | "setup">;
  fallback?: ReactNode | ((error: Error) => ReactNode);
  onError?: ExtensionErrorHandler;
  resetKey?: unknown;
}

interface ExtensionErrorBoundaryState {
  error: Error | null;
}

export class ExtensionErrorBoundary extends Component<
  ExtensionErrorBoundaryProps,
  ExtensionErrorBoundaryState
> {
  state: ExtensionErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ExtensionErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const { contributionId, onError, source = "renderer" } = this.props;
    if (onError) {
      onError(error, {
        source,
        contributionId,
        componentStack: info.componentStack,
      });
    } else {
      console.error(error);
    }
  }

  componentDidUpdate(previousProps: ExtensionErrorBoundaryProps): void {
    if (this.state.error && !Object.is(previousProps.resetKey, this.props.resetKey)) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { fallback = null } = this.props;
    return typeof fallback === "function" ? fallback(error) : fallback;
  }
}

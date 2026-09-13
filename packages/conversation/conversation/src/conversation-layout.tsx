"use client";

import { Component, createRef, type ComponentPropsWithoutRef } from "react";

interface ConversationLayoutProps extends ComponentPropsWithoutRef<"div"> {
  sessionId: string;
  isEmpty: boolean;
  isHistoryLoading: boolean;
  hasDockedComposer: boolean;
}

/** Capture the centered Composer before React removes it, then animate the newly mounted dock. */
export class ConversationLayout extends Component<ConversationLayoutProps> {
  private readonly element = createRef<HTMLDivElement>();
  private animatedDock: HTMLElement | null = null;

  getSnapshotBeforeUpdate(previous: ConversationLayoutProps): DOMRect | null {
    if (
      previous.sessionId !== this.props.sessionId ||
      !previous.isEmpty ||
      previous.hasDockedComposer ||
      previous.isHistoryLoading ||
      this.props.isEmpty ||
      !this.props.hasDockedComposer ||
      this.props.isHistoryLoading ||
      this.element.current?.ownerDocument.defaultView?.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches
    ) {
      return null;
    }
    return (
      this.element.current
        ?.querySelector<HTMLElement>('[data-slot="empty-composer"]')
        ?.getBoundingClientRect() ?? null
    );
  }

  componentDidUpdate(
    previous: ConversationLayoutProps,
    _previousState: unknown,
    source: DOMRect | null,
  ) {
    if (previous.sessionId !== this.props.sessionId || !this.props.hasDockedComposer) {
      this.clearAnimation();
    }
    if (!source || source.width <= 0 || source.height <= 0) return;
    const dock = this.element.current?.querySelector<HTMLElement>("[data-workbench-composer-dock]");
    if (!dock) return;
    this.clearAnimation();
    const target = dock.getBoundingClientRect();
    if (target.width <= 0 || target.height <= 0) return;

    dock.style.setProperty(
      "--composer-dock-enter-transform",
      `translate(${source.left - target.left}px, ${source.top - target.top}px) scale(${source.width / target.width}, ${source.height / target.height})`,
    );
    dock.dataset.animateDock = "";
    this.animatedDock = dock;
  }

  componentWillUnmount() {
    this.clearAnimation();
  }

  private clearAnimation() {
    this.animatedDock?.style.removeProperty("--composer-dock-enter-transform");
    if (this.animatedDock) delete this.animatedDock.dataset.animateDock;
    this.animatedDock = null;
  }

  render() {
    const {
      sessionId: _sessionId,
      isEmpty: _isEmpty,
      isHistoryLoading: _isHistoryLoading,
      hasDockedComposer: _hasDockedComposer,
      onAnimationEnd,
      ...props
    } = this.props;
    return (
      <div
        {...props}
        ref={this.element}
        onAnimationEnd={(event) => {
          if (event.target === this.animatedDock && event.animationName === "composer-dock-enter") {
            this.clearAnimation();
          }
          onAnimationEnd?.(event);
        }}
      />
    );
  }
}

import { useEffect, useId, useRef, type ReactNode } from "react";

interface DialogProps {
  title: string;
  /** Called on Escape / backdrop click. Omit for dialogs that must be answered. */
  onClose?: () => void;
  children: ReactNode;
  /** "panel" is the usual centred card; "sheet" slides up from the bottom on phones. */
  variant?: "panel" | "sheet";
  accent?: string;
  wide?: boolean;
  /** Hide the visible heading (the title is still announced to screen readers). */
  hideTitle?: boolean;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Accessible modal: labelled, focus moves in, Tab is kept inside, Escape closes, focus returns. */
export function Dialog({ title, onClose, children, variant = "panel", accent, wide, hideTitle }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && onClose) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={`overlay overlay--${variant}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`dialog dialog--${variant}${wide ? " dialog--wide" : ""}`}
        style={accent ? ({ "--accent": accent } as React.CSSProperties) : undefined}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className={hideTitle ? "sr-only" : "dialog__title"}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

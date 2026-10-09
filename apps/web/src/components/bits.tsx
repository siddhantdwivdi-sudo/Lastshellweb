import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accent colour of the button (border / hover glow). */
  accent?: string;
  loading?: boolean;
  size?: "md" | "lg";
  variant?: "solid" | "ghost" | "danger";
  children: ReactNode;
}

/** Every button in the app: at least 44px tall, clear disabled and loading states. */
export function Btn({ accent, loading, size = "md", variant = "solid", children, className, disabled, style, ...rest }: BtnProps) {
  const css = accent ? ({ "--accent": accent, ...style } as CSSProperties) : style;
  return (
    <button
      type="button"
      className={`btn btn--${size} btn--${variant}${className ? ` ${className}` : ""}`}
      style={css}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner label="Working" />}
      <span>{children}</span>
    </button>
  );
}

export function Notice({ kind, children }: { kind: "error" | "info"; children: ReactNode }) {
  return (
    <div className={`notice notice--${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

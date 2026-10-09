import type { ToastModel } from "../app/controller";

/** Short message at the bottom of the screen. The controller removes it after a few seconds. */
export function Toast({ toast, onDismiss }: { toast: ToastModel | null; onDismiss(): void }) {
  if (!toast) return null;
  return (
    <div className="toast-wrap" role={toast.kind === "error" ? "alert" : "status"} aria-live="polite">
      <button key={toast.id} type="button" className={`toast toast--${toast.kind}`} onClick={onDismiss}>
        {toast.text}
        <span className="toast__x" aria-hidden="true">
          ✕
        </span>
      </button>
    </div>
  );
}

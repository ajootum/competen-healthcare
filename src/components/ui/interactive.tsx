"use client";

import { useState, useRef, useEffect, useCallback, createContext, useContext } from "react";
import { priority as PRIORITY, type PriorityKey } from "@/lib/design/tokens";

// Interactive components (PUI-004 s3/s7, PUI-005 s3/s4) — the ones that genuinely need client state.
// Everything static lives in ./primitives.tsx so pages can stay server components.
//
// Accessibility is structural here, not decorative:
//   - the dialog traps focus, restores it on close, and is labelled by its own heading
//   - toasts announce through a polite live region; CRITICAL ones use assertive and do NOT auto-dismiss,
//     because PUI-006 makes critical persistent until acknowledged
//   - tabs implement the WAI-ARIA pattern including arrow-key roving focus
//   - the drawer is a dialog too, closes on Escape, and returns focus

// ── Toast (PUI-006 s3 "Toast Notification") ─────────────────────────────────────────────────────────────
export type Toast = { id: number; message: string; level?: PriorityKey; action?: { label: string; onClick: () => void } };

const ToastCtx = createContext<{ push: (t: Omit<Toast, "id">) => void }>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = next.current++;
    setToasts(cur => [...cur, { ...t, id }]);
    // A critical notification must not vanish on a timer — PUI-006 requires it persist until the user
    // acknowledges it. Everything else clears itself.
    if (t.level !== "critical") {
      setTimeout(() => setToasts(cur => cur.filter(x => x.id !== id)), t.level === "high" ? 8000 : 5000);
    }
  }, []);

  const dismiss = (id: number) => setToasts(cur => cur.filter(x => x.id !== id));
  const hasCritical = toasts.some(t => t.level === "critical");

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed top-16 right-4 z-[60] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]"
        role="region" aria-label="Notifications">
        {/* Two live regions: assertive interrupts for critical, polite waits its turn for the rest. */}
        <div aria-live="assertive" aria-atomic="false" className="contents">
          {toasts.filter(t => t.level === "critical").map(t => <ToastCard key={t.id} t={t} onDismiss={() => dismiss(t.id)} />)}
        </div>
        <div aria-live="polite" aria-atomic="false" className="contents">
          {toasts.filter(t => t.level !== "critical").map(t => <ToastCard key={t.id} t={t} onDismiss={() => dismiss(t.id)} />)}
        </div>
      </div>
      {hasCritical && <span className="cmp-sr-only">A critical notification requires acknowledgement.</span>}
    </ToastCtx.Provider>
  );
}

function ToastCard({ t, onDismiss }: { t: Toast; onDismiss: () => void }) {
  const level = t.level ?? "low";
  const p = PRIORITY[level];
  const textVar = level === "critical" || level === "high" ? "var(--cmp-text-critical)"
    : level === "medium" ? "var(--cmp-text-warning)" : "var(--cmp-text-information)";
  return (
    <div className="bg-white border rounded-xl shadow-lg p-3 flex items-start gap-2.5"
      style={{ borderColor: level === "critical" ? "var(--cmp-color-critical)" : "var(--cmp-neutral-200)",
        boxShadow: "var(--cmp-elevation-3)" }}>
      <span aria-hidden style={{ color: textVar }} className="text-sm leading-5">{p.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800">{t.message}</p>
        {level === "critical" && <p className="text-[10px] mt-0.5" style={{ color: textVar }}>Requires acknowledgement</p>}
        {t.action && (
          <button type="button" onClick={() => { t.action!.onClick(); onDismiss(); }}
            className="mt-1.5 text-[11px] font-medium underline" style={{ color: "var(--cmp-color-primary-dark)" }}>
            {t.action.label}
          </button>
        )}
      </div>
      <button type="button" onClick={onDismiss} data-touch-target
        aria-label={level === "critical" ? "Acknowledge notification" : "Dismiss notification"}
        className="text-gray-400 hover:text-gray-600 text-sm leading-none shrink-0 w-6 h-6 flex items-center justify-center">
        {level === "critical" ? "✓" : "✕"}
      </button>
    </div>
  );
}

// ── Confirm dialog (PUI-004 s7, PUI-005 s7 "high-risk actions require confirmation") ────────────────────
export function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", cancelLabel = "Cancel",
  destructive = false, onConfirm, onCancel }: {
  open: boolean; title: string; body?: React.ReactNode;
  confirmLabel?: string; cancelLabel?: string; destructive?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement;
    // Focus the CANCEL control first: for a destructive confirmation, the safe option should be the one a
    // stray Enter hits.
    const focusables = () => [...(panel.current?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? [])];
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); restore.current?.focus(); };
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/30">
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="cmp-dialog-title"
        className="bg-white rounded-xl w-full max-w-sm p-5" style={{ boxShadow: "var(--cmp-elevation-4)" }}>
        <h2 id="cmp-dialog-title" className="text-sm font-bold text-gray-900">{title}</h2>
        {body && <div className="text-sm text-gray-600 mt-1.5">{body}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onCancel} data-touch-target
            className="text-[13px] font-medium rounded-lg px-3 py-1.5 border border-gray-200 text-gray-600 hover:bg-gray-50">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} data-touch-target
            className="text-[13px] font-medium rounded-lg px-3 py-1.5 text-white"
            style={{ background: destructive ? "var(--cmp-text-critical)" : "var(--cmp-color-primary)" }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tabs (PUI-004 s3, WAI-ARIA tabs pattern) ────────────────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange, label = "Sections" }: {
  tabs: { key: string; label: string; badge?: number }[];
  active: string; onChange: (key: string) => void; label?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex(t => t.key === active);
    const to = e.key === "ArrowRight" ? (i + 1) % tabs.length
      : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(tabs[to].key);
    refs.current[tabs[to].key]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey} className="flex flex-wrap gap-1 border-b border-gray-200">
      {tabs.map(t => {
        const on = t.key === active;
        return (
          <button key={t.key} ref={el => { refs.current[t.key] = el; }} type="button" role="tab"
            id={`tab-${t.key}`} aria-selected={on} aria-controls={`panel-${t.key}`}
            tabIndex={on ? 0 : -1} onClick={() => onChange(t.key)} data-touch-target
            className={`text-[13px] px-3 py-2 -mb-px border-b-2 transition-colors ${
              on ? "font-semibold" : "border-transparent text-gray-500 hover:text-gray-800"}`}
            style={on ? { borderColor: "var(--cmp-color-primary)", color: "var(--cmp-color-primary-dark)" } : undefined}>
            {t.label}
            {t.badge != null && t.badge > 0 && <span className="ml-1.5 text-[10px] tabular-nums text-gray-400">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ tabKey, active, children }: { tabKey: string; active: string; children: React.ReactNode }) {
  if (tabKey !== active) return null;
  return <div role="tabpanel" id={`panel-${tabKey}`} aria-labelledby={`tab-${tabKey}`} tabIndex={0}>{children}</div>;
}

// ── Drawer / side panel (PUI-003 s8, PUI-004 s3) ────────────────────────────────────────────────────────
export function Drawer({ open, title, onClose, children, side = "right" }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode; side?: "right" | "left";
}) {
  const restore = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); restore.current?.focus(); };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[65] bg-black/20" onClick={onClose}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className={`absolute top-0 ${side === "right" ? "right-0" : "left-0"} h-full w-full max-w-md bg-white overflow-y-auto`}
        style={{ boxShadow: "var(--cmp-elevation-4)" }}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 h-14 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close panel" data-touch-target
            className="w-9 h-9 rounded-lg text-gray-400 hover:bg-gray-100 flex items-center justify-center">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

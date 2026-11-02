/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useRef } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { errorCls, focusRing } from "./plan-style";

// My Plan (PLP-01..04): the small client pieces its screens share.

export type Called = { ok: boolean; status: number; json: Record<string, any> };
/** One JSON call to our own API. A network failure is a calm message, never a thrown error. */
export async function callJson(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<Called> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}
export const errorOf = (r: Called, fallback = "That could not be saved just now. Try again shortly.") =>
  r.status === 403 || (r.status === 409 && !r.json.needsConfirmation) ? (typeof r.json.error === "string" ? r.json.error : "That is not available here yet.") : typeof r.json.error === "string" ? r.json.error : fallback;

export function ErrorLine({ text }: { text: string }) {
  return text ? <p role="alert" className={errorCls}>{text}</p> : null;
}

/** A person: the learner's own entry. aria-hidden, the word beside it carries the meaning. */
export const PersonIcon = () => (
  <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
);
/** A sparkle: Scholar's own suggestion. aria-hidden. */
export const SparkleIcon = () => (
  <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></svg>
);
export const YourEntryChip = () => (
  <span className="inline-flex items-center gap-1 rounded-full border border-purple-300 bg-purple-50 px-2 py-0.5 text-[11.5px] font-semibold text-purple-900"><PersonIcon />Your entry</span>
);
export const ScholarPlanChip = () => (
  <span className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11.5px] font-semibold text-blue-900"><SparkleIcon />Scholar plan</span>
);

/** A native modal dialog with the shared focus doctrine (focus in, Tab wraps, focus returns). The only scrolling panel on My Plan. */
export function PlanDialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Declared first so it records the trigger before showModal() moves focus into the dialog.
  useModalFocus(true, panel, () => ref.current?.close());
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  return (
    <dialog ref={ref} aria-modal="true" aria-label={title} onClose={onClose} onCancel={onClose}
      onClick={e => { if (e.target === ref.current) ref.current?.close(); }}
      className={`cmp-dialog m-auto w-[96%] ${wide ? "max-w-[640px]" : "max-w-[460px]"} rounded-2xl border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/40`}>
      <div ref={panel} tabIndex={-1} className="flex max-h-[92vh] flex-col outline-none">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4">
          <h2 className="min-w-0 break-words text-[16px] font-bold text-gray-900">{title}</h2>
          <button type="button" aria-label="Close" onClick={() => ref.current?.close()}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-[15px] font-semibold hover:bg-gray-50 pointer-coarse:h-[var(--cmp-touch-min)] pointer-coarse:w-[var(--cmp-touch-min)] ${focusRing}`}>{"✕"}</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </dialog>
  );
}

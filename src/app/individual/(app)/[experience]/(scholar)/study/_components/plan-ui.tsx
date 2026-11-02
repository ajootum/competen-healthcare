/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useRef } from "react";
import type { IconKind } from "@/lib/individual/scholar/plan-workspace";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { errorCls, focusRing, pillOutline, squareBtn } from "./plan-style";

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
export const PersonIcon = ({ size = 14 }: { size?: number } = {}) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
);
/** A sparkle: Scholar's own suggestion. aria-hidden. */
export const SparkleIcon = ({ size = 14 }: { size?: number } = {}) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></svg>
);
/** The line icons of My Plan. aria-hidden: a word always sits beside them. */
function Svg({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">{children}</svg>;
}
/** A calendar with a slash: a time the learner is unavailable. */
export const CalendarOffIcon = ({ size }: { size?: number }) => (
  <Svg size={size}><path d="M8 3v3M16 3v3M4 9h5M20 11V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h9" /><path d="M3 3l18 18" /></Svg>
);
export const CheckIcon = ({ size }: { size?: number }) => (<Svg size={size}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>);
export const SunIcon = ({ size }: { size?: number }) => (<Svg size={size}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></Svg>);
export const CalendarIcon = ({ size }: { size?: number }) => (<Svg size={size}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h.01M12 14h.01M16 14h.01" /></Svg>);
export const ChartIcon = ({ size }: { size?: number }) => (<Svg size={size}><path d="M5 20V12M12 20V5M19 20v-9" /></Svg>);
export const BulbIcon = ({ size }: { size?: number }) => (<Svg size={size}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></Svg>);
export const ClipboardCheckIcon = ({ size }: { size?: number }) => (<Svg size={size}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9zM9 14l2.2 2.2L15.5 12" /></Svg>);
export const CardsIcon = ({ size }: { size?: number }) => (<Svg size={size}><rect x="3" y="7" width="14" height="11" rx="2" /><path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" /></Svg>);
export const RestartIcon = ({ size }: { size?: number }) => (<Svg size={size}><path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4" /></Svg>);
export const PracticeIcon = ({ size }: { size?: number }) => (<Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></Svg>);
export const FlagIcon = ({ size }: { size?: number }) => (<Svg size={size}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></Svg>);
export const BookIcon = ({ size }: { size?: number }) => (<Svg size={size}><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z" /></Svg>);
export const ClockIcon = ({ size }: { size?: number }) => (<Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>);
export const ChevronIcon = ({ dir, size }: { dir: "left" | "right" | "down"; size?: number }) => (<Svg size={size}><path d={dir === "left" ? "M15 5l-7 7 7 7" : dir === "right" ? "M9 5l7 7-7 7" : "M6 9l6 6 6-6"} /></Svg>);
export const DotsIcon = ({ size }: { size?: number }) => (<Svg size={size}><path d="M12 5h.01M12 12h.01M12 19h.01" strokeWidth="3" /></Svg>);

/** The round tinted icon at the left of an agenda row. Tokens only: success (revision, done), information (learning), indigo (own entries). */
const ROW_TINT: Record<IconKind, { bg: string; fg: string }> = {
  revision: { bg: "var(--cmp-surface-success)", fg: "var(--cmp-text-success)" },
  done: { bg: "var(--cmp-surface-success)", fg: "var(--cmp-text-success)" },
  learning: { bg: "var(--cmp-surface-information)", fg: "var(--cmp-text-information)" },
  personal: { bg: "var(--cmp-role-indigo-soft)", fg: "var(--cmp-role-indigo-ink)" },
  deadline: { bg: "var(--cmp-role-indigo-soft)", fg: "var(--cmp-role-indigo-ink)" },
  unavailable: { bg: "var(--cmp-app-bg)", fg: "var(--cmp-app-text-secondary)" },
};
export function RowIcon({ kind }: { kind: IconKind }) {
  const t = ROW_TINT[kind];
  const icon = kind === "revision" ? <RestartIcon size={18} /> : kind === "learning" ? <BookIcon size={18} /> : kind === "personal" ? <PersonIcon size={18} /> : kind === "deadline" ? <FlagIcon size={18} /> : kind === "unavailable" ? <CalendarOffIcon size={18} /> : <CheckIcon size={18} />;
  return <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: t.bg, color: t.fg }}>{icon}</span>;
}

/**
 * A small menu on a native <details>: the trigger is a real button (summary), Escape and a press outside close it and return focus to the trigger,
 * choosing an entry closes it. Dialogs the entries open are rendered by the CALLER beside the menu (never inside it: a closed <details> is not rendered).
 */
export function RowMenu({ label, trigger, children }: { label: string; trigger: "dots" | "change"; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const down = (e: Event) => { if (d.open && !d.contains(e.target as Node)) d.open = false; };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && d.open) { d.open = false; d.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, []);
  return (
    <details ref={ref} className="relative">
      <summary aria-label={label} className={`list-none [&::-webkit-details-marker]:hidden cursor-pointer ${trigger === "dots" ? squareBtn : `${pillOutline} gap-1`}`}>
        {trigger === "dots" ? <DotsIcon size={18} /> : <>Change<span className="sr-only"> ({label})</span></>}
      </summary>
      <div role="group" aria-label={label} className="absolute right-0 z-30 mt-1 flex min-w-[12rem] flex-col rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
        onClick={e => { if ((e.target as HTMLElement).closest("button,a")) { const d = ref.current; if (d) d.open = false; } }}>
        {children}
      </div>
    </details>
  );
}

/** The one-line boundary of My Plan: "For learning only · details" (the formative notice is the detail). */
export function LearningOnlyNote({ notice }: { notice: string }) {
  return (
    <details className="text-[12.5px] text-gray-600">
      <summary className={`inline-flex min-h-9 cursor-pointer items-center font-semibold text-gray-700 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>For learning only · details</summary>
      <p className="mt-0.5 pb-1">{notice}</p>
    </details>
  );
}
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

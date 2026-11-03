"use client";
// Checklist Studio, definition pages: pieces shared by scales, scoring templates, layout templates and progression rules.
import { useRef, type ReactNode } from "react";
import Link from "next/link";
import { Btn } from "@/components/assessment/ui";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { fmtDateTime } from "@/lib/assessment/studio/vocab";
import type { TimelineEntry } from "@/lib/assessment/studio/types";
import { Panel, StateChip, td, th } from "./studio-ui";
import type { LifecycleState } from "@/lib/assessment/studio/types";

/** A modal dialog: overlay, focus moved in, Tab trapped, Escape closes, focus restored (useModalFocus). */
export function DefModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(true, ref, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} data-cmp-theme="platform"
        className="mt-10 w-full max-w-lg space-y-4 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-5 text-[var(--cmp-app-text)] shadow-xl focus:outline-none">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">{title}</h2>
          <Btn kind="ghost" size="sm" onClick={onClose} aria-label="Close">Close</Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface DefRow {
  id: string;
  code: string;
  name: string;
  versionNo: number;
  state: LifecycleState;
  extra?: string;
  href: string;
}

export function DefTable({ rows, empty, extraLabel }: { rows: DefRow[]; empty: string; extraLabel?: string }) {
  if (rows.length === 0) return <p className="rounded-xl border border-dashed border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4 text-sm text-[var(--cmp-app-text-secondary)]">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)]">
      <table className="min-w-full divide-y divide-[var(--cmp-app-border)]">
        <thead><tr><th className={th}>Code</th><th className={th}>Name</th>{extraLabel && <th className={th}>{extraLabel}</th>}<th className={th}>Version</th><th className={th}>State</th></tr></thead>
        <tbody className="divide-y divide-[var(--cmp-app-border)]">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-[var(--cmp-app-bg)]">
              <td className={`${td} font-mono text-xs`}><Link href={r.href} className="font-semibold text-[var(--cmp-theme-ink)] underline underline-offset-2">{r.code}</Link></td>
              <td className={td}>{r.name}</td>
              {extraLabel && <td className={td}>{r.extra ?? ""}</td>}
              <td className={td}>v{r.versionNo}</td>
              <td className={td}><StateChip state={r.state} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DefTimeline({ timeline, names }: { timeline: TimelineEntry[]; names: Record<string, string> }) {
  return (
    <Panel title="History">
      {timeline.length === 0 ? <p className="text-sm text-[var(--cmp-app-text-secondary)]">Nothing recorded yet.</p> : (
        <ol className="space-y-2 text-sm">
          {timeline.map((t, i) => (
            <li key={i} className="border-l-2 border-[var(--cmp-theme-border)] pl-3">
              <span className="font-semibold">{t.label}</span>
              {t.versionNo ? ` (v${t.versionNo})` : ""}
              {t.actorId ? ` by ${names[t.actorId] ?? "a person"}` : ""}
              <span className="block text-xs text-[var(--cmp-app-text-secondary)]">{fmtDateTime(t.at)}{t.detail ? ` · ${t.detail}` : ""}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** Why a create button is off. */
export const NO_AUTHOR = "Creating and editing needs the author capability, held through a Checklist Studio appointment.";

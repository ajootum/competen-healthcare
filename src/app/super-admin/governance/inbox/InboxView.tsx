"use client";
// UNIFIED-GOVERNANCE-V1: My Governance Inbox. One obvious contextual action per task; where the person cannot act, the
// reason and who can. Cards stack on a phone, sit in a list on a tablet and a desktop. Links lead to the governed item.
import { useState } from "react";
import Link from "next/link";
import type { InboxModel, InboxTask } from "@/lib/hq/governance-inbox";

const primary = "inline-flex min-h-10 items-center justify-center rounded-lg bg-teal-700 px-3.5 text-[13px] font-semibold text-white hover:bg-teal-800 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const ghost = "inline-flex min-h-10 items-center justify-center rounded-lg border border-gray-300 bg-white px-3.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const STATUS_TONE: Record<string, string> = {
  "Draft": "bg-slate-100 text-slate-800", "In review": "bg-amber-50 text-amber-900", "Approved": "bg-blue-50 text-blue-900", "Published": "bg-green-50 text-green-900",
  "Returned for correction": "bg-red-50 text-red-900", "Publication requested": "bg-violet-50 text-violet-900",
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

function Task({ t }: { t: InboxTask }) {
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-3 sm:p-4" data-testid="inbox-task">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-gray-700">{t.type}</span>
            <span className={`rounded-md px-1.5 py-0.5 text-[11.5px] font-bold ${STATUS_TONE[t.status] ?? "bg-gray-100 text-gray-800"}`}>{t.status}</span>
            <span className="text-[11.5px] text-gray-500">{t.scope}{t.at ? ` · ${when(t.at)}` : ""}</span>
          </div>
          <Link href={t.href} className="mt-1 block text-[15px] font-bold text-gray-900 hover:underline">{t.title}</Link>
          <p className="text-[13px] text-gray-800"><span className="font-semibold">Required:</span> {t.required}</p>
          {t.detail && <p className="text-[12.5px] text-gray-600">{t.detail}</p>}
          {t.deadline && <p className="text-[12px] text-gray-500">Deadline: {when(t.deadline)}</p>}
          {!t.action && t.reason && <p className="mt-1 text-[12.5px] font-semibold text-amber-900" role="status">{t.reason}</p>}
        </div>
        <div className="flex shrink-0 items-center">
          {t.action ? <Link href={t.action.href} className={t.action.kind === "open" ? ghost : primary}>{t.action.label}</Link> : <Link href={t.href} className={ghost}>Open</Link>}
        </div>
      </div>
    </li>
  );
}

function Section({ title, tasks, empty, id, open = true }: { title: string; tasks: InboxTask[]; empty: string; id: string; open?: boolean }) {
  const [shown, setShown] = useState(open);
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-2">
      <button type="button" onClick={() => setShown((s) => !s)} aria-expanded={shown} className="flex w-full items-center justify-between text-left">
        <h2 id={`${id}-h`} className="text-[13px] font-bold uppercase tracking-wide text-gray-700">{title} <span className="font-normal text-gray-500">({tasks.length})</span></h2>
        <span aria-hidden className="text-gray-500">{shown ? "▾" : "▸"}</span>
      </button>
      {shown && (tasks.length === 0 ? <p className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-600">{empty}</p> : <ul className="space-y-2">{tasks.map((t) => <Task key={t.id} t={t} />)}</ul>)}
    </section>
  );
}

export default function InboxView({ model, viewerName }: { model: InboxModel; viewerName: string | null }) {
  const m = model;
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Governance</p>
          <h1 className="text-[24px] font-bold text-gray-900">Governance Inbox</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-gray-600">{viewerName ? `${viewerName}: ` : ""}{m.standing} One item, one status, one next action. Each action is taken on the item itself, where the same rules apply.</p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Governance areas">
          <Link href="/super-admin/governance/controlled-content" className={ghost}>Controlled Content</Link>
          <Link href="/super-admin/governance/organisation" className={ghost}>Organisation &amp; Appointments</Link>
          <Link href="/super-admin/governance/history" className={ghost}>Governance History</Link>
        </nav>
      </header>
      {m.notes.map((n) => <p key={n} role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">{n}</p>)}
      <div className="grid gap-2 sm:grid-cols-4" aria-label="Summary">
        {[["My actions", m.mine.length], ["In progress", m.inProgress.length], ["Returned for correction", m.returned.length], ["Recently published", m.recentlyPublished.length]].map(([l, n]) => (
          <div key={String(l)} className="rounded-xl border border-gray-200 bg-white px-3 py-2"><p className="text-[22px] font-bold text-gray-900">{n}</p><p className="text-[12px] text-gray-600">{l}</p></div>
        ))}
      </div>
      <Section id="mine" title="My actions" tasks={m.mine} empty="Nothing waits for your action. Items you cannot act on appear below with the reason and who can." />
      <Section id="returned" title="Returned for correction" tasks={m.returned} empty="Nothing has been returned to you." open={m.returned.length > 0} />
      <Section id="progress" title="Items in progress" tasks={m.inProgress} empty="Nothing is in progress elsewhere." open={m.mine.length === 0} />
      {m.overdue.length > 0 && <Section id="overdue" title="Overdue actions" tasks={m.overdue} empty="" />}
      <Section id="published" title="Recently published" tasks={m.recentlyPublished} empty="Nothing was published in the last 30 days." open={false} />
    </div>
  );
}

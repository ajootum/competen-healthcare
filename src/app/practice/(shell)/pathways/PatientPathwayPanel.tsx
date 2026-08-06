"use client";

import Link from "next/link";
import type { PatientPathwayView, PathwayList } from "@/lib/practice/pathways";
import { PATHWAY_PROGRESS_LABELS, AT_RISK_REFUSAL } from "@/lib/practice/pathways-constants";
import StageTrack from "./StageTrack";
import PathwayActions from "./PathwayActions";

// CPR-FUP-003 s11/s12 -- "Display active pathways, current stage, next milestone, next review date and
// pathway status within the patient record."
//
// ⚠ THIS COMPONENT IS WRITTEN TO BE MOUNTED IN THE PATIENT RECORD, NOT ONLY HERE. It takes a
// PathwayList exactly as listPatientPathways returns it -- items, unavailable and detail -- so the
// patient page can render it in one line without re-deriving anything or re-deciding what an
// unavailable read looks like. It is used on the Care Pathways screen as the right-hand panel in the
// meantime.
//
// ⚠ ENDED PATHWAYS ARE SHOWN TOO (s16, "pathway history remains permanently available"). A panel that
// showed only the live ones would answer "is this patient on a plan" and lose "what was tried before",
// which is the question somebody opening an unfamiliar record actually has.

/** ⚠ Two chips, not three. "At risk" is refused -- there is no date rule that produces it. */
export const PROGRESS_CHIP: Record<string, string> = {
  on_track: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  overdue: "bg-rose-100 text-rose-700 ring-rose-200",
  undated: "bg-slate-100 text-slate-500 ring-slate-200",
  ended: "bg-slate-100 text-slate-500 ring-slate-200",
};

export function ProgressChip({ progress }: { progress: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-[10.5px] font-bold ring-1 ${PROGRESS_CHIP[progress] ?? PROGRESS_CHIP.undated}`}>
      {PATHWAY_PROGRESS_LABELS[progress as keyof typeof PATHWAY_PROGRESS_LABELS] ?? progress}
    </span>
  );
}

function PathwayCard({ p, canAssign }: { p: PatientPathwayView; canAssign: boolean }) {
  const live = p.status === "active";
  return (
    <article className={`rounded-xl border p-3 ${
      live
        ? p.progress === "overdue"
          ? "border-rose-200 bg-rose-50/50"
          : "border-emerald-200 bg-emerald-50/40"
        : "border-slate-200 bg-slate-50/60"}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[13px] font-bold text-gray-900">{p.template_name}</h3>
        <span className="text-[10.5px] text-gray-400">v{p.template_version}</span>
        <span className="ml-auto"><ProgressChip progress={p.progress} /></span>
      </div>

      <div className="mt-2"><StageTrack pathway={p} compact /></div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px]">
        <div>
          <dt className="text-gray-400">Current stage</dt>
          <dd className="font-semibold text-gray-700">{p.stageName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-gray-400">Next review</dt>
          <dd className={`font-semibold ${p.progress === "overdue" ? "text-rose-700" : "text-gray-700"}`}>
            {p.stageDueOn ?? "no date"}
            {p.stageDueInDays !== null && (
              <span className="ml-1 font-normal text-gray-400">
                ({p.stageDueInDays < 0 ? `${Math.abs(p.stageDueInDays)} days late` : `in ${p.stageDueInDays} days`})
              </span>
            )}
          </dd>
        </div>
      </dl>

      {!live && (
        <p className="mt-1.5 text-[11px] text-gray-500">
          {p.status === "completed" ? "Completed" : "Stopped"} on {p.ended_on}
          {p.stopped_reason && <> &mdash; {p.stopped_reason}</>}
        </p>
      )}

      {p.followUpId && live && (
        <Link href="/practice/follow-ups?view=all" className="mt-1.5 inline-block text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          The follow-up this stage raised &rarr;
        </Link>
      )}

      {live && <div className="mt-2"><PathwayActions pathway={p} canAssign={canAssign} /></div>}

      <details className="group mt-2">
        <summary className="cursor-pointer list-none text-[10.5px] font-semibold text-gray-500 hover:text-gray-700">
          <span className="mr-1 inline-block transition-transform group-open:rotate-90">&rsaquo;</span>
          Every stage this patient actually reached ({p.history.length})
        </summary>
        <ul className="mt-1 flex flex-col">
          {p.history.map(h => (
            <li key={h.id} className="flex flex-wrap items-baseline gap-2 border-b border-gray-100 py-1 text-[11px] last:border-0">
              <span className="font-semibold text-gray-700">{h.stageName}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                h.state === "completed" ? "bg-emerald-100 text-emerald-700"
                  : h.state === "entered" ? "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]"
                    : h.state === "skipped" ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-500"}`}>
                {h.state}
              </span>
              <span className="ml-auto text-gray-400">
                {h.entered_on}{h.ended_on ? ` → ${h.ended_on}` : ""}
              </span>
              {h.note && <span className="w-full text-gray-500">{h.note}</span>}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

export default function PatientPathwayPanel({ pathways, canAssign, patientName }: {
  pathways: PathwayList<PatientPathwayView>;
  canAssign: boolean;
  patientName?: string | null;
}) {
  // ⚠ THREE STATES, NOT TWO. An unavailable read is not "this patient is on no pathway".
  if (pathways.unavailable) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Care pathways</h2>
        <p className="mt-1 text-[12px] text-[var(--cmp-text-warning)]">
          <span className="font-semibold">Could not be read.</span> This is not the same as this patient
          being on no pathway &mdash; the read did not return.
          {pathways.detail && <span className="mt-0.5 block font-mono text-[11px] opacity-80">{pathways.detail}</span>}
        </p>
      </section>
    );
  }

  const active = pathways.items.filter(p => p.status === "active");
  const ended = pathways.items.filter(p => p.status !== "active");

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[13px] font-bold text-gray-900">
          Care pathways{patientName ? ` — ${patientName}` : ""}
        </h2>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10.5px] font-bold text-gray-600">
          {active.length} active
        </span>
      </div>

      {pathways.items.length === 0 ? (
        <p className="mt-2 text-[12px] text-gray-400">
          This patient is on no care pathway. A pathway is a plan somebody decides on &mdash; it is
          assigned from a consultation or from the Care Pathways workspace, never automatically.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2.5">
          {active.map(p => <PathwayCard key={p.id} p={p} canAssign={canAssign} />)}
          {ended.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer list-none text-[11.5px] font-semibold text-gray-500 hover:text-gray-800">
                <span className="mr-1 inline-block transition-transform group-open:rotate-90">&rsaquo;</span>
                {ended.length === 1 ? "One earlier pathway" : `${ended.length} earlier pathways`}, kept permanently
              </summary>
              <div className="mt-2 flex flex-col gap-2.5">
                {ended.map(p => <PathwayCard key={p.id} p={p} canAssign={canAssign} />)}
              </div>
            </details>
          )}
        </div>
      )}

      <details className="group mt-3 border-t border-gray-100 pt-2">
        <summary className="cursor-pointer list-none text-[10.5px] font-semibold text-gray-500 hover:text-gray-700">
          <span className="mr-1 inline-block transition-transform group-open:rotate-90">&rsaquo;</span>
          Why there is no &ldquo;At risk&rdquo; here
        </summary>
        <p className="mt-1 text-[10.5px] leading-relaxed text-gray-500">{AT_RISK_REFUSAL}</p>
      </details>
    </section>
  );
}

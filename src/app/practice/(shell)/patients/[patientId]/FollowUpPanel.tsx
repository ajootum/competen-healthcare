import Link from "next/link";
import { FOLLOW_UP_OUTCOMES } from "@/lib/practice/follow-up-constants";

// CPR-140's patient-centric follow-up view, laid out to the comp: the plan with its steps, adherence,
// and the tabs (upcoming, past, missed, recall, monitoring, outcomes).
//
// THE COMP'S "86% ADHERENCE" RING IS A COUNT HERE -- "6 of 7 completed", which is what the comp itself
// prints beside the ring. A percentage over three appointments is a sentence that sounds like a
// measurement and is not one; the denominator counts only follow-ups that have REACHED a conclusion, so
// nobody looks non-adherent for an appointment that has not happened yet.
//
// TABS WITHOUT JAVASCRIPT. Each is a link that sets a query parameter, so the panel works on a page that
// is otherwise entirely server-rendered and keeps its state in the URL -- which is also what makes a
// particular tab something a practitioner can bookmark or send to a colleague.

/* eslint-disable @typescript-eslint/no-explicit-any */

const OUTCOME_LABEL = Object.fromEntries(FOLLOW_UP_OUTCOMES.map(([c, l]) => [c, l])) as Record<string, string>;

const TABS = [
  ["upcoming", "Upcoming"],
  ["past", "Past"],
  ["missed", "Missed"],
  ["recall", "Recall"],
  ["monitoring", "Monitoring"],
  ["outcomes", "Outcomes"],
] as const;

function Row({ f }: { f: any }) {
  return (
    <li className={`flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0 ${
      f.overdue ? "border-l-2 border-l-[var(--cmp-color-critical)] pl-2" : ""}`}>
      <span className="min-w-0">
        <span className="block text-[12px] text-gray-800">{f.reason}</span>
        <span className="block text-[10px] text-gray-500">
          {String(f.kind).replace(/_/g, " ")}
          {f.step_number ? ` · step ${f.step_number}` : ""}
          {f.outcome ? ` · ${f.outcome}` : ""}
        </span>
      </span>
      <span className="ml-auto shrink-0 text-right">
        <span className={`block text-[11px] ${f.overdue ? "font-bold text-[var(--cmp-text-critical)]" : "text-gray-600"}`}>
          {f.overdue ? `${Math.abs(f.dueInDays)} days overdue`
            : f.status === "SCHEDULED" ? `booked ${f.bookedFor ?? ""}`
              : f.closed ? String(f.status).toLowerCase()
                : `due ${f.due_on}`}
        </span>
        {f.outcome_code && (
          <span className="block text-[10px] text-gray-500">{OUTCOME_LABEL[f.outcome_code]}</span>
        )}
        {f.priority === "urgent" && !f.closed && (
          <span className="block text-[10px] font-semibold text-[var(--cmp-text-critical)]">urgent</span>
        )}
      </span>
    </li>
  );
}

export default function FollowUpPanel({ view, patientId, tab }: {
  view: Awaited<ReturnType<typeof import("@/lib/practice/follow-up-plans").patientFollowUps>>;
  patientId: string;
  tab: string;
}) {
  const active = TABS.some(([k]) => k === tab) ? tab : "upcoming";
  const rows: any[] = (view as any)[active] ?? [];

  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="text-[13px] font-bold text-gray-900">Follow-up</h2>
        <Link href="/practice/follow-ups" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          The board &rarr;
        </Link>
      </div>

      {/* Next follow-up and adherence, the comp's two header cards */}
      <div className="mt-2 grid sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-[11px] font-semibold text-gray-500">Next follow-up</p>
          {view.overview.next ? (
            <>
              <p className="mt-0.5 text-[13px] font-bold text-gray-900">{view.overview.next.due_on}</p>
              <p className="text-[11px] text-gray-600">{view.overview.next.reason}</p>
            </>
          ) : (
            <p className="mt-0.5 text-[12px] text-gray-400">Nothing outstanding.</p>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="text-[11px] font-semibold text-gray-500">Adherence</p>
          {view.adherence.concluded === 0 ? (
            <p className="mt-0.5 text-[12px] text-gray-400">Nothing has concluded yet.</p>
          ) : (
            <>
              {/* A COUNT AND ITS DENOMINATOR. No ring, no percentage -- see the header. */}
              <p className="mt-0.5 text-[13px] font-bold text-gray-900">
                {view.adherence.completed} of {view.adherence.concluded} completed
              </p>
              <p className="text-[10px] text-gray-500">
                Of those that have concluded.
                {view.adherence.stillOpen > 0 && ` ${view.adherence.stillOpen} still open, not counted.`}
              </p>
            </>
          )}
        </div>
      </div>

      {/* The plans, with their steps -- the comp's "Follow-up Plan" timeline */}
      {view.plans.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold text-gray-500">Plans</p>
          {view.plans.map((p: any) => (
            <div key={p.id} className="mt-1.5 rounded-lg border border-gray-200 p-3">
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] font-semibold text-gray-800">{p.title}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  p.status === "ACTIVE" ? "bg-[var(--cp-primary-soft)] text-[var(--cp-primary-deep)]"
                    : p.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                  {p.status.toLowerCase()}
                </span>
                <span className="ml-auto text-[10px] text-gray-500">from {p.starts_on}</span>
              </div>
              {p.discontinued_reason && (
                <p className="mt-0.5 text-[10px] text-gray-500">Stopped: {p.discontinued_reason}</p>
              )}
              <ol className="mt-1.5 flex flex-col">
                {p.steps.map((s: any) => (
                  <li key={s.id} className="flex items-baseline gap-2 py-0.5">
                    <span aria-hidden className={s.closed ? "text-[var(--cmp-text-success)]" : "text-gray-300"}>
                      {s.closed ? "●" : "○"}
                    </span>
                    <span className="w-24 shrink-0 font-mono text-[10px] text-gray-500">{s.due_on}</span>
                    <span className="min-w-0 truncate text-[11px] text-gray-700">{s.reason}</span>
                    <span className={`ml-auto shrink-0 text-[10px] ${
                      s.overdue ? "font-bold text-[var(--cmp-text-critical)]" : "text-gray-500"}`}>
                      {s.overdue ? "overdue" : String(s.status).toLowerCase()}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="mt-3 flex flex-wrap gap-1 border-b border-gray-100 pb-1">
        {TABS.map(([k, label]) => {
          const n = k === "outcomes" ? view.outcomes.total : ((view as any)[k]?.length ?? 0);
          return (
            <Link key={k} href={`/practice/patients/${patientId}?followUp=${k}`} scroll={false}
              aria-current={active === k ? "page" : undefined}
              className={`rounded-t px-2 py-1 text-[11px] font-semibold ${
                active === k ? "border-b-2 border-[var(--cp-primary)] text-[var(--cp-primary-deep)]" : "text-gray-500 hover:text-gray-800"}`}>
              {label} {n > 0 && <span className="text-gray-400">({n})</span>}
            </Link>
          );
        })}
      </div>

      {active === "outcomes" ? (
        view.outcomes.total === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">Nothing has concluded yet.</p>
        ) : (
          <>
            <ul className="mt-2 flex flex-col">
              {view.outcomes.rows.map(r => (
                <li key={r.code} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                  <span className="text-[12px] text-gray-800">{r.label}</span>
                  <span className="ml-auto text-[13px] font-bold text-gray-900">{r.total}</span>
                </li>
              ))}
            </ul>
            {/* NAMED RATHER THAN DROPPED. A summary that quietly excluded the uncoded ones would make
                this record look more consistent than it is. */}
            {view.outcomes.uncoded > 0 && (
              <p className="mt-1 text-[10px] text-gray-500">
                {view.outcomes.uncoded} completed with no outcome recorded.
              </p>
            )}
          </>
        )
      ) : rows.length === 0 ? (
        <p className="mt-2 text-[12px] text-gray-400">
          {active === "recall" ? "Nothing overdue." : `Nothing ${active}.`}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col">{rows.map(f => <Row key={f.id} f={f} />)}</ul>
      )}

      {active === "recall" && rows.length > 0 && (
        <p className="mt-2 text-[10px] text-gray-500">
          {/* The one sentence this tab must not lose. */}
          Overdue with nothing booked. Nothing has been sent to this patient &mdash; this product has no
          email, SMS or messaging channel, so a recall is a call somebody makes.
        </p>
      )}
    </section>
  );
}

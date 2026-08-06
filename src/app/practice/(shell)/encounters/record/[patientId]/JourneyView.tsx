"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  JOURNEY_FILTERS, JOURNEY_ICON, MILESTONE_KINDS,
} from "@/lib/practice/longitudinal-constants";
import type { JourneyEvent } from "@/lib/practice/longitudinal";
import { formatDate } from "@/lib/datetime";

// CPR-ENC-003 s7's patient journey view: the whole record in chronological order, with filtering.
//
// ⚠ THE FILTER NARROWS WHAT IS SHOWN AND SAYS SO. A filtered timeline that looked identical to an
// unfiltered one would be the same failure as an empty list that looked like a read failure -- somebody
// would read "Investigations only" as "this is everything". The count of what is hidden is printed.
//
// ⚠ ADDING A MILESTONE IS A FORM A PERSON FILLS IN, AND THAT IS THE WHOLE DESIGN.
// `significant_improvement` and `relapse` are on the list. Nothing on this screen offers to work one out
// from the timeline, suggests one, or pre-fills one -- because a milestone in this record is a clinical
// judgement with a name attached, and one computed from a pattern would be indistinguishable from one a
// practitioner made. This is the same refusal as the "Stable / Improving / Monitor" chip that was
// rejected on the Patients screen.

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

/** Each stream in its own hue, so a journey can be read as a pattern of colour before any text is read. */
const KIND_SWATCH: Record<string, { badge: string; rail: string }> = {
  encounters: { badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", rail: "border-[var(--cp-primary)]/30" },
  problems: { badge: "bg-violet-100 text-violet-700", rail: "border-violet-200" },
  treatments: { badge: "bg-cyan-100 text-cyan-700", rail: "border-cyan-200" },
  procedures: { badge: "bg-teal-100 text-teal-700", rail: "border-teal-200" },
  investigations: { badge: "bg-sky-100 text-sky-700", rail: "border-sky-200" },
  referrals: { badge: "bg-slate-100 text-slate-600", rail: "border-slate-200" },
  follow_ups: { badge: "bg-rose-100 text-rose-700", rail: "border-rose-200" },
  milestones: { badge: "bg-amber-50 text-amber-700", rail: "border-amber-200" },
};

export default function JourneyView(props: {
  patientId: string;
  events: JourneyEvent[];
  sourcesUnavailable: string[];
  sourcesDenied: string[];
  timelineUnavailable: boolean;
  timelinePermitted: boolean;
  canRecordMilestone: boolean;
  today: string;
}) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [ms, setMs] = useState({ kind: "first_consultation", label: "", occurredOn: props.today, note: "" });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.events.filter(e => {
      if (filter !== "all" && e.kind !== filter) return false;
      if (!q) return true;
      return `${e.title} ${e.detail ?? ""} ${e.tags.join(" ")}`.toLowerCase().includes(q);
    });
  }, [props.events, filter, query]);

  const hidden = props.events.length - shown.length;

  const addMilestone = async () => {
    setBusy(true); setNotice(null);
    const res = await fetch(`/api/v1/practice/encounters/record/${props.patientId}/milestones`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: ms.kind, label: ms.label, occurredOn: ms.occurredOn, note: ms.note || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      setBusy(false); return;
    }
    window.location.reload();
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-bold text-gray-900">Clinical timeline</h2>
          <p className="text-[11px] text-gray-500">
            A longitudinal view of this patient&apos;s care with you. Not a hospital record.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="journey-search" className="sr-only">Search the timeline</label>
          <input id="journey-search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search timeline…" className={`${input} w-44`} />
          {props.canRecordMilestone && (
            <button type="button" onClick={() => setAdding(a => !a)}
              className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-2 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
              ⚑ Add milestone
            </button>
          )}
        </div>
      </div>

      {notice && (
        <p className={`mt-2 rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      {adding && (
        <form className="mt-3 grid gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:grid-cols-2"
          onSubmit={e => { e.preventDefault(); addMilestone(); }}>
          <p className="sm:col-span-2 text-[11px] text-gray-600">
            A milestone is <strong>your</strong> judgement, recorded with your name and the date it happened.
            Nothing in this product works one out for you.
          </p>
          <label className="text-[10px] font-semibold text-gray-500">
            Kind
            <select value={ms.kind} onChange={e => setMs(p => ({ ...p, kind: e.target.value }))} className={`${input} mt-0.5`}>
              {MILESTONE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-semibold text-gray-500">
            When it happened
            <input type="date" value={ms.occurredOn} onChange={e => setMs(p => ({ ...p, occurredOn: e.target.value }))}
              className={`${input} mt-0.5`} required />
          </label>
          <label className="sm:col-span-2 text-[10px] font-semibold text-gray-500">
            In your words
            <input value={ms.label} onChange={e => setMs(p => ({ ...p, label: e.target.value }))}
              placeholder="e.g. VP shunt inserted" className={`${input} mt-0.5`} required />
          </label>
          <label className="sm:col-span-2 text-[10px] font-semibold text-gray-500">
            Note (optional)
            <input value={ms.note} onChange={e => setMs(p => ({ ...p, note: e.target.value }))} className={`${input} mt-0.5`} />
          </label>
          <button type="submit" disabled={busy || !ms.label.trim()}
            className="rounded-lg bg-[var(--cp-primary)] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
            Record milestone
          </button>
        </form>
      )}

      {/* ── The filter (CPR-ENC-003 s7) ──────────────────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {JOURNEY_FILTERS.map(([key, label]) => {
          const on = filter === key;
          const sw = KIND_SWATCH[key];
          const denied = props.sourcesDenied.includes(key);
          const broken = props.sourcesUnavailable.includes(key);
          return (
            <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={on}
              // `all` has no KIND_SWATCH entry -- it is not a stream -- so it takes the practice's own
              // primary token. A gray-900 fallback would have been an unmapped utility in the dark theme.
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                on ? (sw?.badge ?? "bg-[var(--cp-primary)] text-white") : "border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
              {key !== "all" && <span className="mr-1">{JOURNEY_ICON[key]}</span>}
              {label}
              {denied && <span className="ml-1 text-[9px] font-normal">(not visible)</span>}
              {broken && <span className="ml-1 text-[9px] font-normal">(unreadable)</span>}
            </button>
          );
        })}
      </div>

      {/* ── The three states, stated in words ────────────────────────────────────────────────── */}
      {!props.timelinePermitted ? (
        <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-500">
          You do not hold permission to see this patient&apos;s encounters. Nothing was read.
        </p>
      ) : props.timelineUnavailable ? (
        <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
          <strong>The timeline could not be read.</strong> This is not a patient with no history &mdash; do
          not take it as one.
        </p>
      ) : props.events.length === 0 ? (
        <p className="mt-4 text-[12px] text-gray-400">
          Nothing has been recorded for this patient yet.
        </p>
      ) : shown.length === 0 ? (
        <p className="mt-4 text-[12px] text-gray-400">
          Nothing in the record matches this filter. {props.events.length} entr
          {props.events.length === 1 ? "y is" : "ies are"} hidden by it.
        </p>
      ) : (
        <>
          {(props.sourcesUnavailable.length > 0 || props.sourcesDenied.length > 0) && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              This timeline is incomplete.
              {props.sourcesUnavailable.length > 0 && <> Could not be read: <strong>{props.sourcesUnavailable.join(", ")}</strong>.</>}
              {props.sourcesDenied.length > 0 && <> Not visible to you: <strong>{props.sourcesDenied.join(", ")}</strong>.</>}
            </p>
          )}

          <ol className="mt-4 flex flex-col gap-3">
            {shown.map(e => {
              const sw = KIND_SWATCH[e.kind];
              return (
                <li key={e.key} className="flex gap-3">
                  <div className="w-[86px] shrink-0 pt-1 text-right">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-700">
                      {formatDate(`${e.on}T00:00:00Z`, "UTC")}
                    </p>
                    {e.at && <p className="text-[10px] text-gray-400">{String(e.at).slice(11, 16)}</p>}
                  </div>
                  <div className={`flex-1 rounded-xl border-l-2 border border-gray-200 ${sw.rail} bg-white p-3`}>
                    <div className="flex items-start gap-2">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px] ${sw.badge}`}>
                        {JOURNEY_ICON[e.kind]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-gray-900">{e.title}</p>
                        {e.detail && <p className="text-[12px] text-gray-600">{e.detail}</p>}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {e.tags.map((t, i) => (
                            <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] capitalize text-gray-600">{t}</span>
                          ))}
                        </div>
                      </div>
                      {e.encounterId && (
                        <Link href={`/practice/encounters/${e.encounterId}`}
                          className="shrink-0 text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                          Open →
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {hidden > 0 && (
            <p className="mt-3 text-[11px] text-gray-400">
              {hidden} further entr{hidden === 1 ? "y is" : "ies are"} hidden by the current filter or search.
            </p>
          )}
        </>
      )}
    </div>
  );
}

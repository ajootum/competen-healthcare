"use client";

import { useState } from "react";
import Link from "next/link";
import { FOLLOW_UP_KINDS, FOLLOW_UP_ACTIONS } from "@/lib/practice/follow-up-constants";

// The board's rows and the close dialogue.
//
// CLOSING ASKS FOR WORDS BEFORE IT WILL SUBMIT, mirroring the engine rather than trusting it: marking a
// follow-up missed needs a reason, and completing one needs either an encounter behind it or an outcome.
// The engine refuses either way -- this just means the refusal arrives as a disabled button rather than
// as a red banner after the click.

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

const KIND_LABEL = Object.fromEntries(FOLLOW_UP_KINDS) as Record<string, string>;

const overdueWord = (days: number) =>
  days === -1 ? "1 day overdue" : `${Math.abs(days)} days overdue`;

const dueWord = (days: number) =>
  days === 0 ? "due today" : days === 1 ? "due tomorrow" : `due in ${days} days`;

export default function FollowUpBoard({ board, today, canManage }: {
  board: any; today: string; canManage: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [closing, setClosing] = useState<{ id: string; action: string } | null>(null);
  const [outcome, setOutcome] = useState("");

  async function act(id: string, payload: unknown) {
    setBusy(true); setNotice(null);
    const res = await fetch(`/api/v1/practice/follow-ups/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      setBusy(false); return;
    }
    window.location.reload();
  }

  const row = (f: any, tone: "overdue" | "soon" | "scheduled" | "later" | "closed") => {
    // Bound to a local so the narrowing survives into the callbacks below; `closing?.id === f.id` inside
    // JSX leaves TypeScript unable to prove it is still non-null by the time a handler runs.
    const active = closing?.id === f.id ? closing : null;
    // FROM THE BOARD, closing as done needs words -- there is no encounter here to name as what settled
    // it, so without them the record would say only that somebody clicked. From the consultation the
    // encounter itself is the answer, and the words are optional there.
    const needsWords = active !== null && (active.action === "complete" || active.action === "missed");

    return (
    <li key={f.id} className={`border-b border-gray-100 py-2 last:border-0 ${tone === "overdue" ? "pl-2 border-l-2 border-l-[var(--cmp-color-critical)]" : ""}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <Link href={`/practice/patients/${f.patient_id}`} className="text-[13px] font-semibold text-gray-900 hover:underline">
          {f.patient_name ?? "Unknown patient"}
        </Link>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
          {KIND_LABEL[f.kind] ?? f.kind}
        </span>
        {f.priority !== "routine" && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
            f.priority === "urgent"
              ? "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"
              : "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"}`}>
            {f.priority}
          </span>
        )}
        <span className={`ml-auto text-[11px] ${
          tone === "overdue" ? "font-bold text-[var(--cmp-text-critical)]" : "text-gray-500"}`}>
          {tone === "closed"
            ? `${f.status.toLowerCase()} ${String(f.closed_at ?? "").slice(0, 10)}`
            : f.overdue ? overdueWord(f.dueInDays)
              : f.status === "SCHEDULED" ? `booked ${f.bookedFor ?? ""}${f.late ? " — after it was due" : ""}`
                : dueWord(f.dueInDays)}
        </span>
      </div>
      <p className="mt-0.5 text-[12px] text-gray-700">{f.reason}</p>
      {f.outcome && <p className="mt-0.5 text-[11px] text-gray-500">{f.outcome}</p>}
      <div className="mt-1 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-gray-400">due {f.due_on}</span>
        {f.origin_encounter_id && (
          <Link href={`/practice/encounters/${f.origin_encounter_id}`} className="text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            the consultation that raised it
          </Link>
        )}
        {canManage && tone !== "closed" && (
          <span className="ml-auto flex gap-1.5">
            {(f.status === "MISSED" ? ["reopen"] : ["complete", "missed", "cancel"]).map(action => (
              <button key={action} type="button" disabled={busy}
                onClick={() => {
                  const to = FOLLOW_UP_ACTIONS[action];
                  if (action === "reopen") return act(f.id, { action });
                  setOutcome(""); setClosing({ id: f.id, action: to === "COMPLETED" ? "complete" : action });
                }}
                className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                {action === "complete" ? "Close as done" : action === "missed" ? "Missed" : action === "cancel" ? "Not needed" : "Reopen"}
              </button>
            ))}
          </span>
        )}
      </div>

      {active && (
        <form className="mt-2 flex flex-col gap-1.5 rounded-lg bg-gray-50 p-2"
          onSubmit={e => { e.preventDefault(); act(f.id, { action: active.action, outcome }); }}>
          <label htmlFor={`outcome-${f.id}`} className="text-[11px] font-semibold text-gray-600">
            {active.action === "complete" ? "What happened?"
              : active.action === "missed" ? "Why is this being marked missed?"
                : "Why is this no longer needed? (optional)"}
          </label>
          <input id={`outcome-${f.id}`} autoFocus value={outcome} onChange={e => setOutcome(e.target.value)} className={input} />
          <div className="flex gap-1.5">
            <button type="submit" disabled={busy || (needsWords && !outcome.trim())}
              className="rounded-lg bg-[var(--cp-primary)] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
              Confirm
            </button>
            <button type="button" onClick={() => setClosing(null)}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-white">
              Cancel
            </button>
          </div>
          {active.action === "complete" && (
            <p className="text-[10px] text-gray-400">
              Closing from a consultation records the encounter instead; this route records your words.
              Either way something has to say what happened.
            </p>
          )}
        </form>
      )}
    </li>
    );
  };

  const groups: [string, any[], "overdue" | "soon" | "scheduled" | "later" | "closed", string][] = [
    ["Overdue", board.overdue, "overdue", "Past their due date with nothing booked. This group is the reason the page exists."],
    ["Due soon", board.dueSoon, "soon", `Due within ${board.horizonDays} days and not yet booked.`],
    ["Booked", board.scheduled, "scheduled", "An appointment exists. Cancelling it puts the follow-up back in Overdue or Due soon, automatically."],
    ["Later", board.later, "later", "Committed, not due yet."],
    ["Recently closed", board.recentlyClosed, "closed", "The last ten to be settled, however they were settled."],
  ];

  const total = board.overdue.length + board.dueSoon.length + board.scheduled.length + board.later.length;

  return (
    <>
      {notice && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>{notice.text}</p>
      )}

      {total === 0 && board.recentlyClosed.length === 0 && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <p className="text-[13px] font-semibold text-gray-700">Nothing is owed.</p>
          <p className="mt-1 text-[12px] text-gray-500">
            Follow-ups are raised from a consultation &mdash; open an encounter and use{" "}
            <span className="font-semibold">Raise a follow-up</span> to commit to seeing someone again.
            Today is {today} in this practice.
          </p>
        </section>
      )}

      {groups.map(([title, list, tone, note]) => list.length > 0 && (
        <section key={title} className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <h2 className={`text-[13px] font-bold ${tone === "overdue" ? "text-[var(--cmp-text-critical)]" : "text-gray-900"}`}>{title}</h2>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">{list.length}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-500">{note}</p>
          <ul className="mt-2">{list.map(f => row(f, tone))}</ul>
        </section>
      ))}
    </>
  );
}

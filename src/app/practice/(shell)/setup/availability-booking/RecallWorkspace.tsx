"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RECALL_NOT_RECORDED, RECALL_NOT_CONFIGURABLE, PHASE5_SWATCH,
} from "@/lib/practice/recall-constants";

/**
 * ⚠ COPIED RATHER THAN IMPORTED, AND DELIBERATELY.
 *
 * availability-config.ts exports an identical `hhmm`, and importing it here would drag the whole slot
 * generator -- a server module full of database calls -- into the client bundle for the sake of three
 * lines of arithmetic. This is the same class of mistake as a server-only import reaching a client
 * component, and it passes tsc, eslint and every harness on the way through.
 */
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 PHASE 5 -- s7.5's RECALL QUEUE AND s7.7's WALK-IN RULES, AS A SCREEN.
//
// ⚠ EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN, and every one of those lists arrives from the
// server already built. Nothing here filters, sorts or re-derives: the queue and the number above it are
// the same array, so a tile cannot claim fourteen over a list showing nine -- the failure the Patients
// register shipped once and the follow-ups workspace was rewritten to make impossible.
//
// ⚠ AND AN EMPTY QUEUE IS NOT DRAWN LIKE AN UNREADABLE ONE. "Nobody needs recalling" is the most
// reassuring sentence this screen can print and the one it must never print on the strength of a query
// that failed. Each read carries its own failure and each is rendered as a failure.
//
// ⚠ WHAT IS NOT RECORDED IS ON THE SCREEN. There is no store for a recall ATTEMPT, so nothing here says
// or implies that anybody has been rung. A list of fourteen names with no such caveat reads as a list
// somebody is working through.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

function Unreadable({ what }: { what: string }) {
  return (
    <p className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
      <span className="font-bold">Could not be read.</span> {what} That is not a count of nothing — it is
      no count at all.
    </p>
  );
}

function Tile({ k, n, label, blurb }: { k: string; n: number | null; label: string; blurb: string }) {
  const sw = PHASE5_SWATCH[k];
  return (
    <div className={`rounded-xl border p-3 ${sw.box}`}>
      <span aria-hidden className={`flex h-7 w-7 items-center justify-center rounded-lg text-[13px] ${sw.badge}`}>
        {sw.icon}
      </span>
      <p className={`mt-1.5 text-[22px] font-bold leading-none ${n === null ? "text-slate-300" : sw.figure}`}>
        {n === null ? "—" : n}
      </p>
      <p className="mt-1 text-[11px] font-semibold leading-snug text-gray-700">{label}</p>
      <p className={`text-[10px] leading-snug ${sw.caption}`}>{blurb}</p>
    </div>
  );
}

export default function RecallWorkspace({ recall, walkIns, mayManage }: {
  recall: any; walkIns: any; mayManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  async function returnToQueue(followUpId: string) {
    setBusy(followUpId); setNotice(null);
    const res = await fetch("/api/v1/practice/booking-access", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "return_stranded_follow_up", followUpId }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) { setNotice({ kind: "ok", text: "Returned to the queue. It is open again, and the trail says why." }); router.refresh(); }
    else setNotice({ kind: "bad", text: data.error ?? `Refused (${res.status}).` });
  }

  const q = recall;
  const bookedWalkIns = walkIns.bookedWalkInIds === null ? null : walkIns.bookedWalkInIds.length;
  const queuedWalkIns = walkIns.queuedWalkInIds === null ? null : walkIns.queuedWalkInIds.length;

  return (
    <>
      {/* ══ s7.5 THE RECALL QUEUE ═══════════════════════════════════════════════════════════════ */}
      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-[14px] text-rose-700">⏱</span>
          <div className="min-w-0">
            <h3 className="text-[14px] font-bold text-gray-900">Follow-ups nobody has booked</h3>
            <p className="text-[11px] text-gray-500">
              Worked out from each follow-up&apos;s own due date against {q.today} in {q.timezone}.
              Nothing is stored, so this cannot fall behind.
            </p>
          </div>
          <Link href="/practice/follow-ups" className="ml-auto text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
            Open Follow-ups →
          </Link>
        </div>

        {q.unavailable ? (
          <Unreadable what={`Your follow-ups could not be read. ${q.detail ?? ""}`} />
        ) : (
          <>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <Tile k="overdue" n={q.overdue.length} label="Overdue and unbooked"
                blurb="The date has passed and nothing is booked." />
              <Tile k="due_today" n={q.dueToday.length} label="Due today"
                blurb="One day from being overdue." />
              <Tile k="stranded" n={q.strandedUnavailable ? null : q.stranded.length} label="Booking has died"
                blurb="Reads as booked; the appointment is cancelled or missed." />
              <Tile k="unreachable" n={q.contactUnavailable ? null : q.unreachable.length} label="No way to reach them"
                blurb="No phone and no email on the record. A subset of the two figures on the left." />
            </div>

            {q.contactUnavailable && (
              <p className="mt-2.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                <span className="font-bold">The contact register could not be read.</span>{" "}
                {q.contactDetail} So this screen does not say who can and cannot be reached — it does not
                say &quot;nobody&quot; either.
              </p>
            )}

            {(q.overdue.length > 0 || q.dueToday.length > 0) && (
              <ul className="mt-3 divide-y divide-gray-100">
                {[...q.overdue, ...q.dueToday].slice(0, 12).map((e: any) => (
                  <li key={e.followUpId} className="flex flex-wrap items-baseline gap-2 py-1.5">
                    <Link href={e.href} className="text-[12px] font-semibold text-gray-900 hover:underline">
                      {e.patientName ?? "Unnamed patient"}
                    </Link>
                    <span className="text-[11px] text-gray-500">{e.reason}</span>
                    <span className="ml-auto text-[11px] font-bold text-rose-700">
                      {e.daysOverdue > 0 ? `${e.daysOverdue} day${e.daysOverdue === 1 ? "" : "s"} late` : "due today"}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {e.contactRoutes === null ? "reachability unknown"
                        : e.contactRoutes === 0 ? "no phone or email"
                          : `${e.contactRoutes} way${e.contactRoutes === 1 ? "" : "s"} to reach them`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {q.overdue.length + q.dueToday.length > 12 && (
              <p className="mt-1.5 text-[10.5px] text-gray-500">
                The first 12 of {q.overdue.length + q.dueToday.length}. The rest are in Follow-ups.
              </p>
            )}
            {q.overdue.length === 0 && q.dueToday.length === 0 && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">
                Nothing is due or overdue and unbooked today. This was read, not assumed.
              </p>
            )}

            {/* ── THE STRANDED LIST, AND THE ONE ACTION THAT HAS A STORE BEHIND IT ────────────── */}
            {q.strandedUnavailable ? (
              <div className="mt-3">
                <Unreadable what={`The appointments behind your booked follow-ups could not be read. ${q.strandedDetail ?? ""}`} />
              </div>
            ) : q.stranded.length > 0 && (
              <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
                <p className="text-[12px] font-bold text-violet-900">
                  {q.stranded.length} follow-up{q.stranded.length === 1 ? "" : "s"} read as booked, and
                  the booking is not going to happen
                </p>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-violet-800/90">
                  The board says somebody is booked in. Nobody is coming. Returning one puts it back in
                  the queue, records why, and clears the dead appointment off it.
                </p>
                <ul className="mt-2 space-y-1.5">
                  {q.stranded.map((e: any) => (
                    <li key={e.followUpId} className="flex flex-wrap items-baseline gap-2">
                      <Link href={e.href} className="text-[11.5px] font-semibold text-violet-900 hover:underline">
                        {e.patientName ?? "Unnamed patient"}
                      </Link>
                      <span className="text-[10.5px] text-violet-800/80">
                        {e.appointmentAt.slice(0, 10)} · {String(e.appointmentStatus).toLowerCase().replace(/_/g, " ")}
                      </span>
                      <button type="button" disabled={!mayManage || busy === e.followUpId}
                        onClick={() => returnToQueue(e.followUpId)}
                        className="ml-auto rounded-lg border border-violet-300 bg-white px-2 py-1 text-[10.5px] font-semibold text-violet-800 disabled:opacity-50">
                        {busy === e.followUpId ? "Returning…" : "Return to the queue"}
                      </button>
                    </li>
                  ))}
                </ul>
                {!mayManage && (
                  <p className="mt-1.5 text-[10px] text-violet-800/80">
                    Returning one needs the permission that manages follow-ups, which you do not hold.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {notice && (
          <p className={`mt-2.5 rounded-lg px-3 py-2 text-[11.5px] leading-relaxed ${
            notice.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
            {notice.text}
          </p>
        )}

        {/* ⚠ WHAT THIS QUEUE DOES NOT RECORD. On the screen, not in a comment. */}
        <div className="mt-3 border-t border-gray-100 pt-2.5">
          {RECALL_NOT_RECORDED.map(r => (
            <p key={r.what} className="mt-1 text-[10px] leading-relaxed text-slate-500">
              <span className="font-bold">Not recorded:</span> {r.what.toLowerCase()}. {r.whyNot}
            </p>
          ))}
          {RECALL_NOT_CONFIGURABLE.map(r => (
            <p key={r.what} className="mt-1 text-[10px] leading-relaxed text-slate-500">
              <span className="font-bold">Not configurable:</span> {r.what.toLowerCase()}. {r.whyNot}
            </p>
          ))}
        </div>
      </section>

      {/* ══ s7.7 WALK-INS ═══════════════════════════════════════════════════════════════════════ */}
      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-100 text-[14px] text-cyan-700">⇥</span>
          <div className="min-w-0">
            <h3 className="text-[14px] font-bold text-gray-900">Walk-ins on {walkIns.date}</h3>
            <p className="text-[11px] text-gray-500">
              Your sessions that day, the limit each one resolves to, and how many people have actually
              arrived.
            </p>
          </div>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-3">
          <Tile k="walk_ins" n={walkIns.sessionsUnreadable ? null : walkIns.sessions.length}
            label="Sessions taking walk-ins"
            blurb={walkIns.sessionsUnreadable ? "unreadable" : `${walkIns.sessionsClosedToWalkIns.length} more are closed to them`} />
          <Tile k="walk_ins" n={bookedWalkIns} label="Walk-ins in the diary"
            blurb="Appointments typed as a walk-in today, live statuses only." />
          <Tile k="walk_ins" n={queuedWalkIns} label="Waiting with no appointment"
            blurb="Queue entries with nothing booked behind them. Never added to the figure on the left." />
        </div>

        {walkIns.sessionsUnreadable && <div className="mt-2.5"><Unreadable what={walkIns.sessionsUnreadable} /></div>}
        {walkIns.bookedWalkInsUnreadable && <div className="mt-2.5"><Unreadable what={walkIns.bookedWalkInsUnreadable} /></div>}
        {walkIns.queuedWalkInsUnreadable && <div className="mt-2.5"><Unreadable what={walkIns.queuedWalkInsUnreadable} /></div>}

        {walkIns.sessions.length > 0 && (
          <ul className="mt-3 divide-y divide-gray-100">
            {walkIns.sessions.map((s: any) => (
              <li key={s.sessionId} className="flex flex-wrap items-baseline gap-2 py-1.5">
                <span className="text-[12px] font-semibold text-gray-900">{s.sessionName}</span>
                <span className="text-[10.5px] text-gray-500">
                  {hhmm(s.startsMinute)}–{hhmm(s.endsMinute)}
                  {s.locationName ? ` · ${s.locationName}` : ""}
                </span>
                <span className="ml-auto text-[11px] font-bold text-cyan-700">
                  {/* ⚠ USED OUT OF LIMIT, and a dash rather than a nought where the count failed --
                      "0 of 6" on an unreadable count is an invitation to fill a session that is full. */}
                  {s.effectiveLimit === null
                    ? `${s.usedIds === null ? "—" : s.usedIds.length} so far, no limit set`
                    : `${s.usedIds === null ? "—" : s.usedIds.length} of ${s.effectiveLimit}`}
                </span>
                <span className="text-[10px] text-gray-500">
                  {s.effectiveLimitFrom === "none" ? "neither this session nor a rule sets one"
                    : s.effectiveLimitFrom === "session" ? `this session's own limit${s.practiceDailyLimit !== null ? `, stricter than the rule's ${s.practiceDailyLimit}` : ""}`
                      : s.effectiveLimitFrom === "practice" ? `from the booking rule${s.sessionLimit !== null ? `, stricter than this session's ${s.sessionLimit}` : ""}`
                        : "the session and the rule agree"}
                  {s.effectiveLimit !== null && !s.effectiveLimitEnforced ? " — not checked at booking time" : ""}
                  {s.remaining !== null ? ` · ${s.remaining} left` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {walkIns.sessions.length === 0 && !walkIns.sessionsUnreadable && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">
            No session on {walkIns.date} takes walk-ins.
            {walkIns.sessionsClosedToWalkIns.length > 0
              ? ` ${walkIns.sessionsClosedToWalkIns.length} session${walkIns.sessionsClosedToWalkIns.length === 1 ? " is" : "s are"} running, and none of them allows one.`
              : " Nothing is running that day either."}
          </p>
        )}

        <p className="mt-3 border-t border-gray-100 pt-2.5 text-[10.5px] leading-relaxed text-amber-800">
          <span className="font-bold">⚠ Which of these numbers actually refuses a booking.</span>{" "}
          {walkIns.enforcementNote}
        </p>
        <div className="mt-1.5">
          {walkIns.notConfigurable.map((n: any) => (
            <p key={n.what} className="mt-1 text-[10px] leading-relaxed text-slate-500">
              <span className="font-bold">Not configurable:</span> {n.what.toLowerCase()}. {n.whyNot}
            </p>
          ))}
        </div>
      </section>
    </>
  );
}

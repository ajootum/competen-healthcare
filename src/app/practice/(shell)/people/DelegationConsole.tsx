"use client";

import { useState } from "react";
import Link from "next/link";
import { DELEGATION_AREAS } from "@/lib/practice/delegation-constants";

// CPR-310's delegation surface, laid out to the comp: the KPI strip, active work queues, the delegation
// board by area, recent delegated activity and the approval queue.
//
// THE COMP'S "DELEGATION HEALTH 92% — EXCELLENT" IS NOT HERE, and its four sub-scores (Timely Completion
// 95%, Accuracy 93%, Communication 90%, Approval Time 89%) are not either. There is no formula behind any
// of them and there could not be one -- "accuracy" of a delegated action is not a quantity this product
// observes. What replaces them is the queue counts, which are real and which a reader can act on line by
// line. Same doctrine as CPR-270's.
//
// "Time Saved 18.5 hrs" and "Accuracy Rate 93%" are likewise absent: both are invented indices. The
// panel that would have held them says so.

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const card = "rounded-xl border border-gray-200 bg-white p-4";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function DelegationConsole({
  board, queues, approvals, templates, team, canManage, me, soloPractice,
}: {
  board: any; queues: any; approvals: any[]; templates: any[]; team: any[];
  canManage: boolean; me: string;
  /** ⚠ null = the member list could not be read. Treated as NOT solo, never as solo. */
  soloPractice: boolean | null;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err" | "part"; text: string } | null>(null);
  const [grant, setGrant] = useState({ membershipId: "", area: "scheduling", days: "30", note: "" });
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");

  const endsAt = (days: string) =>
    new Date(Date.now() + Math.max(1, Number(days) || 30) * 86400000).toISOString();

  async function send(method: string, body: unknown, ok = "Done.") {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/delegation", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      setBusy(false); return null;
    }
    // A PARTIAL RESULT IS REPORTED AS ONE. Somebody applying a five-area template who got three has to be
    // told which two did not go, or they will believe the cover is in place.
    if (data.refused?.length) {
      setNotice({
        kind: "part",
        text: `Granted ${data.granted.join(", ")}. Not granted: ${data.refused.map((r: any) => `${r.area} (${r.reason})`).join("; ")}`,
      });
      setBusy(false); return data;
    }
    void ok;
    window.location.reload();
    return data;
  }

  // listTeam returns one entry PER PERSON, carrying their memberships -- provisioning gives the owner
  // two, and a picker listing somebody twice is a bug the first time anybody picks the wrong one. The
  // active membership is the one a delegation attaches to.
  const activeMembers = team
    .filter((m: any) => m.active && m.userId !== me)
    .map((m: any) => ({ ...m, membershipId: m.memberships.find((x: any) => x.status === "active")?.id }))
    .filter((m: any) => m.membershipId);

  return (
    <>
      {notice && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${
          notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
            : notice.kind === "part" ? "bg-amber-50 text-amber-900"
              : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      {/* ── KPI strip (comp: six tiles) ─────────────────────────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Team members</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{board.memberCount}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">active</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Areas delegated</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{board.live.length}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">live right now</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Waiting for approval</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{queues.pendingApprovals}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            {queues.urgentApprovals > 0 ? `${queues.urgentApprovals} urgent` : "none urgent"}
          </p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Work queue items</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {queues.queues.reduce((n: number, q: any) => n + q.total, 0)}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-500">across {queues.queues.length} queues</p>
        </div>
        {/* The comp's "Delegation Health 92%" and "Time Saved 18.5 hrs". Neither has a formula. */}
        <div className={`${card} border-dashed bg-gray-50/60`}>
          <p className="text-[11px] font-semibold text-gray-500">Delegation health</p>
          <p className="mt-1 text-2xl font-bold text-gray-300">&mdash;</p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            A composite score with no defined formula. The queues above are the real measure.
          </p>
        </div>
        <div className={`${card} border-dashed bg-gray-50/60`}>
          <p className="text-[11px] font-semibold text-gray-500">Time saved</p>
          <p className="mt-1 text-2xl font-bold text-gray-300">&mdash;</p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            Nothing measures how long the same work would have taken you.
          </p>
        </div>
      </div>

      <div className="mt-4 grid lg:grid-cols-3 gap-4 items-start">
        {/* ── Active work queues ─────────────────────────────────────────────────────────────────── */}
        <section className={card}>
          <h2 className="text-[13px] font-bold text-gray-900">Active work queues</h2>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Counted from the records themselves, so nothing has to run for these to be right.
          </p>
          <ul className="mt-2 flex flex-col">
            {queues.queues.map((q: any) => (
              <li key={q.key} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <Link href={q.href} className="text-[12px] text-gray-800 hover:underline">{q.label}</Link>
                <span className="ml-auto text-[13px] font-bold text-gray-900">{q.total}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Delegated access by area (comp: Delegated Access Summary) ──────────────────────────── */}
        <section className={card}>
          <h2 className="text-[13px] font-bold text-gray-900">Delegated access by area</h2>
          <ul className="mt-2 flex flex-col">
            {board.byArea.map((a: any) => (
              <li key={a.code} className="border-b border-gray-100 py-1.5 last:border-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-semibold text-gray-800">{a.label}</span>
                  {/* A COUNT, not the comp's percentage bar. "85%" of a practice with six people is a
                      number pretending to be a measurement. */}
                  <span className="ml-auto text-[11px] text-gray-600">
                    {a.holders === 0 ? "nobody" : `${a.holders} ${a.holders === 1 ? "person" : "people"}`}
                  </span>
                </div>
                <p className="text-[10px] text-gray-500">{a.detail}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Approvals ──────────────────────────────────────────────────────────────────────────── */}
        <section className={card}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-bold text-gray-900">Waiting for approval</h2>
            <span className="text-[11px] text-gray-500">{approvals.length}</span>
          </div>
          {/* THE SENTENCE THIS PANEL MUST NOT LOSE. */}
          <p className="mt-0.5 text-[11px] text-gray-500">
            A queue, not a gate. The work was already done &mdash; whoever did it held the permission.
            This records that you wanted to see it.
          </p>
          {approvals.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">Nothing waiting.</p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {approvals.map((a: any) => (
                <li key={a.id} className="border-b border-gray-100 py-1.5 last:border-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12px] text-gray-800">{a.summary}</span>
                    {a.urgency === "urgent" && (
                      <span className="rounded bg-[var(--cmp-surface-critical)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--cmp-text-critical)]">
                        urgent
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500">
                    {a.requestedByName ?? "Someone"} · {String(a.subject_kind).replace(/_/g, " ")}
                    {" · "}{new Date(a.created_at).toLocaleDateString()}
                  </p>
                  {a.requested_by === me && soloPractice !== true ? (
                    // Nobody approves their own work, so the buttons are not offered rather than
                    // offered-and-refused.
                    // ⚠ `soloPractice !== true` rather than `=== false`: an UNKNOWN member count (a
                    // failed read) keeps the strict behaviour. Waiving segregation of duties on a
                    // database blip is the one outcome this must not produce.
                    <p className="mt-1 text-[10px] text-gray-400">
                      Yours &mdash; somebody else decides it.
                      {soloPractice === null && " (This practice's member list could not be read just now.)"}
                    </p>
                  ) : decidingId === a.id ? (
                    <div className="mt-1 flex flex-col gap-1">
                      {/* ⚠ SAID BEFORE THEY DECIDE, NOT AFTER. The user's decision of 2026-08-10 permits
                          a sole member to decide their own request, on the condition that it is recorded
                          as self-approved and the document says so permanently. A practitioner is
                          entitled to know that before they click, not to discover it on the printout. */}
                      {a.requested_by === me && soloPractice === true && (
                        <p className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber-900">
                          This is your own request, and you are the only member of this practice. You may
                          decide it — and the record will say it was approved by its author, with nobody
                          else having read it. That sentence stays on the document.
                        </p>
                      )}
                      <input value={decisionNote} onChange={e => setDecisionNote(e.target.value)}
                        placeholder="What needs to change? (required to send back)" className={input} />
                      <span className="flex gap-2">
                        <button type="button" disabled={busy}
                          onClick={() => send("PATCH", { approvalId: a.id, decision: "APPROVED", note: decisionNote })}
                          className="rounded-lg bg-[var(--cp-primary)] px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-40">
                          Approve
                        </button>
                        <button type="button" disabled={busy || !decisionNote.trim()}
                          onClick={() => send("PATCH", { approvalId: a.id, decision: "REJECTED", note: decisionNote })}
                          className="rounded-lg border border-gray-200 px-3 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                          Send back
                        </button>
                        <button type="button" onClick={() => setDecidingId(null)}
                          className="text-[11px] text-gray-500 hover:underline">Cancel</button>
                      </span>
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setDecidingId(a.id); setDecisionNote(""); }}
                      className="mt-1 text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                      Review
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {canManage && (
        <>
          {/* ── Grant an area ────────────────────────────────────────────────────────────────────── */}
          <section className={`${card} mt-4`}>
            <h2 className="text-[13px] font-bold text-gray-900">Delegate an area</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              You can only grant what you hold, and only in full &mdash; a half-granted area would appear
              on this page as cover that is not there. Nothing clinical is delegable: signing stays with
              the practitioner.
            </p>
            {activeMembers.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">Nobody else here yet.</p>
            ) : (
              <div className="mt-2 grid sm:grid-cols-4 gap-2 items-end">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-gray-500">To</span>
                  <select value={grant.membershipId} onChange={e => setGrant(g => ({ ...g, membershipId: e.target.value }))} className={input}>
                    <option value="">Choose</option>
                    {activeMembers.map((m: any) => (
                      <option key={m.membershipId} value={m.membershipId}>{m.name ?? "Unnamed member"}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-gray-500">Area</span>
                  <select value={grant.area} onChange={e => setGrant(g => ({ ...g, area: e.target.value }))} className={input}>
                    {DELEGATION_AREAS.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-gray-500">For how long</span>
                  <input type="number" min={1} max={365} value={grant.days}
                    onChange={e => setGrant(g => ({ ...g, days: e.target.value }))} className={input} />
                  <span className="text-[10px] text-gray-400">days. It must end.</span>
                </label>
                <button type="button" disabled={busy || !grant.membershipId}
                  onClick={() => send("POST", {
                    membershipId: grant.membershipId, area: grant.area,
                    effectiveTo: endsAt(grant.days), note: grant.note || undefined,
                  })}
                  className="rounded-lg bg-[var(--cp-primary)] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40">
                  Delegate
                </button>
              </div>
            )}

            {templates.length > 0 && (
              <div className="mt-3 border-t border-gray-100 pt-2">
                <p className="text-[11px] font-semibold text-gray-500">Or apply a role template</p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {templates.map((t: any) => (
                    <li key={t.id}>
                      <button type="button" disabled={busy || !grant.membershipId}
                        onClick={() => send("POST", {
                          membershipId: grant.membershipId, templateId: t.id, effectiveTo: endsAt(grant.days),
                        })}
                        title={t.areaLabels.join(", ")}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                        {t.title} <span className="text-[10px] font-normal text-gray-400">({t.areas.length} areas)</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* ── The delegations themselves ───────────────────────────────────────────────────────── */}
          <section className={`${card} mt-4`}>
            <h2 className="text-[13px] font-bold text-gray-900">Delegations</h2>
            {board.delegations.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">None yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {board.delegations.map((d: any) => (
                  <li key={d.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                    <span className="min-w-0">
                      <span className="block text-[12px] font-semibold text-gray-800">
                        {d.name ?? "Unnamed member"} &mdash; {d.areaLabel}
                      </span>
                      <span className="block text-[10px] text-gray-500">
                        until {new Date(d.effective_to).toLocaleDateString()}
                        {d.note ? ` · ${d.note}` : ""}
                        {d.withdrawn_reason ? ` · withdrawn: ${d.withdrawn_reason}` : ""}
                      </span>
                    </span>
                    {/* Withdrawn and expired are different answers to "why did this stop". */}
                    <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      d.state === "live" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
                        : d.state === "scheduled" ? "bg-[var(--cp-primary-soft)] text-[var(--cp-primary-deep)]"
                          : "bg-gray-100 text-gray-600"}`}>
                      {d.state}
                    </span>
                    {d.state === "live" && (
                      <button type="button" disabled={busy} onClick={() => {
                        const reason = prompt("Why is this being withdrawn?");
                        if (reason?.trim()) send("PATCH", { delegationId: d.id, reason });
                      }} className="shrink-0 text-[11px] text-[var(--cmp-text-critical)] hover:underline">
                        Withdraw
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* The comp's AI Team Assistant. */}
      <section className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-4">
        <h2 className="text-[13px] font-bold text-gray-500">AI team assistant</h2>
        <p className="mt-1 text-[11px] text-gray-500">
          Delegation recommendations, workload balancing and bottleneck detection are specified for a future assistant, which is not built.
        </p>
      </section>
    </>
  );
}

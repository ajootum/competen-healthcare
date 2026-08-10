"use client";

import { useState } from "react";
import Link from "next/link";
import { BUTTON } from "@/lib/practice/palette";
import {
  GUIDANCE_STATE_SWATCH, GUIDANCE_CHECK_SWATCH, GUIDANCE_ROUTE, guidanceSection,
} from "@/lib/practice/knowledge-constants";

// One guidance document. CPR-KS-001 Engine 4's ten sections, section 3's five states, and the
// publication checklist.
//
// ⚠ THE CHECKLIST HAS THREE MARKS AND ONE OF THEM IS NEITHER PASS NOR FAIL. Slate and a hollow ring for
// "not checked", never green and never absent -- an unwarned row reads as a cleared row, which is the
// same mistake publish-constants.ts exists to prevent with a booking page behind it instead.
//
// ⚠ EVERY CONTROL THAT CANNOT RUN SAYS WHY. A document that is not a draft shows its boxes read-only
// with the reason, rather than showing an editable box whose save will be refused.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Props = {
  detail: {
    state: "ok" | "absent" | "failed" | "not_found";
    detail: string | null;
    document: any | null;
    sections: any[];
    approval: any;
    readiness: { checks: any[]; blockers: number; warnings: number; publishable: boolean } | null;
    history: any[];
    moves: { from: string; to: string; label: string; why: string }[];
    notMonitored: { headline: string; detail: string; onPaper: string };
  };
  canManage: boolean;
  colleagues: { id: string; name: string }[];
};

const CARD = "rounded-xl border border-gray-200 bg-white";
const FIELD = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function GuidanceDocument({ detail, canManage, colleagues }: Props) {
  const doc = detail.document;
  // ⚠ THE VALUES AS LOADED, kept so "you have unsaved changes" is a comparison rather than a flag
  // somebody has to remember to set on every input. A flag drifts; a comparison cannot.
  const loadedBodies = Object.fromEntries(
    detail.sections.filter(s => s.source === "authored").map(s => [s.key, s.body ?? ""]));
  const [bodies, setBodies] = useState<Record<string, string>>(loadedBodies);
  const [effectiveFrom, setEffectiveFrom] = useState<string>(doc?.effective_from ?? "");
  const [reviewOn, setReviewOn] = useState<string>(doc?.review_on ?? "");
  const [assignee, setAssignee] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // ⚠ WHY THIS EXISTS. The publication checklist below is computed on the SERVER from the SAVED
  // document. A practitioner who fills six sections and two dates, then looks up at a list saying
  // "Empty: purpose, scope, procedure", reasonably concludes the product cannot read what they wrote.
  // That happened during the walkthrough of 2026-08-10 and cost real time. The checklist was correct
  // and said nothing about which version of the document it was describing.
  const unsaved =
    Object.keys(loadedBodies).some(k => (bodies[k] ?? "") !== (loadedBodies[k] ?? ""))
    || effectiveFrom !== (doc?.effective_from ?? "")
    || reviewOn !== (doc?.review_on ?? "");

  if (detail.state !== "ok" || !doc)
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
        <h1 className="text-[14px] font-bold text-amber-900">This document cannot be shown.</h1>
        <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-amber-900/80">
          {detail.state === "absent"
            ? "Practice Guidance has no store in this deployment, so there is nothing to open. This is a fact about the build rather than about this document."
            : "Something needed to read this document failed. That is not the same as the document being empty, and nothing below is shown as though it were."}
        </p>
        {detail.detail && (
          <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 font-mono text-[11px] text-amber-900">{detail.detail}</p>
        )}
        <a href={GUIDANCE_ROUTE} className="mt-3 inline-block text-[12px] text-amber-900 underline">
          Back to the library
        </a>
      </div>
    );

  const swatch = GUIDANCE_STATE_SWATCH[doc.status] ?? GUIDANCE_STATE_SWATCH.draft;
  const editable = !!doc.editable && canManage;

  async function post(url: string, payload: Record<string, unknown>, method = "POST") {
    setBusy(true); setError(null); setSaved(false);
    const res = await fetch(url, {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data?.error?.message ?? "That did not work."); return false; }
    return true;
  }

  const save = async () => {
    const ok = await post(`/api/v1/practice/knowledge/${doc.id}`, {
      effectiveFrom: effectiveFrom || null,
      reviewOn: reviewOn || null,
      sections: Object.entries(bodies).map(([key, body]) => ({ key, body })),
    }, "PATCH");
    if (ok) { setSaved(true); window.location.reload(); }
  };

  const move = async (action: string, extra: Record<string, unknown> = {}) => {
    const ok = await post(`/api/v1/practice/knowledge/${doc.id}/lifecycle`, { action, ...extra });
    if (ok) window.location.reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <a href={GUIDANCE_ROUTE} className="text-[12px] text-gray-500 hover:underline">&larr; Practice Guidance</a>
        <a href={`${GUIDANCE_ROUTE}/${doc.id}/print`}
          className={`${BUTTON.quiet} ml-auto rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>
          Print or save as PDF
        </a>
      </div>

      <header>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[12px] text-gray-500">{doc.code}</span>
          <h1 className="text-[18px] font-bold text-gray-900">{doc.title}</h1>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${swatch.chip}`}>{doc.stateLabel}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">{doc.typeLabel}</span>
          <span className="text-[11.5px] text-gray-400">Version {doc.version}</span>
        </div>
        {doc.stateMeaning && <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-gray-600">{doc.stateMeaning}</p>}
      </header>

      {/* ⚠ THE STANDING NOTICE, ON THE DOCUMENT ITSELF. */}
      <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
        <p className="text-[12.5px] font-bold text-slate-800">
          <span aria-hidden className="mr-1.5">◌</span>{detail.notMonitored.headline}
        </p>
        <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-600">{detail.notMonitored.detail}</p>
      </section>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{error}</p>}
      {saved && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">Saved.</p>}

      {/* ── THE TEN SECTIONS ────────────────────────────────────────────────────────────────────── */}
      <section className="space-y-2.5">
        {detail.sections.map(s => {
          const def = guidanceSection(s.key);
          if (s.source === "derived")
            return (
              <div key={s.key}
                className={`rounded-xl border p-3.5 ${s.state === "not_checked" ? "border-dashed border-slate-300 bg-slate-50/70" : "border-gray-200 bg-gray-50/60"}`}>
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] text-gray-400">{s.position}</span>
                  <h2 className="text-[13px] font-bold text-gray-900">{s.heading}</h2>
                  <span className="rounded bg-slate-200 px-1.5 text-[10px] font-bold text-slate-700">read from the record</span>
                </div>
                {s.state === "not_checked" ? (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-slate-600">
                    <span aria-hidden className="mr-1">◌</span>{s.note}
                  </p>
                ) : (
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-800">{s.body}</p>
                )}
              </div>
            );

          return (
            <div key={s.key} className={`${CARD} p-3.5`}>
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] text-gray-400">{s.position}</span>
                <h2 className="text-[13px] font-bold text-gray-900">{s.heading}</h2>
                {s.required && <span className="rounded bg-rose-50 px-1.5 text-[10px] font-bold text-rose-700">required</span>}
              </div>
              {/* Guidance BESIDE the box, never written into the document. */}
              {def?.prompt && <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{def.prompt}</p>}
              {editable ? (
                <textarea
                  value={bodies[s.key] ?? ""}
                  onChange={e => setBodies(b => ({ ...b, [s.key]: e.target.value }))}
                  rows={Math.max(3, Math.min(16, ((bodies[s.key] ?? "").split("\n").length + 2)))}
                  maxLength={20000}
                  className={`${FIELD} mt-1.5 font-sans leading-relaxed`} />
              ) : s.body ? (
                <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-gray-800">{s.body}</p>
              ) : (
                <p className="mt-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-2.5 py-1.5 text-[12px] text-slate-600">
                  <span aria-hidden className="mr-1">◌</span>Nothing was written here.
                </p>
              )}
            </div>
          );
        })}
      </section>

      {/* ── DATES AND SAVING ────────────────────────────────────────────────────────────────────── */}
      {editable && (
        <section className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">Dates</h2>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">
            The effective date is when this comes into force and a published document must have one. The
            review date has to be after it &mdash; a document whose review has already passed on the day
            it starts is born overdue, and the database refuses it.
          </p>
          <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-gray-500">In force from</span>
              <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} className={FIELD} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-gray-500">Review by</span>
              <input type="date" value={reviewOn} onChange={e => setReviewOn(e.target.value)} className={FIELD} />
            </label>
          </div>
          <button onClick={save} disabled={busy}
            className={`${BUTTON.primary} mt-3 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold`}>
            {busy ? "Saving…" : "Save the draft"}
          </button>
        </section>
      )}

      {!editable && canManage && (
        <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
          <p className="text-[12.5px] font-semibold text-slate-700">
            <span aria-hidden className="mr-1.5">◌</span>This document cannot be edited.
          </p>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-600">
            {/* ⚠ "It is with a colleague" IS FALSE IN A ONE-PERSON PRACTICE, and that is who this
                product is sold to. The owner read it on 2026-08-11 while waiting for a colleague who
                does not exist. The freezing reason is the same either way; who is holding it is not. */}
            {doc.status === "in_review"
              ? colleagues.length === 0
                ? "It is waiting for YOUR decision — you are the only member of this practice. A document that changes while somebody is reading it is not the document they approved, so the text is frozen until it is withdrawn or decided."
                : "It is with a colleague. A document that changes while somebody is reading it is not the document they approved, so the text is frozen until it is withdrawn or decided."
              : doc.status === "approved"
              ? "It has been approved. Any further change would invalidate that approval, so re-opening it is a deliberate act that clears the approval with it."
              : doc.status === "published"
              ? "It is in force. Start a new version instead — the one people are following stays exactly as it was approved."
              : "It is archived. What the practice used to say is kept as it was."}
          </p>
        </section>
      )}

      {/* ── PUBLICATION CHECKLIST ───────────────────────────────────────────────────────────────── */}
      {detail.readiness && (
        <section className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">Before this is published</h2>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">
            {detail.readiness.blockers === 0
              ? "Nothing on this list is blocking publication."
              : `${detail.readiness.blockers} of these has to be settled first.`}
            {" "}Two rows can never be answered by anything in this build and say so rather than passing.
          </p>
          {/* ⚠ SAID BEFORE THE LIST, NOT AFTER IT. Somebody reading a blocker they have already fixed
              needs to know why it is still there BEFORE they start doubting what they typed. */}
          {unsaved && (
            <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
              This list describes the document as it is <strong>saved</strong>. You have changes on this
              screen that have not been saved yet — use <strong>Save the draft</strong> below, and this
              list will catch up.
            </p>
          )}
          <ul className="mt-2 space-y-1.5">
            {detail.readiness.checks.map(c => {
              const mark = GUIDANCE_CHECK_SWATCH[c.state] ?? GUIDANCE_CHECK_SWATCH.not_checked;
              return (
                <li key={c.code} className={`rounded-lg border p-2.5 ${mark.box}`}>
                  <p className="flex items-baseline gap-2 text-[12.5px]">
                    <span aria-hidden className={`rounded px-1.5 text-[11px] font-bold ${mark.badge}`}>{mark.icon}</span>
                    <span className="font-semibold text-gray-900">{c.requirement}</span>
                    <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-wide text-gray-400">
                      {c.severity} · {c.authority}
                    </span>
                  </p>
                  {(c.state !== "pass" || c.authority === "build") && (
                    <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">{c.detail}</p>
                  )}
                  {c.wouldNeed && (
                    <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">It would take: {c.wouldNeed}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── THE MOVES ───────────────────────────────────────────────────────────────────────────── */}
      {canManage && detail.moves.length > 0 && (
        <section className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">What can happen next</h2>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">
            Only these. Anything else is refused by name rather than quietly doing nothing.
          </p>

          <div className="mt-2.5 space-y-2.5">
            {detail.moves.map(m => (
              <div key={`${m.from}-${m.to}`} className="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
                <p className="text-[12.5px] font-semibold text-gray-900">{m.label}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">{m.why}</p>

                {m.to === "in_review" && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-gray-500">Ask which colleague?</span>
                      <select value={assignee} onChange={e => setAssignee(e.target.value)} className={`${FIELD} min-w-[220px]`}>
                        <option value="">Anybody who opens the queue</option>
                        {colleagues.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                    <button disabled={busy} onClick={() => move("submit", { assignedTo: assignee || null })}
                      className={`${BUTTON.primary} rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>
                      {m.label}
                    </button>
                    {colleagues.length === 0 && (
                      // ⚠ THIS SENTENCE USED TO SAY THE DOCUMENT "cannot be approved until somebody else
                      // joins". That was true, and it made practice guidance unusable for the solo
                      // clinician this product is sold to -- send for approval worked, deciding refused,
                      // publishing refused for want of a decision. The user's decision of 2026-08-10
                      // opened the loop: a sole member may decide their own request, and the document
                      // records that it was self-approved. See delegation.ts.
                      <p className="w-full text-[11.5px] text-slate-600">
                        <span aria-hidden className="mr-1">◌</span>
                        There is nobody else active in this practice to send it to. Send it anyway and
                        you can decide it yourself in Practice&nbsp;Setup &rsaquo; Team&nbsp;and&nbsp;Permissions
                        &mdash; the document will record that it was approved by its author, with nobody
                        else having read it.
                      </p>
                    )}
                  </div>
                )}

                {m.to === "draft" && (
                  <button disabled={busy} onClick={() => move("withdraw")}
                    className={`${BUTTON.quiet} mt-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>
                    {m.label}
                  </button>
                )}

                {m.to === "approved" && (
                  <div className="mt-2">
                    <button disabled={busy} onClick={() => move("sync")}
                      className={`${BUTTON.quiet} rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>
                      Check the approval queue
                    </button>
                    {/* ⚠ A LINK, AND THE NAME THE NAV ACTUALLY USES. This said "People > Approvals",
                        which is not a screen in this product -- the entry is Practice Setup > Team and
                        Permissions. The owner sent a document for approval on 2026-08-11, went looking
                        for the place to decide it, and stopped. A sentence naming a screen the sidebar
                        does not is the same defect as calling this section Knowledge Studio. */}
                    <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
                      The decision is made on the approval request itself, in{" "}
                      <Link href="/practice/people" className="font-semibold text-[var(--cp-primary)] underline">
                        Practice Setup &rsaquo; Team and Permissions
                      </Link>. This only brings the document into line with it.
                    </p>
                  </div>
                )}

                {m.to === "published" && (
                  <button disabled={busy}
                    onClick={() => move("publish", { effectiveFrom: effectiveFrom || null, reviewOn: reviewOn || null })}
                    className={`${BUTTON.primary} mt-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>
                    {m.label}
                  </button>
                )}

                {m.to === "archived" && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="block grow">
                      <span className="mb-1 block text-[11px] font-semibold text-gray-500">Why?</span>
                      <input value={reason} onChange={e => setReason(e.target.value)}
                        placeholder="Superseded, withdrawn, found to be wrong…" className={FIELD} />
                    </label>
                    <button disabled={busy} onClick={() => move("archive", { reason })}
                      className={`${BUTTON.danger} rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>
                      {m.label}
                    </button>
                  </div>
                )}
              </div>
            ))}

            {doc.status === "published" && (
              <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
                <p className="text-[12.5px] font-semibold text-gray-900">Start the next version</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">
                  A new draft with these sections copied into it. The version in force stays exactly as
                  it was approved until the new one replaces it.
                </p>
                <button disabled={busy} onClick={() => move("revise")}
                  className={`${BUTTON.primary} mt-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold`}>
                  Start version {doc.version + 1}
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── VERSIONS ────────────────────────────────────────────────────────────────────────────── */}
      {detail.history.length > 0 && (
        <section className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">Other versions</h2>
          <p className="mt-0.5 text-[11.5px] text-gray-500">
            Each is a document you can open, not a difference you have to reconstruct.
          </p>
          <ul className="mt-2 divide-y divide-gray-100">
            {detail.history.map(h => (
              <li key={h.id} className="py-1.5">
                <a href={`${GUIDANCE_ROUTE}/${h.id}`} className="text-[12.5px] hover:underline">
                  <span className="font-semibold text-gray-900">Version {h.version}</span>
                  <span className="text-gray-500"> &mdash; {h.status}{h.relation ? ` · ${h.relation}` : ""}</span>
                  {h.archived_reason && <span className="text-gray-500"> · {h.archived_reason}</span>}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

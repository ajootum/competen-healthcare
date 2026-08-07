"use client";

import { useState } from "react";
import Link from "next/link";
import type { PracticeLifecycle } from "@/lib/practice/lifecycle";
import {
  CLOSURE_CHIP, STATUS_MEANING, REASON_MIN, REASON_MAX, swatchFor,
} from "@/lib/practice/lifecycle-constants";

// CPR-LIFE-001 s8's screen: "Display current status badge and available lifecycle actions."
//
// ⚠ THERE IS NO DANGER ZONE ON THIS PAGE, AND ITS ABSENCE IS THE MOST DELIBERATE THING HERE.
//
// s8 asks for one and the comp draws one, containing a Permanent Delete behind five preconditions and
// four consequences. Three of the five preconditions cannot be checked by this product at all, and one
// of the four consequences is a claim that a deletion handles patient data in line with privacy law.
// That claim appears ONLY in the picture: the 61-line specification never makes it, names no law and
// names no mechanism, and the actual mechanism -- 111 cascading foreign keys -- contradicts it. A Danger
// Zone whose checklist cannot be checked teaches a practitioner that the checklist is decoration, on the
// one screen where that is the worst lesson to learn.
//
// So the delete is absent, the reason for its absence is rendered where it would have been, and the
// picture's sentence is not reproduced anywhere in this build -- not on the screen and not in this file.
// The lifecycle harness scans this source for it and fails if it comes back.
//
// ⚠ EVERY FIGURE IS A NUMBER OR AN EM DASH. `null` means the read failed; it is never drawn as a nought.

type Props = { lifecycle: PracticeLifecycle };

const fmtNumber = (n: number | null) => (n === null ? "—" : n.toLocaleString());

const fmtBytes = (n: number | null) => {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
};

const fmtWhen = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
};

export default function PracticeLifecycleConsole({ lifecycle }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!lifecycle.permitted) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <p className="text-sm text-gray-600">
          You do not hold <code className="rounded bg-gray-100 px-1">practice.lifecycle.view</code>, so this
          practice&rsquo;s lifecycle is not shown to you.
        </p>
      </section>
    );
  }

  const swatch = swatchFor(lifecycle.status);
  const changedWhen = fmtWhen(lifecycle.changedAt);

  async function submit(action: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/v1/practice/lifecycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error?.message ?? `That did not work (${res.status}).`);
        return;
      }
      setDone(`This practice is now ${String(body.to ?? "").toLowerCase()}.`);
      setPending(null); setReason("");
      // The whole page's figures, history and available verbs all move together, so it is reloaded
      // rather than patched -- a half-updated lifecycle screen is a screen that lies about one half.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── CURRENT STATE ─────────────────────────────────────────────────────────────────────── */}
      <section className={`rounded-2xl border p-5 ${swatch.box}`}>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${swatch.chip}`}>
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${swatch.dot}`} />
                {lifecycle.status ?? "Could not be read"}
              </span>
              {lifecycle.statusKind === "provisioning" && (
                <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                  Still being set up — not a lifecycle state
                </span>
              )}
            </div>
            <h2 className="mt-2 text-lg font-bold text-gray-900">{lifecycle.practiceName ?? "This practice"}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-gray-600">
              {lifecycle.statusReadable
                ? (lifecycle.statusMeaning ?? STATUS_MEANING[lifecycle.status ?? ""] ?? "No description is recorded for this state.")
                : "This practice&rsquo;s current state could not be read just now, so nothing on this page is a statement about it."}
            </p>

            <dl className="mt-3 grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="text-gray-500">Created</dt>
                <dd className="font-semibold text-gray-800">{fmtWhen(lifecycle.createdAt) ?? "—"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-gray-500">State last changed</dt>
                <dd className="font-semibold text-gray-800">
                  {changedWhen ?? "never through this screen"}
                </dd>
              </div>
              {changedWhen && (
                <>
                  <div className="flex gap-2">
                    <dt className="text-gray-500">By</dt>
                    <dd className="font-semibold text-gray-800">
                      {lifecycle.changedByName ?? (lifecycle.changedBy ? `user ${lifecycle.changedBy.slice(0, 8)}` : "—")}
                    </dd>
                  </div>
                  <div className="flex gap-2 sm:col-span-2">
                    <dt className="shrink-0 text-gray-500">Because</dt>
                    <dd className="text-gray-800">{lifecycle.changedReason ?? "—"}</dd>
                  </div>
                </>
              )}
            </dl>

            {!changedWhen && lifecycle.statusReadable && (
              <p className="mt-2 text-[12px] text-gray-500">
                No lifecycle change has ever been recorded for this practice. That is expected of every
                practice created before this screen existed — it is not a gap in the record.
              </p>
            )}

            {lifecycle.logDisagreesWithStatus && (
              <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12.5px] text-amber-900">
                The newest recorded transition does not match this practice&rsquo;s current state. The state
                above is read from the practice itself and is correct; the history below carries both facts
                so the discrepancy can be read rather than guessed at.
              </p>
            )}
          </div>
        </div>
      </section>

      {done && (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-[13px] text-emerald-900">{done}</p>
      )}

      {/* ── THE THREE VERBS ───────────────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-[15px] font-bold text-gray-900">Lifecycle actions</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-gray-500">
          All three are reversible and none of them removes anything. Each one records who, when, from
          what state, to what state and why — and that record cannot afterwards be edited or deleted.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {lifecycle.actions.map(a => {
            const usable = a.permitted && a.availableFromHere;
            return (
              <div key={a.action}
                className={`rounded-xl border p-4 ${usable ? "border-gray-200 bg-white" : "border-gray-200 bg-gray-50"}`}>
                <p className="text-[13.5px] font-bold text-gray-900">{a.label}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{a.effect}</p>
                {usable ? (
                  <button type="button"
                    onClick={() => { setPending(a.action); setReason(""); setError(null); }}
                    className="mt-3 w-full rounded-lg bg-[var(--cp-primary)] px-3 py-2 text-[12.5px] font-semibold text-white hover:opacity-90">
                    {a.label}
                  </button>
                ) : (
                  // ⚠ THE REASON IS SHOWN RATHER THAN THE CONTROL BEING HIDDEN. A verb that silently
                  // disappears looks like a verb that does not exist; one that says why it is unavailable
                  // tells somebody whether to ask for a permission or to change the state first.
                  <p className="mt-3 rounded-lg bg-gray-100 px-3 py-2 text-[12px] text-gray-600">
                    {a.blockedReason}
                  </p>
                )}

                {pending === a.action && (
                  <div className="mt-3 rounded-lg border border-[var(--cp-primary)]/30 bg-[var(--cp-primary)]/5 p-3">
                    <label htmlFor={`reason-${a.action}`} className="block text-[12px] font-semibold text-gray-800">
                      Why? (required, at least {REASON_MIN} characters)
                    </label>
                    <textarea id={`reason-${a.action}`} value={reason} rows={3} maxLength={REASON_MAX}
                      onChange={e => setReason(e.target.value)}
                      placeholder="This is kept for good and cannot be edited afterwards."
                      className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-[12.5px]" />
                    <p className="mt-1 text-[11px] text-gray-500">
                      {reason.trim().length}/{REASON_MAX}
                    </p>
                    {error && <p className="mt-2 text-[12px] font-semibold text-rose-700">{error}</p>}
                    <div className="mt-2 flex gap-2">
                      <button type="button" disabled={busy || reason.trim().length < REASON_MIN}
                        onClick={() => submit(a.action)}
                        className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
                        {busy ? "Working…" : "Confirm"}
                      </button>
                      <button type="button" onClick={() => { setPending(null); setError(null); }}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-semibold text-gray-700">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ⚠ WHERE THE DELETE WOULD BE. */}
        <div className="mt-4 rounded-xl border border-slate-300 bg-slate-50 p-4">
          <p className="text-[13px] font-bold text-slate-900">There is no permanent delete here</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-slate-700">{lifecycle.refusals.permanent_deletion}</p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-slate-700">{lifecycle.refusals.anonymisation}</p>
        </div>
      </section>

      {/* ── WHAT IS IN THIS PRACTICE ──────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-[15px] font-bold text-gray-900">What is in this practice</h2>
        <p className="mt-1 text-[12.5px] text-gray-500">
          Each figure names the table it came from. A dash means the count could not be read — never that
          it is nought.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lifecycle.figures.items.map(f => (
            <div key={f.key} className="rounded-xl border border-gray-200 p-3">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-gray-500">{f.label}</p>
              <p className={`mt-0.5 text-2xl font-bold ${f.value === null ? "text-gray-400" : "text-gray-900"}`}>
                {fmtNumber(f.value)}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">{f.detail}</p>
              <p className="mt-1 text-[10.5px] text-gray-400">
                <code>{f.store}</code>
                {f.href && (
                  <> · <Link href={f.href} className="font-semibold text-[var(--cp-primary-deep)] hover:underline">open the list</Link></>
                )}
              </p>
            </div>
          ))}
        </div>

        {/* ⚠ BYTES WITH NO DENOMINATOR AND NO BAR. */}
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-[13px] font-bold text-gray-900">Files uploaded</p>
            <p className="text-lg font-bold text-gray-900">{fmtBytes(lifecycle.bytes.total)}</p>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
            Covering {lifecycle.bytes.covers.map(t => <code key={t} className="mx-0.5 rounded bg-white px-1">{t}</code>)}
            {" "}and excluding {lifecycle.bytes.excludes}
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-gray-600">{lifecycle.refusals.storage_quota}</p>
        </div>
      </section>

      {/* ── s4's CLOSURE CHECKLIST, READ-ONLY ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-[15px] font-bold text-gray-900">Before a practice closes</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-gray-500">
          CPR-LIFE-001 s4&rsquo;s six checks, reported against what this product can actually see. This is a
          report and not a control: nothing here closes a practice, because this build has no close verb.
        </p>
        <ul className="mt-4 flex flex-col gap-2">
          {lifecycle.closure.items.map(c => {
            const chip = CLOSURE_CHIP[c.verdict];
            return (
              <li key={c.key} className="rounded-xl border border-gray-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${chip.chip}`}>
                    <span aria-hidden>{chip.mark}</span>{chip.label}
                  </span>
                  <p className="text-[13px] font-semibold text-gray-900">{c.label}</p>
                  {c.count !== null && (
                    <span className="text-[12px] font-bold text-gray-700">{c.count.toLocaleString()}</span>
                  )}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{c.detail}</p>
                {c.href && (
                  <Link href={c.href} className="mt-1 inline-block text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                    Open the list
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── s5 EXPORT ─────────────────────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-[15px] font-bold text-gray-900">Export everything</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-gray-500">
          The whole practice as one JSON file: patients, appointments, consultations and their notes,
          problems, diagnoses, treatments, procedures, follow-ups, document records, your locations,
          configuration, regular week, booking rules, team and this lifecycle history. Every export is
          recorded in the access log and the audit trail.
        </p>
        {lifecycle.canExport ? (
          // A plain anchor with `download`, NOT next/link. This is a FILE DOWNLOAD from an API route,
          // not a navigation to a page: client-side routing would swallow the content-disposition header
          // and the practitioner would get a screenful of JSON instead of a file.
          <a href="/api/v1/practice/lifecycle?view=export" download
            className="mt-3 inline-block rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12.5px] font-semibold text-white hover:opacity-90">
            Download the practice export (JSON)
          </a>
        ) : (
          <p className="mt-3 rounded-lg bg-gray-100 px-3 py-2 text-[12px] text-gray-600">
            This needs <code>data.export</code>, which you do not hold.
          </p>
        )}
        <ul className="mt-3 flex flex-col gap-1.5 text-[12px] leading-relaxed text-gray-600">
          <li>{lifecycle.refusals.export_formats}</li>
          <li>{lifecycle.refusals.export_billing}</li>
        </ul>
      </section>

      {/* ── THE HISTORY ───────────────────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-[15px] font-bold text-gray-900">Every state change</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-gray-500">
          Append-only. The database refuses an update or a delete of any row below, so this is the record
          somebody can read back after a disagreement about what happened.
        </p>

        {lifecycle.history.unavailable ? (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12.5px] text-amber-900">
            {lifecycle.history.detail}
          </p>
        ) : lifecycle.history.items.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-gray-500">
            Nothing yet. No lifecycle change has been recorded for this practice.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500">
                  <th scope="col" className="py-2 pr-3 font-semibold">When</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Change</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Who</th>
                  <th scope="col" className="py-2 font-semibold">Why</th>
                </tr>
              </thead>
              <tbody>
                {lifecycle.history.items.map(t => (
                  <tr key={t.id} className="border-b border-gray-100 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{fmtWhen(t.occurredAt) ?? t.occurredAt}</td>
                    <td className="py-2 pr-3">
                      <span className="whitespace-nowrap font-semibold text-gray-900">
                        {t.fromStatus} → {t.toStatus}
                      </span>
                      {t.outcome === "refused" && (
                        <span className="ml-2 whitespace-nowrap rounded-full bg-rose-100 px-2 py-0.5 text-[10.5px] font-bold text-rose-800">
                          refused{t.refusalCode ? ` · ${t.refusalCode}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-gray-700">
                      {t.actorName ?? (t.actorUserId ? `user ${t.actorUserId.slice(0, 8)}` : "—")}
                      <span className="ml-1 text-[10.5px] text-gray-400">{t.actorKind}</span>
                    </td>
                    <td className="py-2 text-gray-700">{t.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── WHAT ELSE IS NOT DRAWN, AND WHY ───────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-[15px] font-bold text-gray-900">What this screen does not show</h2>
        <ul className="mt-2 flex flex-col gap-2 text-[12.5px] leading-relaxed text-gray-600">
          <li><span className="font-semibold text-gray-800">Connected integrations.</span> {lifecycle.refusals.integrations}</li>
          <li><span className="font-semibold text-gray-800">Restoring an archived practice.</span> {lifecycle.refusals.restore_lockout}</li>
        </ul>
      </section>
    </div>
  );
}

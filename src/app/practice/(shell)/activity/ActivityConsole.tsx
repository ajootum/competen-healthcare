"use client";

import { useState } from "react";
import Link from "next/link";
import { ACTIVITY_KINDS, PARTICIPATION } from "@/lib/practice/clinical-activity";

// CPR-150's clinical activity log and the portfolio built from it.
//
// THE COMP'S "COMPLICATION RATE 2.1%" AND "SUCCESS RATE 97.9%" ARE NOT HERE. Both are rates, and this
// product does not compute rates: over the forty-eight procedures the comp imagines, 2.1% is arguably
// meaningful; over the three a new practice will have, "33%" is a sentence that sounds like a measurement
// and is not one. The counts and their denominators are what render, and the reader divides.
//
// "PORTFOLIO IMPACT 31.1%" IS ALSO ABSENT, and so is the competency link beside it. This product's
// practice tenancy does not write into the platform's competency records -- that is a cross-tenancy
// decision with its own specification -- and the panel says so rather than implying a link that is not
// there.

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const card = "rounded-xl border border-gray-200 bg-white p-4";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function ActivityConsole({ activities, portfolio, locations, onlyMine, kind, me, periodQuery = "" }: {
  activities: any[]; portfolio: any; locations: any[]; onlyMine: boolean; kind: string; me: string;
  /**
   * ⚠ THE PERIOD, AS QUERY TEXT, ON EVERY LINK THIS CONSOLE BUILDS.
   *
   * These three links rebuild the URL from scratch. Without this, choosing a period and then pressing
   * "Show everyone's" or a kind filter would silently widen the log back out to every date, under a
   * period control still lit as though it were narrow. Content filters and the range are separate
   * controls, and separate means neither resets the other.
   */
  periodQuery?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    kind: "ward_round", title: "", detail: "", participation: "participated",
    occurredAt: new Date().toISOString().slice(0, 16),
    durationMinutes: "", cpdMinutes: "", locationId: "", portfolio: false,
  });

  async function submit() {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/activities", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: form.kind, title: form.title, detail: form.detail || undefined,
        participation: form.participation,
        occurredAt: new Date(form.occurredAt).toISOString(),
        durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
        cpdMinutes: form.cpdMinutes ? Number(form.cpdMinutes) : null,
        locationId: form.locationId || null, portfolio: form.portfolio,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      setBusy(false); return;
    }
    window.location.reload();
  }

  async function togglePortfolio(a: any) {
    setBusy(true);
    const res = await fetch("/api/v1/practice/activities", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "activity", id: a.id, portfolio: !a.portfolio }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ kind: "err", text: data?.error?.message ?? "That did not work." }); setBusy(false); return; }
    window.location.reload();
  }

  const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

  return (
    <>
      {notice && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${
          notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
            : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      {/* ── Portfolio summary (comp: Procedure Summary + Portfolio Impact) ─────────────────────── */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Procedures</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{portfolio.procedures.performed}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            performed{portfolio.procedures.abandoned > 0 ? `, ${portfolio.procedures.abandoned} abandoned` : ""}
          </p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">With a complication</p>
          {/* A COUNT AND ITS DENOMINATOR. Never a rate -- see the header. */}
          <p className="mt-1 text-2xl font-bold text-gray-900">{portfolio.procedures.withComplication}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">of {portfolio.procedures.complicationDenominator} performed</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Activities logged</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{portfolio.activities.total}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">{portfolio.activities.byKind.length} kinds</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">CPD claimed</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{hours(portfolio.cpdMinutes)}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">across {portfolio.portfolioItems} portfolio entries</p>
        </div>
        <div className={`${card} border-dashed bg-gray-50/60`}>
          <p className="text-[11px] font-semibold text-gray-500">Competency links</p>
          <p className="mt-1 text-2xl font-bold text-gray-300">&mdash;</p>
          <p className="mt-0.5 text-[10px] text-gray-500">{portfolio.competencyNote}</p>
        </div>
      </div>

      {portfolio.activities.byKind.length > 0 && (
        <section className={`${card} mt-4`}>
          <h2 className="text-[13px] font-bold text-gray-900">Your activity, by kind</h2>
          <ul className="mt-2 flex flex-col">
            {portfolio.activities.byKind.map((k: any) => (
              <li key={k.kind} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <span className="text-[12px] text-gray-800">{k.label}</span>
                <span className="ml-auto text-[13px] font-bold text-gray-900">{k.total}</span>
                <span className="w-24 text-right text-[11px] text-gray-500">{k.minutes > 0 ? hours(k.minutes) : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── The log ────────────────────────────────────────────────────────────────────────────── */}
      <section className={`${card} mt-4`}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 className="text-[13px] font-bold text-gray-900">Activity log</h2>
          <span className="flex items-center gap-2">
            <Link href={`/practice/activity?mine=${onlyMine ? "0" : "1"}${periodQuery}`}
              className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              {onlyMine ? "Show everyone's" : "Show only mine"}
            </Link>
            <button type="button" onClick={() => setOpen(o => !o)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              {open ? "Cancel" : "Log an activity"}
            </button>
          </span>
        </div>

        {open && (
          <form className="mt-3 flex flex-col gap-2 border-b border-gray-100 pb-3"
            onSubmit={e => { e.preventDefault(); submit(); }}>
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">What kind</span>
                <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} className={input}>
                  {ACTIVITY_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">Your part in it</span>
                <select value={form.participation} onChange={e => setForm(f => ({ ...f, participation: e.target.value }))} className={input}>
                  {PARTICIPATION.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
            </div>
            <input required value={form.title} placeholder="What was it?"
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={input} />
            <textarea rows={2} value={form.detail} placeholder="Anything worth remembering (optional)"
              onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} className={input} />
            <div className="grid sm:grid-cols-4 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">When</span>
                <input type="datetime-local" required value={form.occurredAt}
                  onChange={e => setForm(f => ({ ...f, occurredAt: e.target.value }))} className={input} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">How long</span>
                <input type="number" min={1} max={1440} value={form.durationMinutes} placeholder="minutes"
                  onChange={e => setForm(f => ({ ...f, durationMinutes: e.target.value }))} className={input} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">Of which CPD</span>
                <input type="number" min={0} max={1440} value={form.cpdMinutes} placeholder="minutes"
                  onChange={e => setForm(f => ({ ...f, cpdMinutes: e.target.value }))} className={input} />
                {/* Said where somebody is about to overstate it. */}
                <span className="text-[10px] text-gray-400">Cannot exceed the time it took.</span>
              </label>
              {locations.length > 0 && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-gray-500">Where</span>
                  <select value={form.locationId} onChange={e => setForm(f => ({ ...f, locationId: e.target.value }))} className={input}>
                    <option value="">Not recorded</option>
                    {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <label className="flex items-center gap-2 text-[12px] text-gray-700">
              <input type="checkbox" checked={form.portfolio}
                onChange={e => setForm(f => ({ ...f, portfolio: e.target.checked }))} />
              Keep this in my portfolio
            </label>
            <button type="submit" disabled={busy || !form.title.trim()}
              className="self-start rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40">
              Log it
            </button>
          </form>
        )}

        {/* The kind filter. Links rather than JavaScript, so the state is in the URL and a filtered log
            is something somebody can bookmark or send. */}
        <div className="mt-2 flex flex-wrap gap-1">
          <Link href={`/practice/activity?mine=${onlyMine ? "1" : "0"}${periodQuery}`}
            aria-current={kind === "" ? "page" : undefined}
            className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
              kind === "" ? "bg-[var(--cp-primary-soft)] text-[var(--cp-primary-deep)]" : "text-gray-500 hover:text-gray-800"}`}>
            All
          </Link>
          {ACTIVITY_KINDS.map(([k, l]) => (
            <Link key={k} href={`/practice/activity?mine=${onlyMine ? "1" : "0"}&kind=${k}${periodQuery}`}
              aria-current={kind === k ? "page" : undefined}
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                kind === k ? "bg-[var(--cp-primary-soft)] text-[var(--cp-primary-deep)]" : "text-gray-500 hover:text-gray-800"}`}>
              {l}
            </Link>
          ))}
        </div>

        {activities.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">
            {kind ? "Nothing of that kind logged." : "Nothing logged yet."}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {activities.map((a: any) => (
              <li key={a.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-gray-800">{a.title}</span>
                  <span className="block text-[10px] text-gray-500">
                    {a.kindLabel} · {a.participation}
                    {a.performedByName ? ` · ${a.performedByName}` : ""}
                    {a.duration_minutes ? ` · ${hours(a.duration_minutes)}` : ""}
                    {a.cpd_minutes ? ` · ${hours(a.cpd_minutes)} CPD` : ""}
                  </span>
                </span>
                <span className="ml-auto shrink-0 text-right">
                  <span className="block text-[11px] text-gray-600">
                    {new Date(a.occurred_at).toLocaleDateString()}
                  </span>
                  {/* Only the person who did it may change their own portfolio, so the button is not
                      offered to anyone else rather than offered-and-refused. */}
                  {a.performed_by === me && (
                    <button type="button" disabled={busy} onClick={() => togglePortfolio(a)}
                      className="text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                      {a.portfolio ? "In portfolio" : "Add to portfolio"}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-4">
        <h2 className="text-[13px] font-bold text-gray-500">AI assisted documentation</h2>
        <p className="mt-1 text-[11px] text-gray-500">
          Drafted procedure summaries, suggested coding and missing-field checks are specified in CPR-210
          AI Clinical Assistant, which is not built.
        </p>
      </section>
    </>
  );
}

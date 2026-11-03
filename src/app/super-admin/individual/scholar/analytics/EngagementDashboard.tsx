"use client";
import { useState } from "react";
import type { DashboardResponse, RangePreset, SortKey } from "@/lib/hq/scholar-analytics/types";

// The dashboard's controls and panels. Everything it shows comes from one GET; the toggle to names and the testing filter
// are drawn only for a caller the server says may use them, and the server refuses them anyway (403) for anyone else.

const card = "rounded-xl border border-gray-200 bg-white";
const btn = "rounded-lg border px-3 py-1.5 text-[13px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)]";
const on = `${btn} border-teal-700 bg-teal-700 text-white`;
const off = `${btn} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const money = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toFixed(Number(n) < 1 ? 4 : 2)}`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }) : "—");
const mins = (n: number | null) => (n == null ? "—" : n < 60 ? `${n} min` : `${Math.floor(n / 60)} h ${n % 60} min`);

const SORT_LABEL: Record<SortKey, string> = { activities: "Learning activities", activeDays: "Active days", sessions: "Study sessions", activeMinutes: "Active study time (est.)", aiRequests: "AI requests", aiCostUsd: "AI expenditure", lastActive: "Last active" };
const PRESETS: { k: RangePreset; label: string }[] = [{ k: "today", label: "Today" }, { k: "7d", label: "7 days" }, { k: "30d", label: "30 days" }, { k: "90d", label: "90 days" }, { k: "custom", label: "Custom" }];

type Params = { preset: RangePreset; from: string; to: string; named: boolean; testing: boolean; q: string; sort: SortKey; page: number; learner: string | null };
const FIRST: Params = { preset: "30d", from: "", to: "", named: false, testing: false, q: "", sort: "activities", page: 0, learner: null };

export default function EngagementDashboard({ canIdentify, initial, initialError }: { canIdentify: boolean; initial: DashboardResponse | null; initialError: string | null }) {
  const [p, setP] = useState<Params>(FIRST);
  const [typed, setTyped] = useState("");
  const [data, setData] = useState<DashboardResponse | null>(initial);
  const [err, setErr] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);
  const { preset, from, to, named, testing, sort, page, learner } = p;

  // Every control change fetches with the merged parameters. The first render came from the server (no effect, no flash).
  async function apply(patch: Partial<Params>) {
    const next = { ...p, ...patch };
    setP(next);
    setBusy(true); setErr(null);
    const s = new URLSearchParams({ range: next.preset, sort: next.sort, page: String(next.page) });
    if (next.preset === "custom" && next.from && next.to) { s.set("from", next.from); s.set("to", next.to); }
    if (next.named) s.set("named", "1");
    if (next.testing) s.set("include", "demo,test");
    if (next.q) s.set("q", next.q);
    if (next.learner) s.set("learner", next.learner);
    try {
      const r = await fetch(`/api/hq/individual/scholar-analytics?${s}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? `The analytics could not be loaded (${r.status}).`); setData(null); }
      else setData(j as DashboardResponse);
    } catch { setErr("The analytics could not be loaded."); }
    setBusy(false);
  }
  const setPreset = (preset: RangePreset) => apply({ preset, page: 0 });
  const setFrom = (from: string) => apply({ from, page: 0 });
  const setTo = (to: string) => apply({ to, page: 0 });
  const setNamed = (named: boolean) => apply({ named });
  const setTesting = (testing: boolean) => apply({ testing, page: 0 });
  const setQ = (q: string) => apply({ q, page: 0 });
  const setSort = (sort: SortKey) => apply({ sort, page: 0 });
  const setPage = (f: (n: number) => number) => apply({ page: f(page) });
  const setLearner = (learner: string | null) => apply({ learner });

  const c = data?.cards;
  const cards = c ? [
    { label: "Genuine learner accounts", value: String(c.learners), note: c.unclassifiedIncluded ? `${c.unclassifiedIncluded} not yet classified` : undefined },
    { label: "Daily active", value: String(c.dau), note: "last 24 h" }, { label: "Weekly active", value: String(c.wau), note: "last 7 days" }, { label: "Monthly active", value: String(c.mau), note: "last 30 days" },
    { label: "New learners", value: String(c.newLearners), note: "accounts created in range" }, { label: "Returning learners", value: String(c.returningLearners), note: "active in range and before it" },
    { label: "Learning activities", value: String(c.activities), note: `${c.activeInRange} active learner${c.activeInRange === 1 ? "" : "s"}` },
    { label: "AI expenditure (est.)", value: money(c.aiCostUsd), note: c.aiSettledUsd ? `settled ${money(c.aiSettledUsd)}` : `${c.aiRequests} request${c.aiRequests === 1 ? "" : "s"}` },
    { label: "AI per active learner", value: money(c.aiCostPerActiveLearner), note: "estimated" },
  ] : [];

  return (
    <div className="space-y-4">
      {/* controls */}
      <div className={`${card} flex flex-wrap items-center gap-2 p-3`}>
        <div role="group" aria-label="Date range" className="flex flex-wrap gap-1.5">
          {PRESETS.map(x => <button key={x.k} type="button" className={preset === x.k ? on : off} aria-pressed={preset === x.k} onClick={() => setPreset(x.k)}>{x.label}</button>)}
        </div>
        {preset === "custom" && (
          <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <label>From <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1" /></label>
            <label>To <input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1" /></label>
          </span>
        )}
        <span className="grow" />
        {canIdentify && (
          <div role="group" aria-label="Identity" className="flex gap-1.5">
            <button type="button" className={!named ? on : off} aria-pressed={!named} onClick={() => setNamed(false)}>Anonymous</button>
            <button type="button" className={named ? on : off} aria-pressed={named} onClick={() => setNamed(true)}>Show learner names</button>
          </div>
        )}
        {canIdentify && (
          <label className="flex items-center gap-1.5 text-[13px] text-gray-800"><input type="checkbox" checked={testing} onChange={e => setTesting(e.target.checked)} /> Include demo and test accounts</label>
        )}
      </div>
      {data && <p className="text-[12px] text-gray-600">{data.range.label} · {data.named ? "Named View (audited)" : "Anonymous View: pseudonymous rankings, stable across ranges"} · accounts included: {data.include.join(", ")}</p>}
      {err && <div role="alert" className="rounded-xl border border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)] px-4 py-3 text-sm text-[var(--cmp-text-error)]">{err}</div>}

      {/* summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cards.map(x => (
          <div key={x.label} className={`${card} p-4`}>
            <span className="text-[11px] font-semibold leading-tight text-gray-500">{x.label}</span>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-gray-900">{x.value}</p>
            {x.note && <p className="text-[11.5px] text-gray-500">{x.note}</p>}
          </div>
        ))}
        {!data && !err && <div className={`${card} p-4 text-sm text-gray-500`}>{busy ? "Loading…" : ""}</div>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* activity breakdown */}
        <section className={`${card} p-4`} aria-labelledby="eng-kinds">
          <h2 id="eng-kinds" className="text-sm font-bold text-gray-900">Learning activity breakdown</h2>
          <p className="text-[12px] text-gray-500">Started · completed · abandoned (no activity for 7 days) · resumed. One per record, never a page view.</p>
          {data && (data.kinds.length ? (
            <table className="mt-2 w-full text-[13px]"><thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500"><th className="py-1">Activity</th><th className="text-right">Started</th><th className="text-right">Completed</th><th className="text-right">Abandoned</th><th className="text-right">Resumed</th><th className="text-right">Items</th></tr></thead>
              <tbody>{data.kinds.map(k => <tr key={k.kind} className="border-t border-gray-100"><td className="py-1">{k.label}</td><td className="text-right tabular-nums">{k.started}</td><td className="text-right tabular-nums">{k.completed}</td><td className="text-right tabular-nums">{k.abandoned}</td><td className="text-right tabular-nums">{k.resumed}</td><td className="text-right tabular-nums">{k.items}</td></tr>)}</tbody></table>
          ) : <p className="mt-2 text-sm text-gray-600">No learning activity in this range.</p>)}
        </section>
        {/* AI cost by activity */}
        <section className={`${card} p-4`} aria-labelledby="eng-ai">
          <h2 id="eng-ai" className="text-sm font-bold text-gray-900">AI expenditure by activity</h2>
          <p className="text-[12px] text-gray-500">Gateway estimate per request. Settled costs appear when metering records them; the two are never added.</p>
          {data && (data.costByActivity.length ? (
            <table className="mt-2 w-full text-[13px]"><thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500"><th className="py-1">Operation</th><th className="text-right">Requests</th><th className="text-right">Est. cost</th></tr></thead>
              <tbody>{data.costByActivity.slice(0, 12).map(x => <tr key={x.operation} className="border-t border-gray-100"><td className="py-1 font-mono text-[12px]">{x.operation}</td><td className="text-right tabular-nums">{x.requests}</td><td className="text-right tabular-nums">{money(x.costUsd)}</td></tr>)}</tbody></table>
          ) : <p className="mt-2 text-sm text-gray-600">No AI request in this range.</p>)}
        </section>
      </div>

      {/* leaderboard */}
      <section className={`${card} p-4`} aria-labelledby="eng-board">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="eng-board" className="text-sm font-bold text-gray-900">Most active learners</h2>
            <p className="text-[12px] text-gray-500">Ranked by meaningful learning activity by default. No composite score. Select a learner for the detail.</p>
          </div>
          <form className="flex flex-wrap items-center gap-1.5" onSubmit={e => { e.preventDefault(); setQ(typed.trim()); }}>
            <label className="sr-only" htmlFor="eng-q">Find a learner</label>
            <input id="eng-q" value={typed} onChange={e => setTyped(e.target.value)} placeholder={named ? "Name or Learner code" : "Learner code, e.g. 4F2A"} className="rounded-lg border border-gray-300 px-2 py-1.5 text-[13px] pointer-coarse:min-h-[var(--cmp-touch-min)]" />
            <button type="submit" className={off}>Search</button>
            <label className="text-[13px]">Sort <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-[13px]">{(Object.keys(SORT_LABEL) as SortKey[]).map(k => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}</select></label>
          </form>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
              <th className="py-1">#</th><th>Learner</th>{named && <th>Status</th>}<th className="text-right">Active days</th><th className="text-right">Sessions</th><th className="text-right">Active time (est.)</th><th className="text-right">Activities</th><th className="text-right">AI requests</th><th className="text-right">AI cost (est.)</th><th>Last active</th>
            </tr></thead>
            <tbody>
              {data?.leaderboard.rows.map((r, i) => (
                <tr key={r.key} className={`border-t border-gray-100 ${learner === r.key ? "bg-teal-50/60" : ""}`}>
                  <td className="py-1.5 tabular-nums text-gray-500">{data.leaderboard.page * data.leaderboard.pageSize + i + 1}</td>
                  <td><button type="button" className="text-left font-semibold text-teal-800 hover:underline pointer-coarse:min-h-[var(--cmp-touch-min)]" aria-pressed={learner === r.key} onClick={() => setLearner(learner === r.key ? null : r.key)}>{r.label}</button>{named && r.name && <span className="block font-mono text-[11px] text-gray-500">{r.key}</span>}</td>
                  {named && <td className="text-gray-700">{r.status ?? "—"}{r.classification === "unclassified" ? " · unclassified" : ""}</td>}
                  <td className="text-right tabular-nums">{r.activeDays}</td><td className="text-right tabular-nums">{r.sessions}</td><td className="text-right tabular-nums">{mins(r.activeMinutes)}</td>
                  <td className="text-right tabular-nums">{r.activities}<span className="text-gray-500"> / {r.completed} done</span></td><td className="text-right tabular-nums">{r.aiRequests}</td><td className="text-right tabular-nums">{money(r.aiCostUsd)}{r.aiSettledUsd ? <span className="block text-[11px] text-gray-500">settled {money(r.aiSettledUsd)}</span> : null}</td>
                  <td className="whitespace-nowrap text-gray-700">{when(r.lastActive)}</td>
                </tr>
              ))}
              {data && !data.leaderboard.rows.length && <tr><td colSpan={10} className="py-3 text-sm text-gray-600">No learner matches.</td></tr>}
            </tbody>
          </table>
        </div>
        {data && data.leaderboard.total > data.leaderboard.pageSize && (
          <div className="mt-2 flex items-center gap-2 text-[13px]">
            <button type="button" className={off} disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</button>
            <span>Page {page + 1} of {Math.ceil(data.leaderboard.total / data.leaderboard.pageSize)} · {data.leaderboard.total} learners</span>
            <button type="button" className={off} disabled={(page + 1) * data.leaderboard.pageSize >= data.leaderboard.total} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        )}
      </section>

      {/* learner detail */}
      {learner && (
        <section className={`${card} p-4`} aria-labelledby="eng-detail">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 id="eng-detail" className="text-sm font-bold text-gray-900">{data?.detail?.row.label ?? learner} · engagement detail</h2>
            <button type="button" className={off} onClick={() => setLearner(null)}>Close</button>
          </div>
          {data?.detail ? (() => { const d = data.detail; return (
            <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <h3 className="text-[12px] font-bold uppercase tracking-wide text-gray-500">Activity summary</h3>
                <dl className="mt-1 space-y-0.5 text-[13px]"><div className="flex justify-between"><dt>Active days</dt><dd className="tabular-nums">{d.row.activeDays}</dd></div><div className="flex justify-between"><dt>Study sessions</dt><dd className="tabular-nums">{d.row.sessions}</dd></div><div className="flex justify-between"><dt>Active time (est.)</dt><dd className="tabular-nums">{mins(d.row.activeMinutes)}</dd></div><div className="flex justify-between"><dt>Activities</dt><dd className="tabular-nums">{d.row.activities}</dd></div></dl>
                <h4 className="mt-2 text-[11px] font-semibold text-gray-500">By week</h4>
                <ul className="text-[12.5px]">{d.weeks.map(w => <li key={w.week} className="flex justify-between"><span>w/c {w.week}</span><span className="tabular-nums">{w.activities} act · {w.activeDays} d · {money(w.aiCostUsd)}</span></li>)}{!d.weeks.length && <li className="text-gray-500">Nothing in range.</li>}</ul>
              </div>
              <div>
                <h3 className="text-[12px] font-bold uppercase tracking-wide text-gray-500">Learning progress</h3>
                <dl className="mt-1 space-y-0.5 text-[13px]"><div className="flex justify-between"><dt>Learn sessions completed</dt><dd className="tabular-nums">{d.progress.learnCompleted}</dd></div><div className="flex justify-between"><dt>Revision completed</dt><dd className="tabular-nums">{d.progress.revisionCompleted}</dd></div><div className="flex justify-between"><dt>Cases completed</dt><dd className="tabular-nums">{d.progress.casesCompleted}</dd></div><div className="flex justify-between"><dt>OSCE completed</dt><dd className="tabular-nums">{d.progress.osceCompleted}</dd></div><div className="flex justify-between"><dt>Self-assessments submitted</dt><dd className="tabular-nums">{d.progress.selfAssessmentsSubmitted}</dd></div></dl>
                <p className="mt-1 text-[11.5px] text-gray-500">Participation only. Self-reported ratings, demonstrated performance and verified competence are kept apart and are not combined here.</p>
                <h4 className="mt-2 text-[11px] font-semibold text-gray-500">By activity</h4>
                <ul className="text-[12.5px]">{d.kinds.map(k => <li key={k.kind} className="flex justify-between"><span>{k.label}</span><span className="tabular-nums">{k.started} / {k.completed} done{k.abandoned ? ` / ${k.abandoned} abandoned` : ""}{k.resumed ? ` / ${k.resumed} resumed` : ""}</span></li>)}</ul>
              </div>
              <div>
                <h3 className="text-[12px] font-bold uppercase tracking-wide text-gray-500">AI usage</h3>
                <dl className="mt-1 space-y-0.5 text-[13px]"><div className="flex justify-between"><dt>Requests</dt><dd className="tabular-nums">{d.ai.requests}</dd></div><div className="flex justify-between"><dt>Tokens</dt><dd className="tabular-nums">{d.ai.tokens.toLocaleString()}</dd></div><div className="flex justify-between"><dt>Expenditure (est.)</dt><dd className="tabular-nums">{money(d.ai.costUsd)}</dd></div><div className="flex justify-between"><dt>Settled</dt><dd className="tabular-nums">{d.ai.settledUsd ? money(d.ai.settledUsd) : "none recorded"}</dd></div>
                  <div className="flex justify-between"><dt>Allowance used</dt><dd className="tabular-nums">{d.ai.allowance ? `${d.ai.allowance.usedCau} of ${d.ai.allowance.includedCau} CAU` : "no allowance account"}</dd></div></dl>
                <ul className="mt-2 text-[12px]">{d.ai.byOperation.slice(0, 8).map(o => <li key={o.operation} className="flex justify-between gap-2"><span className="truncate font-mono">{o.operation}</span><span className="tabular-nums">{o.requests} · {money(o.costUsd)}</span></li>)}</ul>
              </div>
              <div>
                <h3 className="text-[12px] font-bold uppercase tracking-wide text-gray-500">Recent activity</h3>
                <ul className="mt-1 space-y-0.5 text-[12.5px]">{d.recent.map((r, i) => <li key={i} className="flex justify-between gap-2"><span className="whitespace-nowrap text-gray-500">{when(r.at)}</span><span className="min-w-0 grow truncate">{r.label}{r.items > 1 ? ` (${r.items})` : ""}</span><span className={r.status === "completed" ? "text-[var(--cmp-text-success)]" : r.status === "abandoned" ? "text-[var(--cmp-text-error)]" : "text-gray-600"}>{r.status}</span></li>)}{!d.recent.length && <li className="text-gray-500">Nothing in range.</li>}</ul>
              </div>
            </div>
          ); })() : <p className="mt-2 text-sm text-gray-600">{busy ? "Loading…" : "That learner is not in the current view."}</p>}
        </section>
      )}

      {/* method and limits */}
      {data && (
        <details className={`${card} px-4 py-3 text-[12.5px] text-gray-700`}>
          <summary className="cursor-pointer font-semibold text-gray-900">How these figures are measured, and what they cannot show</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><span className="font-semibold">Days.</span> {data.method.days}</li>
            <li><span className="font-semibold">Active study time.</span> {data.method.activeTime}</li>
            <li><span className="font-semibold">AI cost.</span> {data.method.aiCost}</li>
            <li><span className="font-semibold">Accounts.</span> {data.method.classification}</li>
            {data.limits.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

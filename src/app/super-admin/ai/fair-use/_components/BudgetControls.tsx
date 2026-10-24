"use client";

import { useState } from "react";
import { Message, ghost, input, primary, useSend } from "./FairUseControls";

// The budget half of /super-admin/ai/fair-use (COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s6, s13). Every control posts to
// /api/hq/ai-governance, which re-checks hq.platform.ai.manage, validates, and audits. Nothing here can charge or
// refund anybody: budgets are charged only by the server, from the workflow that owns the work.

const WORKFLOWS: { code: string; label: string; owner: string }[] = [
  { code: "case.candidate_screen", label: "Screen candidate cases", owner: "platform" },
  { code: "case.dedupe", label: "De-duplicate candidate cases", owner: "platform" },
  { code: "case.promote", label: "Process a promoted candidate", owner: "platform" },
  { code: "case.shared_variation", label: "Generate shared case variations", owner: "platform" },
  { code: "case.educator_develop", label: "Educator develops shared cases", owner: "platform or institution" },
  { code: "case.reviewer_assist", label: "Clinical reviewer AI assistance", owner: "platform or institution" },
];

export function BudgetCreate() {
  const [f, setF] = useState<Record<string, string>>({ ownerType: "platform", product: "scholar" });
  const { busy, msg, send } = useSend();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-[12.5px] text-gray-700">Code<input value={f.code ?? ""} onChange={set("code")} maxLength={61} placeholder="platform.scholar.cases" className={`${input} ml-1 w-52 font-mono`} /></label>
      <label className="text-[12.5px] text-gray-700">Name<input value={f.label ?? ""} onChange={set("label")} maxLength={200} className={`${input} ml-1 w-56`} /></label>
      <label className="text-[12.5px] text-gray-700">Owner<select value={f.ownerType} onChange={set("ownerType")} className={`${input} ml-1`}><option value="platform">Platform</option><option value="institution">Institution</option></select></label>
      <label className="text-[12.5px] text-gray-700">Funds<select value={f.product} onChange={set("product")} className={`${input} ml-1`}><option value="scholar">Scholar</option><option value="professional">Professional</option></select></label>
      {f.ownerType === "institution" && <>
        <label className="text-[12.5px] text-gray-700">Authorised institution (id)<input value={f.institutionRef ?? ""} onChange={set("institutionRef")} className={`${input} ml-1 w-72 font-mono`} /></label>
        <label className="text-[12.5px] text-gray-700">Funding arrangement<input value={f.fundingRef ?? ""} onChange={set("fundingRef")} maxLength={300} className={`${input} ml-1 w-56`} /></label>
      </>}
      <button type="button" disabled={busy} className={primary} onClick={() => send({ action: "budget_create", ...f }, "Budget created. It funds nothing until its policy is published.")}>Create budget</button>
      <Message msg={msg} />
    </div>
  );
}

export function BudgetStatus({ id, status }: { id: string; status: string }) {
  const { busy, msg, send } = useSend();
  if (status === "closed") return <span className="text-[12.5px] text-gray-500">Closed</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {status === "active"
        ? <button type="button" disabled={busy} className={ghost} onClick={() => send({ action: "budget_status", budgetId: id, status: "suspended" }, "Suspended. Its new charges are refused; nothing else changes.")}>Suspend</button>
        : <button type="button" disabled={busy} className={ghost} onClick={() => send({ action: "budget_status", budgetId: id, status: "active" }, "Resumed.")}>Resume</button>}
      <button type="button" disabled={busy} className={ghost} onClick={() => { if (window.confirm("Close this budget? A closed budget cannot be reopened.")) send({ action: "budget_status", budgetId: id, status: "closed" }, "Closed."); }}>Close</button>
      <Message msg={msg} />
    </span>
  );
}

type Policy = { ceilingCau: number; activities: Record<string, { capPerPeriod: number | null }>; automatedLimit: number | null; alertAtPct: number; carryForward: "none" | "unused"; carryCapCau: number; unreconciledCapCau: number };
const CODE = /^[a-z][a-z0-9_]{1,40}$/;

export function BudgetPolicyEditor({ code, initial }: { code: string; initial: Policy }) {
  const [p, setP] = useState<Policy>(initial);
  const [act, setAct] = useState("");
  const { busy, msg, send } = useSend();
  const num = (v: string) => (v === "" ? null : Number(v));
  const field = (label: string, value: number | null, on: (v: number | null) => void, hint?: string) => (
    <label className="block text-[12.5px] text-gray-700">{label}{hint && <span className="text-gray-500"> ({hint})</span>}
      <input inputMode="decimal" value={value ?? ""} onChange={e => on(num(e.target.value))} className={`${input} mt-0.5 block w-32`} />
    </label>
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {field("Monthly ceiling (CAU)", p.ceilingCau, v => setP({ ...p, ceilingCau: v ?? 0 }))}
        {field("Alert from (% used)", p.alertAtPct, v => setP({ ...p, alertAtPct: v ?? 80 }))}
        {field("Automated requests a month", p.automatedLimit, v => setP({ ...p, automatedLimit: v }), "blank = none allowed")}
        {field("Awaiting-reconciliation ceiling (CAU)", p.unreconciledCapCau, v => setP({ ...p, unreconciledCapCau: v ?? 0 }))}
        <label className="block text-[12.5px] text-gray-700">Unused allowance
          <select value={p.carryForward} onChange={e => setP({ ...p, carryForward: e.target.value as Policy["carryForward"] })} className={`${input} mt-0.5 block`}>
            <option value="none">Resets each month</option><option value="unused">Carries forward</option>
          </select>
        </label>
        {p.carryForward === "unused" && field("Carry at most (CAU)", p.carryCapCau, v => setP({ ...p, carryCapCau: v ?? 0 }))}
      </div>
      <div>
        <p className="text-[12.5px] font-semibold text-gray-800">Activities this budget funds</p>
        {Object.keys(p.activities).length === 0 && <p className="text-[12.5px] text-amber-900">None: this budget funds nothing.</p>}
        <ul className="mt-1 space-y-1">
          {Object.entries(p.activities).map(([c, a]) => (
            <li key={c} className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-mono">{c}</span>
              <label className="text-[12.5px] text-gray-700">per month<input aria-label={`${c} per month`} inputMode="numeric" value={a.capPerPeriod ?? ""} placeholder="no cap"
                onChange={e => setP({ ...p, activities: { ...p.activities, [c]: { capPerPeriod: num(e.target.value) } } })} className={`${input} ml-1 w-24`} /></label>
              <button type="button" className={ghost} onClick={() => { const rest = { ...p.activities }; delete rest[c]; setP({ ...p, activities: rest }); }}>Remove</button>
            </li>
          ))}
        </ul>
        <div className="mt-1 flex items-end gap-2">
          <label className="text-[12.5px] text-gray-700">Add activity code<input value={act} maxLength={41} onChange={e => setAct(e.target.value.trim())} className={`${input} ml-1 w-40 font-mono`} /></label>
          <button type="button" className={ghost} disabled={!CODE.test(act) || act in p.activities} onClick={() => { setP({ ...p, activities: { ...p.activities, [act]: { capPerPeriod: null } } }); setAct(""); }}>Add</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} className={ghost} onClick={() => send({ action: "budget_policy", code, settings: p }, "Draft saved. Publish to make it effective.")}>Save {code} draft</button>
        <Message msg={msg} />
      </div>
    </div>
  );
}

export function RoutingEditor({ initial, budgets }: { initial: Record<string, string>; budgets: { code: string; label: string; ownerType: string; status: string }[] }) {
  const [r, setR] = useState<Record<string, string>>(initial);
  const { busy, msg, send } = useSend();
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {WORKFLOWS.map(w => (
          <li key={w.code} className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="w-72">{w.label} <span className="text-[12px] text-gray-500">({w.owner})</span></span>
            <select aria-label={`${w.label} budget`} value={r[w.code] ?? ""} onChange={e => setR({ ...r, [w.code]: e.target.value })} className={input}>
              <option value="">No budget: refused</option>
              {budgets.filter(b => b.status !== "closed" && (b.ownerType === "platform" || w.owner !== "platform")).map(b => <option key={b.code} value={b.code}>{b.label} ({b.code})</option>)}
            </select>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} className={ghost} onClick={() => send({ action: "routing", settings: { workflows: Object.fromEntries(Object.entries(r).filter(([, v]) => v)) } }, "Draft saved. Publish to make it effective.")}>Save routing draft</button>
        <Message msg={msg} />
      </div>
    </div>
  );
}

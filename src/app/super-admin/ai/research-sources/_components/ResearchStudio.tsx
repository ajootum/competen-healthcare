"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useRouter } from "next/navigation";
import { useState } from "react";

// THE RESEARCH SOURCES & EVIDENCE STUDIO -- COMPETEN-RESEARCH-01 ADDENDUM V2 item 12. Eight parts, one draft. Every button
// posts to /api/hq/research-sources, which writes a CONFIG-002 draft; what runs changes only when an owner publishes.
// "Draft" columns are a preview of what publishing would put in force; "Live" is what runs now.

type Cap = { code: string; label: string; phase: number; implemented: boolean };
type StepDef = { code: string; label: string; implemented: boolean };

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[36px] items-center rounded-lg bg-teal-800 px-3 py-1.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-40 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const ghost = `inline-flex min-h-[36px] items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-40 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const input = `rounded-lg border border-gray-300 px-2 py-1 text-[13px] ${focusRing}`;
const card = "rounded-xl border border-gray-200 bg-white p-5";
const PRODUCTS = ["scholar", "professional", "enterprise", "practice"];
const ACTIVITIES = ["learn", "exam", "cpd", "practice_evidence"];
const CHECKS = [["evaluation", "Evaluation"], ["access", "Access"], ["licensing", "Licensing"], ["governance", "Governance"], ["cost", "Cost"], ["paidApproval", "Spend approval (owner)"]] as const;
const STATUS_TONE: Record<string, string> = {
  active: "border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",
  approved: "border-teal-300 bg-teal-50 text-teal-900", evaluated: "border-sky-300 bg-sky-50 text-sky-900", integrated: "border-sky-300 bg-sky-50 text-sky-900",
  configured: "border-gray-300 bg-gray-50 text-gray-800", designed: "border-gray-300 bg-white text-gray-700",
  paused: "border-amber-300 bg-amber-50 text-amber-900", retired: "border-gray-300 bg-gray-100 text-gray-500",
};

export function ResearchStudio(props: {
  view: any; canEdit: boolean; isOwner: boolean; capabilities: Cap[]; steps: StepDef[]; lifecycleLabel: Record<string, string>; fixedRules: string[]; adapters: Record<string, boolean>;
}) {
  const router = useRouter();
  const { view, canEdit, isOwner } = props;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [sel, setSel] = useState<string>("pubmed");
  const post = async (key: string, body: Record<string, unknown>) => {
    setBusy(key); setMsg(null);
    const r = await fetch("/api/hq/research-sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async x => ({ ok: x.ok, j: await x.json().catch(() => ({})) })).catch(() => ({ ok: false, j: { error: "Competen could not be reached." } }));
    setBusy("");
    setMsg({ ok: r.ok, text: r.ok ? (r.j.detail ?? "Saved as a draft. It takes effect when an owner publishes.") : (r.j.error ?? "That did not work.") });
    if (r.ok) router.refresh();
  };
  const draftReg = view.draft.registry as Record<string, any>, liveReg = view.published.registry as Record<string, any>;
  const records = Object.values(draftReg).sort((a: any, b: any) => a.phase - b.phase || a.priority - b.priority) as any[];
  const Status = ({ s }: { s: string }) => <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${STATUS_TONE[s] ?? ""}`}>{props.lifecycleLabel[s] ?? s}</span>;

  return (
    <div className="space-y-6">
      {/* ── publish bar ── */}
      <section aria-label="Draft and publication" className={`${card} flex flex-wrap items-center gap-3`}>
        <p className="text-[13.5px] text-gray-800">{view.pending ? <><span className="font-semibold">Unpublished changes.</span> The draft columns below show what publishing would put in force.</> : "No unpublished changes. What you see is what runs."}</p>
        {isOwner && <PublishForm disabled={!view.pending || !!busy} onPublish={note => post("publish", { action: "publish", note })} />}
        {msg && <p role="status" className={`w-full rounded-lg border px-3 py-2 text-[13px] ${msg.ok ? "border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>{msg.text}</p>}
      </section>

      {/* ── 1. Provider registry ── */}
      <section aria-labelledby="p1" className={card}>
        <h2 id="p1" className="text-[16px] font-bold text-gray-900">1. Provider registry</h2>
        <p className="text-[13px] text-gray-600">Every source the engine knows. Phase 1 has adapters in code; Phase 2 and 3 are structures only and cannot be called. Choose a row to edit it.</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead><tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-[0.08em] text-gray-500"><th scope="col" className="py-1.5">Source</th><th scope="col">Phase</th><th scope="col">Adapter</th><th scope="col">Draft</th><th scope="col">Live</th><th scope="col">Products</th><th scope="col">Priority</th><th scope="col">Cost / request</th><th scope="col">Key reference</th></tr></thead>
            <tbody>{records.map(r => (
              <tr key={r.id} className={`border-b border-gray-100 ${sel === r.id ? "bg-teal-50/50" : ""}`}>
                <th scope="row" className="py-1.5 font-normal"><button type="button" onClick={() => setSel(r.id)} className={`text-left font-semibold underline-offset-2 hover:underline ${focusRing}`}>{r.name}</button><span className="block text-[11.5px] text-gray-500">{r.id} · v{r.version}</span></th>
                <td>{r.phase}</td><td>{props.adapters[r.id] ? "In code" : <span className="text-gray-500">None</span>}</td>
                <td><Status s={r.status} /></td><td><Status s={liveReg[r.id]?.status ?? "designed"} /></td>
                <td>{r.products.join(", ") || <span className="text-gray-500">None</span>}</td><td>{r.priority}</td>
                <td>{r.costPerRequestUsd > 0 ? `$${r.costPerRequestUsd}` : "Free"}</td><td className="font-mono text-[12px]">{r.secretRef ?? <span className="font-sans text-gray-500">No key needed</span>}</td>
              </tr>))}</tbody>
          </table>
        </div>
        {draftReg[sel] && <ProviderEditor key={`${sel}-${draftReg[sel].version}`} r={draftReg[sel]} caps={props.capabilities} disabled={!canEdit || !!busy || draftReg[sel].status === "retired"} onSave={patch => post("save", { action: "provider_save", id: sel, patch })} />}
        {canEdit && <NewProvider disabled={!!busy} onCreate={(id, name) => { setSel(id); return post("new", { action: "provider_save", id, patch: { name } }); }} />}
      </section>

      {/* ── 2. Capability catalogue ── */}
      <section aria-labelledby="p2" className={card}>
        <h2 id="p2" className="text-[16px] font-bold text-gray-900">2. Capability catalogue</h2>
        <p className="text-[13px] text-gray-600">What a source can be asked to do. A capability without code is a definition: no source can be activated for it.</p>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">{props.capabilities.map(c => (
          <li key={c.code} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[13px]">
            <span className="font-semibold text-gray-900">{c.label}</span> <span className="text-gray-500">· phase {c.phase} · {c.implemented ? "implemented" : "definition only"}</span>
            <span className="block text-[12px] text-gray-600">{records.filter(r => r.capabilities.includes(c.code)).map(r => r.name).join(", ") || "No source"}</span>
          </li>))}</ul>
      </section>

      {/* ── 3. Source policies, 5. Evidence & citation rules, 6. Budgets & limits: one document ── */}
      <PolicyEditor policy={view.draft.policy} live={view.published.policy} records={records} fixedRules={props.fixedRules} disabled={!canEdit || !!busy} onSave={settings => post("policy", { action: "policy", settings })} />

      {/* ── 4. Workflows ── */}
      <section aria-labelledby="p4" className={card}>
        <h2 id="p4" className="text-[16px] font-bold text-gray-900">4. Workflows</h2>
        <p className="text-[13px] text-gray-600">Configuration over the engine&apos;s own steps. A workflow is operational only when it is Active and everything it needs is Active. Only Basic has every step in code.</p>
        <div className="mt-2 space-y-3">{Object.values(view.draft.workflows as Record<string, any>).map((w: any) => {
          const rd = view.workflowReadiness[w.id];
          return (
            <article key={w.id} className="rounded-lg border border-gray-200 p-3">
              <p className="text-[14px] font-semibold text-gray-900">{w.name} <Status s={w.status} /> <span className="text-[12px] font-normal text-gray-600">· live <Status s={view.published.workflows[w.id]?.status ?? "designed"} /> · {rd?.operationalNow ? "operational now" : "not operational"}</span></p>
              <ol className="mt-1 flex flex-wrap gap-1 text-[12px]">{w.steps.map((s: string) => { const d = props.steps.find(x => x.code === s); return <li key={s} className={`rounded border px-1.5 py-0.5 ${d?.implemented ? "border-gray-300 text-gray-800" : "border-dashed border-amber-400 text-amber-900"}`}>{d?.label ?? s}{d?.implemented ? "" : " (no code)"}</li>; })}</ol>
              {rd?.needs.length ? <p className="mt-1 text-[12px] text-gray-700">To activate it needs: {rd.needs.join("; ")}.</p> : <p className="mt-1 text-[12px] text-[var(--cmp-text-success)]">Everything it needs is in place in the draft.</p>}
              {canEdit && <div className="mt-2 flex flex-wrap gap-2">
                {w.status !== "active" && w.status !== "retired" && <button type="button" className={btn} disabled={!!busy || !isOwner || rd?.needs.length > 0} onClick={() => post(`wf-${w.id}`, { action: "workflow", id: w.id, patch: { status: "active" } })}>Activate</button>}
                {w.status === "active" && <button type="button" className={ghost} disabled={!!busy} onClick={() => post(`wf-${w.id}`, { action: "workflow", id: w.id, patch: { status: "paused" } })}>Pause</button>}
                {w.status === "designed" && <button type="button" className={ghost} disabled={!!busy} onClick={() => post(`wf-${w.id}`, { action: "workflow", id: w.id, patch: { status: "configured" } })}>Mark configured</button>}
                {isOwner && w.status !== "retired" && <button type="button" className={ghost} disabled={!!busy} onClick={() => post(`wf-${w.id}`, { action: "workflow", id: w.id, patch: { status: "retired" } })}>Retire</button>}
              </div>}
            </article>);
        })}</div>
      </section>

      {/* ── 7. Readiness & activation ── */}
      <section aria-labelledby="p7" className={card}>
        <h2 id="p7" className="text-[16px] font-bold text-gray-900">7. Readiness &amp; activation</h2>
        <p className="text-[13px] text-gray-600">Designed → Configured → Integrated → Evaluated → Approved → Active → Paused → Retired. Each step names what it still needs. Approval, activation and retirement are the owner&apos;s.</p>
        <div className="mt-2 space-y-3">{records.map(r => {
          const rd = view.readiness[r.id];
          return (
            <article key={r.id} className="rounded-lg border border-gray-200 p-3">
              <p className="text-[14px] font-semibold text-gray-900">{r.name} <Status s={r.status} /></p>
              <ul className="mt-1 flex flex-wrap gap-1.5 text-[12px]">{[["connectivity", "Connectivity"], ...CHECKS].map(([k, label]) => {
                const c = r.checks?.[k];
                return <li key={k} className={`rounded border px-1.5 py-0.5 ${c?.ok ? "border-[var(--cmp-color-success)] text-[var(--cmp-text-success)]" : "border-gray-300 text-gray-600"}`} title={c?.detail ?? ""}>{label}: {c?.ok ? "recorded" : c ? "failed" : "not recorded"}</li>;
              })}</ul>
              {rd?.next && <p className="mt-1 text-[12px] text-gray-700">Next: {props.lifecycleLabel[rd.next]}{rd.needs.length ? `, which needs ${rd.needs.join("; ")}.` : ", ready."}</p>}
              {canEdit && r.status !== "retired" && <ReadinessControls r={r} next={rd?.next ?? null} ready={!!rd?.next && rd.needs.length === 0} adapter={props.adapters[r.id]} isOwner={isOwner} busy={!!busy}
                onCheck={() => post(`ck-${r.id}`, { action: "provider_check", id: r.id })}
                onAttest={(kind, note) => post(`at-${r.id}`, { action: "provider_attest", id: r.id, kind, note })}
                onMove={to => post(`mv-${r.id}`, { action: "provider_transition", id: r.id, to })} />}
            </article>);
        })}</div>
      </section>

      {/* ── 8. Usage, quality and cost ── */}
      <section aria-labelledby="p8" className={card}>
        <h2 id="p8" className="text-[16px] font-bold text-gray-900">8. Usage, quality &amp; cost (last 14 days)</h2>
        <p className="text-[13px] text-gray-600">Research usage and cost are recorded apart from AI cost. Codes and counts only: no query text, no person.</p>
        {view.analytics.usage === null ? <p className="mt-2 text-[13px] text-gray-700">Research usage is not recorded on this environment yet (migration 630). Nothing can be called until it is, because provider budgets read from it.</p> : view.analytics.usage.length === 0 ? <p className="mt-2 text-[13px] text-gray-700">No research calls yet.</p> : (
          <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-[13px]">
            <thead><tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-[0.08em] text-gray-500"><th scope="col" className="py-1.5">Source</th><th scope="col">Calls</th><th scope="col">HTTP requests</th><th scope="col">Failed</th><th scope="col">Over budget</th><th scope="col">Cache hits</th><th scope="col">Avg latency</th><th scope="col">Research cost</th></tr></thead>
            <tbody>{view.analytics.usage.map((u: any) => <tr key={u.provider} className="border-b border-gray-100"><th scope="row" className="py-1.5 font-normal">{u.provider}</th><td>{u.calls}</td><td>{u.requests}</td><td>{u.failed}</td><td>{u.budget}</td><td>{u.cache}</td><td>{u.avgLatencyMs === null ? "Not measured" : `${u.avgLatencyMs} ms`}</td><td>${u.costUsd}</td></tr>)}</tbody>
          </table></div>)}
        {view.analytics.costByOutcome && (
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-[13px]">
            <caption className="text-left text-[12.5px] font-semibold text-gray-800">Research cost by the outcome of the Scholar answer it served</caption>
            <thead><tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-[0.08em] text-gray-500"><th scope="col" className="py-1.5">Outcome</th><th scope="col">Answers</th><th scope="col">HTTP requests</th><th scope="col">Research cost</th></tr></thead>
            <tbody>{([["accepted", "Shown"], ["partial", "Partly shown"], ["safe_non_answer", "Safe non-answer (withheld)"], ["error", "Error"], ["unlinked", "Not linked to an answer"]] as const).map(([k, label]) => {
              const b = view.analytics.costByOutcome[k];
              return <tr key={k} className="border-b border-gray-100"><th scope="row" className="py-1.5 font-normal">{label}</th><td>{b.actions}</td><td>{b.requests}</td><td>${b.costUsd}</td></tr>;
            })}</tbody>
          </table></div>)}
        <p className="mt-3 text-[13px] text-gray-800">AI cost of Research &amp; Explain answers: {view.analytics.aiCostUsd === null ? "not readable" : `$${view.analytics.aiCostUsd}`}.</p>
        {view.analytics.outcomes && <p className="mt-1 text-[13px] text-gray-800">Outcomes: {view.analytics.outcomes.total} answers · {view.analytics.outcomes.accepted} accepted · {view.analytics.outcomes.partial} partly · {view.analytics.outcomes.rejected} withheld.{view.analytics.outcomes.reasons.length ? ` Reasons: ${view.analytics.outcomes.reasons.map(([r, n]: [string, number]) => `${r} (${n})`).join(", ")}.` : ""}</p>}
      </section>

      {/* ── versions ── */}
      <section aria-labelledby="pv" className={card}>
        <h2 id="pv" className="text-[16px] font-bold text-gray-900">Published versions</h2>
        {view.versions.length === 0 ? <p className="text-[13px] text-gray-700">Nothing has been published yet: every source is as the code defines it, and none is Active.</p> : (
          <ul className="mt-1 space-y-1 text-[13px]">{view.versions.map((v: any) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2">{new Date(v.created_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC · {v.published_by_name ?? "unknown"}{v.note ? ` · ${v.note}` : ""}
              {isOwner && <button type="button" className={ghost} disabled={!!busy} onClick={() => post(`rb-${v.id}`, { action: "rollback", versionId: v.id })}>Roll back to this</button>}</li>))}</ul>)}
      </section>
    </div>
  );
}

function PublishForm({ disabled, onPublish }: { disabled: boolean; onPublish: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <form className="ml-auto flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); onPublish(note); }}>
      <label className="text-[12.5px] text-gray-700">Note <input className={input} value={note} onChange={e => setNote(e.target.value)} maxLength={500} /></label>
      <button type="submit" className={btn} disabled={disabled}>Publish</button>
    </form>
  );
}

function NewProvider({ disabled, onCreate }: { disabled: boolean; onCreate: (id: string, name: string) => void }) {
  const [id, setId] = useState(""), [name, setName] = useState("");
  return (
    <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3" onSubmit={e => { e.preventDefault(); onCreate(id.trim(), name.trim()); }}>
      <p className="w-full text-[12.5px] text-gray-600">Register another source. It starts Designed, and without an adapter in code it can never be integrated or called.</p>
      <label className="text-[12.5px] text-gray-700">Id <input className={input} value={id} onChange={e => setId(e.target.value.toLowerCase())} pattern="[a-z][a-z0-9_]{1,40}" required /></label>
      <label className="text-[12.5px] text-gray-700">Name <input className={input} value={name} onChange={e => setName(e.target.value)} required maxLength={120} /></label>
      <button type="submit" className={ghost} disabled={disabled}>Register</button>
    </form>
  );
}

function ProviderEditor({ r, caps, disabled, onSave }: { r: any; caps: Cap[]; disabled: boolean; onSave: (patch: Record<string, unknown>) => void }) {
  const [f, setF] = useState<any>({ ...r, disciplines: r.disciplines.join(", "), effectiveFrom: r.effectiveFrom?.slice(0, 10) ?? "", effectiveTo: r.effectiveTo?.slice(0, 10) ?? "" });
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const toggle = (k: string, v: string) => set(k, f[k].includes(v) ? f[k].filter((x: string) => x !== v) : [...f[k], v]);
  const num = (k: string, label: string, step = "1") => <label className="text-[12.5px] text-gray-700">{label}<input type="number" step={step} className={`${input} ml-1 w-24`} value={f[k]} onChange={e => set(k, e.target.value)} disabled={disabled} /></label>;
  return (
    <form className="mt-4 space-y-3 rounded-lg border border-gray-200 p-3" onSubmit={e => { e.preventDefault(); onSave({ ...f, disciplines: String(f.disciplines).split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean), effectiveFrom: f.effectiveFrom || null, effectiveTo: f.effectiveTo || null }); }}>
      <p className="text-[14px] font-semibold text-gray-900">{r.name} <span className="text-[12px] font-normal text-gray-600">· {r.type.replace(/_/g, " ")} · phase {r.phase}{r.docsUrl ? <> · <a href={r.docsUrl} target="_blank" rel="noopener noreferrer" className="underline">API documentation</a></> : null}</span></p>
      <p className="text-[12px] text-gray-600">Changing capabilities, products, activities, licensing or cost sends an integrated source back to Configured and clears its checks.</p>
      <label className="block text-[12.5px] text-gray-700">Name <input className={`${input} w-full max-w-md`} value={f.name} onChange={e => set("name", e.target.value)} disabled={disabled} /></label>
      <fieldset><legend className="text-[12.5px] font-semibold text-gray-700">Capabilities</legend><div className="flex flex-wrap gap-2">{caps.map(c => (
        <label key={c.code} className="text-[12.5px] text-gray-800"><input type="checkbox" checked={f.capabilities.includes(c.code)} onChange={() => toggle("capabilities", c.code)} disabled={disabled} /> {c.label}{c.implemented ? "" : " (definition)"}</label>))}</div></fieldset>
      <fieldset><legend className="text-[12.5px] font-semibold text-gray-700">Products and permitted activities</legend><div className="flex flex-wrap gap-3">
        {PRODUCTS.map(p => <label key={p} className="text-[12.5px] text-gray-800"><input type="checkbox" checked={f.products.includes(p)} onChange={() => toggle("products", p)} disabled={disabled} /> {p}</label>)}
        <span className="text-gray-300">|</span>
        {ACTIVITIES.map(a => <label key={a} className="text-[12.5px] text-gray-800"><input type="checkbox" checked={f.activities.includes(a)} onChange={() => toggle("activities", a)} disabled={disabled} /> {a.replace(/_/g, " ")}</label>)}
      </div></fieldset>
      <div className="flex flex-wrap gap-3">
        {num("priority", "Priority")}
        <label className="text-[12.5px] text-gray-700">Jurisdiction<input className={`${input} ml-1 w-28`} value={f.jurisdiction} onChange={e => set("jurisdiction", e.target.value)} disabled={disabled} /></label>
        <label className="text-[12.5px] text-gray-700">Disciplines<input className={`${input} ml-1 w-48`} value={f.disciplines} onChange={e => set("disciplines", e.target.value)} disabled={disabled} /></label>
      </div>
      <div className="flex flex-wrap gap-3">
        {num("rateLimitPerMinute", "Requests / minute")}{num("dailyRequestBudget", "Requests / day")}{num("costPerRequestUsd", "Cost / request (USD)", "0.0001")}{num("dailySpendBudgetUsd", "Spend / day (USD)", "0.01")}
      </div>
      <div className="flex flex-wrap gap-3">
        {num("depth", "Depth (results)")}{num("freshnessYears", "Freshness (years, 0 any)")}{num("cacheDays", "Cache (days)")}{num("retentionDays", "Retention (days)")}
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-[12.5px] text-gray-700">Effective from<input type="date" className={`${input} ml-1`} value={f.effectiveFrom} onChange={e => set("effectiveFrom", e.target.value)} disabled={disabled} /></label>
        <label className="text-[12.5px] text-gray-700">Effective to<input type="date" className={`${input} ml-1`} value={f.effectiveTo} onChange={e => set("effectiveTo", e.target.value)} disabled={disabled} /></label>
      </div>
      <label className="block text-[12.5px] text-gray-700">Licensing and reuse<textarea rows={2} className={`${input} mt-0.5 w-full`} value={f.licensing} onChange={e => set("licensing", e.target.value)} disabled={disabled} /></label>
      <label className="block text-[12.5px] text-gray-700">Provenance<input className={`${input} mt-0.5 w-full`} value={f.provenance} onChange={e => set("provenance", e.target.value)} disabled={disabled} /></label>
      <p className="text-[12px] text-gray-600">Key: {r.needsKey ? <>held in the deployment as <span className="font-mono">{r.secretRef}</span>, never here.</> : "none needed."}</p>
      <button type="submit" className={btn} disabled={disabled}>Save draft</button>
    </form>
  );
}

function ReadinessControls({ r, next, ready, adapter, isOwner, busy, onCheck, onAttest, onMove }: {
  r: any; next: string | null; ready: boolean; adapter: boolean; isOwner: boolean; busy: boolean; onCheck: () => void; onAttest: (kind: string, note: string) => void; onMove: (to: string) => void;
}) {
  const [kind, setKind] = useState<string>("evaluation"), [note, setNote] = useState("");
  const ownerStep = next === "approved" || next === "active";
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      {adapter && r.type !== "external_link" && <button type="button" className={ghost} disabled={busy} onClick={onCheck}>Run connectivity check</button>}
      <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); onAttest(kind, note); setNote(""); }}>
        <label className="text-[12.5px] text-gray-700">Record <select className={input} value={kind} onChange={e => setKind(e.target.value)}>{CHECKS.filter(([k]) => k !== "paidApproval" || isOwner).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="text-[12.5px] text-gray-700">What it rests on <input className={`${input} w-64`} value={note} onChange={e => setNote(e.target.value)} minLength={10} maxLength={500} required /></label>
        <button type="submit" className={ghost} disabled={busy}>Record</button>
      </form>
      {next && <button type="button" className={btn} disabled={busy || !ready || (ownerStep && !isOwner)} onClick={() => onMove(next)}>Move to {next}</button>}
      {r.status === "active" && <button type="button" className={ghost} disabled={busy} onClick={() => onMove("paused")}>Pause</button>}
      {isOwner && <button type="button" className={ghost} disabled={busy} onClick={() => onMove("retired")}>Retire</button>}
    </div>
  );
}

function PolicyEditor({ policy, live, records, fixedRules, disabled, onSave }: { policy: any; live: any; records: any[]; fixedRules: string[]; disabled: boolean; onSave: (p: unknown) => void }) {
  const [p, setP] = useState<any>(structuredClone(policy));
  const setPath = (path: string[], v: unknown) => setP((x: any) => { const y = structuredClone(x); let o = y; for (const k of path.slice(0, -1)) o = o[k]; o[path[path.length - 1]] = v; return y; });
  const search = records.filter(r => r.capabilities.includes("search"));
  const num = (path: string[], label: string, step = "1") => <label className="text-[12.5px] text-gray-700">{label}<input type="number" step={step} className={`${input} ml-1 w-24`} value={path.reduce((o, k) => o[k], p)} onChange={e => setPath(path, Number(e.target.value))} disabled={disabled} /></label>;
  const flag = (path: string[], label: string) => <label className="text-[12.5px] text-gray-800"><input type="checkbox" checked={path.reduce((o, k) => o[k], p)} onChange={e => setPath(path, e.target.checked)} disabled={disabled} /> {label}</label>;
  return (
    <form className="space-y-6" onSubmit={e => { e.preventDefault(); onSave(p); }}>
      <section aria-labelledby="p3" className={card}>
        <h2 id="p3" className="text-[16px] font-bold text-gray-900">3. Source policies</h2>
        <p className="text-[13px] text-gray-600">Per product: which sources it searches, first to last (empty: every Active source by priority), and its clinical source rule.</p>
        <div className="mt-2 space-y-3">{Object.keys(p.sources).map(prod => (
          <fieldset key={prod} className="rounded-lg border border-gray-200 p-3">
            <legend className="px-1 text-[13px] font-semibold text-gray-900">{prod}</legend>
            <div className="flex flex-wrap gap-3">{search.map(r => {
              const order: string[] = p.sources[prod].providers; const at = order.indexOf(r.id);
              return <label key={r.id} className="text-[12.5px] text-gray-800"><input type="checkbox" checked={at > -1} disabled={disabled} onChange={() => setPath(["sources", prod, "providers"], at > -1 ? order.filter(x => x !== r.id) : [...order, r.id])} /> {r.name}{at > -1 ? ` (#${at + 1})` : ""}</label>;
            })}</div>
            <div className="mt-1">{flag(["sources", prod, "clinicalApprovedOnly"], "Clinical topics use approved sources only")}</div>
            <p className="mt-1 text-[11.5px] text-gray-500">Live: {live.sources[prod].providers.join(" → ") || "every Active source by priority"}</p>
          </fieldset>))}</div>
      </section>
      <section aria-labelledby="p5" className={card}>
        <h2 id="p5" className="text-[16px] font-bold text-gray-900">5. Evidence &amp; citation rules</h2>
        <p className="text-[13px] font-semibold text-gray-800">Fixed in code (not configurable):</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-gray-700">{fixedRules.map(r => <li key={r}>{r}</li>)}</ul>
        <div className="mt-3 flex flex-wrap gap-4">
          {flag(["rules", "abstractsAsEvidence"], "Use permitted abstracts as evidence")}{flag(["rules", "doiVerification"], "Verify DOIs with Crossref")}
          {flag(["rules", "showFurtherReading"], "Show further reading")}{flag(["rules", "scholarLink"], "Offer the Google Scholar link")}{flag(["rules", "openAccessLinks"], "Show PubMed Central open-access links (never fetched)")}
        </div>
        <div className="mt-2 flex flex-wrap gap-3">{num(["rules", "maxEvidence"], "Evidence items (max)")}{num(["rules", "excerptChars"], "Excerpt shown (characters)")}</div>
      </section>
      <section aria-labelledby="p6" className={card}>
        <h2 id="p6" className="text-[16px] font-bold text-gray-900">6. Budgets &amp; limits</h2>
        <p className="text-[13px] text-gray-600">Engine-wide. Each source also has its own request and spend budgets (registry), and each product its per-learner limits. A paid request beyond a budget is never sent.</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {num(["limits", "maxResultsPerRequest"], "Results / request")}{num(["limits", "timeoutMs"], "Timeout (ms)")}{num(["limits", "retries"], "Retries")}
          {num(["limits", "cacheDays"], "Cache (days)")}{num(["limits", "retentionDays"], "Retention (days)")}{num(["limits", "dailyRequests"], "Requests / day (all sources)")}{num(["limits", "dailySpendUsd"], "Spend / day (USD)", "0.01")}
        </div>
        <button type="submit" className={`${btn} mt-4`} disabled={disabled}>Save policies, rules and limits as a draft</button>
      </section>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ghost, input, primary } from "@/app/super-admin/ai/fair-use/_components/FairUseControls";

// The write half of /super-admin/research (COMPETEN-KNOWLEDGE-RESEARCH-01). Every control posts to an HQ route that
// re-checks the capability, and the 440-443 triggers check authority and independence again. Nothing here chooses an
// actor, a decider, a time or a data-access level.

export function useResearchSend(endpoint = "/api/hq/knowledge/governance") {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be done. Nothing has changed." }); return; }
      setMsg({ ok: true, text: done });
      router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be done. Check your connection." }); } finally { setBusy(false); }
  }
  return { busy, msg, send };
}

export function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>{msg.text}</p>;
}

/** One action button, with an optional note and an optional date, for a purpose or a project move. */
export function ActionButton({ body, label, done, note, date, endpoint, tone = "ghost" }: {
  body: Record<string, unknown>; label: string; done: string; note?: string; date?: string; endpoint?: string; tone?: "primary" | "ghost";
}) {
  const { busy, msg, send } = useResearchSend(endpoint);
  const [n, setN] = useState("");
  const [d, setD] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {note && <input aria-label={note} placeholder={note} value={n} onChange={e => setN(e.target.value)} className={`${input} w-44`} />}
      {date && <input aria-label={date} type="date" value={d} onChange={e => setD(e.target.value)} className={input} />}
      <button type="button" disabled={busy} className={tone === "primary" ? primary : ghost}
        onClick={() => send({ ...body, ...(note ? { note: n } : {}), ...(date ? { [body.action === "ethics" ? "decidedOn" : "retainUntil"]: d } : {}) }, done)}>{label}</button>
      <Msg msg={msg} />
    </span>
  );
}

type PolicyShape = { minCohort: number; complementarySuppression: boolean; roundTo: number; measures: Record<string, boolean>; cohortDimensions: string[];
  periodGrain: string; snapshotRetentionDays: number; educatorMeasures: string[] };

/** The CKRI policy draft (CONFIG-002). The server clamps every value, and the database floor stays 5 whatever is sent. */
export function PolicyForm({ initial, measures, dimensions }: { initial: PolicyShape; measures: { code: string; label: string; available: boolean }[]; dimensions: readonly string[] }) {
  const { busy, msg, send } = useResearchSend();
  const [p, setP] = useState<PolicyShape>(initial);
  const toggle = (list: string[], x: string) => list.includes(x) ? list.filter(y => y !== x) : [...list, x];
  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex flex-wrap gap-3">
        <label>Minimum cohort <input type="number" min={5} max={1000} value={p.minCohort} onChange={e => setP({ ...p, minCohort: Number(e.target.value) })} className={`${input} w-20`} /></label>
        <label>Round counts to <select value={p.roundTo} onChange={e => setP({ ...p, roundTo: Number(e.target.value) })} className={input}>{[1, 5, 10].map(x => <option key={x} value={x}>{x}</option>)}</select></label>
        <label><input type="checkbox" checked={p.complementarySuppression} onChange={e => setP({ ...p, complementarySuppression: e.target.checked })} /> Complementary suppression</label>
        <label>Period <select value={p.periodGrain} onChange={e => setP({ ...p, periodGrain: e.target.value })} className={input}><option value="month">Month</option><option value="quarter">Quarter</option></select></label>
        <label>Keep snapshots (days) <input type="number" min={30} max={1825} value={p.snapshotRetentionDays} onChange={e => setP({ ...p, snapshotRetentionDays: Number(e.target.value) })} className={`${input} w-24`} /></label>
      </div>
      <fieldset><legend className="font-semibold text-gray-800">Measures (computed / shown to educators)</legend>
        {measures.map(m => (
          <div key={m.code} className="flex flex-wrap gap-3">
            <label className={m.available ? "" : "text-gray-500"}><input type="checkbox" disabled={!m.available} checked={!!p.measures[m.code]} onChange={e => setP({ ...p, measures: { ...p.measures, [m.code]: e.target.checked } })} /> {m.label}{m.available ? "" : " (source pending)"}</label>
            <label className="text-gray-700"><input type="checkbox" disabled={!m.available} checked={p.educatorMeasures.includes(m.code)} onChange={() => setP({ ...p, educatorMeasures: toggle(p.educatorMeasures, m.code) })} /> educators</label>
          </div>
        ))}
      </fieldset>
      <fieldset><legend className="font-semibold text-gray-800">Cohort dimensions</legend>
        {dimensions.map(d => <label key={d} className="mr-3"><input type="checkbox" checked={p.cohortDimensions.includes(d)} onChange={() => setP({ ...p, cohortDimensions: toggle(p.cohortDimensions, d) })} /> {d}</label>)}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} className={ghost} onClick={() => send({ action: "policy_draft", policy: p }, "Draft saved. Publish it to put it in force.")}>Save draft</button>
        <button type="button" disabled={busy} className={primary} onClick={() => send({ action: "policy_publish" }, "Published.")}>Publish draft</button>
        <Msg msg={msg} />
      </div>
    </div>
  );
}

/** A small form: named fields, posted as one action. */
export function FieldsForm({ action, fields, submit, done, endpoint, extra }: {
  action: string; submit: string; done: string; endpoint?: string; extra?: Record<string, unknown>;
  fields: { name: string; label: string; kind?: "text" | "textarea" | "number" | "select" | "date"; options?: string[]; required?: boolean }[];
}) {
  const { busy, msg, send } = useResearchSend(endpoint);
  const [v, setV] = useState<Record<string, string>>({});
  const set = (k: string, x: string) => setV(s => ({ ...s, [k]: x }));
  return (
    <form className="grid gap-2 sm:grid-cols-2" onSubmit={e => {
      e.preventDefault();
      const body: Record<string, unknown> = { action, ...(extra ?? {}) };
      for (const f of fields) body[f.name] = f.kind === "number" ? Number(v[f.name] ?? "") : (v[f.name] ?? "");
      send(body, done);
    }}>
      {fields.map(f => (
        <label key={f.name} className={`text-[12.5px] text-gray-700 ${f.kind === "textarea" ? "sm:col-span-2" : ""}`}>
          <span className="block">{f.label}</span>
          {f.kind === "textarea" ? <textarea required={f.required} value={v[f.name] ?? ""} onChange={e => set(f.name, e.target.value)} rows={3} className={`${input} w-full`} />
            : f.kind === "select" ? <select required={f.required} value={v[f.name] ?? ""} onChange={e => set(f.name, e.target.value)} className={`${input} w-full`}><option value="">Choose</option>{f.options?.map(o => <option key={o} value={o}>{o}</option>)}</select>
            : <input required={f.required} type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"} value={v[f.name] ?? ""} onChange={e => set(f.name, e.target.value)} className={`${input} w-full`} />}
        </label>
      ))}
      <div className="sm:col-span-2 flex items-center gap-2"><button type="submit" disabled={busy} className={primary}>{submit}</button><Msg msg={msg} /></div>
    </form>
  );
}

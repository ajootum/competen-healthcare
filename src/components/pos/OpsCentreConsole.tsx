"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { POS_TEMPLATES, POS_GROUPS, type PosTemplate, type PosField } from "@/lib/operations/pos-form-templates";

// Patient Operations Centre console (POS-106 §3/§6). The interactive layer of the command
// surface: quick actions, the seven-group workflow catalogue with live open-form counts, and a
// functional form drawer that renders a template's structured fields and saves a draft or submits.
// Submitting posts to /api/operations/pos-forms, which persists the instance, writes an immutable
// event, appends the patient timeline and creates tasks. State-mutating movements (admission)
// cross-link to their operational workflow rather than faking a census write here.
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const tc = (s: string) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

type Patient = { id: string; label: string; state: string };

export default function OpsCentreConsole({ patients, counts }: { patients: Patient[]; counts: Record<string, { open: number; total: number }> }) {
  const router = useRouter();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [patientId, setPatientId] = useState("");
  const [values, setValues] = useState<any>({});
  const [draftId, setDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 5000); };

  const tpl = openKey ? POS_TEMPLATES.find(t => t.key === openKey) ?? null : null;
  const quick = POS_TEMPLATES.filter(t => t.quick);

  function launch(t: PosTemplate) {
    if (t.crossLink) return; // handled by the anchor
    setOpenKey(t.key); setValues({}); setDraftId(null); setMsg(null);
  }
  function close() { setOpenKey(null); setValues({}); setDraftId(null); }

  const setV = (k: string, v: any) => setValues((p: any) => ({ ...p, [k]: v }));
  const toggleChecklist = (k: string, item: string) => setValues((p: any) => { const cur: string[] = p[k] ?? []; return { ...p, [k]: cur.includes(item) ? cur.filter(x => x !== item) : [...cur, item] }; });
  const addRow = (k: string) => setValues((p: any) => ({ ...p, [k]: [...(p[k] ?? []), { text: "", owner: "", due: "", priority: "medium" }] }));
  const setRow = (k: string, i: number, field: string, v: string) => setValues((p: any) => { const rows = [...(p[k] ?? [])]; rows[i] = { ...rows[i], [field]: v }; return { ...p, [k]: rows }; });
  const rmRow = (k: string, i: number) => setValues((p: any) => ({ ...p, [k]: (p[k] ?? []).filter((_: any, j: number) => j !== i) }));

  async function post(action: "save" | "submit") {
    if (!tpl) return;
    setBusy(true);
    const r = await fetch("/api/operations/pos-forms", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id: draftId, template_key: tpl.key, patient_id: patientId || null, title: values.__title || tpl.name, priority: values.__priority || null, payload: values }),
    });
    setBusy(false);
    if (r.ok) {
      const data = await r.json().catch(() => ({}));
      if (action === "submit") { toast("ok", `${tpl.name} submitted`); close(); router.refresh(); }
      else { if (data?.id) setDraftId(data.id); toast("ok", `${tpl.name} draft saved`); }
    } else { const d = await r.json().catch(() => ({})); toast("err", d?.error || "Failed"); }
  }

  function renderField(f: PosField) {
    const v = values[f.key];
    if (f.type === "textarea") return <textarea className={input} rows={2} value={v ?? ""} onChange={e => setV(f.key, e.target.value)} placeholder={(f as any).placeholder} />;
    if (f.type === "number") return <input type="number" className={input} value={v ?? ""} onChange={e => setV(f.key, e.target.value)} />;
    if (f.type === "datetime") return <input type="datetime-local" className={input} value={v ?? ""} onChange={e => setV(f.key, e.target.value)} />;
    if (f.type === "select") return <select className={input} value={v ?? ""} onChange={e => setV(f.key, e.target.value)}><option value="">—</option>{(f as any).options.map((o: string) => <option key={o} value={o}>{tc(o)}</option>)}</select>;
    if (f.type === "boolean") return <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={!!v} onChange={e => setV(f.key, e.target.checked)} /> Yes</label>;
    if (f.type === "checklist") return <div className="space-y-1">{(f as any).items.map((it: string) => <label key={it} className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={(v ?? []).includes(it)} onChange={() => toggleChecklist(f.key, it)} /> {it}</label>)}</div>;
    if (f.type === "actions") return (
      <div className="space-y-1.5">
        {(v ?? []).map((row: any, i: number) => (
          <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
            <input className={`${input} col-span-5`} placeholder="Action" value={row.text} onChange={e => setRow(f.key, i, "text", e.target.value)} />
            <input className={`${input} col-span-3`} placeholder="Owner" value={row.owner} onChange={e => setRow(f.key, i, "owner", e.target.value)} />
            <input type="datetime-local" className={`${input} col-span-3`} value={row.due} onChange={e => setRow(f.key, i, "due", e.target.value)} />
            <button type="button" onClick={() => rmRow(f.key, i)} className="col-span-1 text-gray-400 hover:text-rose-600 text-lg leading-none">×</button>
          </div>
        ))}
        <button type="button" onClick={() => addRow(f.key)} className="text-[11px] font-medium text-emerald-700 hover:underline">+ Add action</button>
      </div>
    );
    return <input className={input} value={v ?? ""} onChange={e => setV(f.key, e.target.value)} placeholder={(f as any).placeholder} />;
  }

  return (
    <>
      {msg && <div className={`fixed bottom-4 right-4 z-50 text-sm rounded-lg px-4 py-2.5 shadow-lg ${msg.kind === "ok" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{msg.text}</div>}

      {/* Quick actions (§3) */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Quick actions</h3><span className="text-[11px] text-gray-400">Opens a contextual form</span></div>
        <div className="flex flex-wrap gap-2">
          {quick.map(t => t.crossLink ? (
            <Link key={t.key} href={t.crossLink.href} className="text-sm rounded-lg border border-gray-200 text-gray-700 px-3 py-1.5 hover:border-emerald-300 hover:text-emerald-700 transition-colors">{t.icon} {t.name}</Link>
          ) : (
            <button key={t.key} onClick={() => launch(t)} className="text-sm rounded-lg bg-emerald-600 text-white px-3 py-1.5 hover:bg-emerald-700 transition-colors">{t.icon} {t.name}</button>
          ))}
        </div>
      </div>

      {/* Workflow catalogue (§6) — seven groups */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {POS_GROUPS.map(group => {
          const forms = POS_TEMPLATES.filter(t => t.group === group);
          return (
            <div key={group} className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-2.5">{group}</h3>
              <div className="space-y-1.5">
                {forms.map(t => {
                  const open = counts[t.key]?.open ?? 0;
                  const inner = (
                    <>
                      <span className="flex items-center gap-2 min-w-0"><span className="text-sm">{t.icon}</span><span className="text-sm text-gray-700 truncate">{t.name}</span>{t.verify && <span className="text-[8px] uppercase font-bold text-violet-500 bg-violet-50 rounded px-1">verify</span>}</span>
                      <span className="flex items-center gap-2 shrink-0">{open > 0 && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 rounded-full px-1.5">{open} open</span>}<span className="text-[11px] text-emerald-700">{t.crossLink ? "↗" : "Open"}</span></span>
                    </>
                  );
                  return t.crossLink
                    ? <Link key={t.key} href={t.crossLink.href} className="flex items-center justify-between rounded-lg border border-gray-100 px-2.5 py-1.5 hover:border-emerald-200 hover:bg-emerald-50/30 transition-colors">{inner}</Link>
                    : <button key={t.key} onClick={() => launch(t)} className="w-full flex items-center justify-between rounded-lg border border-gray-100 px-2.5 py-1.5 hover:border-emerald-200 hover:bg-emerald-50/30 transition-colors text-left">{inner}</button>;
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Form drawer */}
      {tpl && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/30" onClick={close} />
          <div className="relative w-full max-w-lg bg-white h-full shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3.5 flex items-center justify-between z-10">
              <div><h3 className="font-bold text-gray-900">{tpl.icon} {tpl.name}</h3><p className="text-[11px] text-gray-400">{tpl.group}{tpl.verify ? " · requires verification" : ""}</p></div>
              <button onClick={close} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {tpl.note && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{tpl.note}</p>}
              <label className="block text-xs text-gray-500">Patient <span className="text-gray-300">(operational context)</span>
                <select className={input} value={patientId} onChange={e => setPatientId(e.target.value)}><option value="">— none / unit-level —</option>{patients.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
              </label>
              {tpl.fields.map(f => (
                <label key={f.key} className="block text-xs text-gray-500">{f.label}{(f as any).required && <span className="text-rose-500"> *</span>}{(f as any).help && <span className="text-gray-300 font-normal"> · {(f as any).help}</span>}
                  <div className="mt-1">{renderField(f)}</div>
                </label>
              ))}
            </div>
            <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex items-center justify-between gap-2">
              <button onClick={() => post("save")} disabled={busy} className="text-sm rounded-lg border border-gray-200 text-gray-700 px-3.5 py-2 hover:border-gray-300 disabled:opacity-50">Save draft</button>
              <button onClick={() => post("submit")} disabled={busy} className="text-sm rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-50">Submit</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

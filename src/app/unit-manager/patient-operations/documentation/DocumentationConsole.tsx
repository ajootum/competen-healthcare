"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DOC_TEMPLATES, docTemplateByKey } from "@/lib/operations/doc-templates";

// Operational Documentation console (POS-109). Generate a document from live operational data,
// preview the content snapshot, then sign it (electronic signature §6) or regenerate a fresh
// version (immutable history §3.2). All mutations go through /api/operations/pos-documents.
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const STATUS_TONE: Record<string, string> = { draft: "bg-gray-100 text-gray-600", finalised: "bg-sky-100 text-sky-700", signed: "bg-emerald-100 text-emerald-700", superseded: "bg-gray-100 text-gray-400" };
const fmtDateTime = (iso: string) => { const d = new Date(iso); return `${d.toLocaleDateString([], { day: "2-digit", month: "short" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`; };

export default function DocumentationConsole({ patients, documents }: { patients: { id: string; label: string }[]; documents: any[] }) {
  const router = useRouter();
  const [templateKey, setTemplateKey] = useState(DOC_TEMPLATES[0].key);
  const [patientId, setPatientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewed, setViewed] = useState<any>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 5000); };

  async function generate() {
    if (!patientId) { toast("err", "Select a patient"); return; }
    setBusy(true);
    const r = await fetch("/api/operations/pos-documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate", template_key: templateKey, patient_id: patientId }) });
    setBusy(false);
    if (r.ok) { const doc = await r.json(); setViewed(doc); toast("ok", "Document generated"); router.refresh(); }
    else { const d = await r.json().catch(() => ({})); toast("err", d?.error || "Failed"); }
  }
  async function act(action: "sign" | "supersede", id: string) {
    if (action === "supersede" && !window.confirm("Regenerate a fresh version from current data? The existing version is retained as superseded.")) return;
    setBusy(true);
    const r = await fetch("/api/operations/pos-documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
    setBusy(false);
    if (r.ok) { const doc = await r.json(); if (action === "sign") { setViewed(doc); toast("ok", "Document signed"); } else { setViewed(doc); toast("ok", "New version generated"); } router.refresh(); }
    else { const d = await r.json().catch(() => ({})); toast("err", d?.error || "Failed"); }
  }

  const tpl = viewed ? docTemplateByKey(viewed.template_key) : null;

  return (
    <>
      {msg && <div className={`fixed bottom-4 right-4 z-50 text-sm rounded-lg px-4 py-2.5 shadow-lg ${msg.kind === "ok" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{msg.text}</div>}

      {/* Generate panel */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Generate a document</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-xs text-gray-500 sm:col-span-1">Template
            <select className={input} value={templateKey} onChange={e => setTemplateKey(e.target.value)}>{DOC_TEMPLATES.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}</select>
          </label>
          <label className="text-xs text-gray-500 sm:col-span-1">Patient
            <select className={input} value={patientId} onChange={e => setPatientId(e.target.value)}><option value="">— select —</option>{patients.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
          </label>
          <div className="flex items-end"><button onClick={generate} disabled={busy || !patientId} className="w-full text-sm rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-50">Generate from live data</button></div>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">{docTemplateByKey(templateKey)?.blurb} Populated from the operational record at generation time — never fabricated.</p>
      </div>

      {/* Recent documents */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Recent documents</h3>
        {documents.length === 0 ? <p className="text-sm text-gray-400">No documents generated yet. Generate one above.</p> : (
          <div className="divide-y divide-gray-50">
            {documents.map(d => (
              <button key={d.id} onClick={() => setViewed(d)} className="w-full flex items-center justify-between gap-2 py-2 text-left hover:bg-gray-50/60 rounded-lg px-2 -mx-2">
                <span className="min-w-0"><span className="text-sm text-gray-800 truncate block">{d.title}</span><span className="text-[11px] text-gray-400">v{d.version} · {d.gen?.full_name ?? "—"} · {fmtDateTime(d.created_at)}</span></span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${STATUS_TONE[d.status] ?? "bg-gray-100 text-gray-600"}`}>{d.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Document viewer */}
      {viewed && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/30" onClick={() => setViewed(null)} />
          <div className="relative w-full max-w-xl bg-white h-full shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3.5 flex items-center justify-between z-10">
              <div><h3 className="font-bold text-gray-900">{viewed.title}</h3><p className="text-[11px] text-gray-400">{viewed.doc_type} · v{viewed.version} · <span className={`px-1.5 py-0.5 rounded ${STATUS_TONE[viewed.status]}`}>{viewed.status}</span>{viewed.signed_at ? ` · signed ${fmtDateTime(viewed.signed_at)}` : ""}</p></div>
              <button onClick={() => setViewed(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {(viewed.content ?? []).map((s: any, i: number) => (
                <div key={i}><h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-1">{s.heading}</h4><div className="space-y-0.5">{(s.lines ?? []).map((l: string, j: number) => <p key={j} className="text-sm text-gray-600">{l}</p>)}</div></div>
              ))}
              {(!viewed.content || viewed.content.length === 0) && <p className="text-sm text-gray-400">No content.</p>}
            </div>
            <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex items-center justify-between gap-2">
              <p className="text-[10px] text-gray-400 max-w-[50%]">{viewed.status === "signed" ? "Signed — immutable." : viewed.status === "superseded" ? "Superseded by a newer version." : "Draft — sign to finalise."}</p>
              <div className="flex items-center gap-2">
                {viewed.status !== "superseded" && <button onClick={() => act("supersede", viewed.id)} disabled={busy} className="text-sm rounded-lg border border-gray-200 text-gray-700 px-3 py-2 hover:border-gray-300 disabled:opacity-50">Regenerate</button>}
                {viewed.status === "draft" && <button onClick={() => act("sign", viewed.id)} disabled={busy} className="text-sm rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 disabled:opacity-50">Sign{tpl?.sign ? "" : " & finalise"}</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

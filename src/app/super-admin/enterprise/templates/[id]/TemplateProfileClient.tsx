"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { NEXT_STATUS } from "@/lib/enterprise/templates";

// Enterprise Template profile (ENT-001 §6) — lifecycle, versioning and the
// deployment workflow (organisation templates provision a new organisation).
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_BADGE: Record<string, string> = { draft: "bg-gray-100 text-gray-600", review: "bg-amber-50 text-amber-700", approved: "bg-sky-50 text-sky-700", published: "bg-green-50 text-green-700", assigned: "bg-violet-50 text-violet-700", retired: "bg-gray-100 text-gray-400" };
const TYPE_ICON: Record<string, string> = { organisation: "🏛️", facility: "🏥", department: "🗂️", unit: "🔹", role: "🪪", workspace: "🖥️", structure: "🏗️" };
const card = "bg-white rounded-xl border border-gray-200 p-5";
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; return `${Math.floor(s / 86400)} d ago`; };

export default function TemplateProfileClient({ data }: { data: any }) {
  const router = useRouter();
  const { template, audit, auditReady } = data;
  const [busy, setBusy] = useState(false);
  const [deploy, setDeploy] = useState(false);
  const [form, setForm] = useState({ org_name: "", org_code: "", hq_country: "Kenya", org_status: "onboarding" });
  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }));
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 4000); };

  async function act(body: any, ok: string) {
    setBusy(true);
    const r = await fetch(`/api/enterprise/templates?id=${template.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    const d = await r.json().catch(() => ({}));
    if (r.ok) { toast("ok", ok); router.refresh(); return d; } else { toast("err", d.error ?? "Failed"); return null; }
  }
  async function runDeploy() {
    if (!form.org_name.trim()) { toast("err", "Organisation name required"); return; }
    const d = await act({ action: "deploy", ...form }, "Deployed");
    if (d?.organisation_id) { setDeploy(false); router.push(`/super-admin/enterprise/organisations/${d.organisation_id}`); }
  }

  const transitions = NEXT_STATUS[template.status] ?? [];
  const canDeploy = template.status === "published" && template.type === "organisation";

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/enterprise" className="hover:text-teal-700">Enterprise Administration</Link><span>/</span>
        <Link href="/super-admin/enterprise/templates" className="hover:text-teal-700">Templates</Link><span>/</span><span className="text-gray-600 truncate">{template.name}</span>
      </div>

      <div className={`${card} flex flex-wrap items-start justify-between gap-3`}>
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 rounded-xl bg-gray-50 flex items-center justify-center text-xl shrink-0">{TYPE_ICON[template.type] ?? "📦"}</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap"><h1 className="text-xl font-bold text-gray-900">{template.name}</h1>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${STATUS_BADGE[template.status] ?? "bg-gray-100 text-gray-600"}`}>{template.status}</span></div>
            <p className="text-xs text-gray-500 mt-0.5 capitalize">{template.type} template · v{template.version}{template.code ? ` · ${template.code}` : ""}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {transitions.map((t: any) => <button key={t.to} onClick={() => act({ action: "transition", to: t.to }, `Moved to ${t.to}`)} disabled={busy} className="text-xs font-medium rounded-lg border border-teal-200 text-teal-700 hover:bg-teal-50 px-3 py-1.5 disabled:opacity-40">{t.label}</button>)}
          <button onClick={() => act({ action: "bump_minor" }, "Version bumped")} disabled={busy} className="text-xs font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-1.5 disabled:opacity-40">+ Minor version</button>
          {canDeploy && <button onClick={() => setDeploy(true)} className="text-xs font-semibold rounded-lg bg-teal-600 text-white hover:bg-teal-700 px-3 py-1.5">Deploy →</button>}
        </div>
      </div>
      {msg && <div className={`text-sm rounded-lg px-3 py-1.5 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</div>}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className={card}><h3 className="font-semibold text-gray-900 mb-2">Template</h3>
          <div className="text-sm">
            <div className="flex justify-between border-b border-gray-50 py-1.5"><span className="text-gray-500">Type</span><span className="text-gray-800 capitalize">{template.type}</span></div>
            <div className="flex justify-between border-b border-gray-50 py-1.5"><span className="text-gray-500">Version</span><span className="text-gray-800 tabular-nums">v{template.version}</span></div>
            <div className="flex justify-between border-b border-gray-50 py-1.5"><span className="text-gray-500">Status</span><span className="text-gray-800 capitalize">{template.status}</span></div>
            <div className="flex justify-between border-b border-gray-50 py-1.5"><span className="text-gray-500">Created by</span><span className="text-gray-800">{template.createdBy ?? "—"}</span></div>
            <div className="flex justify-between py-1.5"><span className="text-gray-500">Updated</span><span className="text-gray-800">{template.updatedAt ? new Date(template.updatedAt).toLocaleDateString() : "—"}</span></div>
          </div>
          {template.description && <p className="text-sm text-gray-600 mt-3 leading-relaxed">{template.description}</p>}
        </div>
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-2">Lifecycle</h3>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {["draft", "review", "approved", "published", "assigned", "retired"].map((s, i, arr) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={`px-2 py-0.5 rounded capitalize ${template.status === s ? "bg-teal-600 text-white font-medium" : "bg-gray-100 text-gray-500"}`}>{s}</span>
                {i < arr.length - 1 && <span className="text-gray-300">→</span>}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-3">An organisation already using a template is not changed automatically when the master is updated. {template.type === "organisation" ? "Publish, then Deploy to provision a new organisation." : "Deployment for this template type activates with the deployment engine."}</p>
        </div>
      </div>

      <div className={card}><h3 className="font-semibold text-gray-900 mb-3">Audit history</h3>
        {!auditReady || audit.length === 0 ? <p className="text-sm text-gray-400">{auditReady ? "No audit entries for this template yet." : "Audit log not available."}</p> : (
          <div className="space-y-2">{audit.map((a: any, i: number) => (
            <div key={i} className="flex items-center gap-2.5 text-sm"><span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" /><span className="text-gray-700 capitalize">{(a.action ?? "").replace(/_/g, " ")}</span><span className="text-gray-400 text-xs ml-auto">{relTime(a.created_at)}</span></div>
          ))}</div>
        )}
      </div>

      {deploy && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDeploy(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100"><h3 className="font-bold text-gray-900">Deploy “{template.name}”</h3><button onClick={() => setDeploy(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button></div>
            <div className="p-6 flex flex-col gap-3">
              <p className="text-[11px] text-gray-500">Configure the local variables for the new organisation this template provisions.</p>
              <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Organisation name *</label><input value={form.org_name} onChange={set("org_name")} className={input} placeholder="e.g. New Hope Hospital" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Code</label><input value={form.org_code} onChange={set("org_code")} className={input} /></div>
                <div><label className="text-xs font-semibold text-gray-600 mb-1 block">HQ Country</label><input value={form.hq_country} onChange={set("hq_country")} className={input} /></div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setDeploy(false)} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button onClick={runDeploy} disabled={busy} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-60">{busy ? "Deploying…" : "Deploy"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

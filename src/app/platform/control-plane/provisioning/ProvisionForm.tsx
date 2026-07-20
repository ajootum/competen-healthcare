"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Template = { code: string; name: string; departments: number; plan: string };

export default function ProvisionForm({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [templateCode, setTemplateCode] = useState(templates[0]?.code ?? "");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState<"trial" | "active">("trial");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string; steps?: string[]; tenantId?: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetch("/api/platform/provision", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), templateCode, country: country.trim() || null, status }),
      });
      const data = await res.json();
      setResult(data);
      if (data.ok) { setName(""); setCountry(""); router.refresh(); }
    } catch {
      setResult({ ok: false, error: "Request failed" });
    } finally { setBusy(false); }
  };

  const field = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-400";
  const sel = templates.find(t => t.code === templateCode);

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 max-w-lg">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Tenant name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. CURE Children's Hospital Uganda" className={field} required />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Template</label>
        <select value={templateCode} onChange={e => setTemplateCode(e.target.value)} className={field}>
          {templates.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
        </select>
        {sel && <p className="text-[11px] text-gray-400 mt-1">Seeds {sel.departments} departments · <span className="font-mono">{sel.plan}</span> plan</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Country (ISO-2)</label>
          <input value={country} onChange={e => setCountry(e.target.value.toUpperCase().slice(0, 2))} placeholder="UG" className={field} maxLength={2} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Initial status</label>
          <select value={status} onChange={e => setStatus(e.target.value as "trial" | "active")} className={field}>
            <option value="trial">Trial</option><option value="active">Active</option>
          </select>
        </div>
      </div>
      <button type="submit" disabled={busy || !name.trim()} className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors">
        {busy ? "Provisioning…" : "⚡ Provision tenant"}
      </button>

      {result && (
        <div className={`rounded-lg p-3 text-sm ${result.ok ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-700"}`}>
          <p className="font-medium">{result.ok ? "✓ Tenant provisioned" : `✗ ${result.error ?? "Failed"}`}</p>
          {result.steps && result.steps.length > 0 && (
            <ul className="mt-1.5 text-xs space-y-0.5 opacity-80">{result.steps.map((s, i) => <li key={i}>· {s}</li>)}</ul>
          )}
        </div>
      )}
    </form>
  );
}

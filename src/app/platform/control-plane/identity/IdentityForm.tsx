"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Configure a tenant's SSO/IdP (LCP-001 §19). Stores config; enforcement pending.
export default function IdentityForm({ tenants }: { tenants: { id: string; name: string }[] }) {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [protocol, setProtocol] = useState("saml");
  const [provider, setProvider] = useState("azure_ad");
  const [mfaRequired, setMfa] = useState(false);
  const [scimEnabled, setScim] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || busy) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/platform/identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId, protocol, provider, mfaRequired, scimEnabled, isActive: false }) });
      const data = await res.json();
      if (data.ok) { setMsg("saved"); router.refresh(); } else setMsg(data.error || "failed");
    } catch { setMsg("failed"); } finally { setBusy(false); }
  };
  const field = "border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-400";
  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3 max-w-md">
      <h3 className="font-semibold text-gray-900">Configure tenant SSO</h3>
      <select value={tenantId} onChange={e => setTenantId(e.target.value)} className={`${field} w-full`} required>
        <option value="">Select tenant…</option>
        {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <div className="flex gap-2">
        <select value={protocol} onChange={e => setProtocol(e.target.value)} className={`${field} flex-1`}>{["saml", "oidc", "oauth"].map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}</select>
        <select value={provider} onChange={e => setProvider(e.target.value)} className={`${field} flex-1`}>{["azure_ad", "google", "okta", "custom"].map(p => <option key={p} value={p}>{p}</option>)}</select>
      </div>
      <div className="flex gap-4 text-sm text-gray-600">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={mfaRequired} onChange={e => setMfa(e.target.checked)} /> MFA required</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={scimEnabled} onChange={e => setScim(e.target.checked)} /> SCIM</label>
      </div>
      <button type="submit" disabled={busy || !tenantId} className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2">{busy ? "Saving…" : "Save configuration"}</button>
      {msg && <p className={`text-xs ${msg === "saved" ? "text-green-600" : "text-red-500"}`}>{msg}</p>}
      <p className="text-[11px] text-gray-400">Saved as a configuration; enforcement activates when the auth provider is wired.</p>
    </form>
  );
}

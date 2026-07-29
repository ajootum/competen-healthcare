"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// COMP-023 — the worker manages their consented, time-limited passport share links: mint one (choosing what
// to share + how long), copy the verify link, and revoke at any time. Talks to /api/passport/share.
type Token = { id: string; token: string; scope: string; label: string | null; expires_at: string | null; revoked: boolean; view_count: number | null; created_at: string };

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function ShareManager({ tokens }: { tokens: Token[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("summary");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(30);
  const [copied, setCopied] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const statusOf = (t: Token) => (t.revoked ? "revoked" : t.expires_at && new Date(t.expires_at) < new Date() ? "expired" : "active");
  const STATUS_TONE: Record<string, string> = { active: "bg-emerald-100 text-emerald-700", expired: "bg-amber-100 text-amber-700", revoked: "bg-gray-200 text-gray-500" };

  async function create() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/passport/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, label: label || null, expires_in_days: days }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Error ${res.status}`); return; }
      setLabel(""); setOpen(false); router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setErr(null);
    try { const res = await fetch(`/api/passport/share?id=${id}`, { method: "PATCH" }); if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Error ${res.status}`); return; } router.refresh(); }
    catch { setErr("Network error"); } finally { setBusy(false); }
  }
  async function copy(token: string) { try { await navigator.clipboard.writeText(`${origin}/verify/${token}`); setCopied(token); setTimeout(() => setCopied(c => (c === token ? null : c)), 1500); } catch { setErr("Could not copy — select and copy the link manually."); } }

  const inp = "border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px]";
  return (
    <div className="space-y-4">
      {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-[12px]">{err}</div>}

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div><p className="text-sm font-semibold text-gray-900">Create a verification link</p><p className="text-[12px] text-gray-500">Share proof of your competencies &amp; credentials with an employer or regulator — time-limited and revocable.</p></div>
          <button onClick={() => setOpen(v => !v)} className="text-[13px] bg-teal-600 text-white rounded-lg px-3 py-2 hover:bg-teal-700 shrink-0">{open ? "Close" : "＋ New link"}</button>
        </div>
        {open && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
            <div><label className="text-[11px] text-gray-500 mb-0.5 block">What to share</label><select className={`${inp} w-full`} value={scope} onChange={e => setScope(e.target.value)}><option value="summary">Summary (counts only)</option><option value="full">Full (competencies + credentials)</option></select></div>
            <div className="md:col-span-2"><label className="text-[11px] text-gray-500 mb-0.5 block">Purpose (optional)</label><input className={`${inp} w-full`} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Job application — City Hospital" /></div>
            <div className="flex gap-2 items-end"><div className="flex-1"><label className="text-[11px] text-gray-500 mb-0.5 block">Valid for (days)</label><input type="number" min={1} max={365} className={`${inp} w-full`} value={days} onChange={e => setDays(Math.max(1, Math.min(365, +e.target.value || 30)))} /></div><button disabled={busy} onClick={create} className="text-[13px] bg-gray-800 text-white rounded-lg px-3 py-1.5 disabled:opacity-40">Create</button></div>
            <p className="md:col-span-4 text-[11px] text-gray-400">The link reveals only your verified, current competencies and credentials — never gaps, notes or patient data. You can revoke it any time.</p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
        {tokens.length === 0 && <p className="text-sm text-gray-400 p-6 text-center">No verification links yet. Create one above to share proof of your competence.</p>}
        {tokens.map(t => {
          const st = statusOf(t);
          return (
            <div key={t.id} className="p-3 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-gray-800 truncate">{t.label ?? "Verification link"}</p>
                <p className="text-[11px] text-gray-400">{t.scope === "full" ? "Full" : "Summary"} · created {fmt(t.created_at)} · valid until {fmt(t.expires_at)} · {t.view_count ?? 0} view{(t.view_count ?? 0) === 1 ? "" : "s"}</p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_TONE[st]}`}>{st}</span>
              {st === "active" && <button onClick={() => copy(t.token)} className="text-[12px] text-teal-600 hover:underline">{copied === t.token ? "✓ copied" : "copy link"}</button>}
              {st === "active" && <button disabled={busy} onClick={() => revoke(t.id)} className="text-[12px] text-rose-500 hover:text-rose-700 disabled:opacity-40">revoke</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

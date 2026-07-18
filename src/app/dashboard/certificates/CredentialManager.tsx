"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import EvidencePanel, { type EvidenceItem } from "@/components/EvidencePanel";

// Licence & registration self-entry (§A): a clinician records their own
// professional licence/registration (lands as pending verification for the
// organisation to confirm) and attaches supporting documents.

export type OwnCredential = {
  id: string; title: string; credential_type: string; issuing_body: string | null;
  credential_number: string | null; issue_date: string | null; expiry_date: string | null;
  status: string; verified: boolean; evidence: EvidenceItem[];
};

const TYPES = [
  { value: "professional_license", label: "Professional Licence" },
  { value: "registration",         label: "Council Registration" },
  { value: "certification",        label: "Certification" },
  { value: "degree",               label: "Degree / Diploma" },
];

const EMPTY = { credential_type: "professional_license", title: "", issuing_body: "", credential_number: "", issue_date: "", expiry_date: "" };

export default function CredentialManager({ credentials }: { credentials: OwnCredential[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch("/api/credentials", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        issue_date: form.issue_date || null,
        expiry_date: form.expiry_date || null,
      }),
    });
    if (res.ok) {
      setForm(EMPTY); setOpen(false);
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({}))).error ?? "Could not save the credential");
    }
    setBusy(false);
  }

  const input = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500";

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div>
          <h2 className="font-semibold text-gray-900 text-sm">My Licences &amp; Registrations</h2>
          <p className="text-[10px] text-gray-400">
            Record your professional licence or council registration — your organisation verifies it.
          </p>
        </div>
        <button onClick={() => setOpen(o => !o)}
          className="text-xs font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 px-3 py-1.5 rounded-lg transition-colors">
          {open ? "Cancel" : "＋ Add licence / registration"}
        </button>
      </div>

      {open && (
        <form onSubmit={submit} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-gray-50 pt-4">
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Type</label>
            <select value={form.credential_type} onChange={e => setForm({ ...form, credential_type: e.target.value })} className={input}>
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Title *</label>
            <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Registered Nurse Licence" className={input} />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Issuing Body</label>
            <input value={form.issuing_body} onChange={e => setForm({ ...form, issuing_body: e.target.value })}
              placeholder="e.g. Uganda Nurses & Midwives Council" className={input} />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Registration / Licence No.</label>
            <input value={form.credential_number} onChange={e => setForm({ ...form, credential_number: e.target.value })}
              placeholder="e.g. UNMC-12345" className={input} />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Issue Date</label>
            <input type="date" value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} className={input} />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Expiry Date</label>
            <input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} className={input} />
          </div>
          {error && <p className="sm:col-span-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy}
              className="bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
              {busy ? "Saving…" : "Submit for verification"}
            </button>
          </div>
        </form>
      )}

      {credentials.length > 0 && (
        <div className="mt-4 border-t border-gray-50 divide-y divide-gray-50">
          {credentials.map(c => (
            <div key={c.id} className="py-3 flex items-start gap-3">
              <span className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-base shrink-0">🪪</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800">{c.title}</p>
                <p className="text-[10px] text-gray-400" suppressHydrationWarning>
                  {[c.issuing_body, c.credential_number, c.expiry_date ? `expires ${new Date(c.expiry_date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : null]
                    .filter(Boolean).join(" · ") || TYPES.find(t => t.value === c.credential_type)?.label}
                </p>
                <EvidencePanel credentialId={c.id} initial={c.evidence} canAttach />
              </div>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                c.verified ? "bg-green-50 text-green-700"
                : c.status === "pending_verification" ? "bg-amber-50 text-amber-700"
                : "bg-gray-100 text-gray-500"
              }`}>
                {c.verified ? "Verified" : c.status === "pending_verification" ? "Awaiting verification" : c.status.replace(/_/g, " ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

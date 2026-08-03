"use client";

import { useState } from "react";
import Link from "next/link";

// CPR-004's registry console: search-first, ranked results with how-it-matched, rapid registration when
// nothing matches, and the duplicate interstitial when something nearly does. The 409-with-candidates
// from the API is rendered as the decision it is -- open the existing patient, or confirm a namesake --
// never retried silently and never treated as a failure toast.

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

const MATCH_LABEL: Record<string, string> = {
  name: "exact name", "name-partial": "name contains", phone: "phone", email: "email",
};

export default function RegistryConsole({ canCreate }: { canCreate: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<any[] | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [form, setForm] = useState({ displayName: "", sex: "unspecified", birthDate: "", ageEstimateYears: "", phone: "", email: "", nationalId: "" });
  const [showRegister, setShowRegister] = useState(false);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setNotice(null);
    const r = await fetch(`/api/v1/practice/patients?q=${encodeURIComponent(q.trim())}`);
    setResults(r.ok ? (await r.json()).results : []);
    setBusy(false);
  }

  async function register(confirmNew: boolean) {
    setBusy(true); setNotice(null); setCandidates(null);
    const res = await fetch("/api/v1/practice/patients", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: form.displayName,
        sex: form.sex,
        birthDate: form.birthDate || undefined,
        ageEstimateYears: form.ageEstimateYears ? Number(form.ageEstimateYears) : undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        identifiers: form.nationalId ? [{ type: "national_id", value: form.nationalId }] : undefined,
        confirmNew,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && Array.isArray(data.candidates) && data.candidates.length) {
      setCandidates(data.candidates.map((c: any) => ({ ...c, hardBlock: data?.error?.code === "DUPLICATE_IDENTIFIER" })));
      setBusy(false);
      return;
    }
    if (!res.ok) { setNotice({ kind: "err", text: data?.error?.message ?? "Registration failed." }); setBusy(false); return; }
    window.location.assign(`/practice/patients/${data.patient.id}`);
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold text-gray-900">Patients</h1>
      <p className="mt-1 text-[13px] text-gray-500">Search first. Register only when nothing matches (CPR-005 workflow).</p>

      <form onSubmit={search} className="mt-4 flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, phone, or any identifier (Practice ID, national ID, MRN)" className={input} />
        <button type="submit" disabled={busy || !q.trim()}
          className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50 shrink-0">
          Search
        </button>
      </form>

      {notice && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>{notice.text}</p>
      )}

      {results !== null && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">{results.length} match{results.length === 1 ? "" : "es"}</h2>
          {results.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">
              Nobody matches.{canCreate ? " Register them below." : ""}
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {results.map(r => (
                <li key={r.id}>
                  <Link href={`/practice/patients/${r.id}`}
                    className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 hover:border-[var(--cp-primary)] transition">
                    <span className="text-[13px] font-semibold text-gray-900">{r.displayName}</span>
                    {r.practiceId && <span className="font-mono text-[11px] text-gray-500">{r.practiceId}</span>}
                    {r.birthDate && <span className="text-[11px] text-gray-400">b. {r.birthDate}</span>}
                    <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                      {MATCH_LABEL[r.matchedBy] ?? r.matchedBy}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {canCreate && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <button type="button" onClick={() => setShowRegister(v => !v)} className="text-[13px] font-bold text-gray-900 w-full text-left">
            {showRegister ? "▾" : "▸"} Register a patient
          </button>
          {showRegister && (
            <form className="mt-3 grid sm:grid-cols-2 gap-2" onSubmit={e => { e.preventDefault(); register(false); }}>
              <input required placeholder="Full name *" value={form.displayName} onChange={e => setForm(p => ({ ...p, displayName: e.target.value }))} className={`${input} sm:col-span-2`} />
              <select value={form.sex} onChange={e => setForm(p => ({ ...p, sex: e.target.value }))} className={input}>
                {["unspecified", "female", "male", "other", "unknown"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input type="date" value={form.birthDate} onChange={e => setForm(p => ({ ...p, birthDate: e.target.value }))} className={input} title="Date of birth" />
              <input type="number" min={0} max={130} placeholder="…or estimated age" value={form.ageEstimateYears} onChange={e => setForm(p => ({ ...p, ageEstimateYears: e.target.value }))} className={input} />
              <input placeholder="Phone (primary contact) *" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} className={input} />
              <input placeholder="Email (optional)" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className={input} />
              <input placeholder="National ID (optional)" value={form.nationalId} onChange={e => setForm(p => ({ ...p, nationalId: e.target.value }))} className={input} />
              <p className="sm:col-span-2 text-[10px] text-gray-400">
                Minimum dataset per CPR-005: name, date of birth or estimated age, and one contact. A Practice ID is generated automatically.
              </p>
              <button type="submit" disabled={busy || !form.displayName.trim() || (!form.birthDate && !form.ageEstimateYears) || (!form.phone && !form.email)}
                className="sm:col-span-2 rounded-lg bg-[var(--cp-primary)] py-2 text-[13px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                {busy ? "Checking for duplicates…" : "Register"}
              </button>
            </form>
          )}

          {candidates && (
            <div className="mt-3 rounded-lg border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-3">
              <p className="text-[12px] font-bold text-[var(--cmp-text-warning)]">
                {candidates[0]?.hardBlock ? "That identifier already belongs to:" : "A very similar patient already exists:"}
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {candidates.map(c => (
                  <li key={c.id}>
                    <Link href={`/practice/patients/${c.id}`} className="text-[12px] font-semibold text-gray-800 hover:underline">
                      {c.displayName}{c.practiceId ? ` · ${c.practiceId}` : ""}{c.birthDate ? ` · b. ${c.birthDate}` : ""} ({c.matchedBy})
                    </Link>
                  </li>
                ))}
              </ul>
              {!candidates[0]?.hardBlock && (
                <button type="button" disabled={busy} onClick={() => register(true)}
                  className="mt-2 rounded-lg border border-[var(--cmp-color-warning)] px-3 py-1.5 text-[11px] font-semibold text-[var(--cmp-text-warning)] hover:bg-white/40">
                  This is a different person — register anyway
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

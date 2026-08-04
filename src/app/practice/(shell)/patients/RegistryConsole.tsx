"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import RegistrationForm from "./RegistrationForm";

// CPR-V2-004's registry console: search-first, ranked results with how-it-matched, rapid registration when
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
  // The duplicate interstitial moved into RegistrationForm with the form it belongs to.
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  // THE PRACTICE'S OWN FORM, fetched rather than assumed. A practice that published a registration
  // template gets its fields, its order and its extra questions; one that has not gets the built-in
  // form -- and "no template" is a legitimate answer, not an error.
  const [formConfig, setFormConfig] = useState<any | null>(null);
  useEffect(() => {
    if (!canCreate) return;
    fetch("/api/v1/practice/registration")
      .then(r => r.ok ? r.json() : null)
      .then(setFormConfig)
      .catch(() => setFormConfig(null));
  }, [canCreate]);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setNotice(null);
    const r = await fetch(`/api/v1/practice/patients?q=${encodeURIComponent(q.trim())}`);
    setResults(r.ok ? (await r.json()).results : []);
    setBusy(false);
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold text-gray-900">Patients</h1>
      <p className="mt-1 text-[13px] text-gray-500">Search first. Register only when nothing matches (CPR-V2-005 workflow).</p>

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
            formConfig
              ? <RegistrationForm
                  form={{ template: formConfig.template, fields: formConfig.fields ?? [] }}
                  majorityAge={formConfig.majorityAge ?? 18}
                  today={formConfig.today}
                  onRegistered={(r) => {
                    // THE INCOMPLETE STEPS ARE SHOWN, NOT SWALLOWED. A desk that believes it booked an
                    // appointment it did not book is the worst outcome of the three.
                    if (r.incomplete?.length) {
                      setNotice({ kind: "err", text: `Registered, but: ${r.incomplete.map((i: any) => i.reason).join("; ")}` });
                      setTimeout(() => window.location.assign(`/practice/patients/${r.patientId}`), 2500);
                      return;
                    }
                    window.location.assign(`/practice/patients/${r.patientId}`);
                  }}
                />
              : <p className="mt-3 text-[12px] text-gray-400">Loading this practice&rsquo;s form…</p>
          )}
        </section>
      )}
    </div>
  );
}

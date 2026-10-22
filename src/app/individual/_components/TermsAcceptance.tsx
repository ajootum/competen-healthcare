"use client";

import { useState } from "react";

// Owner ruling D2: the acceptance step shown before an experience is used. It lists exactly the documents
// and versions the server resolved and posts those same versions back, so the record is of what was shown.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

export type ShownDoc = { title: string; version: string; url: string | null };

export default function TermsAcceptance({ experience, accent, docs, foundation, experienceDocs }: {
  experience: string; accent: string; docs: ShownDoc[];
  foundation: { terms: string; privacy: string }; experienceDocs: { terms: string; privacy: string };
}) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/individual/terms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experience, foundation, experienceDocs }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Your acceptance could not be recorded."); return; }
      window.location.reload();
    } catch {
      setError("Your acceptance could not be recorded. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <ul className="space-y-2">
        {docs.map(d => (
          <li key={`${d.title}-${d.version}`} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[14px]">
            {d.url
              ? <a href={d.url} target="_blank" rel="noreferrer" className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: accent }}>{d.title}</a>
              : <span className="font-semibold text-gray-900">{d.title}</span>}
            <span className="ml-2 text-[12.5px] text-gray-500">version {d.version}</span>
          </li>
        ))}
      </ul>
      <label className="flex items-start gap-3 text-[14px] text-gray-800">
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0" style={{ accentColor: accent }} />
        <span>I have read and accept the documents listed above.</span>
      </label>
      {error && <p role="alert" className="text-[13.5px] font-medium text-red-700">{error}</p>}
      <button type="submit" disabled={!agreed || busy}
        className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 py-2.5 text-[14.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`}
        style={{ background: accent }}>
        {busy ? "Recording…" : "Accept and continue"}
      </button>
    </form>
  );
}

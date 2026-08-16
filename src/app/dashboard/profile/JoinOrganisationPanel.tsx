"use client";

import { useEffect, useState } from "react";

// COMP-IDENTITY-001 "Organization join request" -- the requester's side (migration 308).
//
// ⚠ SHOWN ONLY TO THE UN-HOMED. A person who already belongs to an organisation is not offered the
// form, because the single-home rule refuses their request anyway and a form that always refuses is
// the disabled-button trap this product has been caught by before. Their requests HISTORY still
// renders -- what happened to an ask is theirs to see forever.

type MyRequest = {
  id: string; status: string; note: string | null; decision_note: string | null;
  created_at: string; decided_at: string | null;
  organisations: { name: string } | null;
};

const STATUS_TONE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-800 border-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-800 border-emerald-200",
  REFUSED: "bg-rose-50 text-rose-800 border-rose-200",
  WITHDRAWN: "bg-gray-50 text-gray-600 border-gray-200",
};

export default function JoinOrganisationPanel({ homed }: { homed: boolean }) {
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [mine, setMine] = useState<MyRequest[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [orgId, setOrgId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/v1/identity/join-requests?scope=mine");
      const body = await res.json();
      if (!res.ok) { setUnavailable(body.error ?? "could not be read"); return; }
      setMine(body.requests?.items ?? []);
      if (body.requests?.unavailable) setUnavailable(body.requests.detail ?? "could not be read");
      setOrgs(body.organisations ?? []);
    } catch { setUnavailable("The request list could not be read just now. Reload to try again."); }
  }
  // Kicked from a callback, not the effect body -- the PracticeSessionGuard pattern the lint rule wants.
  useEffect(() => { const t = setTimeout(() => { void refresh(); }, 0); return () => clearTimeout(t); }, []);

  async function submit() {
    setBusy(true); setProblem(null); setSent(null);
    const res = await fetch("/api/v1/identity/join-requests", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", organisationId: orgId, note: note.trim() || null }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setProblem(body.error ?? "The request was not accepted."); return; }
    setSent("Your request has been sent. The organisation's administrators can see it now, and you will be notified when it is answered.");
    setNote(""); setOrgId("");
    await refresh();
  }

  async function withdraw(id: string) {
    setBusy(true); setProblem(null);
    const res = await fetch("/api/v1/identity/join-requests", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "withdraw", requestId: id }),
    });
    setBusy(false);
    if (!res.ok) { setProblem((await res.json()).error ?? "The withdrawal was not accepted."); return; }
    await refresh();
  }

  const hasHistory = (mine ?? []).length > 0;
  if (homed && !hasHistory && mine !== null) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <h2 className="text-[13px] font-bold text-gray-900">Organisation membership</h2>

      {unavailable && (
        <p className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-900">{unavailable}</p>
      )}

      {!homed && (
        <>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
            This account is not part of any organisation. If your hospital or organisation uses
            Competen, you can ask to join it &mdash; an administrator there decides, and you will be
            told either way.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="text-[11px] text-gray-600">Organisation</span>
              <select value={orgId} onChange={e => setOrgId(e.target.value)}
                className="mt-0.5 block w-64 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px]">
                <option value="">Choose&hellip;</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <label className="block flex-1 min-w-[16rem]">
              <span className="text-[11px] text-gray-600">A note for the administrator (optional)</span>
              <input type="text" value={note} maxLength={500} onChange={e => setNote(e.target.value)}
                placeholder="Who you are and why you are asking"
                className="mt-0.5 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px]" />
            </label>
            <button type="button" disabled={busy || !orgId} onClick={submit}
              className="rounded-lg bg-[var(--cmp-color-information)] px-3.5 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40">
              {busy ? "Sending…" : "Ask to join"}
            </button>
          </div>
        </>
      )}

      {problem && <p className="mt-2 text-[12px] text-rose-700">{problem}</p>}
      {sent && <p className="mt-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[12px] text-emerald-900">{sent}</p>}

      {hasHistory && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {(mine ?? []).map(r => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
              <span className="text-[12.5px] font-semibold text-gray-900">{r.organisations?.name ?? "Organisation"}</span>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONE[r.status] ?? STATUS_TONE.WITHDRAWN}`}>{r.status.toLowerCase()}</span>
              <span className="text-[11px] text-gray-500">{new Date(r.created_at).toLocaleDateString()}</span>
              {/* The words that came back. A refusal without its reason shown would make the note rule pointless. */}
              {r.decision_note && <span className="w-full text-[11.5px] text-gray-600">&ldquo;{r.decision_note}&rdquo;</span>}
              {r.status === "PENDING" && (
                <button type="button" disabled={busy} onClick={() => withdraw(r.id)}
                  className="ml-auto rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
                  Withdraw
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

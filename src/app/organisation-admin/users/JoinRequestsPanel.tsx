"use client";

import { useEffect, useState } from "react";
import { ORG_ROLE_CONFIG, type OrgRole } from "@/lib/roles";

// The approver's inbox for organisation join requests (COMP-IDENTITY-001, migration 308).
//
// ⚠ APPROVAL GRANTS, SO THE FORM SAYS WHAT WILL BE GRANTED. The org-role picker is the same
// vocabulary the role editor uses, and the derivation behind the grant is the same function
// (profileUpdateForOrgRoles) -- what this panel promises is exactly what the profile receives.
// A refusal requires words, because the requester reads them with nothing else to go on.

type Req = {
  id: string; user_id: string; note: string | null; created_at: string;
  hospital_id: string | null;
  profiles: { full_name: string | null; email: string | null } | null;
};

export default function JoinRequestsPanel() {
  const [items, setItems] = useState<Req[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [refusing, setRefusing] = useState(false);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/v1/identity/join-requests?scope=org&status=PENDING");
      const body = await res.json();
      if (!res.ok) { setUnavailable(body.error ?? "could not be read"); return; }
      setItems(body.requests?.items ?? []);
      if (body.requests?.unavailable) setUnavailable(body.requests.detail ?? "could not be read");
    } catch { setUnavailable("The inbox could not be read just now. Reload to try again."); }
  }
  // Kicked from a callback, not the effect body -- the PracticeSessionGuard pattern the lint rule wants.
  useEffect(() => { const t = setTimeout(() => { void refresh(); }, 0); return () => clearTimeout(t); }, []);

  async function decide(requestId: string, approve: boolean) {
    setBusy(true); setProblem(null);
    const res = await fetch("/api/v1/identity/join-requests", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "decide", requestId, approve,
        orgRoles: approve ? roles : [],
        decisionNote: noteText.trim() || null,
      }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setProblem(body.error ?? "The decision was not accepted."); return; }
    setOpen(null); setRoles([]); setNoteText(""); setRefusing(false);
    await refresh();
  }

  // An empty inbox renders nothing at all -- this panel earns its space only when there is work.
  if (unavailable === null && (items === null || items.length === 0)) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <h2 className="text-[13px] font-bold text-gray-900">Join requests</h2>
      <p className="mt-0.5 text-[11.5px] text-gray-500">
        People asking to join this organisation. Approving grants the roles you choose here, through
        the same rules as the role editor.
      </p>

      {unavailable && (
        <p className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-900">{unavailable}</p>
      )}

      <ul className="mt-2 flex flex-col gap-2">
        {(items ?? []).map(r => (
          <li key={r.id} className="rounded-xl border border-gray-100 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-gray-900">{r.profiles?.full_name ?? "Unnamed account"}</span>
              <span className="text-[11.5px] text-gray-500">{r.profiles?.email}</span>
              <span className="text-[11px] text-gray-400">{new Date(r.created_at).toLocaleDateString()}</span>
              <button type="button" onClick={() => { setOpen(open === r.id ? null : r.id); setRoles([]); setNoteText(""); setRefusing(false); setProblem(null); }}
                className="ml-auto rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
                {open === r.id ? "Close" : "Answer"}
              </button>
            </div>
            {r.note && <p className="mt-1 text-[12px] text-gray-600">&ldquo;{r.note}&rdquo;</p>}

            {open === r.id && (
              <div className="mt-2 rounded-lg bg-gray-50 p-3">
                {!refusing ? (
                  <>
                    <p className="text-[11px] font-semibold text-gray-600">Approve with these organisation roles:</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(Object.keys(ORG_ROLE_CONFIG) as OrgRole[]).map(code => (
                        <label key={code} className={`flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[11.5px] ${roles.includes(code) ? "border-teal-400 bg-teal-50 text-teal-900" : "border-gray-200 bg-white text-gray-700"}`}>
                          <input type="checkbox" className="accent-teal-600" checked={roles.includes(code)}
                            onChange={e => setRoles(p => e.target.checked ? [...p, code] : p.filter(x => x !== code))} />
                          {ORG_ROLE_CONFIG[code].label}
                        </label>
                      ))}
                    </div>
                    <input type="text" value={noteText} maxLength={500} onChange={e => setNoteText(e.target.value)}
                      placeholder="A note back to them (optional on approval)"
                      className="mt-2 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12.5px]" />
                    <div className="mt-2 flex items-center gap-2">
                      <button type="button" disabled={busy || roles.length === 0} onClick={() => decide(r.id, true)}
                        className="rounded-lg bg-teal-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
                        {busy ? "Granting…" : "Approve and grant"}
                      </button>
                      <button type="button" disabled={busy} onClick={() => setRefusing(true)}
                        className="rounded-lg border border-rose-200 px-3 py-1.5 text-[12px] font-semibold text-rose-700 hover:bg-rose-50">
                        Refuse instead…
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] font-semibold text-gray-600">
                      Refusing. Say why &mdash; the requester reads this with nothing else to go on.
                    </p>
                    <input type="text" value={noteText} maxLength={500} onChange={e => setNoteText(e.target.value)}
                      placeholder="Why this request is being refused" autoFocus
                      className="mt-1.5 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12.5px]" />
                    <div className="mt-2 flex items-center gap-2">
                      <button type="button" disabled={busy || noteText.trim() === ""} onClick={() => decide(r.id, false)}
                        className="rounded-lg bg-rose-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
                        {busy ? "Refusing…" : "Refuse with this reason"}
                      </button>
                      <button type="button" disabled={busy} onClick={() => setRefusing(false)}
                        className="text-[11.5px] text-gray-500 hover:underline">Back</button>
                    </div>
                  </>
                )}
                {problem && <p className="mt-2 text-[12px] text-rose-700">{problem}</p>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

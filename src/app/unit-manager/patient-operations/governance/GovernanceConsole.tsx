"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { templateByKey } from "@/lib/operations/pos-form-templates";

// Unit Manager Governance actions (POS-106A §10.2). Decide exceptions and amendment requests over
// the shared POS-106 objects. Approving an amendment creates a new linked version (original preserved);
// segregation of duties is enforced server-side. Returning a deficient form uses the form-engine API.
/* eslint-disable @typescript-eslint/no-explicit-any */

const tname = (k: string) => templateByKey(k)?.name ?? k;
const RISK_TONE: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-orange-50 text-orange-700", moderate: "bg-amber-50 text-amber-700", low: "bg-gray-100 text-gray-600" };

export default function GovernanceConsole({ exceptions, amendments, returned }: { exceptions: any[]; amendments: any[]; returned: any[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 4500); };

  async function call(url: string, body: any, ok: string) {
    setBusy(true);
    const r = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { toast("ok", ok); router.refresh(); }
    else { const d = await r.json().catch(() => ({})); toast("err", d?.error || "Failed"); }
  }
  const decideException = (id: string, decision: "approve" | "reject" | "revoke") => {
    let decision_reason: string | null = null;
    if (decision !== "approve") { decision_reason = window.prompt(`Reason to ${decision} this exception:`); if (!decision_reason) return; }
    call(`/api/operations/pos-governance?id=${id}`, { action: "decide_exception", decision, decision_reason }, `Exception ${decision}d`);
  };
  const decideAmendment = (id: string, decision: "approve" | "reject") => {
    let decision_reason: string | null = null;
    if (decision === "reject") { decision_reason = window.prompt("Reason to reject this amendment:"); if (!decision_reason) return; }
    else if (!window.confirm("Approve this amendment? A new linked version is created; the original is preserved.")) return;
    call(`/api/operations/pos-governance?id=${id}`, { action: "decide_amendment", decision, decision_reason }, decision === "approve" ? "Amendment approved — new version created" : "Amendment rejected");
  };
  return (
    <>
      {msg && <div className={`fixed bottom-4 right-4 z-50 text-sm rounded-lg px-4 py-2.5 shadow-lg ${msg.kind === "ok" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{msg.text}</div>}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Exception queue */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3">Exception approvals <span className="text-[10px] font-normal text-gray-400">§13.1</span></h3>
          {exceptions.length === 0 ? <p className="text-sm text-gray-400">No exceptions awaiting decision.</p> : (
            <div className="space-y-2">
              {exceptions.map(e => (
                <div key={e.id} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="text-sm font-medium text-gray-800">{e.exception_type} <span className="text-gray-400 font-normal">· {e.op_patients?.label ?? "unit"}</span></p><p className="text-[11px] text-gray-500 mt-0.5">{e.reason_category}: {e.reason}</p><p className="text-[10px] text-gray-400 mt-0.5">by {e.requester?.full_name ?? "—"}</p></div>
                    {e.risk_level && <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${RISK_TONE[e.risk_level] ?? "bg-gray-100 text-gray-600"}`}>{e.risk_level}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button disabled={busy} onClick={() => decideException(e.id, "approve")} className="text-[11px] font-medium text-white bg-emerald-600 rounded px-2 py-1 hover:bg-emerald-700 disabled:opacity-50">Approve</button>
                    <button disabled={busy} onClick={() => decideException(e.id, "reject")} className="text-[11px] font-medium text-rose-700 hover:underline disabled:opacity-50">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Amendment queue */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3">Amendment requests <span className="text-[10px] font-normal text-gray-400">§13.2</span></h3>
          {amendments.length === 0 ? <p className="text-sm text-gray-400">No amendment requests.</p> : (
            <div className="space-y-2">
              {amendments.map(a => (
                <div key={a.id} className="rounded-lg border border-gray-100 p-3">
                  <div className="min-w-0"><p className="text-sm font-medium text-gray-800">{tname(a.form?.template_key ?? "")} <span className="text-gray-400 font-normal">· {a.op_patients?.label ?? "—"}</span></p><p className="text-[11px] text-gray-500 mt-0.5">{a.reason}</p><p className="text-[10px] text-gray-400 mt-0.5">by {a.requester?.full_name ?? "—"}</p></div>
                  <div className="flex items-center gap-2 mt-2">
                    <button disabled={busy} onClick={() => decideAmendment(a.id, "approve")} className="text-[11px] font-medium text-white bg-emerald-600 rounded px-2 py-1 hover:bg-emerald-700 disabled:opacity-50">Approve &amp; version</button>
                    <button disabled={busy} onClick={() => decideAmendment(a.id, "reject")} className="text-[11px] font-medium text-rose-700 hover:underline disabled:opacity-50">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Returned / deficient forms */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Deficient forms <span className="text-[10px] font-normal text-gray-400">returned / to review</span></h3>
        {returned.length === 0 ? <p className="text-sm text-gray-400">No returned forms.</p> : (
          <div className="divide-y divide-gray-50">
            {returned.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                <span className="min-w-0"><span className="text-gray-700">{r.patient}</span> <span className="text-gray-400">{tname(r.template_key)} · {r.by}</span></span>
                <span className="text-amber-700">returned</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Awaiting-verification governance action = return to author */}
      <p className="text-[11px] text-gray-400">Governance operates on the shared POS-106 objects — approving an amendment creates a new linked version; the original event is never overwritten (§1). Operational data entry is performed in the <Link href="/supervisor/patient-operations/operations-centre" className="text-emerald-700 hover:underline">Shift Supervisor Operations Centre</Link>.</p>
    </>
  );
}

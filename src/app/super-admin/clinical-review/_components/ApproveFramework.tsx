"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useModalFocus } from "@/components/ui/use-modal-focus";

// Framework-level approval for a clinical reviewer (owner, 29 Oct 2026). Every competency listed is approved with its
// OWN decision on its OWN exact version, re-checked against the reviewer's queue by the server at decision time
// (src/lib/competency/review-decide-batch.ts). Untick anything that needs changes and decide it on its own, below.

export type ApproveItem = { versionId: string; competencyId: string; title: string; domain: string; version: string; criteria: number; checks: string[] };
type Result = { versionId: string; title: string; outcome: "approved" | "not_waiting" | "failed" | "not_reached"; reason: string };

const btn = "inline-flex items-center justify-center rounded-lg px-4 py-2 text-[13.5px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const LABEL: Record<Result["outcome"], [string, string]> = {
  approved: ["Approved", "bg-green-50 text-green-900"], not_waiting: ["Not recorded", "bg-gray-100 text-gray-800"],
  failed: ["Failed", "bg-red-50 text-red-900"], not_reached: ["Not reached", "bg-gray-100 text-gray-800"],
};

export function ApproveFramework({ framework, items }: { framework: string; items: ApproveItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={primary} onClick={() => setOpen(true)}>Approve framework ({items.length})</button>
      {open && <Dialog framework={framework} items={items} onClose={() => setOpen(false)} />}
    </>
  );
}

function Dialog({ framework, items, onClose }: { framework: string; items: ApproveItem[]; onClose: () => void }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.map(i => i.versionId)));
  const [ack, setAck] = useState(false);
  const [comment, setComment] = useState("");
  const [stage, setStage] = useState<"choose" | "running" | "done">("choose");
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(true, panel, () => { if (stage !== "running") onClose(); });
  const flagged = items.filter(i => i.checks.length).length;

  async function approve() {
    setStage("running"); setError(null);
    let pending = items.filter(i => picked.has(i.versionId)).map(i => ({ versionId: i.versionId, competencyId: i.competencyId }));
    const all: Result[] = [];
    for (let pass = 0; pending.length && pass < 20; pass++) {
      const r = await fetch("/api/hq/clinical-review", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve_many", items: pending, acknowledged: true, comment: comment || null }) }).then(async x => ({ ok: x.ok, json: await x.json().catch(() => ({})) })).catch(() => ({ ok: false, json: {} as any }));
      if (!r.ok) { setError(r.json?.error ?? "The decisions could not be recorded just now. Nothing more was recorded."); break; }
      const got: Result[] = r.json.results ?? [];
      all.push(...got.filter(g => g.outcome !== "not_reached"));
      pending = got.filter(g => g.outcome === "not_reached").map(g => pending.find(p => p.versionId === g.versionId)!).filter(Boolean);
    }
    setResults(all); setStage("done"); router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-teal-950/40 p-4">
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="af-title" tabIndex={-1} className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4">
          <h2 id="af-title" className="text-[18px] font-bold text-gray-900">{stage === "done" ? "Decisions recorded" : `Approve ${framework}`}</h2>
          <button type="button" aria-label="Close" className={ghost} disabled={stage === "running"} onClick={onClose}>×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-[13px]">
          {stage !== "done" ? (
            <>
              <p className="text-gray-700">{items.length} competencies are waiting for you in this framework{flagged ? `, ${flagged} with points worth checking` : ""}. Each ticked competency gets its own approval at the exact version shown. Untick anything that needs changes, and ask for changes on it individually.</p>
              <table className="mt-3 w-full text-left">
                <thead><tr className="border-b border-gray-200 text-[12px] text-gray-500"><th className="py-2 pr-2"><span className="sr-only">Approve</span></th><th className="py-2 font-semibold">Competency</th><th className="py-2 font-semibold">Version · criteria</th></tr></thead>
                <tbody>
                  {items.map(i => (
                    <tr key={i.versionId} className="border-b border-gray-100 align-top">
                      <td className="py-2 pr-2"><input type="checkbox" aria-label={`Approve ${i.title}`} checked={picked.has(i.versionId)} disabled={stage === "running"}
                        onChange={() => setPicked(s => { const n = new Set(s); if (n.has(i.versionId)) n.delete(i.versionId); else n.add(i.versionId); return n; })} /></td>
                      <td className="py-2"><span className="text-gray-900">{i.title}</span><span className="block text-[12px] text-gray-500">{i.domain}</span>
                        {i.checks.length > 0 && <span className="mt-1 block text-[12px] text-amber-900">Worth checking: {i.checks.join(" ")}</span>}</td>
                      <td className="py-2 font-mono text-[12px] text-gray-600">{i.version} · {i.criteria}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <label className="mt-3 block text-[12.5px] font-semibold text-gray-700" htmlFor="af-note">Note recorded with each approval (optional)</label>
              <textarea id="af-note" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" rows={2} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} disabled={stage === "running"} />
              <label className="mt-3 flex items-start gap-2 text-gray-800">
                <input type="checkbox" className="mt-0.5" checked={ack} onChange={e => setAck(e.target.checked)} disabled={stage === "running"} />
                I have reviewed each ticked competency, including every criterion, at the version shown. I did not write, edit or put forward this content.
              </label>
              {error && <p role="alert" className="mt-2 text-[var(--cmp-text-critical)]">{error}</p>}
            </>
          ) : (
            <>
              <p className="text-gray-700">{results.filter(r => r.outcome === "approved").length} approved · {results.filter(r => r.outcome !== "approved").length} not recorded. Each approval is a separate decision on its exact version. Publication is a separate, independent step.</p>
              <ul className="mt-3 divide-y divide-gray-100">
                {results.map(r => <li key={r.versionId} className="py-2"><span className="text-gray-900">{r.title}</span> <span className={`ml-2 rounded-md px-2 py-0.5 text-[12px] font-semibold ${LABEL[r.outcome][1]}`}>{LABEL[r.outcome][0]}</span>{r.outcome !== "approved" && <span className="block text-[12px] text-gray-600">{r.reason}</span>}</li>)}
              </ul>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
          {stage === "done" ? <button type="button" className={primary} onClick={onClose}>Done</button> : (
            <>
              <button type="button" className={ghost} disabled={stage === "running"} onClick={onClose}>Cancel</button>
              <button type="button" className={primary} disabled={stage === "running" || !ack || picked.size === 0} onClick={() => void approve()}>{stage === "running" ? "Recording…" : `Approve ${picked.size}`}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

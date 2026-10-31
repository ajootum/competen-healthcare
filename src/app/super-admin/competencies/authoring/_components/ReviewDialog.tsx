"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { useRouter } from "next/navigation";

// CFCA-STUDIO-UX-02: put a whole framework, a domain or chosen competencies forward for independent clinical review.
// Preview (eligibility and exact versions) -> acknowledge -> submit (each item its own request, re-checked by the
// server at its boundary, continued across passes until every item is reached) -> outcome -> retry what failed or
// went stale. Nothing here approves or publishes. The server (/api/hq/competency/authoring, review_* actions) decides.

type Scope = { kind: "framework" } | { kind: "domain"; domainId: string } | { kind: "competencies"; ids: string[] };
type Item = { competencyId: string; code: string | null; name: string; domain?: string; hash: string | null; eligibility: string; reason: string; checks?: string[] };
type Preview = { scopeLabel: string; items: Item[]; counts: { inScope: number; eligible: number; excluded: number; withChecks?: number } };
type Result = { competencyId: string; code: string | null; name: string; outcome: "submitted" | "skipped" | "excluded" | "stale" | "failed" | "not_reached"; reason: string; versionId?: string };

const btn = "inline-flex items-center justify-center rounded-lg px-4 py-2 text-[13.5px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const TONE: Record<string, string> = {
  eligible: "bg-green-50 text-green-900", submitted: "bg-green-50 text-green-900",
  in_review: "bg-blue-50 text-blue-900", skipped: "bg-gray-100 text-gray-800", approved: "bg-violet-50 text-violet-900",
  changes_requested: "bg-amber-50 text-amber-900", excluded: "bg-amber-50 text-amber-900", framework_locked: "bg-gray-100 text-gray-800",
  stale: "bg-amber-50 text-amber-900", failed: "bg-red-50 text-red-900", unreadable: "bg-red-50 text-red-900", not_reached: "bg-gray-100 text-gray-800",
};
const LABEL: Record<string, string> = {
  eligible: "Eligible", in_review: "In review", approved: "Reviewed", changes_requested: "Needs revision", framework_locked: "Locked", unreadable: "Unreadable",
  submitted: "Submitted", skipped: "Skipped", excluded: "Excluded", stale: "Changed since preview", failed: "Failed", not_reached: "Not reached",
};
const Badge = ({ k }: { k: string }) => <span className={`inline-block rounded-md px-2 py-0.5 text-[12px] font-semibold ${TONE[k] ?? "bg-gray-100"}`}>{LABEL[k] ?? k}</span>;

async function post(body: unknown): Promise<{ ok: boolean; json: any }> {
  const r = await fetch("/api/hq/competency/authoring", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, json: await r.json().catch(() => ({})) };
}

/** `revision`: put forward the PROPOSED content of the open revision draft of a published framework (S6), not the published content. */
export function ReviewButton({ frameworkId, scope, label, className, disabled, revision = false }: { frameworkId: string; scope: Scope; label: string; className?: string; disabled?: boolean; revision?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className ?? primary} disabled={disabled} onClick={() => setOpen(true)}>{label}</button>
      {open && <ReviewDialog frameworkId={frameworkId} scope={scope} revision={revision} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReviewDialog({ frameworkId, scope, revision, onClose }: { frameworkId: string; scope: Scope; revision: boolean; onClose: () => void }) {
  const rv = revision ? { revision: true } : {};
  const router = useRouter();
  const [stage, setStage] = useState<"loading" | "preview" | "running" | "done" | "error">("loading");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  async function load(s: Scope) {
    setStage("loading"); setError(null); setAck(false);
    const r = await post({ action: "review_preview", frameworkId, scope: s, ...rv }).catch(() => ({ ok: false, json: {} }));
    if (!r.ok) { setError(r.json?.error ?? "The preview could not be prepared just now."); setStage("error"); return; }
    setPreview(r.json); setStage("preview");
  }
  // The first preview, once, when the dialog opens (state is set when the answer arrives, never synchronously here).
  useEffect(() => {
    let live = true;
    post({ action: "review_preview", frameworkId, scope, ...rv }).catch(() => ({ ok: false, json: {} as any })).then(r => {
      if (!live) return;
      if (!r.ok) { setError(r.json?.error ?? "The preview could not be prepared just now."); setStage("error"); return; }
      setPreview(r.json); setStage("preview");
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(true, panel, () => { if (stage !== "running") onClose(); });

  async function submit() {
    if (!preview) return;
    const queue = preview.items.filter(i => i.eligibility === "eligible").map(i => ({ competencyId: i.competencyId, hash: i.hash }));
    setStage("running"); setProgress({ done: 0, total: queue.length });
    const all: Result[] = [...preview.items.filter(i => i.eligibility !== "eligible").map(i => ({
      competencyId: i.competencyId, code: i.code, name: i.name, outcome: (i.eligibility === "in_review" || i.eligibility === "approved" ? "skipped" : "excluded") as Result["outcome"], reason: i.reason,
    }))];
    let pending = queue;
    // Continue across passes: the server pauses before its time limit and returns what it did not reach.
    for (let pass = 0; pending.length && pass < 20; pass++) {
      const r = await post({ action: "review_submit", frameworkId, items: pending, ...rv }).catch(() => ({ ok: false, json: {} }));
      if (!r.ok) {
        for (const p of pending) { const i = preview.items.find(x => x.competencyId === p.competencyId)!; all.push({ competencyId: i.competencyId, code: i.code, name: i.name, outcome: "failed", reason: r.json?.error ?? "The request failed. Retry to try again." }); }
        break;
      }
      const got: Result[] = r.json.results ?? [];
      all.push(...got.filter(g => g.outcome !== "not_reached"));
      pending = got.filter(g => g.outcome === "not_reached").map(g => pending.find(p => p.competencyId === g.competencyId)!).filter(Boolean);
      setProgress({ done: queue.length - pending.length, total: queue.length });
    }
    setResults(all); setStage("done"); router.refresh();
  }

  const retryable = results.filter(r => r.outcome === "failed" || r.outcome === "stale");
  const count = (o: Result["outcome"]) => results.filter(r => r.outcome === o).length;
  function download() {
    const blob = new Blob([JSON.stringify({ frameworkId, scope: preview?.scopeLabel, at: new Date().toISOString(), results }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `clinical-review-submission-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`; a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-teal-950/40 p-4">
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="rv-title" tabIndex={-1} className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4">
          <h2 id="rv-title" className="text-[18px] font-bold text-gray-900">{stage === "done" ? "Submission complete" : stage === "running" ? "Putting content forward" : revision ? "Preview clinical review submission (revision draft)" : "Preview clinical review submission"}</h2>
          <button type="button" aria-label="Close" className={ghost} disabled={stage === "running"} onClick={onClose}>×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {stage === "loading" && <p className="text-[13.5px] text-gray-600">Checking eligibility and exact content versions…</p>}
          {stage === "error" && <p role="alert" className="text-[13.5px] text-[var(--cmp-text-critical)]">{error}</p>}
          {stage === "preview" && preview && (
            <>
              <p className="text-[13px] text-gray-600">{preview.scopeLabel} · {preview.counts.inScope} competenc{preview.counts.inScope === 1 ? "y" : "ies"} in scope</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {[[preview.counts.eligible, "Eligible to submit"], [preview.counts.excluded, "Not put forward, with reasons"], [0, "Will be approved"]].map(([n, l]) => (
                  <div key={String(l)} className="rounded-xl border border-gray-200 p-4"><p className="text-[26px] font-bold text-gray-900">{n}</p><p className="text-[12.5px] text-gray-600">{l}</p></div>
                ))}
              </div>
              <p className="mt-3 rounded-lg border border-teal-100 bg-teal-50/60 px-3 py-2 text-[12.5px] text-teal-950">
                Each eligible competency gets its own request for its exact content version. Content already in review is skipped. Independent review and publication stay separate: nothing is approved or published here.{revision ? " This is the proposed content of the revision draft: learners and assessors keep the published version." : ""}
              </p>
              {(preview.counts.withChecks ?? 0) > 0 && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">Outstanding points: {preview.counts.withChecks} competenc{preview.counts.withChecks === 1 ? "y has" : "ies have"} points worth checking before review, listed below. They do not block submission; the reviewer sees them too.</p>}
              <ItemTable rows={preview.items.map(i => ({ id: i.competencyId, code: i.code, name: i.name, badge: i.eligibility, reason: [i.eligibility === "eligible" ? "" : i.reason, i.checks?.length ? `Worth checking: ${i.checks.join(" ")}` : ""].filter(Boolean).join(" ") }))} head="Eligibility" />
              {preview.counts.eligible > 0 && (
                <label className="mt-3 flex items-start gap-2 text-[13px] text-gray-800">
                  <input type="checkbox" className="mt-0.5" checked={ack} onChange={e => setAck(e.target.checked)} />
                  I am putting these exact versions forward for independent clinical review. I cannot review content I wrote, edited or put forward.
                </label>
              )}
            </>
          )}
          {stage === "running" && (
            <div>
              <p className="text-[13.5px] text-gray-700">{progress.done} of {progress.total} processed. Keep this window open.</p>
              <div className="mt-2 h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-teal-700 transition-all" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} /></div>
            </div>
          )}
          {stage === "done" && (
            <>
              <p className="text-[13.5px] text-gray-700">{count("submitted")} submitted · {count("skipped") + count("excluded")} not put forward · {retryable.length} need attention</p>
              <p className="mt-2 rounded-lg border border-teal-100 bg-teal-50/60 px-3 py-2 text-[12.5px] text-teal-950">No competency was approved or published. Submitted items now show &ldquo;In clinical review&rdquo;.</p>
              <ItemTable rows={[...results].sort((a, b) => ord(a.outcome) - ord(b.outcome)).map(r => ({ id: r.competencyId, code: r.code, name: r.name, badge: r.outcome, reason: r.reason }))} head="Outcome" />
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-6 py-4">
          {stage === "done" ? (
            <>
              <button type="button" className={ghost} onClick={download}>Download outcome report</button>
              <span className="flex gap-2">
                {retryable.length > 0 && <button type="button" className={ghost} onClick={() => void load({ kind: "competencies", ids: retryable.map(r => r.competencyId) })}>Preview retry ({retryable.length})</button>}
                <button type="button" className={primary} onClick={onClose}>Done</button>
              </span>
            </>
          ) : (
            <>
              <button type="button" className={ghost} disabled={stage === "running"} onClick={onClose}>Cancel</button>
              <button type="button" className={primary} disabled={stage !== "preview" || !ack || !preview?.counts.eligible} onClick={() => void submit()}>
                Submit {preview?.counts.eligible ?? 0} eligible
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const ord = (o: string) => ["failed", "stale", "excluded", "skipped", "not_reached", "submitted"].indexOf(o);

function ItemTable({ rows, head }: { rows: { id: string; code: string | null; name: string; badge: string; reason: string }[]; head: string }) {
  return (
    <table className="mt-3 w-full text-left text-[13px]">
      <thead><tr className="border-b border-gray-200 text-[12px] text-gray-500"><th className="py-2 pr-3 font-semibold">Competency</th><th className="py-2 font-semibold">{head}</th></tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} className="border-b border-gray-100 align-top">
            <td className="py-2.5 pr-3"><span className="text-gray-900">{r.name}</span><span className="block font-mono text-[11.5px] text-gray-500">{r.code ?? "no code"}</span></td>
            <td className="py-2.5"><Badge k={r.badge} />{r.reason && <span className="mt-1 block text-[12.5px] text-gray-600">{r.reason}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

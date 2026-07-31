import { loadCmoReview } from "@/lib/competency/cmo-governance";
import { cmoGuard, Head, Card, Kpi, Bars, Pill, Provision, Foot } from "../_cmo-ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

// COMP-011 Review & Approval Centre — multi-stage governance review of competencies submitted from
// Competency Studio (technical → clinical → governance → approval), over the real approval engine.
/* eslint-disable @typescript-eslint/no-explicit-any */
const fmt = (t: string | null) => { if (!t) return "—"; try { return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); } catch { return "—"; } };
const FUNCTIONS = [
  ["🔍", "Review metadata", "Inspect competency definition, requirements & evidence rules"],
  ["🔀", "Compare versions", "Diff the submitted version against the current published one"],
  ["↩️", "Request revisions", "Return to Competency Studio for edits (Office never edits definitions)"],
  ["✅", "Approve / reject", "Authorised approvers record a governed decision"],
  ["👥", "Assign reviewers", "Route to technical, clinical and governance reviewers"],
  ["⏱️", "Track SLA & due dates", "Monitor turnaround and escalate breaches"],
];

export default async function ReviewApprovalPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadCmoReview(admin, hid, isSuper);
  const head = <Head code="COMP-011 · Competency Office" title="Review & Approval Centre" sub="Multi-stage governance review of competencies submitted from Competency Studio — technical, clinical and governance review through to approval." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="the Review & Approval Centre" /></div>;
  const k = d.kpis;

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Pending reviews" value={k.pending} sub="in the queue" tone={k.pending ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Kpi label="Technical review" value={k.technical} />
        <Kpi label="Clinical review" value={k.clinical} />
        <Kpi label="Governance review" value={k.governance} />
        <Kpi label="Approval pending" value={k.approval} sub="final sign-off" tone={k.approval ? "text-violet-600" : undefined} />
        <Kpi label="Overdue (>14d)" value={k.overdue} sub={k.avgAge != null ? `avg ${k.avgAge}d` : "SLA"} tone={k.overdue ? "text-[var(--cmp-text-error)]" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Submission & review queue" className="xl:col-span-2" right={<Link href="/competency-office/publishing" className="text-[11px] text-teal-600 hover:underline">Publication pipeline →</Link>}>
          {d.queue.length ? <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Competency</span><span className="w-32">Stage</span><span className="w-16 text-center">Step</span><span className="w-16 text-right">Age</span></div>
            {d.queue.map((r: any, i: number) => (
              <div key={i} className="flex items-center px-1 py-1.5 text-[12px] border-b border-gray-50"><span className="flex-1 text-gray-800 truncate">{r.entity}</span><span className="w-32"><Pill text={r.stage} tone={r.stage === "Approval" ? "violet" : r.stage.startsWith("Technical") ? "blue" : r.stage.startsWith("Clinical") ? "teal" : "amber"} /></span><span className="w-16 text-center text-gray-500 tabular-nums">{r.step ?? "—"}/{r.total ?? "—"}</span><span className={`w-16 text-right tabular-nums ${r.overdue ? "text-[var(--cmp-text-error)] font-semibold" : "text-gray-400"}`}>{r.age}d</span></div>
            ))}
          </div> : <div className="py-8 text-center"><p className="text-sm text-gray-400">No competencies awaiting review.</p><p className="text-[10px] text-gray-400 mt-1">The multi-stage queue populates from <code>plat_approval_requests</code> as Competency Studio submits competencies for governance.</p></div>}
        </Card>

        <Card title="Review stage breakdown">
          <Bars rows={d.stageBreak.map((s: any) => ({ label: s.label, n: s.value }))} colors={["#3b82f6", "#14b8a6", "#f59e0b", "#a855f7"]} />
          <p className="text-[10px] text-gray-400 mt-2">Pending items by governance stage. Each competency flows technical → clinical → governance → approval before publication.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Recent approval decisions" right={<span className="text-[11px] text-gray-400">{k.decided30} in 30 days</span>}>
          {d.recentDecisions.length ? <div className="space-y-2">{d.recentDecisions.map((x: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[12px] border-b border-gray-50 pb-1.5"><Pill text={x.decision} tone={x.decision === "approved" ? "emerald" : "rose"} /><div className="min-w-0 flex-1"><p className="text-gray-700 truncate">{x.note ?? `Step ${x.step} decision`}</p><p className="text-[10px] text-gray-400">{x.actor ?? "—"}</p></div><span className="text-gray-400 tabular-nums shrink-0">{fmt(x.when)}</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No approval decisions recorded in the last 30 days.</p>}
        </Card>

        <Card title="Revision & change requests" right={<span className="text-[11px] text-gray-400">{d.openChanges} open</span>}>
          {d.changeReviews.length ? <div className="space-y-2">{d.changeReviews.map((c: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[12px] border-b border-gray-50 pb-1.5"><div className="min-w-0 flex-1"><p className="text-gray-800 truncate">{c.entity}</p><p className="text-[10px] text-gray-400">{c.by ?? "—"} · {fmt(c.when)}</p></div><Pill text={c.kind} tone={c.kind === "major" ? "rose" : c.kind === "revision" ? "amber" : "blue"} /><Pill text={c.status} tone={c.status === "approved" || c.status === "implemented" ? "emerald" : c.status === "rejected" ? "rose" : "amber"} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No competency revision requests.</p>}
        </Card>
      </div>

      <Card title="Review functions" right={<span className="text-[11px] text-gray-400">governed workflow</span>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {FUNCTIONS.map(([icon, label, desc], i) => (
            <div key={i} className="flex items-start gap-2.5 border border-gray-100 rounded-xl p-3"><span className="text-lg shrink-0">{icon}</span><span className="min-w-0"><span className="block text-[12.5px] font-medium text-gray-800 leading-tight">{label}</span><span className="block text-[10.5px] text-gray-400 leading-tight mt-0.5">{desc}</span></span></div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-2">The review pipeline, stage split, decisions and change requests are live. The interactive write actions (approve / reject / request-revision / assign-reviewer with digital signature) run through the governed workflow engine and are the next build phase — no competency publishes without a recorded approval.</p>
      </Card>

      <Foot>COMP-011 — live over the real approval substrate: <code>plat_approval_requests</code> + <code>plat_approval_decisions</code> (multi-stage review &amp; decisions) and <code>change_requests</code> (revision requests for competency / framework entities). Authoring stays in Competency Studio; the Office reviews and approves. Digital signatures and the interactive approve/reject/assign write-actions are the next phase.</Foot>
    </div>
  );
}

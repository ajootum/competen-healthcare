import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { resourceReviewQueue } from "@/lib/knowledge/educator";
import { FieldsForm } from "../_components/ResearchControls";
import { StationPreview } from "../_components/KnowledgeStatus";

// /super-admin/research/knowledge-review -- clinical review of knowledge resources (COMPETEN-KNOWLEDGE-RESEARCH-01 K3,
// migration 442). Guarded by hq.quality.clinical.approve, the 395 reviewer right. Decisions go through the existing
// /api/hq/clinical-review route into clinical_review_decision, where the 442 guard enforces independence, authority,
// scope (every competency the resource teaches) and staleness. This page is a convenience queue, not a second engine.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Knowledge resource review" };

export default async function KnowledgeReviewPage() {
  const ctx = await requireHqCapability("hq.quality.clinical.approve");
  const q = await resourceReviewQueue(ctx.admin, ctx.userId);
  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Clinical content</p>
        <h1 className="text-xl font-bold text-gray-900">Knowledge resource review</h1>
        <p className="mt-1 text-sm text-gray-600">Educator-reviewed explanations, revision questions, resources and OSCE practice stations awaiting independent clinical approval of their exact content.</p>
      </header>
      {!q ? <p role="alert" className="text-[13px] text-[var(--cmp-text-critical)]">The queue could not be read (or migration 442 is not applied here).</p>
        : q.items.length === 0 ? <p className="text-[13px] text-gray-600">Nothing awaits your decision.</p> : q.items.map(i => (
          <section key={i.versionId} className="rounded-xl border border-gray-200 bg-white p-4 text-[13px]">
            <h2 className="text-[15px] font-bold text-gray-900">{i.title}</h2>
            <p className="text-gray-600">{i.kind} · {i.origin === "ai_draft" ? "began as an AI draft, reviewed by an educator" : "written by an educator"} · {i.approvals} of {i.required} approvals · {i.competencies.length} competencies</p>
            {i.kind === "osce_station" ? <div className="mt-2"><StationPreview content={i.content} /></div>
              : <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[12.5px] text-gray-900">{JSON.stringify(i.content, null, 2)}</pre>}
            <div className="mt-2">
              <FieldsForm action="decide" endpoint="/api/hq/clinical-review" submit="Record decision" done="Recorded."
                extra={{ versionId: i.versionId }}
                fields={[{ name: "appointmentId", label: "Your reviewer appointment", kind: "select", options: q.appointments.map(a => a.id), required: true },
                  { name: "decision", label: "Decision", kind: "select", options: ["approved", "rejected"], required: true }, { name: "comment", label: "Comment (required to reject)", kind: "textarea" }]} />
            </div>
          </section>
        ))}
    </div>
  );
}

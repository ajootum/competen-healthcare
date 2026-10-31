import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { listResources } from "@/lib/knowledge/educator";
import { ActionButton } from "../_components/ResearchControls";
import { StationPreview, StatusChip } from "../_components/KnowledgeStatus";

// /super-admin/research/knowledge-publication -- publication of knowledge resources (COMPETEN-KNOWLEDGE-RESEARCH-01 K3,
// migration 442). Guarded by hq.quality.knowledge.publish. Publication is a separate act: 442 refuses any version that
// is not clinically approved in its exact content.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Knowledge publication" };
const EP = "/api/hq/knowledge/educator";

export default async function KnowledgePublicationPage() {
  const ctx = await requireHqCapability("hq.quality.knowledge.publish");
  const resources = await listResources(ctx.admin);
  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Knowledge &amp; Research Intelligence</p>
        <h1 className="text-xl font-bold text-gray-900">Knowledge publication</h1>
        <p className="mt-1 text-sm text-gray-600">Only a clinically approved version can be published. Publishing supersedes the earlier published version.</p>
      </header>
      {!resources ? <p role="alert" className="text-[13px] text-[var(--cmp-text-critical)]">Resources could not be read (or migration 442 is not applied here).</p>
        : resources.length === 0 ? <p className="text-[13px] text-gray-600">No resources yet.</p> : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white px-4 text-[13px]">
          {resources.map(r => (
            <li key={r.id} className="space-y-1 py-2">
              <div><span className="font-semibold">{r.title}</span> <code className="text-gray-600">{r.code}</code> · {r.kind} · {r.status}</div>
              {r.versions.filter(v => v.state !== "draft").slice(0, 3).map(v => (
                <div key={v.id} className="ml-3 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">Version {v.versionNo}</span><StatusChip status={v.status} />
                    <span>{v.origin === "ai_draft" ? "AI draft, educator-reviewed" : "educator-written"}</span>
                    {v.state === "submitted" && v.clinical === "approved" && <ActionButton endpoint={EP} body={{ action: "publish", versionId: v.id }} label="Publish" done="Published. Any earlier published version is now superseded." tone="primary" />}
                  </div>
                  {r.kind === "osce_station" && v.status === "approved" && <details><summary className="cursor-pointer text-[13px] font-semibold text-teal-800">View station</summary><StationPreview content={v.content} /></details>}
                </div>
              ))}
              {r.status === "active" && <ActionButton endpoint={EP} body={{ action: "retire", resourceId: r.id }} label="Retire resource" done="Retired." />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

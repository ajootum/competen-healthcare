import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { workspace } from "@/lib/knowledge/workspace";
import { ProjectWorkspace } from "../_components/ProjectWorkspace";

// /super-admin/research/scientific-review -- independent scientific review (COMPETEN-KNOWLEDGE-RESEARCH-01 K4, migration
// 443). Guarded by hq.quality.research.review. Frozen manuscripts and outputs only. 443 refuses a reviewer who is on
// the project team or proposed it.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scientific review" };

export default async function ScientificReviewPage() {
  const ctx = await requireHqCapability("hq.quality.research.review");
  const projects = await workspace(ctx.admin, ctx.userId, true);
  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Knowledge &amp; Research Intelligence</p>
        <h1 className="text-xl font-bold text-gray-900">Scientific review</h1>
        <p className="mt-1 text-sm text-gray-600">Review frozen manuscripts and statistical outputs of projects you are not part of.</p>
      </header>
      {!projects ? <p role="alert" className="text-[13px] text-[var(--cmp-text-critical)]">Projects could not be read (or migration 443 is not applied here).</p>
        : projects.filter(p => !p.mine && !p.members.some(m => m.person_id === ctx.userId && m.status === "active")).map(p => <ProjectWorkspace key={p.id} p={p} as="reviewer" />)}
    </div>
  );
}

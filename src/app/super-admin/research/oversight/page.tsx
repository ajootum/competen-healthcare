import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { workspace } from "@/lib/knowledge/workspace";
import { ProjectWorkspace } from "../_components/ProjectWorkspace";

// /super-admin/research/oversight -- governance of research workspaces (COMPETEN-KNOWLEDGE-RESEARCH-01 K4, migration 443).
// Guarded by hq.quality.research.govern: team appointments, approved datasets, publication decisions, corrections and
// withdrawal. 443 refuses a governor who is on the project team.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Research oversight" };

export default async function ResearchOversightPage() {
  const ctx = await requireHqCapability("hq.quality.research.govern");
  const projects = await workspace(ctx.admin, ctx.userId, true);
  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Knowledge &amp; Research Intelligence</p>
        <h1 className="text-xl font-bold text-gray-900">Research oversight</h1>
        <p className="mt-1 text-sm text-gray-600">Appoint teams, approve aggregate datasets and decide publication. You cannot decide a project you are part of.</p>
      </header>
      {!projects ? <p role="alert" className="text-[13px] text-[var(--cmp-text-critical)]">Projects could not be read (or migration 443 is not applied here).</p>
        : projects.length === 0 ? <p className="text-[13px] text-gray-600">No projects yet.</p>
        : projects.map(p => <ProjectWorkspace key={p.id} p={p} as="governor" />)}
    </div>
  );
}

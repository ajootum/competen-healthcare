import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { ckriEnabled } from "@/lib/knowledge/governance";
import { workspace } from "@/lib/knowledge/workspace";
import { ActionButton, FieldsForm } from "./_components/ResearchControls";
import { ProjectWorkspace } from "./_components/ProjectWorkspace";

// /super-admin/research -- the CKRI research workspace for Research Leads and their teams (COMPETEN-KNOWLEDGE-RESEARCH-01
// K4, migrations 440 and 443). Guarded by hq.quality.research.propose. Shows only projects the person proposes or is on.
// Research access is aggregate only: an approved dataset is a suppressed snapshot, never rows.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Research workspace" };
const GOV = "/api/hq/knowledge/governance";

export default async function ResearchWorkspacePage() {
  const ctx = await requireHqCapability("hq.quality.research.propose");
  const [on, projects] = await Promise.all([ckriEnabled(ctx.admin), workspace(ctx.admin, ctx.userId, false)]);
  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Knowledge &amp; Research Intelligence</p>
        <h1 className="text-xl font-bold text-gray-900">Research workspace</h1>
        <p className="mt-1 text-sm text-gray-600">Protocols, approved aggregate datasets, outputs with their integrity record, independent review and publication. No row-level student data is available here.</p>
      </header>
      {!on && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">CKRI is switched off in this environment. Nothing can be changed.</p>}
      <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="np-h">
        <h2 id="np-h" className="text-[15px] font-bold text-gray-900">Propose a project</h2>
        <FieldsForm action="propose" endpoint={GOV} submit="Save draft" done="Draft saved. Write and freeze its protocol and analysis plan, then submit it."
          fields={[{ name: "code", label: "Code", required: true }, { name: "title", label: "Title", required: true }, { name: "purposeCode", label: "Active purpose code", required: true },
            { name: "sponsor", label: "Sponsor", kind: "select", options: ["platform", "institution"], required: true }, { name: "institutionRef", label: "Institution id (institution sponsor)" },
            { name: "agreementRef", label: "Agreement reference (institution sponsor)" }, { name: "minCohort", label: "Minimum cohort (5 or more)", kind: "number" }]} />
      </section>
      {!projects ? <p role="alert" className="text-[13px] text-[var(--cmp-text-critical)]">Projects could not be read (or migrations 440 and 443 are not applied here).</p>
        : projects.length === 0 ? <p className="text-[13px] text-gray-600">You propose no project and are on no team.</p>
        : projects.map(p => (
          <div key={p.id} className="space-y-2">
            {p.mine && <div className="flex flex-wrap gap-2">
              {p.status === "draft" && <ActionButton endpoint={GOV} body={{ action: "submit", projectId: p.id }} label="Submit for governance review" done="Submitted." tone="primary" />}
              {p.status === "submitted" && <ActionButton endpoint={GOV} body={{ action: "return", projectId: p.id }} label="Return to draft" done="Returned." />}
              {["draft", "submitted", "approved", "recruiting"].includes(p.status) && <ActionButton endpoint={GOV} body={{ action: "withdraw", projectId: p.id }} label="Withdraw project" done="Withdrawn." />}
            </div>}
            <ProjectWorkspace p={p} as="team" />
          </div>
        ))}
    </div>
  );
}

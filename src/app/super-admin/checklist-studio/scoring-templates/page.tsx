import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { listRuleTemplates } from "@/lib/assessment/studio/read";
import { DefCreate } from "../_components/DefCreate";
import { DefTable } from "../_components/DefShared";
import { PageHead, StudioShell } from "../_components/studio-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scoring templates" };

export default async function ScoringTemplatesPage() {
  const ctx = await withOwnAppointments(await requireHqCapability("hq.assessment.studio.view"));
  const canAuthor = ctx.capabilities.includes(CAP.author);
  const versions = await listRuleTemplates(ctx.admin);
  return (
    <StudioShell>
      <PageHead
        title="Scoring templates" crumbs={[{ href: "/super-admin/checklist-studio", label: "Checklist Studio" }, { label: "Scoring templates" }]}
        lede="Reusable scoring rules with their saved tests. A published template is copied into a checklist, where it is checked again against that checklist."
        right={<DefCreate type="rule_template" basePath="/super-admin/checklist-studio/scoring-templates" canAuthor={canAuthor} />}
      />
      <DefTable
        empty="No scoring template exists yet."
        rows={versions.map((v) => ({ id: v.id, code: v.code, name: v.name, versionNo: v.version_no, state: v.state, href: `/super-admin/checklist-studio/scoring-templates/v/${v.id}` }))}
      />
    </StudioShell>
  );
}

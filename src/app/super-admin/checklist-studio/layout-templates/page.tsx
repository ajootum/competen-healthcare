import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { listLayoutTemplates } from "@/lib/assessment/studio/read";
import { DefCreate } from "../_components/DefCreate";
import { DefTable } from "../_components/DefShared";
import { PageHead, StudioShell } from "../_components/studio-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Layout templates" };

const PRES: Record<string, string> = {
  standard_checklist: "Standard checklist", guided_assessment: "Guided assessment", audit_inspection: "Audit and inspection", assessment_form: "Assessment form", matrix: "Matrix",
};

export default async function LayoutTemplatesPage() {
  const ctx = await withOwnAppointments(await requireHqCapability("hq.assessment.studio.view"));
  const canAuthor = ctx.capabilities.includes(CAP.author);
  const versions = await listLayoutTemplates(ctx.admin);
  return (
    <StudioShell>
      <PageHead
        title="Layout templates" crumbs={[{ href: "/super-admin/checklist-studio", label: "Checklist Studio" }, { label: "Layout templates" }]}
        lede="How a checklist is drawn: standard checklist or guided assessment today. A layout can never hide or reorder an item."
        right={<DefCreate type="layout_template" basePath="/super-admin/checklist-studio/layout-templates" canAuthor={canAuthor} />}
      />
      <DefTable
        empty="No layout template exists yet."
        extraLabel="Presentation"
        rows={versions.map((v) => ({ id: v.id, code: v.code, name: v.name, versionNo: v.version_no, state: v.state, extra: PRES[v.presentation ?? ""] ?? v.presentation, href: `/super-admin/checklist-studio/layout-templates/v/${v.id}` }))}
      />
    </StudioShell>
  );
}

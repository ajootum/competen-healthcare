import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { listScaleVersions } from "@/lib/assessment/studio/read";
import { listSourceScales } from "@/lib/assessment/adapters/scholar/scales";
import { DefScaleImport, DefCreate } from "../_components/DefCreate";
import { DefTable } from "../_components/DefShared";
import { PageHead, StudioShell } from "../_components/studio-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Response scales" };

// /super-admin/checklist-studio/scales -- Checklist Studio (S2). One right opens every Studio page (studio.view). Creating needs the author
// capability, held through an appointment. A scale is versioned like a checklist, and an item may use only a PUBLISHED scale version.
export default async function ScalesPage() {
  const ctx = await withOwnAppointments(await requireHqCapability("hq.assessment.studio.view"));
  const canAuthor = ctx.capabilities.includes(CAP.author);
  const [versions, sources] = await Promise.all([listScaleVersions(ctx.admin), listSourceScales(ctx.admin).catch(() => [])]);
  return (
    <StudioShell>
      <PageHead
        title="Response scales" crumbs={[{ href: "/super-admin/checklist-studio", label: "Checklist Studio" }, { label: "Scales" }]}
        lede="The levels a rating item is answered on, and the states that are not levels. A stage scale is what progression rules place a person on."
        right={<><DefCreate type="scale" basePath="/super-admin/checklist-studio/scales" canAuthor={canAuthor} /><DefScaleImport sources={sources} canAuthor={canAuthor} /></>}
      />
      <DefTable
        empty="No scale exists yet. Create one, or import an existing scoring scale as a draft."
        extraLabel="Kind"
        rows={versions.map((v) => ({ id: v.id, code: v.scale_code, name: v.scale_name, versionNo: v.version_no, state: v.state, extra: v.scale_kind === "stage" ? "Stage scale" : "Rating scale", href: `/super-admin/checklist-studio/scales/v/${v.id}` }))}
      />
    </StudioShell>
  );
}

import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { listLibrary, listProgressionVersions, listScaleVersions } from "@/lib/assessment/studio/read";
import { describeTarget, targetLabels } from "@/lib/assessment/adapters/scholar/targets";
import { DefCreate } from "../_components/DefCreate";
import { DefTable } from "../_components/DefShared";
import { PageHead, StudioShell } from "../_components/studio-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Progression rules" };

export default async function ProgressionPage() {
  const ctx = await withOwnAppointments(await requireHqCapability("hq.assessment.studio.view"));
  const canAuthor = ctx.capabilities.includes(CAP.author);
  const [versions, scales, library] = await Promise.all([listProgressionVersions(ctx.admin), listScaleVersions(ctx.admin), listLibrary(ctx.admin)]);
  const labels = await targetLabels(ctx.admin, versions.map((v) => ({ kind: v.target_kind, ref: v.target_ref })));
  const stageScales = scales.filter((s) => s.scale_kind === "stage" && s.state === "published").map((s) => ({ id: s.id, label: `${s.scale_name} (${s.scale_code}) v${s.version_no}` }));
  return (
    <StudioShell>
      <PageHead
        title="Progression rules" crumbs={[{ href: "/super-admin/checklist-studio", label: "Checklist Studio" }, { label: "Progression rules" }]}
        lede="Where the evidence of several assessments places a person on a stage scale. Never an average, and never from one assessment unless a rule says so. Not formal verification."
        right={<DefCreate type="progression" basePath="/super-admin/checklist-studio/progression" canAuthor={canAuthor} stageScales={stageScales} instruments={library.map((i) => ({ id: i.id, label: `${i.name} (${i.code})` }))} />}
      />
      <DefTable
        empty="No progression rule set exists yet."
        extraLabel="Places people against"
        rows={versions.map((v) => ({ id: v.id, code: v.code, name: v.name, versionNo: v.version_no, state: v.state, extra: describeTarget({ kind: v.target_kind, ref: v.target_ref }, labels), href: `/super-admin/checklist-studio/progression/v/${v.id}` }))}
      />
    </StudioShell>
  );
}

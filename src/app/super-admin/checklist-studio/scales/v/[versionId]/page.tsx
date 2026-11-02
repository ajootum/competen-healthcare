import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { loadScaleVersion } from "@/lib/assessment/studio/read";
import { lifecycleData } from "@/lib/assessment/studio/page-data";
import { readStageScale } from "@/lib/assessment/adapters/scholar/scales";
import { DefScaleEditor } from "../../../_components/DefScaleEditor";
import { DefTimeline } from "../../../_components/DefShared";
import { LifecyclePanel } from "../../../_components/LifecyclePanel";
import { PageHead, StateChip, StudioShell } from "../../../_components/studio-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Response scale" };

export default async function ScaleVersionPage({ params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await withOwnAppointments(await requireHqCapability("hq.assessment.studio.view"));
  const { versionId } = await params;
  const v = await loadScaleVersion(ctx.admin, versionId);
  if (!v) notFound();
  const canAuthor = ctx.capabilities.includes(CAP.author);
  const [lc, stage] = await Promise.all([
    lifecycleData(ctx.admin, { kind: "scale", version: v, actorId: ctx.userId, caps: ctx.capabilities, validationErrors: 0 }),
    v.scale_kind === "stage" ? readStageScale(ctx.admin, v.id).catch(() => null) : Promise.resolve(null),
  ]);
  return (
    <StudioShell>
      <PageHead
        title={`${v.scale_name} (${v.scale_code}), version ${v.version_no}`}
        crumbs={[{ href: "/super-admin/checklist-studio", label: "Checklist Studio" }, { href: "/super-admin/checklist-studio/scales", label: "Scales" }, { label: v.scale_code }]}
        lede={v.source_kind ? "Imported from an existing scale. Its levels keep a link to the level they came from." : undefined}
        right={<StateChip state={v.state} />}
      />
      <DefScaleEditor
        versionId={v.id} initialLevels={v.levels} initialStates={v.states} description={v.description} scaleKind={v.scale_kind}
        bands={stage?.bands ?? []} stages={stage?.stages ?? []} editable={v.state === "draft" && canAuthor}
      />
      <LifecyclePanel
        kind="scale" versionId={v.id} versionNo={v.version_no} state={v.state} contentHash={v.content_hash} availability={lc.availability} approval={lc.approval}
        requiresDomainReview={false} decisions={lc.decisions} names={lc.names}
        hrefForVersion={(id) => `/super-admin/checklist-studio/scales/v/${id}`} listHref="/super-admin/checklist-studio/scales"
      />
      <DefTimeline timeline={lc.timeline} names={lc.names} />
    </StudioShell>
  );
}

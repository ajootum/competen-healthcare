import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireHqCapability } from "@/lib/hq/context";
import { CAP } from "@/lib/assessment/studio/transitions";
import { loadProgressionVersion } from "@/lib/assessment/studio/read";
import { lifecycleData } from "@/lib/assessment/studio/page-data";
import { recentDesigns } from "@/lib/assessment/studio/designs";
import { readStageScale } from "@/lib/assessment/adapters/scholar/scales";
import { DefProgressionEditor } from "../../../_components/DefProgressionEditor";
import { DefTimeline } from "../../../_components/DefShared";
import { LifecyclePanel } from "../../../_components/LifecyclePanel";
import { Notice, PageHead, StateChip, StudioShell } from "../../../_components/studio-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Progression rule set" };

export default async function ProgressionVersionPage({ params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await requireHqCapability("hq.assessment.studio.view");
  const { versionId } = await params;
  const v = await loadProgressionVersion(ctx.admin, versionId);
  if (!v) notFound();
  const canAuthor = ctx.capabilities.includes(CAP.author);
  const [lc, designs, stageScale] = await Promise.all([
    lifecycleData(ctx.admin, { kind: "progression", version: v, actorId: ctx.userId, caps: ctx.capabilities, validationErrors: 0 }),
    recentDesigns(ctx.admin),
    readStageScale(ctx.admin, v.stage_scale_version_id).catch(() => null),
  ]);
  return (
    <StudioShell wide>
      <PageHead
        title={`${v.name} (${v.code}), version ${v.version_no}`}
        crumbs={[{ href: "/super-admin/checklist-studio", label: "Checklist Studio" }, { href: "/super-admin/checklist-studio/progression", label: "Progression rules" }, { label: v.code }]}
        lede={`Places: ${v.target_kind.replace(/_/g, " ")}.`}
        right={<StateChip state={v.state} />}
      />
      {stageScale ? (
        <DefProgressionEditor
          versionId={v.id} initialRules={v.rules ?? {}} initialTests={v.tests ?? []} stageScaleVersionId={v.stage_scale_version_id} stageScale={stageScale}
          description={v.description} designs={designs} editable={v.state === "draft" && canAuthor}
        />
      ) : (
        <Notice tone="error">The stage scale this rule set uses could not be read, so the rules cannot be shown.</Notice>
      )}
      <LifecyclePanel
        kind="progression" versionId={v.id} versionNo={v.version_no} state={v.state} contentHash={v.content_hash} availability={lc.availability} approval={lc.approval}
        requiresDomainReview={false} decisions={lc.decisions} names={lc.names}
        hrefForVersion={(id) => `/super-admin/checklist-studio/progression/v/${id}`} listHref="/super-admin/checklist-studio/progression"
      />
      <DefTimeline timeline={lc.timeline} names={lc.names} />
    </StudioShell>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireHqCapability } from "@/lib/hq/context";
import { CAP } from "@/lib/assessment/studio/transitions";
import { loadRuleTemplateVersion } from "@/lib/assessment/studio/read";
import { lifecycleData } from "@/lib/assessment/studio/page-data";
import { recentDesigns } from "@/lib/assessment/studio/designs";
import { DefRuleTemplateEditor } from "../../../_components/DefRuleTemplateEditor";
import { DefTimeline } from "../../../_components/DefShared";
import { LifecyclePanel } from "../../../_components/LifecyclePanel";
import { PageHead, StateChip, StudioShell } from "../../../_components/studio-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scoring template" };

export default async function RuleTemplateVersionPage({ params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await requireHqCapability("hq.assessment.studio.view");
  const { versionId } = await params;
  const v = await loadRuleTemplateVersion(ctx.admin, versionId);
  if (!v) notFound();
  const canAuthor = ctx.capabilities.includes(CAP.author);
  const editable = v.state === "draft" && canAuthor;
  const [lc, designs] = await Promise.all([
    lifecycleData(ctx.admin, { kind: "rule_template", version: v, actorId: ctx.userId, caps: ctx.capabilities, validationErrors: 0 }),
    recentDesigns(ctx.admin),
  ]);
  return (
    <StudioShell wide>
      <PageHead
        title={`${v.name} (${v.code}), version ${v.version_no}`}
        crumbs={[{ href: "/super-admin/checklist-studio", label: "Checklist Studio" }, { href: "/super-admin/checklist-studio/scoring-templates", label: "Scoring templates" }, { label: v.code }]}
        right={<StateChip state={v.state} />}
      />
      <DefRuleTemplateEditor versionId={v.id} initialRules={v.rules ?? {}} initialTests={v.tests ?? []} description={v.description} designs={designs} editable={editable} />
      <LifecyclePanel
        kind="rule_template" versionId={v.id} versionNo={v.version_no} state={v.state} contentHash={v.content_hash} availability={lc.availability} approval={lc.approval}
        requiresDomainReview={false} decisions={lc.decisions} names={lc.names}
        hrefForVersion={(id) => `/super-admin/checklist-studio/scoring-templates/v/${id}`} listHref="/super-admin/checklist-studio/scoring-templates"
      />
      <DefTimeline timeline={lc.timeline} names={lc.names} />
    </StudioShell>
  );
}

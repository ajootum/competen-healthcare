import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { POLICY_CAP } from "@/lib/assessment/studio/transitions";
import { loadPolicy, loadPolicyVersion } from "@/lib/assessment/studio/read";
import { isUuid } from "@/lib/assessment/studio/api";
import { lifecycleData } from "@/lib/assessment/studio/page-data";
import { pathwayModel } from "@/lib/assessment/studio/pathway-data";
import { validateOther } from "@/lib/assessment/studio/service";
import { DefTimeline } from "../../../../checklist-studio/_components/DefShared";
import { LifecyclePanel } from "../../../../checklist-studio/_components/LifecyclePanel";
import { PathwayPanel } from "../../../../checklist-studio/_components/PathwayPanel";
import { PageHead, StateChip, StudioShell } from "../../../../checklist-studio/_components/studio-ui";
import { PolicyVersionEditor } from "../../../_components/PolicyVersionEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Policy version" };

export default async function PolicyVersionPage({ params }: { params: Promise<{ policyId: string; versionId: string }> }) {
  const ctx = await withOwnAppointments(await requireHqCapability("hq.quality.policy.view"));
  const { policyId, versionId } = await params;
  if (!isUuid(policyId) || !isUuid(versionId)) notFound();
  const data = await loadPolicyVersion(ctx.admin, versionId);
  if (!data || data.policy.id !== policyId) notFound();
  const { policy, version: v } = data;
  const canAuthor = ctx.capabilities.includes(POLICY_CAP.author);
  const [report, all] = await Promise.all([validateOther(ctx.admin, "policy", v.id), loadPolicy(ctx.admin, policyId)]);
  const versionNos = Object.fromEntries((all?.versions ?? [v]).map((x) => [x.id, x.version_no]));
  const lc = await lifecycleData(ctx.admin, { kind: "policy", version: v, actorId: ctx.userId, caps: ctx.capabilities, validationErrors: report.errors.length, versionNos });
  const pathway = await pathwayModel(ctx.admin, { kind: "policy", version: v, actorId: ctx.userId, caps: ctx.capabilities, life: lc, versionNos, validation: v.state === "draft" ? report.errors : [] });
  const editable = v.state === "draft" && canAuthor;
  const whyNot = v.state !== "draft" ? "Only a draft can be edited. To change this version, duplicate it to a new draft." : "Editing needs the policy author capability, held through an appointment.";
  const base = `/super-admin/policy-manager/${policy.id}/v`;
  return (
    <StudioShell>
      <PageHead kicker="Competen Holdings, Policy Manager" kicker="Competen Holdings, Policy Manager"
        title={`${v.title} (${policy.code}), version ${v.version_no}`}
        crumbs={[{ href: "/super-admin/policy-manager", label: "Policy Manager" }, { href: `/super-admin/policy-manager/${policy.id}`, label: policy.code }, { label: `v${v.version_no}` }]}
        right={<StateChip state={v.state} />}
      />
      <PathwayPanel model={pathway} versionId={v.id} versionHrefBase={base} />
      <PolicyVersionEditor
        key={`${v.id}:${v.content_hash ?? ""}`}
        versionId={v.id} editable={editable} whyNot={whyNot}
        initial={{ title: v.title, summary: v.summary ?? "", content: v.content, effectiveFrom: v.effective_from ?? "", reviewDue: v.review_due ?? "" }}
      />
      <LifecyclePanel
        kind="policy" versionId={v.id} versionNo={v.version_no} state={v.state} contentHash={v.content_hash} availability={lc.availability} approval={lc.approval}
        requiresDomainReview={false} decisions={lc.decisions} names={lc.names} versionHrefBase={base} listHref={`/super-admin/policy-manager/${policy.id}`}
        report={report}
      />
      <DefTimeline timeline={lc.timeline} names={lc.names} />
    </StudioShell>
  );
}

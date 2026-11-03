import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { isUuid } from "@/lib/assessment/studio/api";
import { listLayoutTemplates, listRuleTemplates, listScaleChoices, loadInstrumentVersion, loadRegistries } from "@/lib/assessment/studio/read";
import { lifecycleData } from "@/lib/assessment/studio/page-data";
import { pathwayModel } from "@/lib/assessment/studio/pathway-data";
import { validateLoaded } from "@/lib/assessment/studio/service";
import { CRITERION_KIND, criterionDrift, readMappedCriteria } from "@/lib/assessment/adapters/scholar/criteria";
import { VersionWorkspace } from "../../../_components/VersionWorkspace";
import { PageHead, StudioShell } from "../../../_components/studio-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checklist version" };

// /super-admin/checklist-studio/[instrumentId]/v/[versionId] -- Checklist Studio (S2): Content, Scoring & Rules, Design & Layout,
// Settings & Review and Preview for one version. Studio view opens it. Editing needs the author capability, held through an appointment,
// and only on a draft. Every action re-checks its own capability in the API and the database refuses what is not independent.
export default async function VersionPage({ params }: { params: Promise<{ instrumentId: string; versionId: string }> }) {
  const ctx = await withOwnAppointments(await requireHqCapability("hq.assessment.studio.view"));
  const { instrumentId, versionId } = await params;
  if (!isUuid(instrumentId) || !isUuid(versionId)) notFound();
  const loaded = await loadInstrumentVersion(ctx.admin, versionId);
  if (!loaded || loaded.instrument.id !== instrumentId) notFound();
  const { instrument, version, content } = loaded;

  const mappedSkills = content.items.flatMap((i) => (i.mapping?.kind === CRITERION_KIND && i.mapping.ref_id ? [i.mapping.ref_id] : []));
  const usedScales = content.items.flatMap((i) => [i.scale_version_id, ...(i.fields ?? []).map((f) => f.scale_version_id)]).filter(Boolean) as string[];
  const [registries, scaleChoices, ruleTemplates, layoutTemplates, live, report] = await Promise.all([
    loadRegistries(ctx.admin), listScaleChoices(ctx.admin, usedScales), listRuleTemplates(ctx.admin, ["published"]), listLayoutTemplates(ctx.admin, ["published"]),
    readMappedCriteria(ctx.admin, mappedSkills).catch(() => new Map()), validateLoaded(ctx.admin, loaded),
  ]);
  const drift: Record<string, string[]> = {};
  for (const it of content.items) {
    const d = criterionDrift(it.mapping, it.mapping?.ref_id ? live.get(it.mapping.ref_id) ?? null : null);
    if (d.drifted) drift[it.stable_key] = d.reasons;
  }
  // Layouts the version may use also include ones it already points at that were retired since, so the choice is never hidden.
  const layoutIds = new Set([...loaded.allowedLayoutIds, ...(version.default_layout_version_id ? [version.default_layout_version_id] : [])]);
  const allLayouts = layoutTemplates.length || layoutIds.size ? [...layoutTemplates, ...(layoutIds.size ? (await listLayoutTemplates(ctx.admin)).filter((l) => layoutIds.has(l.id) && !layoutTemplates.some((x) => x.id === l.id)) : [])] : [];

  const caps = ctx.capabilities;
  const canEdit = version.state === "draft" && caps.includes(CAP.author);
  const life = await lifecycleData(ctx.admin, { kind: "instrument", version, actorId: ctx.userId, caps, validationErrors: report.errors.length });
  const pathway = await pathwayModel(ctx.admin, { kind: "instrument", version, actorId: ctx.userId, caps, validation: report.errors, life, instrumentId: instrument.id });
  const taxonomies = await ctx.admin.from("taxonomies").select("id, label");
  const termRows = await ctx.admin.from("taxonomy_terms").select("id, value, taxonomy_id").order("sort_order");
  const taxName = new Map(((taxonomies.data ?? []) as { id: string; label: string }[]).map((t) => [t.id, t.label]));
  const terms = ((termRows.data ?? []) as { id: string; value: string; taxonomy_id: string }[]).map((t) => ({ id: t.id, label: t.value, group: taxName.get(t.taxonomy_id) ?? "Terms" }));

  return (
    <StudioShell wide>
      <PageHead
        title={`${instrument.name}, version ${version.version_no}`}
        crumbs={[{ href: "/super-admin/checklist-studio", label: "Checklist Studio" }, { href: `/super-admin/checklist-studio/${instrument.id}`, label: instrument.code }, { label: `v${version.version_no}` }]}
      />
      <VersionWorkspace
        versionId={version.id} instrument={{ id: instrument.id, code: instrument.code, name: instrument.name }} versionNo={version.version_no} state={version.state}
        content={content} canEdit={canEdit} canPick={true} methods={registries.methods} scaleChoices={scaleChoices} terms={terms} drift={drift}
        ruleTemplates={ruleTemplates.map((t) => ({ id: t.id, label: `${t.name} v${t.version_no}` }))}
        scoring={version.scoring} scoringTests={version.scoring_tests} scoringTemplateId={version.scoring_template_version_id} scoringHash={version.scoring_hash}
        layouts={allLayouts.map((l) => ({ id: l.id, name: `${l.name} v${l.version_no}`, presentation: l.presentation ?? "standard_checklist", layout: (l.layout ?? {}) as Record<string, unknown> }))}
        defaultLayoutId={version.default_layout_version_id} allowedLayoutIds={loaded.allowedLayoutIds}
        settings={{
          version, tagTermIds: loaded.tagTermIds, terms, purposes: registries.purposes, methods: registries.methods, editable: canEdit, canValidate: caps.includes(CAP.author), report,
        }}
        report={report} title={version.title ?? instrument.name} timeline={life.timeline}
        pathway={pathway} catalogueHref={`/super-admin/assessment-catalogue/${instrument.id}`}
        lifecycle={{
          contentHash: version.content_hash, availability: life.availability, approval: life.approval, requiresDomainReview: version.requires_domain_review,
          decisions: life.decisions, names: life.names,
        }}
      />
    </StudioShell>
  );
}

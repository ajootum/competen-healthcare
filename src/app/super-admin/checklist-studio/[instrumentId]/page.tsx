import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireHqCapability } from "@/lib/hq/context";
import { CAP } from "@/lib/assessment/studio/transitions";
import { buildTimeline, loadInstrument, loadRegistries, loadTrail, nameMap } from "@/lib/assessment/studio/read";
import { isUuid } from "@/lib/assessment/studio/api";
import { InstrumentView } from "../_components/InstrumentView";
import { PageHead, StudioShell } from "../_components/studio-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checklist versions" };

// /super-admin/checklist-studio/[instrumentId] -- Checklist Studio (S2): the versions of one instrument and its history timeline
// (definition events and review decisions). Duplicate to a new draft and retire are here. Studio view opens it.
export default async function InstrumentPage({ params }: { params: Promise<{ instrumentId: string }> }) {
  const ctx = await requireHqCapability("hq.assessment.studio.view");
  const { instrumentId } = await params;
  if (!isUuid(instrumentId)) notFound();
  const data = await loadInstrument(ctx.admin, instrumentId);
  if (!data) notFound();
  const { instrument, versions, familyLabel } = data;
  const [trail, registries] = await Promise.all([loadTrail(ctx.admin, "instrument", versions.map((v) => v.id)), loadRegistries(ctx.admin)]);
  const timeline = buildTimeline(trail.events, trail.decisions, Object.fromEntries(versions.map((v) => [v.id, v.version_no])));
  const names = await nameMap(ctx.admin, [...versions.flatMap((v) => [...v.authored_by, v.published_by, v.submitted_by]), ...timeline.map((t) => t.actorId)]);
  return (
    <StudioShell>
      <PageHead
        title={`${instrument.code}, ${instrument.name}`}
        crumbs={[{ href: "/super-admin/checklist-studio", label: "Checklist Studio" }, { label: instrument.code }]}
        lede={`${familyLabel ?? instrument.family_code ?? "No family"} · ${instrument.kind}${instrument.description ? ` · ${instrument.description}` : ""}`}
      />
      <InstrumentView
        instrumentId={instrument.id}
        versions={versions.map((v) => ({
          id: v.id, version_no: v.version_no, state: v.state, purpose_code: v.purpose_code, delivery_modes: v.delivery_modes, authored_by: v.authored_by,
          published_at: v.published_at, submitted_at: v.submitted_at, created_at: v.created_at, risk: v.risk,
        }))}
        timeline={timeline} names={names} purposes={registries.purposes} canAuthor={ctx.capabilities.includes(CAP.author)} canPublish={ctx.capabilities.includes(CAP.publish)}
      />
    </StudioShell>
  );
}

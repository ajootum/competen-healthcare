import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { isUuid } from "@/lib/assessment/catalogue/filters";
import { loadInstrumentDetail } from "@/lib/assessment/catalogue/detail";
import { loadTaxonomy } from "@/lib/assessment/catalogue/classify";
import { loadCollections } from "@/lib/assessment/catalogue/collections";
import { loadReferenceKinds } from "@/lib/assessment/catalogue/relations";
import InstrumentView from "../InstrumentView";
import { BASE } from "../ui";

// /super-admin/assessment-catalogue/[instrumentId] -- the full page for one instrument, for deep links. It reads exactly
// what the registry drawer reads and renders the same component, so the two cannot disagree.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Catalogue instrument" };

export default async function InstrumentPage({ params }: { params: Promise<{ instrumentId: string }> }) {
  const { instrumentId } = await params;
  if (!isUuid(instrumentId)) notFound();
  // withOwnAppointments: the pathway says whether THIS person may take the next step, which an owner holds only through an appointment.
  const ctx = await withOwnAppointments(await requireHqCapability("hq.assessment.catalogue.view"));
  const canManage = ctx.isOwner || ctx.capabilities.includes("hq.assessment.catalogue.manage");
  const canStudio = ctx.isOwner || ctx.capabilities.includes("hq.assessment.studio.view");
  const [detail, taxonomy, collections, referenceKinds] = await Promise.all([
    loadInstrumentDetail(ctx.admin, instrumentId, { actorId: ctx.userId, caps: ctx.capabilities }), loadTaxonomy(ctx.admin), loadCollections(ctx.admin), canManage ? loadReferenceKinds(ctx.admin) : Promise.resolve([]),
  ]);
  if (!detail) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px]">
        <Link href={BASE} className="font-semibold text-teal-800 underline">Assessment &amp; Checklist Catalogue</Link>
        <span className="text-gray-600"> / {detail.code}</span>
      </nav>
      <div className="rounded-xl border border-gray-100 bg-white p-5">
        <InstrumentView detail={detail} taxonomy={taxonomy} collections={collections} referenceKinds={referenceKinds} canManage={canManage} canStudio={canStudio} layout="page" />
      </div>
    </div>
  );
}

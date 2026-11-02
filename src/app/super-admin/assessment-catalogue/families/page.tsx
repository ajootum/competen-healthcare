import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { loadFamilies } from "@/lib/assessment/catalogue/families";
import FamiliesAdmin from "./FamiliesAdmin";
import { BASE } from "../ui";

// /super-admin/assessment-catalogue/families -- configure the catalogue families (hq.assessment.catalogue.manage).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Catalogue families" };

export default async function FamiliesPage() {
  const ctx = await requireHqCapability("hq.assessment.catalogue.manage");
  const families = await loadFamilies(ctx.admin, { withCounts: true });
  return (
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px]"><Link href={BASE} className="font-semibold text-teal-800 underline">Assessment &amp; Checklist Catalogue</Link><span className="text-gray-600"> / Families</span></nav>
      <h1 className="text-xl font-bold text-gray-900">Catalogue families</h1>
      <p className="mb-4 mt-0.5 text-sm text-gray-700">A family is the kind of instrument. Its code prefixes every instrument code of the family (CA-000001) and is permanent. A family can be hidden to stop new registrations in it.</p>
      <FamiliesAdmin families={families} />
    </div>
  );
}

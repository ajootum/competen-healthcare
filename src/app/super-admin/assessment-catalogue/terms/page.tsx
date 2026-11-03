import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { loadTaxonomy } from "@/lib/assessment/catalogue/classify";
import TermsAdmin from "./TermsAdmin";
import { BASE } from "../ui";

// /super-admin/assessment-catalogue/terms -- configure the classification dimensions and their terms (hq.assessment.catalogue.manage).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Catalogue classification terms" };

export default async function TermsPage() {
  const ctx = await requireHqCapability("hq.assessment.catalogue.manage");
  const taxonomy = await loadTaxonomy(ctx.admin);
  return (
    <div className="mx-auto max-w-4xl">
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px]"><Link href={BASE} className="font-semibold text-teal-800 underline">Assessment &amp; Checklist Catalogue</Link><span className="text-gray-600"> / Terms</span></nav>
      <h1 className="text-xl font-bold text-gray-900">Classification terms</h1>
      <p className="mb-4 mt-0.5 text-sm text-gray-700">The words an instrument can be classified with, by axis. A term that is hidden stays on the instruments that already carry it and cannot be newly chosen. Level terms are created by linking to the programme qualification levels, so the catalogue names them and never copies them.</p>
      <TermsAdmin taxonomy={taxonomy} />
    </div>
  );
}

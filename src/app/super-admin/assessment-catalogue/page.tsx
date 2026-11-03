import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { PAGE_SIZE, parseCatalogueQuery } from "@/lib/assessment/catalogue/filters";
import { catalogueStats, searchCatalogue, type SearchResult } from "@/lib/assessment/catalogue/search";
import { loadFamilies } from "@/lib/assessment/catalogue/families";
import { loadTaxonomy } from "@/lib/assessment/catalogue/classify";
import { loadProductLines } from "@/lib/assessment/catalogue/availability";
import { loadCollections } from "@/lib/assessment/catalogue/collections";
import { loadReferenceKinds } from "@/lib/assessment/catalogue/relations";
import { loadInstrumentDetail } from "@/lib/assessment/catalogue/detail";
import CatalogueWorkspace from "./CatalogueWorkspace";

// /super-admin/assessment-catalogue -- the Holdings Assessment & Checklist Catalogue (migration 894).
//
// Guarded by hq.assessment.catalogue.view. Changes need hq.assessment.catalogue.manage, checked again by every API route.
// The URL is the whole query (search, filters, sort, page, tab and the open instrument), and the registry is filtered, sorted
// and paged IN THE DATABASE, so the browser receives one page of 50 whatever the size of the catalogue.
//
// ⚠ THE CATALOGUE HOLDS METADATA ONLY. This page reads identities, classification, availability, version states and dates.
// It reads no assessment instance, response, evidence or outcome, and the plane boundary harness fails the build if it does.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assessment & Checklist Catalogue" };

export default async function AssessmentCataloguePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // withOwnAppointments: an owner holds the Studio author capability only through a live appointment, and an import or a
  // template copy writes a Studio draft, so the register chooser must know whether registering content is possible.
  const ctx = await withOwnAppointments(await requireHqCapability("hq.assessment.catalogue.view"));
  const admin = ctx.admin;
  const query = parseCatalogueQuery(await searchParams);
  const canManage = ctx.isOwner || ctx.capabilities.includes("hq.assessment.catalogue.manage");
  const canStudio = ctx.isOwner || ctx.capabilities.includes("hq.assessment.studio.view");
  // Owner decision 4 (3 Nov 2026): a Catalogue Manager or an Instrument Author may import and register draft instruments.
  const canAuthor = canManage || ctx.capabilities.includes(CAP.author);

  const empty: SearchResult = { rows: [], total: 0, page: 1, pageSize: PAGE_SIZE };
  const [stats, result, families, taxonomy, productLines, collections, detail, referenceKinds] = await Promise.all([
    catalogueStats(admin),
    query.tab === "instruments" ? searchCatalogue(admin, query) : Promise.resolve(empty),
    loadFamilies(admin),
    loadTaxonomy(admin),
    loadProductLines(admin),
    loadCollections(admin),
    query.open ? loadInstrumentDetail(admin, query.open) : Promise.resolve(null),
    canManage ? loadReferenceKinds(admin) : Promise.resolve([]),
  ]);

  return (
    <CatalogueWorkspace
      query={query} stats={stats} result={result} families={families} taxonomy={taxonomy} productLines={productLines}
      collections={collections} referenceKinds={referenceKinds} detail={detail} canManage={canManage} canStudio={canStudio} canAuthor={canAuthor}
    />
  );
}

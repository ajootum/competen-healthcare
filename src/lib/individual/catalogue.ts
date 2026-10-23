/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadIndividualCatalogue, allowedCatalogueIds, type CatalogueCompetency, type CatalogueScope } from "@/lib/competency/foundation";
import { loadIndividualPolicy } from "./policy";

// ── WHAT AN INDIVIDUAL EXPERIENCE MAY MAP TO ── COMPETEN-SCHOLAR-01 S1, the interface S2-S4 build on ────────
//
// The experience's catalogue allowlist (Individual policy, empty by default) applied to the shared
// competency library (src/lib/competency/foundation.ts). null = could not be read, so offer nothing.
// [] = readable, and nothing allowed yet.
export async function loadCatalogueFor(admin: any, scope: CatalogueScope): Promise<CatalogueCompetency[] | null> {
  return loadIndividualCatalogue(admin, allowedCatalogueIds(await loadIndividualPolicy(admin), scope));
}

export type { CatalogueCompetency, CatalogueScope };

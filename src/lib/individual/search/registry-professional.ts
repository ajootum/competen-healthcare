// COMPETEN UNIVERSAL SEARCH STANDARD: what Professional offers to search. The same declaration as Scholar's, for Professional's own
// modules, reusing the registry's types. Imports nothing but types: client and server both read it.
//
// ⚠ PROFESSIONAL READS NO SCHOLAR RECORD. Every record type here is one the professional keeps in Professional (the Professional store
// and its own tables). Scholar's study, materials and evaluations are never searched from here, and Scholar's registry never lists these.

import type { SearchModule } from "./registry";

export type ProfessionalSearchKey = "registration" | "development" | "cpd" | "evidence" | "competencies";

/** The Professional modules this person may open: the segments EXPERIENCES.professional lists, decided by the route before any read. */
export type ProfessionalSearchAccess = { modules: ReadonlySet<ProfessionalSearchKey> };

export type ProfessionalSearchModule = Omit<SearchModule, "key" | "allowed" | "product"> & {
  key: ProfessionalSearchKey;
  product: "Professional";
  allowed: (a: ProfessionalSearchAccess) => boolean;
  /** False where the module's page has no search box of its own: Global Search still returns its records, but offers no "search this area" link. */
  pageSearch?: false;
};

const listed = (key: ProfessionalSearchKey) => (a: ProfessionalSearchAccess) => a.modules.has(key);

export const PROFESSIONAL_SEARCH_MODULES: readonly ProfessionalSearchModule[] = [
  { key: "registration", product: "Professional", label: "My practice", scope: "your registrations, employment, specialties, interests and aspirations", segment: "registration", pageSearch: false,
    recordTypes: [{ key: "profile", label: "Profile records" }],
    fields: ["titles", "types", "organisations"], filters: [], allowed: listed("registration") },
  { key: "development", product: "Professional", label: "Needs & plan", scope: "your development needs and goals", segment: "development",
    recordTypes: [{ key: "need", label: "Development needs" }, { key: "goal", label: "Goals" }],
    fields: ["titles", "descriptions"], filters: ["needs view", "plan view"], allowed: listed("development") },
  { key: "cpd", product: "Professional", label: "Learning & CPD", scope: "your CPD log and learning history", segment: "cpd",
    recordTypes: [{ key: "cpd", label: "CPD entries" }],
    fields: ["titles", "providers", "kinds of activity"], filters: [], allowed: listed("cpd") },
  { key: "evidence", product: "Professional", label: "Credentials & evidence", scope: "your credentials and evidence", segment: "evidence",
    recordTypes: [{ key: "credential", label: "Credentials" }, { key: "evidence", label: "Competency evidence" }],
    fields: ["titles", "issuing bodies", "descriptions", "document names"], filters: [], allowed: listed("evidence") },
  { key: "competencies", product: "Professional", label: "My competencies", scope: "your competencies", segment: "competencies",
    recordTypes: [{ key: "competency", label: "Competencies" }],
    fields: ["titles", "descriptions", "groups"], filters: [], allowed: listed("competencies") },
];

export const professionalSearchModule = (key: ProfessionalSearchKey): ProfessionalSearchModule => PROFESSIONAL_SEARCH_MODULES.find(m => m.key === key)!;

/** Only what this person may open. */
export const allowedProfessionalModules = (a: ProfessionalSearchAccess): ProfessionalSearchModule[] => PROFESSIONAL_SEARCH_MODULES.filter(m => m.allowed(a));

/** The line that says what a box searches. */
export const professionalScopeLine = (key: ProfessionalSearchKey) => `Searching ${professionalSearchModule(key).scope}`;

/** A search on a module's own page, below /individual/professional, or null where that page has no search box. */
export function professionalSearchPath(key: ProfessionalSearchKey, q: string): string | null {
  if (professionalSearchModule(key).pageSearch === false) return null;
  return `${professionalSearchModule(key).segment}?${new URLSearchParams({ q }).toString()}`;
}

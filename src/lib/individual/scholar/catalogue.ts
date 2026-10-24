/* eslint-disable @typescript-eslint/no-explicit-any */
import { COMPETENCY_LAYERS, loadIndividualCatalogue, type CompetencyLayer } from "@/lib/competency/foundation";
import { loadCatalogueFor } from "../catalogue";
import { loadIndividualPolicy, meetsMinStatus, type ContentStatusLevel } from "../policy";

// ── THE COMPETENCY CATALOGUE SCHOLAR LEARNS AGAINST ── COMPETEN-SCHOLAR-01 S2, over S1 (migrations 384, 387) ──
//
// ⚠ AN INTERFACE OVER S1, NOT A CATALOGUE. What exists, and what Scholar may offer, is S1's: the shared
// competency foundation (src/lib/competency/foundation.ts) behind the HQ allowlist for Scholar
// (loadCatalogueFor(admin, "scholar"), Individual policy `scholar_catalogues`, EMPTY by default). That read
// already holds a catalogue to shared (hospital_id null), active and published. Nothing in Scholar reads the
// framework tables itself (scripts/scholar-learning-harness.ts K2), so there is one gate, and it is HQ's.
// The id of a competency IS framework_competencies.id, never a copy: migration 388 stores it as a typed
// foreign key.
//
// ⚠ A PROGRAMME NARROWS, IT NEVER WIDENS. A programme (individual_scholar_programme, migration 387) names
// the catalogues its students learn against. What a student is offered is the catalogues in BOTH their
// programme and the HQ allowlist. A programme row naming a catalogue HQ has not allowed offers nothing from
// it -- configuring a programme is neither publishing nor allowing a catalogue.
//
// ⚠ S1 OWNS THE LAYER AND THE PROFESSION. A catalogue's layer is 384's frameworks.competency_layer. The
// programme's own layer is used only where HQ has not classified the catalogue. The same for the profession.
//
// ⚠ PROFESSION-AGNOSTIC. No code path here names a profession. A new profession is a catalogue (S1) and a
// programme (rows).

export const LAYERS = COMPETENCY_LAYERS;
export type Layer = CompetencyLayer;
export const isLayer = (v: unknown): v is Layer => typeof v === "string" && (LAYERS as readonly string[]).includes(v);

export const LAYER_LABEL: Record<Layer, string> = {
  foundational: "Foundational",
  profession: "Profession",
  advanced: "Advanced practice",
  specialty: "Specialty",
  context: "Context",
};

/** One competency as S2-S4 use it: S1's shape, projected. */
export type CatalogueCompetency = {
  id: string;
  layer: Layer;
  profession: string;
  /** The catalogue (framework) it belongs to, by name. */
  catalogue: string;
  frameworkId: string;
  domain: string;
  code: string | null;
  title: string;
  /** What a learner should be able to do, as S1 records it. Empty when none is recorded -- not invented here. */
  outcomes: string[];
  /** The proficiency the framework expects (S1 expectedLevel). Orders gaps. Null when it sets none. */
  expectedLevel: { score: number; label: string } | null;
  // THE CLINICAL STRUCTURE (CKCM, migration 011): domain -> practice -> clinical practice unit. Read from S1,
  // never rebuilt here. Null where the library has not placed the competency in a practice or a CPU -- most
  // competencies today -- and shown as such, never guessed.
  practice: { code: string | null; name: string } | null;
  cpu: { code: string | null; name: string } | null;
  // CONTENT STATUS (S1, migration 394; owner ruling 2026-10-24: LABEL, never hide silently). Whether the
  // competency's content is clinically approved, a draft, or unreviewed -- shown beside it wherever it appears.
  contentStatus: ContentStatusLevel;
  statusNote: string | null;
  /** UPLOAD-01 U3: the catalogue version S1 read it from (major.minor.revision), recorded on every mapping. */
  catalogueVersion?: string | null;
};

/** A programme as configuration: which catalogues, in which layer. Read by the store from 387. */
export type ProgrammeConfig = {
  code: string;
  label: string;
  profession: string;
  country: string | null;
  level: string | null;
  frameworks: { frameworkId: string; layer: Layer; sortOrder: number }[];
};

/**
 * `belowFloor`: competencies the programme's catalogues hold that the content-status floor
 * (Individual policy scholar_catalogue_min_status) does not offer. Counted, so a page can SAY so -- never silently
 * missing. `minStatus`: the floor applied.
 */
export type CatalogueRead = { ok: true; data: CatalogueCompetency[]; belowFloor?: number; minStatus?: ContentStatusLevel } | { ok: false };

export interface CompetencyCatalogue {
  /** Every competency a programme learns against, in layer order. Unreadable is { ok: false }, never []. */
  forProgramme(programme: ProgrammeConfig): Promise<CatalogueRead>;
}

/** Shaped like S1's CatalogueCompetency, so the projection below is pure and unit-tested. */
export type S1Competency = {
  competencyId: string; code: string | null; title: string; layer: Layer | null;
  profession: { label: string } | null; catalogue: { id: string; name: string; version?: string }; domain: { name: string }; outcomes: string[];
  expectedLevel?: { score: number; label: string } | null;
  cpu?: { code: string | null; name: string } | null;
  /** The CKCM practice (S1, #49): the competency's own, or its CPU's. */
  practice?: { code: string | null; name: string } | null;
  contentStatus?: string;
  statusNote?: string | null;
};

/** Pure. An unknown or missing status is unreviewed -- never approved by default (S1's own rule). */
export const normaliseStatus = (s: string | undefined): ContentStatusLevel => (s === "approved" || s === "draft" ? s : "unreviewed");

/** Pure. The clinical-structure line for a competency, e.g. "Oxygen Therapy > CPU-OXYSAFE-001 Safe Oxygen Administration", or null. */
export function structureLabel(c: Pick<CatalogueCompetency, "practice" | "cpu">): string | null {
  const parts = [c.practice?.name, c.cpu ? [c.cpu.code, c.cpu.name].filter(Boolean).join(" ") : null].filter((x): x is string => !!x);
  return parts.length ? parts.join(" \u203a ") : null;
}

/** Pure. S1's competencies, narrowed to the programme's catalogues, in layer then programme then catalogue order. */
export function projectForProgramme(all: S1Competency[], programme: ProgrammeConfig): CatalogueCompetency[] {
  const config = new Map(programme.frameworks.map(f => [f.frameworkId, f]));
  const order = (l: Layer) => LAYERS.indexOf(l);
  return all
    .filter(c => config.has(c.catalogue.id))
    .map((c, i) => {
      const f = config.get(c.catalogue.id)!;
      return {
        sort: [order(c.layer ?? f.layer), f.sortOrder, i] as const,
        c: {
          id: c.competencyId, layer: c.layer ?? f.layer, profession: c.profession?.label ?? programme.profession,
          catalogue: c.catalogue.name, frameworkId: c.catalogue.id, domain: c.domain.name, code: c.code, title: c.title, outcomes: c.outcomes,
          expectedLevel: c.expectedLevel ? { score: c.expectedLevel.score, label: c.expectedLevel.label } : null,
          practice: c.practice ? { code: c.practice.code, name: c.practice.name } : null,
          cpu: c.cpu ? { code: c.cpu.code, name: c.cpu.name } : null,
          contentStatus: normaliseStatus(c.contentStatus), statusNote: c.statusNote ?? null,
          catalogueVersion: c.catalogue.version ?? null,
        },
      };
    })
    .sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || a.sort[2] - b.sort[2])
    .map(x => x.c);
}

/** Pure. The content-status floor: what is offered, and how many the floor holds back (said, never hidden). */
export function applyContentFloor(rows: CatalogueCompetency[], min: ContentStatusLevel): { kept: CatalogueCompetency[]; belowFloor: number } {
  const kept = rows.filter(c => meetsMinStatus(c.contentStatus, min));
  return { kept, belowFloor: rows.length - kept.length };
}

/** What a governed reference needs of a competency. A programme catalogue entry is one. */
export type ReferenceCompetency = Pick<CatalogueCompetency, "id" | "title" | "code" | "outcomes" | "contentStatus">;

/**
 * LEARN-01 item 5: the governed reference collections HQ lists (Individual policy scholar_reference_collections),
 * through S1's own read -- shared, active, published, with 395's clinical review state -- and the same content-status
 * floor as the programme catalogue. Only reached when the list is not empty. null = unreadable.
 */
export async function referenceCollections(admin: any, ids: readonly string[], min: ContentStatusLevel): Promise<ReferenceCompetency[] | null> {
  const all = await loadIndividualCatalogue(admin, ids);
  if (all === null) return null;
  return all.map(c => ({ id: c.competencyId, title: c.title, code: c.code, outcomes: c.outcomes, contentStatus: normaliseStatus(c.contentStatus) }))
    .filter(c => meetsMinStatus(c.contentStatus, min));
}

/** THE ADAPTER: S1's Scholar catalogue (HQ allowlist, shared, active, published), narrowed to the programme. */
export function scholarCatalogue(admin: any): CompetencyCatalogue {
  return {
    async forProgramme(programme) {
      if (!programme.frameworks.length) return { ok: true, data: [] };
      const all = await loadCatalogueFor(admin, "scholar");
      if (all === null) return { ok: false };
      const min = (await loadIndividualPolicy(admin)).scholarCatalogueMinStatus;
      const { kept, belowFloor } = applyContentFloor(projectForProgramme(all, programme), min);
      return { ok: true, data: kept, belowFloor, minStatus: min };
    },
  };
}

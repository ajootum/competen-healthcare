/* eslint-disable @typescript-eslint/no-explicit-any */
import { PUBLISHED } from "../professional/frameworks";

// ── THE COMPETENCY CATALOGUE SCHOLAR LEARNS AGAINST ── COMPETEN-SCHOLAR-01 S2, migrations 003, 127, 387 ──────
//
// ⚠ AN INTERFACE, NOT A CATALOGUE. S1 (IND-007) is building the layered catalogue read API. Scholar codes
// against CompetencyCatalogue below, and frameworkCatalogue() is the INTERIM adapter over the existing
// frameworks / framework_domains / framework_competencies. When S1 lands, a second adapter implements the
// same interface and nothing in S2-S4 changes. The id of a competency IS framework_competencies.id, never a
// copy: migration 388 stores it as a typed foreign key.
//
// ⚠ PROFESSION-AGNOSTIC. No code path here names a profession. What a student learns against is their
// programme (individual_scholar_programme, migration 387), and a programme is configuration rows: a
// profession, and which frameworks it uses in which LAYER (foundational, profession, specialty).
//
// ⚠ SHARED, ACTIVE AND PUBLISHED ONLY, the same rule Competen Professional applies (frameworks.ts):
// hospital_id IS NULL (an organisation's own framework is that organisation's content, and listing it to a
// person outside it would be a cross-tenant read), is_active, and pub_status = 'published'. A programme
// row that names a draft framework offers nothing from it -- configuring a programme is not publishing a
// framework. scripts/scholar-learning-harness.ts pins all three filters on every framework read here.

export const LAYERS = ["foundational", "profession", "specialty"] as const;
export type Layer = (typeof LAYERS)[number];
export const isLayer = (v: unknown): v is Layer => typeof v === "string" && (LAYERS as readonly string[]).includes(v);

export const LAYER_LABEL: Record<Layer, string> = {
  foundational: "Foundational",
  profession: "Profession",
  specialty: "Specialty",
};

/** One competency as Scholar sees it. The shape S1's read API returns. */
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
  /** What a learner should be able to do. Empty when the catalogue states none -- not invented here. */
  outcomes: string[];
};

/** A programme as configuration: which frameworks, in which layer. Read by the store from 387. */
export type ProgrammeConfig = {
  code: string;
  label: string;
  profession: string;
  country: string | null;
  level: string | null;
  frameworks: { frameworkId: string; layer: Layer; sortOrder: number }[];
};

export type CatalogueRead = { ok: true; data: CatalogueCompetency[] } | { ok: false };

export interface CompetencyCatalogue {
  /** Every competency a programme learns against, in layer order. Unreadable is { ok: false }, never []. */
  forProgramme(programme: ProgrammeConfig): Promise<CatalogueRead>;
}

const LAYER_ORDER: Record<Layer, number> = { foundational: 0, profession: 1, specialty: 2 };

/** Pure. Description text → outcome lines. Bulleted or line-separated text splits, plain prose stays whole. */
export function outcomesFrom(description: string | null | undefined): string[] {
  const text = (description ?? "").trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
  return lines.slice(0, 12).map(l => l.slice(0, 300));
}

/** THE INTERIM ADAPTER, over framework_competencies. Replaced by S1's read API behind the same interface. */
export function frameworkCatalogue(admin: any): CompetencyCatalogue {
  return {
    async forProgramme(programme) {
      const ids = programme.frameworks.map(f => f.frameworkId);
      if (!ids.length) return { ok: true, data: [] };
      try {
        const { data: fws, error: fwErr } = await admin.from("frameworks").select("id, name")
          .in("id", ids).is("hospital_id", null).eq("is_active", true).eq("pub_status", PUBLISHED);
        if (fwErr) return { ok: false };
        const offered = new Map<string, string>(((fws ?? []) as any[]).map(f => [f.id, f.name]));
        if (!offered.size) return { ok: true, data: [] };
        const { data, error } = await admin.from("framework_domains")
          .select("framework_id, name, sort_order, framework_competencies(id, name, description, code, sort_order)")
          .in("framework_id", [...offered.keys()]).order("sort_order").limit(1000);
        if (error) return { ok: false };
        const config = new Map(programme.frameworks.map(f => [f.frameworkId, f]));
        const out: (CatalogueCompetency & { _f: number; _d: number; _c: number })[] = [];
        for (const d of (data ?? []) as any[]) {
          const f = config.get(d.framework_id);
          if (!f) continue;
          for (const c of d.framework_competencies ?? []) {
            out.push({
              id: c.id, layer: f.layer, profession: programme.profession, catalogue: offered.get(d.framework_id) ?? "",
              frameworkId: d.framework_id, domain: d.name, code: c.code ?? null, title: c.name, outcomes: outcomesFrom(c.description),
              _f: f.sortOrder, _d: d.sort_order ?? 0, _c: c.sort_order ?? 0,
            });
          }
        }
        out.sort((a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer] || a._f - b._f || a._d - b._d || a._c - b._c);
        return { ok: true, data: out.map(({ _f, _d, _c, ...c }) => { void _f; void _d; void _c; return c; }) };
      } catch {
        return { ok: false };
      }
    },
  };
}

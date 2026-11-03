import { must, mustOk, type Admin, type Row } from "./db";

/**
 * Classification: the dimensions, their terms, and the terms an instrument carries.
 *
 * A dimension is an independent axis (method, subject domain, population, setting, level, specialty, keyword). An
 * instrument carries any number of terms on any axis and at most one PRIMARY term per axis, which the database holds
 * with a trigger. There are no nested folders: a hierarchy exists only inside a dimension that allows one.
 */

export type Dimension = { code: string; label: string; isActive: boolean; allowsHierarchy: boolean; position: number };
export type Term = {
  id: string; dimensionCode: string; code: string; label: string; parentId: string | null;
  sourceKind: string | null; sourceRef: string | null; isActive: boolean; position: number;
};
export type TaxonomyDimension = Dimension & { terms: Term[] };

const toDimension = (r: Row): Dimension => ({ code: r.code, label: r.label, isActive: !!r.is_active, allowsHierarchy: !!r.allows_hierarchy, position: r.position ?? 0 });
const toTerm = (r: Row): Term => ({
  id: r.id, dimensionCode: r.dimension_code, code: r.code, label: r.label, parentId: r.parent_id ?? null,
  sourceKind: r.source_kind ?? null, sourceRef: r.source_ref ?? null, isActive: !!r.is_active, position: r.position ?? 0,
});

export async function loadTaxonomy(admin: Admin): Promise<TaxonomyDimension[]> {
  const [d, t] = await Promise.all([
    admin.from("asmt_catalogue_dimension").select("code, label, is_active, allows_hierarchy, position").order("position"),
    admin.from("asmt_catalogue_term").select("id, dimension_code, code, label, parent_id, source_kind, source_ref, is_active, position").order("position").order("label"),
  ]);
  const dims = (must(d as { data: Row[] | null; error: { message: string } | null }, "dimensions") ?? []).map(toDimension);
  const terms = (must(t as { data: Row[] | null; error: { message: string } | null }, "terms") ?? []).map(toTerm);
  return dims.map(dim => ({ ...dim, terms: terms.filter(x => x.dimensionCode === dim.code) }));
}

/** The terms an instrument carries, with their dimension. */
export type InstrumentTerm = { termId: string; dimensionCode: string; dimensionLabel: string; code: string; label: string; isPrimary: boolean };

export async function loadInstrumentTerms(admin: Admin, instrumentId: string, taxonomy?: TaxonomyDimension[]): Promise<InstrumentTerm[]> {
  const links = (must(await admin.from("asmt_instrument_term").select("instrument_id, term_id, is_primary").eq("instrument_id", instrumentId),
    "instrument terms") ?? []) as Row[];
  if (!links.length) return [];
  const tax = taxonomy ?? await loadTaxonomy(admin);
  const out: InstrumentTerm[] = [];
  for (const l of links) {
    for (const dim of tax) {
      const t = dim.terms.find(x => x.id === l.term_id);
      if (t) out.push({ termId: t.id, dimensionCode: dim.code, dimensionLabel: dim.label, code: t.code, label: t.label, isPrimary: !!l.is_primary });
    }
  }
  const order = new Map(tax.map((d, i) => [d.code, i]));
  return out.sort((a, b) => (order.get(a.dimensionCode) ?? 0) - (order.get(b.dimensionCode) ?? 0) || Number(b.isPrimary) - Number(a.isPrimary) || a.label.localeCompare(b.label));
}

/** Replace the classification of an instrument. The write and its audit event are one database transaction. */
export async function classifyInstrument(admin: Admin, actor: string, instrumentId: string, terms: { termId: string; isPrimary: boolean }[]): Promise<void> {
  const res = await admin.rpc("asmt_catalogue_classify", {
    p_instrument: instrumentId,
    p_terms: terms.map(t => ({ term_id: t.termId, is_primary: t.isPrimary })),
    p_actor: actor,
  });
  mustOk(res as { error: { message: string } | null }, "classify");
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
export const termCodeFrom = (label: string) => {
  const s = slug(label);
  return /^[a-z0-9]/.test(s) ? s : "";
};

export type TermInput = { dimensionCode: string; label: string; code?: string; parentId?: string | null; sourceKind?: string | null; sourceRef?: string | null; position?: number };

export async function createTerm(admin: Admin, input: TermInput): Promise<void> {
  const code = (input.code?.trim() || termCodeFrom(input.label));
  if (!code) throw new Error("A term needs a label with letters or digits in it");
  const res = await admin.from("asmt_catalogue_term").insert({
    dimension_code: input.dimensionCode, code, label: input.label.trim(),
    parent_id: input.parentId || null, source_kind: input.sourceKind || null, source_ref: input.sourceRef || null, position: input.position ?? 100,
  });
  mustOk(res, "create term");
}

export async function updateTerm(admin: Admin, termId: string, patch: { label?: string; isActive?: boolean; position?: number; parentId?: string | null }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.label !== undefined) { if (!patch.label.trim()) throw new Error("A term needs a label"); row.label = patch.label.trim(); }
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  if (patch.position !== undefined) row.position = patch.position;
  if (patch.parentId !== undefined) row.parent_id = patch.parentId || null;
  if (!Object.keys(row).length) return;
  mustOk(await admin.from("asmt_catalogue_term").update(row).eq("id", termId), "update term");
}

export async function updateDimension(admin: Admin, code: string, patch: { label?: string; isActive?: boolean; position?: number; allowsHierarchy?: boolean }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.label !== undefined) { if (!patch.label.trim()) throw new Error("A dimension needs a label"); row.label = patch.label.trim(); }
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  if (patch.allowsHierarchy !== undefined) row.allows_hierarchy = patch.allowsHierarchy;
  if (patch.position !== undefined) row.position = patch.position;
  if (!Object.keys(row).length) return;
  mustOk(await admin.from("asmt_catalogue_dimension").update(row).eq("code", code), "update dimension");
}

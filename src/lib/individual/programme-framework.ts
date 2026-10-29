/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadCatalogueForPreview, isRequirement, type Requirement } from "@/lib/competency/foundation";
import { loadEntryComponents, type ComponentRequirement, type Level } from "@/lib/competency/studio-components";
import { loadScalesWithMappings, publishedOf, stageFor } from "@/lib/competency/stage-mapping";
import { projectForProgramme, type CatalogueCompetency, type Layer, type ProgrammeConfig } from "./scholar/catalogue";
import { loadIndividualPolicy, meetsMinStatus } from "./policy";

// ── PROGRAMME FRAMEWORKS: CONFIGURATION AND PREVIEW ── CFCA-STUDIO-P1 items 4, 9, 10 (migration 660) ────────────
//
// A PROGRAMME FRAMEWORK is a controlled catalogue (394) that NAMES the shared competencies a programme uses, each
// with the programme's own requirement (required, recommended, optional), target level and CCHU component
// requirements (660). It is linked to a Scholar programme (387), which may name its qualification level (660).
// One shared master catalogue, many programme frameworks: no competency is defined twice for different cadres.
//
// ⚠ THE PREVIEW IS THE LEARNER'S PROJECTION, NOT A SECOND ONE. It resolves a programme through the SAME pure
// function Scholar uses (projectForProgramme, over S1's read), so what HQ sees is what a learner of that
// programme is offered -- plus what is not offered yet, and why (catalogue not published, not allowlisted for
// Scholar, content below the clinical-status floor). A draft catalogue can be previewed on its own before it is
// published. The preview read is HQ-only (loadCatalogueForPreview), and offers nothing to anybody.
//
// ⚠ EDITS ARE DRAFT-ONLY, ENFORCED BY THE DATABASE. The overlay and the component requirements of a catalogue in
// review or published are frozen by the 394 and 660 triggers. Changing them means a new draft version, clinical
// review where it applies, and independent publication -- the existing governed path.

export type QualificationTerm = { id: string; label: string; code: string | null };
export type StudioProgramme = {
  code: string; label: string; profession: string; level: string | null; isActive: boolean;
  qualification: QualificationTerm | null; frameworks: { frameworkId: string; layer: Layer; sortOrder: number }[];
};
export type StudioCatalogue = { id: string; name: string; code: string | null; status: string; layer: string | null; entries: number };

export type PreviewRow = CatalogueCompetency & {
  targetStage: string | null;
  components: ComponentRequirement[];
  /** Why a learner of the programme is not offered it today. Empty = offered. */
  notOffered: string[];
};
export type ProgrammePreview = {
  subject: { kind: "programme"; programme: StudioProgramme } | { kind: "catalogue"; catalogue: StudioCatalogue };
  catalogues: (StudioCatalogue & { allowlisted: boolean; layerInProgramme: Layer })[];
  rows: PreviewRow[];
  counts: Record<Requirement, number> & { offered: number; total: number };
  minStatus: string;
  stageLabels: Record<string, string>;
};

const rows = async (p: PromiseLike<any>) => { try { const r = await p; return r?.error ? null : (r?.data ?? []); } catch { return null; } };

export async function listQualificationTerms(admin: any): Promise<QualificationTerm[] | null> {
  const t = await rows(admin.from("taxonomies").select("id").eq("kind", "qualification_level").limit(1));
  if (t === null) return null;
  if (!t.length) return [];
  const terms = await rows(admin.from("taxonomy_terms").select("id, value, code, sort_order").eq("taxonomy_id", t[0].id).order("sort_order"));
  return terms === null ? null : terms.map((x: any) => ({ id: x.id, label: x.value, code: x.code ?? null }));
}

/** Every Scholar programme with its qualification and catalogue links. null = unreadable. */
export async function listStudioProgrammes(admin: any): Promise<StudioProgramme[] | null> {
  const [p, l, q] = await Promise.all([
    rows(admin.from("individual_scholar_programme").select("code, label, profession, level, is_active, qualification_term_id").order("label").limit(500)),
    rows(admin.from("individual_scholar_programme_framework").select("programme_code, framework_id, layer, sort_order").order("sort_order").limit(5000)),
    listQualificationTerms(admin),
  ]);
  if (p === null || l === null || q === null) return null;
  const terms = new Map(q.map(t => [t.id, t]));
  return p.map((r: any) => ({
    code: r.code, label: r.label, profession: r.profession, level: r.level ?? null, isActive: r.is_active !== false,
    qualification: r.qualification_term_id ? terms.get(r.qualification_term_id) ?? null : null,
    frameworks: l.filter((x: any) => x.programme_code === r.code).map((x: any) => ({ frameworkId: String(x.framework_id), layer: x.layer, sortOrder: x.sort_order ?? 0 })),
  }));
}

/** Shared catalogues: classified frameworks, and any that name competencies. null = unreadable. */
export async function listStudioCatalogues(admin: any): Promise<StudioCatalogue[] | null> {
  const [fws, entries] = await Promise.all([
    rows(admin.from("frameworks").select("id, name, code, pub_status, competency_layer").is("hospital_id", null).order("name")),
    rows(admin.from("competency_catalogue_entry").select("catalogue_id")),
  ]);
  if (fws === null || entries === null) return null;
  const count = new Map<string, number>();
  for (const e of entries) count.set(e.catalogue_id, (count.get(e.catalogue_id) ?? 0) + 1);
  return fws.filter((f: any) => f.competency_layer || count.has(f.id)).map((f: any) => ({
    id: String(f.id), name: f.name, code: f.code ?? null, status: f.pub_status ?? "draft", layer: f.competency_layer ?? null, entries: count.get(f.id) ?? 0,
  }));
}

/** Pure: the preview rows from the projection, with stages, components and the reasons a row is not offered. */
export function annotate(projected: CatalogueCompetency[], ctx: {
  catalogues: ReadonlyMap<string, { status: string; allowlisted: boolean }>; minStatus: string;
  stageOf: (levelId: string | null | undefined, score: number | null | undefined) => string | null;
  components: ReadonlyMap<string, ComponentRequirement[]>;
}): PreviewRow[] {
  return projected.map(c => {
    const cat = ctx.catalogues.get(c.frameworkId);
    const notOffered: string[] = [];
    if (cat && cat.status !== "published") notOffered.push(`Its catalogue is ${cat.status}, not published.`);
    if (cat && !cat.allowlisted) notOffered.push("Its catalogue is not allowed for Scholar (Individual policy).");
    if (!meetsMinStatus(c.contentStatus, ctx.minStatus as never)) notOffered.push(`Its content is ${c.contentStatus === "draft" ? "a draft" : "not clinically reviewed"}, below the Scholar floor.`);
    return {
      ...c, targetStage: ctx.stageOf(c.expectedLevelId, c.expectedLevel?.score),
      components: c.overlayEntryId ? ctx.components.get(c.overlayEntryId) ?? [] : [], notOffered,
    };
  });
}

/**
 * The resolved programme framework: every competency, its requirement, target level and stage, its components,
 * and whether a learner is offered it today. For a programme, or for one catalogue previewed on its own.
 */
export async function loadProgrammePreview(admin: any, subject: { programmeCode: string } | { catalogueId: string }): Promise<ProgrammePreview | { error: string }> {
  const [programmes, catalogues, policy, scales] = await Promise.all([
    listStudioProgrammes(admin), listStudioCatalogues(admin), loadIndividualPolicy(admin), loadScalesWithMappings(admin),
  ]);
  if (programmes === null || catalogues === null || scales === null) return { error: "The programme frameworks could not be read just now." };
  const byId = new Map(catalogues.map(c => [c.id, c]));
  let config: ProgrammeConfig; let head: ProgrammePreview["subject"];
  if ("programmeCode" in subject) {
    const p = programmes.find(x => x.code === subject.programmeCode);
    if (!p) return { error: "That programme does not exist." };
    config = { code: p.code, label: p.label, profession: p.profession, country: null, level: p.level, frameworks: p.frameworks };
    head = { kind: "programme", programme: p };
  } else {
    const c = byId.get(subject.catalogueId);
    if (!c) return { error: "That catalogue does not exist, or is not a shared catalogue." };
    const layer = (c.layer ?? "profession") as Layer;
    config = { code: "preview", label: c.name, profession: "", country: null, level: null, frameworks: [{ frameworkId: c.id, layer, sortOrder: 0 }] };
    head = { kind: "catalogue", catalogue: c };
  }
  const ids = config.frameworks.map(f => f.frameworkId);
  const all = await loadCatalogueForPreview(admin, ids);
  if (all === null) return { error: "The catalogues could not be read just now." };
  const projected = projectForProgramme(all, config);

  // Stages: each target level through the PUBLISHED mapping of its own scale.
  const levelScale = new Map<string, string>(); const levels = new Map<string, Level>();
  for (const s of scales) for (const l of s.levels) { levelScale.set(l.id, s.id); levels.set(l.id, { ...l, scaleId: s.id }); }
  const published = new Map(scales.map(s => [s.id, publishedOf(s)]));
  const stageOf = (levelId: string | null | undefined, score: number | null | undefined) => {
    const m = levelId ? published.get(levelScale.get(levelId) ?? "") : null;
    return m ? stageFor(score, m.bands) : null;
  };
  const components = await loadEntryComponents(admin, projected.map(c => c.overlayEntryId).filter((x): x is string => !!x), levels);
  const allowed = new Set(policy.scholarCatalogues.map(x => String(x).toLowerCase()));
  const catMeta = new Map(ids.map(id => [id, { status: byId.get(id)?.status ?? "unknown", allowlisted: allowed.has(id.toLowerCase()) }]));
  const out = annotate(projected, { catalogues: catMeta, minStatus: policy.scholarCatalogueMinStatus, stageOf, components: components ?? new Map() });
  const stageRows = await rows(admin.from("competency_stage").select("code, label"));
  const counts = { required: 0, recommended: 0, optional: 0, offered: 0, total: out.length } as ProgrammePreview["counts"];
  for (const r of out) { counts[isRequirement(r.requirement) ? r.requirement : "required"]++; if (!r.notOffered.length) counts.offered++; }
  return {
    subject: head,
    catalogues: config.frameworks.map(f => ({ ...(byId.get(f.frameworkId) ?? { id: f.frameworkId, name: "A catalogue that is no longer shared", code: null, status: "unknown", layer: null, entries: 0 }),
      allowlisted: allowed.has(f.frameworkId.toLowerCase()), layerInProgramme: f.layer })),
    rows: out, counts, minStatus: policy.scholarCatalogueMinStatus,
    stageLabels: Object.fromEntries((stageRows ?? []).map((s: any) => [s.code, s.label])),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import { byOrder } from "./layout-order";

// ── DRAFT VERSUS PUBLISHED ── FRAMEWORK-DESIGN-STUDIO-02 S1, capability 4 (G7) ─────────────────────────────────────
//
// What changed since a framework's last published version: its live rows against the framework_versions snapshot
// taken at publication (framework-lifecycle.ts). Read only, never a governance decision: the 395 fingerprint and the
// 466/640 guards stay the authority on what needs review and who may publish.
//
// Snapshots taken before FRAMEWORK-DESIGN-STUDIO-01 (750/751) carry competency ids but no domain or criterion ids, so
// domains are then matched by name and criteria by (section, text): a reworded criterion reads as one removed and
// one added. A snapshot does not record whether a criterion was retired, so every snapshot criterion counts as active.
//
// The pure part (normalise + diffFramework) is client-safe; loadFrameworkDiff is the server read.

export type DiffCriterion = { id: string | null; text: string; component: string | null; sortOrder: number | null; active: boolean };
export type DiffCompetency = {
  id: string; code: string | null; name: string; description: string | null; learningOutcomes: string[]; expectedLevelId: string | null;
  riskCategory: string | null; practiceId: string | null; cpuId: string | null; sortOrder: number | null; criteria: DiffCriterion[];
};
export type DiffDomain = { id: string | null; name: string; code: string | null; sortOrder: number | null; competencies: DiffCompetency[] };
export type DiffFramework = { name: string; description: string | null; componentOrder: string[] | null; domains: DiffDomain[] };

export type FieldChange = { field: "code" | "name" | "description" | "learningOutcomes" | "expectedLevelId" | "riskCategory" | "practiceId" | "cpuId"; before: unknown; after: unknown;
  /** In the 395 content fingerprint: a change sends the competency back to clinical review. */
  clinical: boolean };
export type CritRef = { id: string | null; text: string; component: string | null };
export type CompetencyChange = {
  id: string; code: string | null; name: string; domain: string;
  fields: FieldChange[];
  /** The competency now sits in another domain (organisational, D3). */
  movedDomain: { from: string; to: string } | null;
  criteria: {
    added: CritRef[]; retired: CritRef[]; removed: CritRef[];
    textChanged: { id: string; component: string | null; before: string; after: string }[];
    /** Into this competency from another, or into another section of it. */
    moved: { id: string; text: string; from: { competencyId: string; component: string | null }; to: { competencyId: string; component: string | null } }[];
    /** Out of this competency into another (listed again, as moved, on the competency it went to). */
    movedOut: { id: string; text: string; toCompetencyId: string }[];
    /** Sections whose criteria order changed. */
    reordered: (string | null)[];
  };
  /** Its place among its domain's competencies changed. */
  reordered: boolean;
};
export type FrameworkDiff = {
  framework: { field: "name" | "description"; before: string | null; after: string | null }[];
  domains: { added: { id: string | null; name: string }[]; removed: { id: string | null; name: string }[]; renamed: { id: string; before: string; after: string }[]; reordered: boolean };
  competencies: { added: { id: string; code: string | null; name: string; domain: string }[]; removed: { id: string; code: string | null; name: string; domain: string }[]; changed: CompetencyChange[] };
  sectionOrderChanged: boolean;
  counts: { competenciesAdded: number; competenciesRemoved: number; competenciesChanged: number; criteriaAdded: number; criteriaRetired: number; criteriaRemoved: number; criteriaTextChanged: number; criteriaMoved: number };
  unchanged: boolean;
};

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const sortRows = <T extends { sortOrder: number | null; name?: string; text?: string; id: string | null }>(xs: T[]) =>
  [...xs].sort((a, b) => byOrder({ sortOrder: a.sortOrder, name: a.name ?? a.text ?? "", id: a.id ?? "" }, { sortOrder: b.sortOrder, name: b.name ?? b.text ?? "", id: b.id ?? "" }));

/** Pure: a framework_versions snapshot, or a live frameworks row read with the same nesting, in one shape. */
export function normalise(row: any): DiffFramework {
  return {
    name: String(row?.name ?? ""), description: row?.description ?? null,
    componentOrder: Array.isArray(row?.component_order) ? row.component_order.map(String) : null,
    domains: sortRows((row?.framework_domains ?? []).map((d: any) => ({
      id: d.id ?? null, name: String(d.name ?? ""), code: d.code ?? null, sortOrder: d.sort_order ?? null,
      competencies: sortRows((d.framework_competencies ?? []).map((c: any) => ({
        id: String(c.id), code: c.code ?? null, name: String(c.name ?? ""), description: c.description ?? null, learningOutcomes: arr(c.learning_outcomes),
        expectedLevelId: c.expected_level_id ?? null, riskCategory: c.risk_category ?? null, practiceId: c.practice_id ?? null, cpuId: c.cpu_id ?? null, sortOrder: c.sort_order ?? null,
        criteria: sortRows((c.competency_skills ?? []).map((k: any) => ({ id: k.id ?? null, text: String(k.name ?? ""), component: k.component_code ?? null, sortOrder: k.sort_order ?? null, active: k.is_active !== false }))),
      }))),
    }))),
  };
}

const FIELDS: { field: FieldChange["field"]; clinical: boolean }[] = [
  { field: "code", clinical: false }, { field: "name", clinical: true }, { field: "description", clinical: true }, { field: "learningOutcomes", clinical: true },
  { field: "expectedLevelId", clinical: true }, { field: "riskCategory", clinical: true }, { field: "practiceId", clinical: true }, { field: "cpuId", clinical: true },
];
const eq = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Pure: whether the common ids keep their relative order. */
const sameOrder = (a: readonly string[], b: readonly string[]) => { const s = new Set(b); const x = a.filter(i => s.has(i)), t = new Set(x), y = b.filter(i => t.has(i)); return x.every((v, i) => v === y[i]); };
const ref = (k: DiffCriterion): CritRef => ({ id: k.id, text: k.text, component: k.component });

/** Pure: the draft (live rows) against the last published version. */
export function diffFramework(published: DiffFramework, draft: DiffFramework): FrameworkDiff {
  const framework: FrameworkDiff["framework"] = [];
  if (published.name !== draft.name) framework.push({ field: "name", before: published.name, after: draft.name });
  if ((published.description ?? null) !== (draft.description ?? null)) framework.push({ field: "description", before: published.description, after: draft.description });

  // Domains: by id where the snapshot has one, else by name.
  const dKey = (d: DiffDomain, byName: boolean) => (byName || !d.id ? `n:${d.name}` : `i:${d.id}`);
  const byName = published.domains.some(d => !d.id);
  const pD = new Map(published.domains.map(d => [dKey(d, byName), d])), lD = new Map(draft.domains.map(d => [dKey(d, byName), d]));
  const domains: FrameworkDiff["domains"] = {
    added: draft.domains.filter(d => !pD.has(dKey(d, byName))).map(d => ({ id: d.id, name: d.name })),
    removed: published.domains.filter(d => !lD.has(dKey(d, byName))).map(d => ({ id: d.id, name: d.name })),
    renamed: byName ? [] : draft.domains.flatMap(d => { const p = pD.get(dKey(d, false)); return p && p.name !== d.name && d.id ? [{ id: d.id, before: p.name, after: d.name }] : []; }),
    reordered: !sameOrder(published.domains.map(d => dKey(d, byName)), draft.domains.map(d => dKey(d, byName))),
  };

  type At = { c: DiffCompetency; d: DiffDomain };
  const flat = (f: DiffFramework) => new Map<string, At>(f.domains.flatMap(d => d.competencies.map(c => [c.id, { c, d }] as const)));
  const pC = flat(published), lC = flat(draft);
  // Criteria by id across the whole framework, so a move between competencies is seen as a move.
  const critAt = (f: DiffFramework) => new Map<string, { k: DiffCriterion; competencyId: string }>(f.domains.flatMap(d => d.competencies.flatMap(c => c.criteria.filter(k => k.id).map(k => [k.id!, { k, competencyId: c.id }] as const))));
  const pK = critAt(published), lK = critAt(draft);
  const withIds = published.domains.every(d => d.competencies.every(c => c.criteria.every(k => k.id)));

  const added = [...lC.values()].filter(x => !pC.has(x.c.id)).map(x => ({ id: x.c.id, code: x.c.code, name: x.c.name, domain: x.d.name }));
  const removed = [...pC.values()].filter(x => !lC.has(x.c.id)).map(x => ({ id: x.c.id, code: x.c.code, name: x.c.name, domain: x.d.name }));
  const changed: CompetencyChange[] = [];
  for (const { c, d } of lC.values()) {
    const before = pC.get(c.id);
    if (!before) continue;
    const p = before.c;
    const fields = FIELDS.filter(f => !eq((p as any)[f.field], (c as any)[f.field])).map(f => ({ field: f.field, before: (p as any)[f.field], after: (c as any)[f.field], clinical: f.clinical }));
    const movedDomain = dKey(before.d, byName) !== dKey(d, byName) ? { from: before.d.name, to: d.name } : null;
    const crit: CompetencyChange["criteria"] = { added: [], retired: [], removed: [], textChanged: [], moved: [], movedOut: [], reordered: [] };
    if (withIds) {
      for (const k of c.criteria) {
        const was = k.id ? pK.get(k.id) : undefined;
        if (!was) { if (k.active) crit.added.push(ref(k)); continue; }
        if (!k.active) { crit.retired.push(ref(k)); continue; }
        if (was.k.text !== k.text) crit.textChanged.push({ id: k.id!, component: k.component, before: was.k.text, after: k.text });
        if (was.competencyId !== c.id || (was.k.component ?? null) !== (k.component ?? null))
          crit.moved.push({ id: k.id!, text: k.text, from: { competencyId: was.competencyId, component: was.k.component }, to: { competencyId: c.id, component: k.component } });
      }
      for (const k of p.criteria) {
        const now = k.id ? lK.get(k.id) : undefined;
        if (!now) crit.removed.push(ref(k));
        else if (now.competencyId !== c.id) crit.movedOut.push({ id: k.id!, text: k.text, toCompetencyId: now.competencyId });
      }
    } else {
      // Before 750 snapshots: (section, text) as a multiset.
      const key = (k: DiffCriterion) => `${k.component ?? ""}\u0000${k.text}`;
      const pool = new Map<string, number>();
      for (const k of p.criteria) pool.set(key(k), (pool.get(key(k)) ?? 0) + 1);
      for (const k of c.criteria.filter(x => x.active)) { const n = pool.get(key(k)) ?? 0; if (n) pool.set(key(k), n - 1); else crit.added.push(ref(k)); }
      const left = new Map(pool);
      for (const k of p.criteria) { const n = left.get(key(k)) ?? 0; if (n) { left.set(key(k), n - 1); crit.removed.push(ref(k)); } }
    }
    if (withIds) {
      const sections = [...new Set(c.criteria.map(k => k.component ?? null))];
      for (const s of sections) {
        const now = c.criteria.filter(k => k.active && (k.component ?? null) === s && k.id).map(k => k.id!);
        const then = p.criteria.filter(k => (k.component ?? null) === s && k.id).map(k => k.id!);
        if (!sameOrder(then, now)) crit.reordered.push(s);
      }
    }
    // Its place among the competencies both versions of its domain hold.
    const pd = movedDomain ? undefined : published.domains.find(x => dKey(x, byName) === dKey(d, byName));
    const reordered = !!pd && (() => {
      const live = new Set(d.competencies.map(x => x.id)), then = new Set(pd.competencies.map(x => x.id));
      return pd.competencies.map(x => x.id).filter(i => live.has(i)).indexOf(c.id) !== d.competencies.map(x => x.id).filter(i => then.has(i)).indexOf(c.id);
    })();
    const any = fields.length || movedDomain || reordered || Object.values(crit).some(v => v.length);
    if (any) changed.push({ id: c.id, code: c.code, name: c.name, domain: d.name, fields, movedDomain, criteria: crit, reordered });
  }
  const sum = (f: (x: CompetencyChange) => number) => changed.reduce((n, x) => n + f(x), 0);
  const counts = {
    competenciesAdded: added.length, competenciesRemoved: removed.length, competenciesChanged: changed.length,
    criteriaAdded: sum(x => x.criteria.added.length) + [...lC.values()].filter(x => !pC.has(x.c.id)).reduce((n, x) => n + x.c.criteria.filter(k => k.active && !(k.id && pK.has(k.id))).length, 0),
    criteriaRetired: sum(x => x.criteria.retired.length), criteriaRemoved: sum(x => x.criteria.removed.length),
    criteriaTextChanged: sum(x => x.criteria.textChanged.length), criteriaMoved: sum(x => x.criteria.moved.length),
  };
  const sectionOrderChanged = !eq(published.componentOrder, draft.componentOrder);
  const unchanged = !framework.length && !domains.added.length && !domains.removed.length && !domains.renamed.length && !domains.reordered && !added.length && !removed.length && !changed.length && !sectionOrderChanged;
  return { framework, domains, competencies: { added, removed, changed }, sectionOrderChanged, counts, unchanged };
}

// ── The server read ──────────────────────────────────────────────────────────────────────────────────────────

export type DiffResponse =
  | { status: "no_published_version"; framework: { id: string; name: string; pubStatus: string } }
  | { status: "compared"; framework: { id: string; name: string; pubStatus: string }; version: { num: number; label: string; publishedAt: string | null; publishedBy: string | null }; diff: FrameworkDiff };

const LIVE = (withLayout: boolean) => `name, description${withLayout ? ", component_order" : ""},
  framework_domains(id, name, code, sort_order,
    framework_competencies(id, code, name, description, sort_order, learning_outcomes, expected_level_id, risk_category, practice_id, cpu_id,
      competency_skills(id, name, sort_order, ${withLayout ? "component_code, " : ""}is_active)))`;

/** compare_published: the framework's live rows against its last framework_versions snapshot. Shared frameworks only. */
export async function loadFrameworkDiff(admin: any, frameworkId: string): Promise<DiffResponse | { status: number; error: string }> {
  const { data: fw, error } = await admin.from("frameworks").select("id, name, pub_status, hospital_id").eq("id", frameworkId).maybeSingle();
  if (error) return { status: 503, error: "The framework could not be read just now." };
  if (!fw || fw.hospital_id !== null) return { status: 404, error: "That is not a shared framework." };
  const head = { id: fw.id, name: fw.name, pubStatus: fw.pub_status ?? "draft" };
  const { data: vs, error: vErr } = await admin.from("framework_versions").select("version_num, published_at, published_by_name, snapshot").eq("framework_id", fw.id).order("version_num", { ascending: false }).limit(1);
  if (vErr) return { status: 503, error: "The published versions could not be read just now." };
  const v = vs?.[0];
  if (!v?.snapshot) return { status: "no_published_version", framework: head };
  let live = await admin.from("frameworks").select(LIVE(true)).eq("id", fw.id).single();
  if (live.error) live = await admin.from("frameworks").select(LIVE(false)).eq("id", fw.id).single();
  if (live.error || !live.data) return { status: 503, error: "The draft could not be read just now." };
  const s = v.snapshot;
  return {
    status: "compared", framework: head,
    version: { num: v.version_num, label: s.version_label ?? `${s.version_major ?? 1}.${s.version_minor ?? 0}.${s.version_revision ?? 0}`, publishedAt: v.published_at ?? null, publishedBy: v.published_by_name ?? null },
    diff: diffFramework(normalise(s), normalise(live.data)),
  };
}

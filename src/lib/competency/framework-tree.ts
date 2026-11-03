import { applyLayout, groupByArea, type LayoutTree, type LayoutV1, type TreeArea, type TreeDomain } from "./layout-order";

// ── THE LAID-OUT FRAMEWORK TREE, PURE ── shared by the HQ Studio and the Scholar Explorer (SCHOLAR-COMPETENCY-EXPLORER-HFE-01) ──
//
// One helper turns a framework's records (Areas, domains with their Area, competencies with their domain, each with
// its saved sort position) into the tree a page shows: Framework -> Area -> Domain -> Competency, in the SAVED order,
// through the same two rules the Studio applies (layout-order.ts applyLayout, then groupByArea). Nothing here infers
// an Area from a domain's name, sorts alphabetically by default, or knows a profession: the records decide.
//
//   HQ Studio    the live order with a pending layout draft applied (the editor's view)
//   Scholar      the published order only (layout null): learners never see a draft
//
// A domain with no Area, or whose Area is not among the framework's Areas, lands in the group with `area: null`. The
// caller labels that group ("unassigned") and says so to framework administrators: it is a structural gap in the
// records, never hidden and never guessed away. A competency whose domain is not a domain of the framework (a
// controlled-catalogue reference, 394) is listed in `unplacedCompetencyIds` so the caller can place it honestly.

export type TreeInput = {
  /** 760. undefined: Areas were not read (no grouping by Area is possible). [] : read, none defined. */
  areas?: { id: string; name: string; sortOrder: number | null }[] | null;
  domains: { id: string; name: string; code?: string | null; sortOrder: number | null; areaId?: string | null }[];
  competencies: { id: string; name: string; domainId: string; sortOrder: number | null; criteria?: { id: string; name: string; sortOrder: number | null; component: string | null }[] }[];
  /** The framework's live section order (null: the registry's). Only the Studio cares. */
  componentOrder?: string[] | null;
  registry?: string[];
};

export type FrameworkTreeDomain = { id: string; name: string; code: string | null; competencyIds: string[] };
export type FrameworkTreeArea = {
  /** null: the domains with no (known) Area. */
  area: { id: string; name: string } | null;
  domains: FrameworkTreeDomain[];
};
export type FrameworkTree = {
  areas: FrameworkTreeArea[];
  /** Areas were read for this framework (760). False: no Area level exists to show. */
  areasRead: boolean;
  /** Domains that have no Area although the framework defines Areas: the structural gap to flag. */
  unassignedDomainIds: string[];
  /** Competencies whose domain is not one of the framework's domains. */
  unplacedCompetencyIds: string[];
};

/** Pure: the framework's records as the LayoutTree applyLayout works on. Criteria are carried when given (the Studio needs them). */
export function toLayoutTree(input: TreeInput): LayoutTree {
  const byDomain = new Map<string, TreeDomain["competencies"]>();
  for (const c of input.competencies) {
    const list = byDomain.get(c.domainId) ?? [];
    list.push({ id: c.id, name: c.name, sortOrder: c.sortOrder, criteria: (c.criteria ?? []).map(k => ({ id: k.id, name: k.name, sortOrder: k.sortOrder, component: k.component })) });
    byDomain.set(c.domainId, list);
  }
  const areasKnown = input.areas !== undefined && input.areas !== null;
  return {
    componentOrder: input.componentOrder ?? null,
    registry: input.registry ?? [],
    ...(areasKnown ? { areas: (input.areas ?? []).map((a): TreeArea => ({ id: a.id, name: a.name, sortOrder: a.sortOrder })) } : {}),
    domains: input.domains.map((d): TreeDomain => ({ id: d.id, name: d.name, sortOrder: d.sortOrder, competencies: byDomain.get(d.id) ?? [], ...(areasKnown ? { areaId: d.areaId ?? null } : {}) })),
  };
}

/** Pure: the tree as a page shows it -- Area by Area, domain by domain, competency by competency, in the saved (or laid-out) order. */
export function frameworkTree(input: TreeInput, layout: LayoutV1 | null = null): FrameworkTree {
  const laid = applyLayout(toLayoutTree(input), layout);
  const codeOf = new Map(input.domains.map(d => [d.id, d.code ?? null]));
  const areasRead = laid.areas !== undefined;
  const groups = groupByArea(laid);
  const areas: FrameworkTreeArea[] = groups
    .filter(g => g.area !== null || g.domains.length > 0)
    .map(g => ({ area: g.area ? { id: g.area.id, name: g.area.name } : null, domains: g.domains.map(d => ({ id: d.id, name: d.name, code: codeOf.get(d.id) ?? null, competencyIds: d.competencies.map(c => c.id) })) }));
  const domainIds = new Set(input.domains.map(d => d.id));
  return {
    areas,
    areasRead,
    unassignedDomainIds: areasRead && (laid.areas ?? []).length > 0 ? (groups.find(g => g.area === null)?.domains ?? []).map(d => d.id) : [],
    unplacedCompetencyIds: input.competencies.filter(c => !domainIds.has(c.domainId)).map(c => c.id),
  };
}

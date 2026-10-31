// ── FRAMEWORK-DESIGN-STUDIO-02 S4: the pure parts of the Studio's Areas, organisational moves and framework map ──────
// Client-safe and profession-agnostic. The server decides (framework-areas.ts, layout-order.ts); these helpers only
// compute what the screen shows and the optimistic list a move leads to. Nothing here reads or writes data.

import { revisionTags, type RevMark } from "./revision-ui";

export type StudioArea = { id: string; name: string };
export type AreaGroup<D> = { area: StudioArea | null; domains: D[] };

/**
 * Pure: the domains grouped by Area, in the order given (Areas in their order, each Area's domains in their order),
 * then the domains with no Area. With no Areas, one group with area null holding every domain (a flat tree). An
 * "Unassigned" group appears only when Areas exist and at least one domain has none; an empty Area keeps its group.
 */
export function groupDomains<D extends { areaId?: string | null }>(domains: readonly D[], areas?: readonly StudioArea[] | null): AreaGroup<D>[] {
  if (!areas?.length) return [{ area: null, domains: [...domains] }];
  const known = new Set(areas.map(a => a.id));
  const groups: AreaGroup<D>[] = areas.map(a => ({ area: a, domains: domains.filter(d => d.areaId === a.id) }));
  const none = domains.filter(d => !d.areaId || !known.has(d.areaId));
  return none.length ? [...groups, { area: null, domains: none }] : groups;
}

/** Pure: `all` with the slots held by `group` refilled in the order `next` (the rest do not move). The order to send for a part of a list. */
export function expandOrder(all: readonly string[], group: readonly string[], next: readonly string[]): string[] {
  const inGroup = new Set(group), queue = [...next];
  return all.map(id => (inGroup.has(id) ? queue.shift() ?? id : id));
}

/** Pure: a copy of the domains with one placed in an Area (null: none). Unknown domain: unchanged. */
export function setDomainArea<D extends { id: string; areaId?: string | null }>(domains: readonly D[], domainId: string, areaId: string | null): D[] {
  return domains.map(d => (d.id === domainId ? { ...d, areaId } : d));
}

/**
 * Pure: a copy of the domains with a competency moved to another domain, at `position` (0-based in the target after the
 * move; omitted or out of range = last). Unknown competency or domain: unchanged. The competency itself is not edited.
 */
export function moveCompetency<C extends { id: string }, D extends { id: string; competencies: C[] }>(domains: readonly D[], competencyId: string, toDomainId: string, position?: number | null): D[] {
  const comp = domains.flatMap(d => d.competencies).find(c => c.id === competencyId);
  if (!comp || !domains.some(d => d.id === toDomainId)) return [...domains];
  const without = domains.map(d => ({ ...d, competencies: d.competencies.filter(c => c.id !== competencyId) }));
  return without.map(d => {
    if (d.id !== toDomainId) return d;
    const at = position == null || position < 0 || position > d.competencies.length ? d.competencies.length : position;
    return { ...d, competencies: [...d.competencies.slice(0, at), comp, ...d.competencies.slice(at)] };
  });
}

// ── drag between parents ──
export type DragSource = { kind: "domain"; id: string; areaId: string | null } | { kind: "competency"; id: string; domainId: string };
export type DropTarget = { kind: "area"; areaId: string | null } | { kind: "domain"; domainId: string };
export type OrgAction =
  | { action: "set_domain_area"; domainId: string; areaId: string | null }
  | { action: "move_competency_domain"; competencyId: string; domainId: string };

/** Pure: what dropping `src` on `tgt` asks for, or null when the drop means nothing (same parent, or not a compatible parent). */
export function dropAction(src: DragSource, tgt: DropTarget): OrgAction | null {
  if (src.kind === "domain" && tgt.kind === "area") return (src.areaId ?? null) === tgt.areaId ? null : { action: "set_domain_area", domainId: src.id, areaId: tgt.areaId };
  if (src.kind === "competency" && tgt.kind === "domain") return src.domainId === tgt.domainId ? null : { action: "move_competency_domain", competencyId: src.id, domainId: tgt.domainId };
  return null;
}

// ── words a screen reader hears ──
export const announceAreaMove = (domain: string, area: string | null) => (area ? `Moved ${domain} to the Area ${area}.` : `Moved ${domain} out of its Area. It is now unassigned.`);
export const announceCompetencyMove = (competency: string, domain: string) => `Moved ${competency} to the domain ${domain}.`;

// ── the framework map ──
export type MapSource = { id: string; name: string; areaId?: string | null; competencies: { id: string; code: string | null; name: string; status: string; criteria: { active?: boolean; [k: string]: unknown }[]; rev?: RevMark }[] };
/** `tags` (S6): what an open revision does to the competency ("Changed", "New", "2 retired"); absent when it does nothing. */
export type MapChip = { id: string; code: string | null; name: string; criteria: number; status: string; tags?: string[] };
export type MapDomain = { id: string; name: string; chips: MapChip[] };
export type MapColumn = { key: string; title: string; unassigned: boolean; domains: MapDomain[] };

/** Pure: the map's columns: one per Area (the Area's name; "Unassigned" for domains with none), each holding domain cards of competency chips. No Areas: one column "Domains". */
export function mapModel(domains: readonly MapSource[], areas?: readonly StudioArea[] | null): MapColumn[] {
  const toDomain = (d: MapSource): MapDomain => ({ id: d.id, name: d.name, chips: d.competencies.map(c => { const tags = revisionTags(c.rev); return { id: c.id, code: c.code, name: c.name, criteria: c.criteria.filter(k => k.active !== false).length, status: c.status, ...(tags.length ? { tags } : {}) }; }) });
  const groups = groupDomains(domains, areas);
  if (!areas?.length) return [{ key: "all", title: "Domains", unassigned: false, domains: groups[0].domains.map(toDomain) }];
  return groups.map(g => ({ key: g.area?.id ?? "none", title: g.area?.name ?? "Unassigned", unassigned: !g.area, domains: g.domains.map(toDomain) }));
}

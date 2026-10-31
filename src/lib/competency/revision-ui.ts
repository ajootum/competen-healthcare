// ── REVISION DRAFTS IN THE STUDIO ── FRAMEWORK-DESIGN-STUDIO-02 S6 (owner ruling D2) ────────────────────────────────
//
// Pure and client-safe: how an open revision (the revision_view shape, framework-revision.ts) is laid over the live tree the
// Studio shows, what it marks on each competency and criterion, the counts the banner states, and the one place a criteria
// reorder is translated into the move_criterion the revision understands. Nothing here reads or writes anything: the server
// decides every write, and the clinical state of a revision competency is the one the server computed at its PROPOSED content.

export type RevCriterionView = { id: string; isNew: boolean; text: string; component: string | null; sourceRef: string | null; sortOrder: number; active: boolean };
export type RevCompetencyView = {
  id: string; isNew: boolean; domainId: string | null; sortOrder: number | null; code: string | null; name: string; description: string | null; learningOutcomes: string[];
  expectedLevelId: string | null; riskCategory: string | null; practiceId: string | null; cpuId: string | null;
  proposedHash: string | null; liveHash: string | null; changed: boolean; clinical: unknown; criteria: RevCriterionView[];
};
export type RevisionView = { id: string; createdBy: string; createdAt: string; updatedAt: string; competencies: RevCompetencyView[] };

/** What the revision does to one competency. "touched" = opened in the revision, same clinical content as published. */
export type RevMark = { state: "new" | "changed" | "touched"; added: number; retired: number; restored: number; reworded: number };
export type CritMark = "new" | "reworded" | "restored" | "retired";

type LiveCrit = { id?: string; component: string | null; text: string; sourceRef: string | null; active?: boolean; mark?: CritMark };
/** The published fields of a competency the revision holds (shown by "Show published version"). */
export type PublishedFields = {
  code: string | null; name: string; description: string | null; learningOutcomes: string[]; expectedLevelId: string | null; riskCategory: string;
  cpuId: string | null; criteria: LiveCrit[];
};
type LiveComp = {
  id: string; code: string | null; name: string; description: string | null; learningOutcomes: string[]; expectedLevelId: string | null; riskCategory: string;
  sortOrder: number; cpuId: string | null; criteria: LiveCrit[];
};
type WithDomain<C> = { id: string; competencies: C[] };

/** Added on a competency the revision holds. */
export type RevisionExtras = { rev?: RevMark; published?: PublishedFields | null };

const RISKS = new Set(["low", "standard", "high", "critical"]);

/** Pure: what the revision does to a competency, against its published criteria (null: a new competency). */
export function markOf(live: Pick<LiveComp, "criteria"> | null, rc: RevCompetencyView): RevMark {
  const base = rc.isNew ? "new" : rc.changed ? "changed" : "touched";
  const byId = new Map((live?.criteria ?? []).filter(k => k.id).map(k => [k.id!, k]));
  let added = 0, retired = 0, restored = 0, reworded = 0;
  for (const k of rc.criteria) {
    const was = byId.get(k.id);
    if (!was) { if (k.active) added++; continue; }
    const wasActive = was.active !== false;
    if (wasActive && !k.active) retired++;
    else if (!wasActive && k.active) restored++;
    else if (k.active && (was.text !== k.text || (was.sourceRef ?? null) !== (k.sourceRef ?? null))) reworded++;
  }
  return { state: base, added, retired, restored, reworded };
}

/** Pure: the mark one proposed criterion carries against the published one (undefined: unchanged). */
export function critMarkOf(was: LiveCrit | undefined, k: RevCriterionView): CritMark | undefined {
  if (!was) return k.active ? "new" : undefined;
  const wasActive = was.active !== false;
  if (wasActive && !k.active) return "retired";
  if (!wasActive && k.active) return "restored";
  if (k.active && (was.text !== k.text || (was.sourceRef ?? null) !== (k.sourceRef ?? null))) return "reworded";
  return undefined;
}

/**
 * Pure: the live tree with the revision laid over it. A competency the revision holds takes its proposed fields and its
 * proposed criteria (with a mark on each change), keeping the published values in `published`. One the revision does not
 * hold keeps its criteria, less any the revision moved elsewhere. A NEW competency joins its domain at the end.
 * `state` works out the review status of a held competency from its server-computed clinical state (never inferred here).
 */
export function overlayDomains<C extends LiveComp & { status: string; statusText: string }, D extends WithDomain<C>>(
  domains: readonly D[], rv: RevisionView | null,
  state: (clinical: unknown) => { status: C["status"]; statusText: string },
): (D & { competencies: (C & RevisionExtras)[] })[] {
  if (!rv) return domains.map(d => ({ ...d, competencies: d.competencies as (C & RevisionExtras)[] }));
  const held = new Map(rv.competencies.map(c => [c.id, c]));
  const moved = new Set(rv.competencies.flatMap(c => c.criteria.map(k => k.id)));
  const build = (rc: RevCompetencyView, live: C | null): C & RevisionExtras => {
    const byId = new Map((live?.criteria ?? []).filter(k => k.id).map(k => [k.id!, k]));
    const st = state(rc.clinical);
    const criteria: LiveCrit[] = [...rc.criteria].sort((a, b) => a.sortOrder - b.sortOrder)
      .map(k => ({ id: k.id, component: k.component, text: k.text, sourceRef: k.sourceRef, active: k.active, mark: critMarkOf(byId.get(k.id), k) }));
    const risk = rc.riskCategory && RISKS.has(rc.riskCategory) ? rc.riskCategory : live?.riskCategory ?? "standard";
    return {
      ...(live ?? ({} as C)), id: rc.id, code: rc.code, name: rc.name, description: rc.description, learningOutcomes: rc.learningOutcomes,
      expectedLevelId: rc.expectedLevelId, riskCategory: risk, cpuId: rc.cpuId, sortOrder: live?.sortOrder ?? rc.sortOrder ?? 0, criteria,
      ...st, rev: markOf(live, rc),
      published: live ? { code: live.code, name: live.name, description: live.description, learningOutcomes: live.learningOutcomes, expectedLevelId: live.expectedLevelId, riskCategory: live.riskCategory, cpuId: live.cpuId, criteria: live.criteria } : null,
    } as C & RevisionExtras;
  };
  return domains.map(d => ({
    ...d,
    competencies: [
      ...d.competencies.map(c => {
        const rc = held.get(c.id);
        return rc ? build(rc, c) : ({ ...c, criteria: c.criteria.filter(k => !(k.id && moved.has(k.id))) } as C & RevisionExtras);
      }),
      ...rv.competencies.filter(rc => rc.isNew && rc.domainId === d.id).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map(rc => build(rc, null)),
    ],
  }));
}

export type RevisionCounts = { changed: number; added: number; touched: number; criteriaAdded: number; criteriaRetired: number; criteriaRestored: number; criteriaReworded: number };

/** Pure: what the banner states. "added" = new competencies. */
export function revisionCounts(marks: readonly RevMark[]): RevisionCounts {
  const out: RevisionCounts = { changed: 0, added: 0, touched: 0, criteriaAdded: 0, criteriaRetired: 0, criteriaRestored: 0, criteriaReworded: 0 };
  for (const m of marks) {
    if (m.state === "changed") out.changed++; else if (m.state === "new") out.added++; else out.touched++;
    out.criteriaAdded += m.added; out.criteriaRetired += m.retired; out.criteriaRestored += m.restored; out.criteriaReworded += m.reworded;
  }
  return out;
}

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
/** Pure: the banner's sentence. Never says "no changes" when the revision holds a competency that matches the published content. */
export function revisionSummary(c: RevisionCounts): string {
  const parts = [
    c.changed ? `${n(c.changed, "competency", "competencies")} changed` : "", c.added ? `${n(c.added, "new competency", "new competencies")}` : "",
    c.criteriaAdded ? `${n(c.criteriaAdded, "criterion", "criteria")} added` : "", c.criteriaReworded ? `${n(c.criteriaReworded, "criterion", "criteria")} reworded` : "",
    c.criteriaRetired ? `${n(c.criteriaRetired, "criterion", "criteria")} retired` : "", c.criteriaRestored ? `${n(c.criteriaRestored, "criterion", "criteria")} restored` : "",
  ].filter(Boolean);
  if (!parts.length) return c.touched ? `${n(c.touched, "competency", "competencies")} opened in the revision, none different from the published content yet` : "No change yet";
  return parts.join(" · ");
}

/** Pure: the short words a competency row carries ("Changed", "New", "2 retired"). */
export function revisionTags(m: RevMark | undefined): string[] {
  if (!m) return [];
  return [m.state === "new" ? "New" : m.state === "changed" ? "Changed" : "", m.added && m.state !== "new" ? `${m.added} added` : "", m.reworded ? `${m.reworded} reworded` : "",
    m.retired ? `${m.retired} retired` : "", m.restored ? `${m.restored} restored` : ""].filter(Boolean);
}

/**
 * Pure: a criteria reorder (the full new order of the shown section) as the one criterion that moved and its 1-based place in
 * the whole section, retired ones included (the section keeps their slots), for move_criterion { criterionId, position }.
 * null when the two orders differ by anything other than one criterion moving.
 */
export function movedPosition(before: readonly string[], after: readonly string[], fullAfter: readonly string[]): { id: string; position: number } | null {
  if (before.length !== after.length) return null;
  const i = before.findIndex((id, k) => id !== after[k]);
  if (i < 0) return null;
  for (const id of [after[i], before[i]]) {
    const b = before.filter(x => x !== id), a = after.filter(x => x !== id);
    if (before.includes(id) && b.length === a.length && b.every((x, k) => x === a[k])) {
      const at = fullAfter.indexOf(id);
      return at < 0 ? null : { id, position: at + 1 };
    }
  }
  return null;
}

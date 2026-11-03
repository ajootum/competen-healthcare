import type { Term } from "./classify";

/**
 * Term hierarchy helpers. Pure. A hierarchy exists only inside a dimension that allows one (parent_id), and a term's
 * identity is its id: relabelling a term or moving it under another parent changes nothing an instrument carries.
 */

export function topLevel(terms: Term[]): Term[] {
  return terms.filter((t) => !t.parentId || !terms.some((p) => p.id === t.parentId)).sort(byOrder);
}

export function childrenOf(parentId: string, terms: Term[]): Term[] {
  return terms.filter((t) => t.parentId === parentId).sort(byOrder);
}

/** Labels from the root down to the term, loops cut. */
export function termPath(t: Term, terms: Term[]): string[] {
  const out: string[] = [t.label];
  const seen = new Set<string>([t.id]);
  let cur = t;
  while (cur.parentId && !seen.has(cur.parentId)) {
    const p = terms.find((x) => x.id === cur.parentId);
    if (!p) break;
    seen.add(p.id);
    out.unshift(p.label);
    cur = p;
  }
  return out;
}

export function depthOf(t: Term, terms: Term[]): number {
  return termPath(t, terms).length - 1;
}

/** The terms in tree order (each parent followed by its subtree), for a list that reads as a hierarchy. */
export function treeOrder(terms: Term[]): { term: Term; depth: number }[] {
  const out: { term: Term; depth: number }[] = [];
  const visit = (t: Term, depth: number, seen: Set<string>) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    out.push({ term: t, depth });
    for (const c of childrenOf(t.id, terms)) visit(c, depth + 1, seen);
  };
  const seen = new Set<string>();
  for (const t of topLevel(terms)) visit(t, 0, seen);
  for (const t of terms) if (!seen.has(t.id)) visit(t, 0, seen);
  return out;
}

/** The ids a term may NOT have as a parent: itself and everything under it. */
export function forbiddenParents(t: Term, terms: Term[]): Set<string> {
  const out = new Set<string>([t.id]);
  const walk = (id: string) => { for (const c of childrenOf(id, terms)) if (!out.has(c.id)) { out.add(c.id); walk(c.id); } };
  walk(t.id);
  return out;
}

const byOrder = (a: Term, b: Term) => a.position - b.position || a.label.localeCompare(b.label);

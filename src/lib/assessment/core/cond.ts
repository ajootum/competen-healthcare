// asmt core: the shared condition machinery. Generic over the leaf predicate type so scoring rules and progression
// rules use the SAME evaluator and the SAME DNF / interval analysis (design s4 and s7).
//
// Evaluation: every leaf is evaluated (no short circuit) so a trace always lists every predicate value.
// Analysis: a condition is turned into disjunctive normal form (DNF) of "boxes". A box is a conjunction of
// per-variable constraints (a numeric interval or a set of allowed symbols). Two rules may overlap only if some
// pair of their boxes intersects. A rule is unreachable if it has no satisfiable box, or every box is contained in
// ONE box of a higher-priority rule. Variables are treated as independent, which is conservative for overlap
// (may report an overlap that cannot happen) and sound for unreachable (never reports one that can happen).
// DNF is capped at 256 terms: beyond that the analysis answers "too complex" and the validator refuses.
import { canonicalJson } from "./hash";

export type Cond<P> = { all: Cond<P>[] } | { any: Cond<P>[] } | { not: Cond<P> } | P;
export type Op = "=" | "!=" | "<" | "<=" | ">" | ">=";
export const DNF_CAP = 256;

export type CondKind = "all" | "any" | "not" | "leaf" | "invalid";

/** Classify a node. A combinator node must have exactly its one key. */
export function condKind(c: unknown): CondKind {
  if (c === null || typeof c !== "object" || Array.isArray(c)) return "invalid";
  const o = c as Record<string, unknown>;
  const keys = Object.keys(o);
  const comb = ["all", "any", "not"].filter((k) => k in o);
  if (comb.length === 0) return "leaf";
  if (comb.length > 1 || keys.length > 1) return "invalid";
  return comb[0] as CondKind;
}

export function compare(op: Op, a: number, b: number): boolean {
  switch (op) {
    case "=": return a === b;
    case "!=": return a !== b;
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
    default: throw new Error(`unknown operator ${String(op)}`);
  }
}

export interface LeafEval { value: boolean; detail?: unknown }
export interface CondEval<P> { value: boolean; leaves: { pred: P; value: boolean; detail?: unknown }[] }

/** Evaluate a condition. Every leaf is evaluated, in document order. */
export function evalCond<P>(c: Cond<P>, leaf: (p: P) => LeafEval): CondEval<P> {
  const leaves: CondEval<P>["leaves"] = [];
  const go = (n: Cond<P>): boolean => {
    const k = condKind(n);
    if (k === "all") { const r = ((n as { all: Cond<P>[] }).all).map(go); return r.every(Boolean); }
    if (k === "any") { const r = ((n as { any: Cond<P>[] }).any).map(go); return r.some(Boolean); }
    if (k === "not") return !go((n as { not: Cond<P> }).not);
    if (k === "leaf") { const e = leaf(n as P); leaves.push({ pred: n as P, value: e.value, detail: e.detail }); return e.value; }
    throw new Error("invalid condition node");
  };
  return { value: go(c), leaves };
}

/** Visit every leaf (and report invalid nodes through `bad`). */
export function walkLeaves<P>(c: Cond<P>, fn: (p: P, path: string) => void, bad?: (node: unknown, path: string) => void, path = "when"): void {
  const k = condKind(c);
  if (k === "all" || k === "any") (c as unknown as Record<string, Cond<P>[]>)[k].forEach((x, i) => walkLeaves(x, fn, bad, `${path}.${k}[${i}]`));
  else if (k === "not") walkLeaves((c as { not: Cond<P> }).not, fn, bad, `${path}.not`);
  else if (k === "leaf") fn(c as P, path);
  else bad?.(c, path);
}

// ── intervals and constraints ────────────────────────────────────────────────────────────────────────────────
export interface Interval { lo: number; hi: number; loOpen: boolean; hiOpen: boolean }
export type NumC = { k: "num"; iv: Interval; int: boolean };
export type SetC = { k: "set"; allow: string[]; domain: string[] };
export type Constraint = NumC | SetC;
export interface Atom { v: string; c: Constraint }
export type Box = Record<string, Constraint>;

/** The stand-in value of "no value" (unanswered, aggregate with nothing to aggregate) in a numeric variable. */
export const NONE = -1e15;

const emptyIv = (i: Interval) => i.lo > i.hi || (i.lo === i.hi && (i.loOpen || i.hiOpen));
function normInt(i: Interval): Interval {
  const lo = i.lo === -Infinity ? i.lo : i.loOpen ? Math.floor(i.lo) + 1 : Math.ceil(i.lo);
  const hi = i.hi === Infinity ? i.hi : i.hiOpen ? Math.ceil(i.hi) - 1 : Math.floor(i.hi);
  return { lo, hi, loOpen: false, hiOpen: false };
}
function interIv(a: Interval, b: Interval): Interval {
  let lo = a.lo, loOpen = a.loOpen;
  if (b.lo > lo || (b.lo === lo && b.loOpen)) { lo = b.lo; loOpen = b.loOpen; }
  let hi = a.hi, hiOpen = a.hiOpen;
  if (b.hi < hi || (b.hi === hi && b.hiOpen)) { hi = b.hi; hiOpen = b.hiOpen; }
  return { lo, hi, loOpen, hiOpen };
}
function subsetIv(a: Interval, b: Interval): boolean {
  if (emptyIv(a)) return true;
  const loOk = a.lo > b.lo || (a.lo === b.lo && (!b.loOpen || a.loOpen));
  const hiOk = a.hi < b.hi || (a.hi === b.hi && (!b.hiOpen || a.hiOpen));
  return loOk && hiOk;
}
/** full minus the given intervals, as a list of intervals */
function subtract(full: Interval, cut: Interval[]): Interval[] {
  let parts: Interval[] = [full];
  for (const c of cut) {
    if (emptyIv(c)) continue;
    const next: Interval[] = [];
    for (const p of parts) {
      const x = interIv(p, c);
      if (emptyIv(x)) { next.push(p); continue; }
      const left: Interval = { lo: p.lo, hi: c.lo, loOpen: p.loOpen, hiOpen: !c.loOpen };
      const right: Interval = { lo: c.hi, hi: p.hi, loOpen: !c.hiOpen, hiOpen: p.hiOpen };
      if (!emptyIv(left)) next.push(left);
      if (!emptyIv(right)) next.push(right);
    }
    parts = next;
  }
  return parts;
}

export interface NumDomain { lo: number; hi: number; int: boolean; /** the variable can be "none" (the NONE sentinel) */ none: boolean }

function opIntervals(op: Op, n: number): Interval[] {
  switch (op) {
    case "=": return [{ lo: n, hi: n, loOpen: false, hiOpen: false }];
    case "!=": return [{ lo: -Infinity, hi: n, loOpen: false, hiOpen: true }, { lo: n, hi: Infinity, loOpen: true, hiOpen: false }];
    case "<": return [{ lo: -Infinity, hi: n, loOpen: false, hiOpen: true }];
    case "<=": return [{ lo: -Infinity, hi: n, loOpen: false, hiOpen: false }];
    case ">": return [{ lo: n, hi: Infinity, loOpen: true, hiOpen: false }];
    case ">=": return [{ lo: n, hi: Infinity, loOpen: false, hiOpen: false }];
  }
}

/**
 * Atoms (alternatives) for "variable <op> n" over a numeric domain, or its negation. A comparison against "none" is
 * false, so the negation includes the NONE sentinel.
 */
export function numAtoms(v: string, op: Op, n: number, negated: boolean, dom: NumDomain): Atom[] {
  const posDom: Interval = { lo: dom.lo, hi: dom.hi, loOpen: false, hiOpen: false };
  const pos = opIntervals(op, n).map((i) => interIv(i, posDom)).filter((i) => !emptyIv(i));
  let ivs: Interval[];
  if (!negated) ivs = pos;
  else {
    const full: Interval = { lo: dom.none ? NONE : dom.lo, hi: dom.hi, loOpen: false, hiOpen: false };
    ivs = subtract(full, pos);
  }
  const out: Atom[] = [];
  for (const i0 of ivs) {
    const i = dom.int ? normInt(i0) : i0;
    if (!emptyIv(i)) out.push({ v, c: { k: "num", iv: i, int: dom.int } });
  }
  return out;
}

/** Atoms for "variable is in allow" (or not), over a closed symbol domain. */
export function setAtoms(v: string, allow: string[], domain: string[], negated: boolean): Atom[] {
  const a = negated ? domain.filter((d) => !allow.includes(d)) : allow.filter((d) => domain.includes(d));
  return a.length ? [{ v, c: { k: "set", allow: a, domain } }] : [];
}

/** A boolean variable that is true / false. */
export const boolAtoms = (v: string, truth: boolean, negated: boolean): Atom[] => setAtoms(v, [String(truth)], ["true", "false"], negated);

function interC(a: Constraint, b: Constraint): Constraint | null {
  if (a.k === "num" && b.k === "num") {
    let iv = interIv(a.iv, b.iv);
    if (a.int || b.int) iv = normInt(iv);
    return emptyIv(iv) ? null : { k: "num", iv, int: a.int || b.int };
  }
  if (a.k === "set" && b.k === "set") {
    const allow = a.allow.filter((x) => b.allow.includes(x));
    return allow.length ? { k: "set", allow, domain: a.domain } : null;
  }
  return null; // mixed kinds on one variable cannot be satisfied together
}
function subsetC(a: Constraint, b: Constraint): boolean {
  if (a.k === "num" && b.k === "num") return subsetIv(a.iv, b.iv);
  if (a.k === "set" && b.k === "set") return a.allow.every((x) => b.allow.includes(x));
  return false;
}

export class TooComplex extends Error { constructor() { super("too complex"); } }
export type Atomizer<P> = (p: P, negated: boolean) => Atom[];

function termToBox(term: Atom[]): Box | null {
  const box: Box = {};
  for (const a of term) {
    const cur = box[a.v];
    if (!cur) { box[a.v] = a.c; continue; }
    const m = interC(cur, a.c);
    if (!m) return null;
    box[a.v] = m;
  }
  return box;
}

/** DNF as satisfiable boxes, or "too_complex" when more than DNF_CAP terms arise. */
export function toBoxes<P>(c: Cond<P>, atomize: Atomizer<P>, cap = DNF_CAP): Box[] | "too_complex" {
  const guard = (t: Atom[][]) => { if (t.length > cap) throw new TooComplex(); return t; };
  const go = (n: Cond<P>, neg: boolean): Atom[][] => {
    const k = condKind(n);
    if (k === "not") return go((n as { not: Cond<P> }).not, !neg);
    if (k === "leaf") return atomize(n as P, neg).map((a) => [a]);
    if (k === "invalid") return [[]];
    const kids = (n as unknown as Record<string, Cond<P>[]>)[k];
    const conj = (k === "all") !== neg; // all (not negated) and any (negated) are conjunctions
    if (!conj) return guard(kids.flatMap((x) => go(x, neg)));
    let acc: Atom[][] = [[]];
    for (const x of kids) {
      const part = go(x, neg);
      const next: Atom[][] = [];
      for (const t of acc) for (const p of part) { next.push([...t, ...p]); if (next.length > cap) throw new TooComplex(); }
      acc = guard(next);
    }
    return acc;
  };
  try {
    return go(c, false).map(termToBox).filter((b): b is Box => b !== null);
  } catch (e) {
    if (e instanceof TooComplex) return "too_complex";
    throw e;
  }
}

export function boxesIntersect(a: Box, b: Box): boolean {
  for (const v of Object.keys(a)) if (b[v] && !interC(a[v], b[v])) return false;
  return true;
}
/** inner is inside outer: every constraint of outer is implied by inner */
export function boxContains(outer: Box, inner: Box): boolean {
  for (const v of Object.keys(outer)) if (!inner[v] || !subsetC(inner[v], outer[v])) return false;
  return true;
}
export const dnfIntersects = (a: Box[], b: Box[]): boolean => a.some((x) => b.some((y) => boxesIntersect(x, y)));
/** every box of `inner` sits inside a single box of `higher` */
export const dnfShadowed = (inner: Box[], higher: Box[]): boolean => inner.length > 0 && inner.every((i) => higher.some((h) => boxContains(h, i)));

/** a stable symbol for a leaf, used to name analysis variables */
export const leafKey = (x: unknown): string => canonicalJson(x);

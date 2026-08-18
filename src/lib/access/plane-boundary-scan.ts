// Plane-boundary scanner (PLAT-OVERSIGHT-SURVEY-001 §6.2) — what a source file IMPORTS and what it READS.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS IS AN AST WALK AND NOT A GREP, WHICH IS THE WHOLE POINT OF THE EXERCISE.
//
// §1.3 of the survey records a grep of `src/app/super-admin/**` for `practice_patient` returning ZERO
// while that page reads the table — because the read is one import away. A harness that repeated the
// grep at a different scope would repeat the finding. So this module answers three questions precisely:
// what a file imports (so the closure can be followed), which of its declarations the importer can
// actually reach (so the closure is the CALLABLE surface and not merely the bundle), and what each
// reachable declaration reads. All three from the TypeScript AST, because all three have answers a
// regex gets wrong:
//
//   - a `.select("…")` sits four lines and two comments below its `.from("…")` in operations.ts:54–60,
//   - `import type { EngineResult }` is erased at build time and reaches no runtime read,
//   - `admin.from(table)` in operations.ts:129 names its table through a PARAMETER, and the four tables
//     it resolves to include `practice_patient`,
//   - `identifier-format.ts:1` imports one function from `provisioning.ts`, which puts 400 lines of the
//     practice engine in the platform BUNDLE while making none of it CALLABLE from the platform plane.
//
// AND WHEN IT CANNOT TELL, IT SAYS SO. Every resolution below is conservative: a `.from()` whose table
// cannot be resolved is returned with `unresolved` set, and the policy in plane-boundary.ts turns that
// into a FAILURE unless it is a declared, justified exception. `scan.ts` established this house rule for
// gates ("an unrecognised gate is reported as unknown, never as open"); a table name this scanner cannot
// read is the same shape of blind spot as the one the harness exists to close.
//
// PURE. No filesystem, no network — `(source, fileName) => facts`. The disk walk and the cross-file
// worklist live in scripts/plane-boundary-harness.ts, mirroring scan.ts / gen-access-matrix.ts.
//
// ⚠ THIS MODULE IMPORTS THE TYPESCRIPT COMPILER AND MUST NEVER BE IMPORTED BY APPLICATION CODE. The
// policy — the allowlist and the verdict function — lives in plane-boundary.ts, which imports nothing at
// all and is the module a page should reach for.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

import ts from "typescript";
import type { BoundarySite, SelectKind } from "./plane-boundary";

/** Every export of a module, when the importer takes a namespace or the module is loaded for effect. */
export const ALL = "*";

export type ImportEdge = {
  specifier: string;
  line: number;
  /** True when TypeScript erases it, so no runtime read can be reached through it. */
  typeOnly: boolean;
  /**
   * The module is loaded whatever is used from it (side-effect import, namespace import, `export *`,
   * dynamic `import()`), so its module-load statements run regardless of which names are needed.
   */
  eager: boolean;
};

/** A read site, tagged with the top-level declaration that owns it. `null` = module-load code. */
export type OwnedSite = BoundarySite & { owner: string | null };

export type ModuleFacts = {
  imports: ImportEdge[];
  /** local binding name → where it came from. `imported === ALL` for `import * as x`. */
  importBindings: Map<string, { specifier: string; imported: string }>;
  /** exported name → the local declaration (or import binding) it resolves to. */
  exports: Map<string, string>;
  /** true when the module has `export * from …`, so any needed name may live downstream. */
  starReexports: string[];
  /** top-level declaration name → the identifiers its subtree mentions. */
  refs: Map<string, Set<string>>;
  /** identifiers mentioned by code that runs the moment the module is loaded. */
  moduleLoadRefs: Set<string>;
  sites: OwnedSite[];
  rpc: { fn: string; owner: string | null; line: number }[];
};

/**
 * ⚠ THE PLANE IS NO LONGER ONE TABLE FAMILY, AND THIS SCANNER ASSUMED IT WAS.
 *
 * `practice_` was the only prefix for as long as the practice plane meant practice tables. Then
 * `mos_event` was allowlisted — the operational event store, which is Practice-scoped telemetry and the
 * one store on this plane that cannot carry clinical content by construction.
 *
 * The scanner did not fail loudly. It reported the new grant as a DEAD GRANT — "allowlisted but never
 * read" — while the read sat six lines away in the loader, because a detector that matches on
 * `practice_` cannot see `mos_event` at all. The alarm was real and pointed at the wrong thing.
 *
 * This is the recorded class, on its fifth appearance in this build: a guard that must be taught about
 * anything new in the same commit that introduces it. A prefix is the cheapest possible table
 * classifier and it goes wrong the first time the plane grows a second family.
 */
export const PLANE_TABLE_PREFIXES = ["practice_", "mos_", "pd_"] as const;

const matchesPrefix = (table: string, prefix: string | readonly string[]): boolean =>
  typeof prefix === "string" ? table.startsWith(prefix) : prefix.some(p => table.startsWith(p));

// ── THE ANALYSIS ─────────────────────────────────────────────────────────────────────────────────────

export function analyzeModule(source: string, fileName: string, tablePrefix: string | readonly string[] = PLANE_TABLE_PREFIXES): ModuleFacts {
  const sf = parse(source, fileName);
  const facts: ModuleFacts = {
    imports: [], importBindings: new Map(), exports: new Map(), starReexports: [],
    refs: new Map(), moduleLoadRefs: new Set(), sites: [], rpc: [],
  };

  // ── Imports and exports ──────────────────────────────────────────────────
  const addImport = (spec: ts.Expression | undefined, typeOnly: boolean, eager: boolean, node: ts.Node) => {
    if (!spec || !ts.isStringLiteral(spec)) return;
    facts.imports.push({ specifier: spec.text, typeOnly, eager, line: lineOf(sf, node) });
  };

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const clause = st.importClause;
      const typeOnly = !!clause && (clause.isTypeOnly || allSpecifiersAreTypes(clause));
      const spec = ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
      // No clause at all = `import "./x"`, which runs the module for its side effects.
      let eager = !clause;
      if (clause && spec && !typeOnly) {
        if (clause.name) facts.importBindings.set(clause.name.text, { specifier: spec, imported: "default" });
        const b = clause.namedBindings;
        if (b && ts.isNamespaceImport(b)) { facts.importBindings.set(b.name.text, { specifier: spec, imported: ALL }); eager = true; }
        else if (b && ts.isNamedImports(b)) {
          for (const e of b.elements) {
            if (e.isTypeOnly) continue;
            facts.importBindings.set(e.name.text, { specifier: spec, imported: (e.propertyName ?? e.name).text });
          }
        }
      }
      addImport(st.moduleSpecifier, typeOnly, eager, st);
      continue;
    }
    if (ts.isExportDeclaration(st)) {
      const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
      if (spec) {
        if (!st.exportClause) { facts.starReexports.push(spec); addImport(st.moduleSpecifier, st.isTypeOnly, true, st); }
        else if (ts.isNamedExports(st.exportClause)) {
          for (const e of st.exportClause.elements) {
            if (e.isTypeOnly || st.isTypeOnly) continue;
            const local = `__reexport:${e.name.text}`;
            facts.importBindings.set(local, { specifier: spec, imported: (e.propertyName ?? e.name).text });
            facts.exports.set(e.name.text, local);
          }
          addImport(st.moduleSpecifier, st.isTypeOnly, false, st);
        }
      } else if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const e of st.exportClause.elements) facts.exports.set(e.name.text, (e.propertyName ?? e.name).text);
      }
      continue;
    }
  }

  // ── Top-level declarations, and which of them run at module load ─────────
  //
  // ⚠ THE DISTINCTION THAT MAKES THE CLOSURE THE CALLABLE SURFACE. `const F = () => { … }` puts nothing
  // in the body on the module-load path; `const T = { a: "practice_patient" }` evaluates immediately.
  // Collapsing the two would report every function in every bundled module as reachable, which is how a
  // boundary harness ends up red about 400 lines of an engine the platform plane cannot call.
  type Decl = { name: string; node: ts.Node; deferred: boolean };
  const decls: Decl[] = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) decls.push({ name: st.name.text, node: st, deferred: true });
    else if (ts.isClassDeclaration(st) && st.name) decls.push({ name: st.name.text, node: st, deferred: true });
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const names = bindingNames(d.name);
        const deferred = !!d.initializer && isFunctionLike(d.initializer);
        for (const n of names) decls.push({ name: n, node: d, deferred });
      }
    } else if (ts.isImportDeclaration(st) || ts.isExportDeclaration(st) || ts.isInterfaceDeclaration(st)
      || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) {
      // nothing to execute (or nothing this rule cares about)
    } else if (ts.isExportAssignment(st)) {
      decls.push({ name: "default", node: st, deferred: false });
      facts.exports.set("default", "default");
    } else {
      // A bare top-level statement: it runs on import.
      collectIdentifiers(st, facts.moduleLoadRefs);
      attachSites(sf, st, null, fileName, tablePrefix, facts);
    }
  }

  // Export names for declarations carrying the `export` modifier.
  for (const st of sf.statements) {
    const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined;
    if (!mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    const isDefault = mods.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) {
      const n = st.name?.text ?? "default";
      facts.exports.set(isDefault ? "default" : n, n);
      if (isDefault && st.name) facts.exports.set(n, n);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) for (const n of bindingNames(d.name)) facts.exports.set(n, n);
    }
  }

  for (const d of decls) {
    const set = facts.refs.get(d.name) ?? new Set<string>();
    collectIdentifiers(d.node, set, d.name);
    facts.refs.set(d.name, set);
    if (!d.deferred) collectIdentifiers(d.node, facts.moduleLoadRefs, d.name);
    attachSites(sf, d.node, d.name, fileName, tablePrefix, facts);
  }

  return facts;
}

/** Back-compat helpers used by the harness's own controls, so the rules stay directly testable. */
export function extractImports(source: string, fileName = "file.ts"): ImportEdge[] {
  return analyzeModule(source, fileName).imports;
}
export function extractReads(source: string, fileName: string, tablePrefix: string | readonly string[] = PLANE_TABLE_PREFIXES): OwnedSite[] {
  return analyzeModule(source, fileName, tablePrefix).sites;
}

// ── READ SITES ───────────────────────────────────────────────────────────────────────────────────────

/** Receivers whose `.from` is a language builtin and never a table. */
const NOT_A_TABLE = new Set(["Array", "Object", "Buffer", "Set", "Map", "Date", "BigInt", "Number", "String"]);
/** Chain verbs that write. A write is not a disclosure unless it reads rows back. */
const WRITE_VERBS = new Set(["insert", "update", "upsert", "delete"]);
/** Chain verbs whose FIRST argument names a column. Collected for reporting; see plane-boundary.ts. */
const FILTER_VERBS = new Set([
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "contains", "containedBy",
  "order", "overlaps", "rangeGt", "rangeLt", "rangeGte", "rangeLte", "textSearch", "not",
]);

function attachSites(
  sf: ts.SourceFile, root: ts.Node, owner: string | null, file: string, prefix: string | readonly string[], facts: ModuleFacts,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method === "from") {
        const recv = node.expression.expression;
        if (!(ts.isIdentifier(recv) && NOT_A_TABLE.has(recv.text))) collect(sf, node, file, prefix, owner, facts.sites);
      } else if (method === "rpc") {
        const a0 = node.arguments[0];
        const fn = a0 ? literalString(a0, sf) : null;
        if (fn) facts.rpc.push({ fn, owner, line: lineOf(sf, node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
}

function collect(
  sf: ts.SourceFile, fromCall: ts.CallExpression, file: string, prefix: string | readonly string[],
  owner: string | null, out: OwnedSite[],
): void {
  const line = lineOf(sf, fromCall);
  const arg = fromCall.arguments[0];
  const resolved = arg ? resolveStrings(arg, sf) : { values: null, why: "no argument" };

  // Resolved, and none of them is a practice table: silence is correct.
  if (resolved.values && resolved.values.every(v => !matchesPrefix(v, prefix))) return;

  const chain = walkChain(fromCall);
  const chainText = truncate(fromCall.getText(sf).replace(/\s+/g, " "), 140);
  const verbs = chain.map(c => c.name);
  const write = verbs.some(v => WRITE_VERBS.has(v));
  const selectCall = chain.find(c => c.name === "select");

  let kind: SelectKind = "none";
  let columns: string[] = [];
  let embeds: { table: string; columns: string[] }[] = [];
  let head = false, exact = false, selectUnresolved: string | null = null;

  if (selectCall) {
    const a0 = selectCall.args[0];
    if (!a0) kind = "star";                                        // `.select()` returns every column
    else {
      const lit = literalString(a0, sf);
      if (lit === null) { kind = "unresolved"; selectUnresolved = `select(${truncate(a0.getText(sf), 60)}) is not a literal`; }
      else if (lit.trim() === "*") kind = "star";
      else { kind = "columns"; const p = parseSelect(lit); columns = p.columns; embeds = p.embeds; }
    }
    const a1 = selectCall.args[1];
    if (a1 && ts.isObjectLiteralExpression(a1)) {
      for (const p of a1.properties) {
        if (!ts.isPropertyAssignment(p) || !p.name) continue;
        const key = p.name.getText(sf).replace(/["']/g, "");
        if (key === "head") head = p.initializer.kind === ts.SyntaxKind.TrueKeyword;
        if (key === "count") exact = true;
      }
    }
  }

  const filters: string[] = [];
  for (const c of chain) {
    if (!FILTER_VERBS.has(c.name)) continue;
    const s = c.args[0] ? literalString(c.args[0], sf) : null;
    if (s) filters.push(s);
  }

  const argText = arg ? truncate(arg.getText(sf).replace(/\s+/g, " "), 60) : "";
  const tables = resolved.values ?? [null];
  for (const table of tables) {
    if (table !== null && !matchesPrefix(table, prefix)) continue;
    out.push({
      owner, file, line, table, argText,
      resolvedFrom: resolved.values && resolved.values.length > 1 ? resolved.values.join(" | ") : null,
      select: kind, columns, embeds, head, exactCount: exact,
      write, verbs, filters, chain: chainText,
      unresolved: table === null ? `.from(${argText}) — ${resolved.why}` : selectUnresolved,
    });
  }
}

/** The `.a().b().c()` calls hanging off a call expression. */
function walkChain(start: ts.CallExpression): { name: string; args: readonly ts.Expression[] }[] {
  const chain: { name: string; args: readonly ts.Expression[] }[] = [];
  let node: ts.Node = start;
  for (let guard = 0; guard < 64; guard++) {
    const pa = node.parent;
    if (!pa || !ts.isPropertyAccessExpression(pa) || pa.expression !== node) break;
    const call = pa.parent;
    if (!call || !ts.isCallExpression(call) || call.expression !== pa) break;
    chain.push({ name: pa.name.text, args: call.arguments });
    node = call;
  }
  return chain;
}

// ── SELECT PARSING ───────────────────────────────────────────────────────────────────────────────────

/**
 * Split a PostgREST select list into columns and EMBEDDED RESOURCES.
 *
 * ⚠ THE EMBED IS THE JOIN. The survey's sentence is "the distance between five integers per practice and
 * clinical content is ONE JOIN", and in PostgREST that join is spelled inside the select string:
 * `.select("id, practice_patient(given_name)")` reads a patient name through a chain whose `.from()` says
 * `practice_workspace`. Flattening embeds into the column list would let exactly that read past.
 */
export function parseSelect(text: string): { columns: string[]; embeds: { table: string; columns: string[] }[] } {
  const columns: string[] = [];
  const embeds: { table: string; columns: string[] }[] = [];
  for (const part of splitTop(text)) {
    const p = part.trim();
    if (!p) continue;
    const open = p.indexOf("(");
    if (open >= 0 && p.endsWith(")")) {
      const head = p.slice(0, open).trim();
      const inner = p.slice(open + 1, -1);
      // `alias:relation(cols)` — the relation is what is read, the alias is presentation.
      const rel = head.includes(":") ? head.slice(head.indexOf(":") + 1).trim() : head;
      const nested = parseSelect(inner);
      embeds.push({ table: stripModifiers(rel), columns: nested.columns });
      for (const e of nested.embeds) embeds.push(e);
      continue;
    }
    // `alias:column`, `column::cast`, `column->>json`
    const col = p.includes(":") && !p.includes("::") ? p.slice(p.indexOf(":") + 1).trim() : p;
    columns.push(stripModifiers(col));
  }
  return { columns, embeds };
}

const stripModifiers = (s: string) => s.split("::")[0].split("->")[0].split("!")[0].trim();

/** Comma-split that respects parentheses, so an embed's own list stays with the embed. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

// ── STRING RESOLUTION ────────────────────────────────────────────────────────────────────────────────

type Resolution = { values: string[] | null; why: string };

/** A string literal, or null when the expression is anything else. */
function literalString(node: ts.Expression, sf: ts.SourceFile): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  const r = resolveStrings(node, sf);
  return r.values && r.values.length === 1 ? r.values[0] : null;
}

/**
 * Resolve an expression to the set of string literals it can hold, WITHIN ONE FILE.
 *
 * ⚠ THIS EXISTS BECAUSE OF ONE REAL SITE AND IT IS THE IMPORTANT ONE. `operations.ts:129` reads
 * `admin.from(table)` where `table` is a function parameter; the call sites bind it to the four values of
 * a `TABLES` map — `practice_membership`, `practice_appointment`, `practice_patient`,
 * `practice_encounter` — plus one literal. Two of those are the clinical tables the whole survey is
 * about. A scanner that only understood string literals would report this file as reading nothing.
 *
 * DELIBERATELY INTRA-FILE AND DELIBERATELY SMALL: literals, module constants, object-literal maps,
 * `for…of` bindings, ternaries, array elements, a property read off a registry object, and a parameter
 * resolved from the call sites in the same file. Anything past that returns null with a reason, and null
 * fails the harness unless the site is a declared exception. Widening this resolver is how a real blind
 * spot gets closed; making it guess is how one gets opened.
 */
export function resolveStrings(node: ts.Expression, sf: ts.SourceFile, seen = new Set<ts.Node>(), depth = 0): Resolution {
  if (depth > 8) return { values: null, why: "resolution too deep" };
  if (seen.has(node)) return { values: null, why: "cyclic" };
  seen.add(node);

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return { values: [node.text], why: "literal" };
  if (ts.isTemplateExpression(node)) return { values: null, why: "interpolated template" };

  // A null/undefined branch contributes no table. The code that produces one always guards on it
  // (`if (!table) return badRequest(...)`), so folding it away is exact rather than optimistic.
  if (node.kind === ts.SyntaxKind.NullKeyword) return { values: [], why: "null" };
  if (ts.isIdentifier(node) && node.text === "undefined") return { values: [], why: "undefined" };

  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))
    return resolveStrings(node.expression, sf, seen, depth + 1);

  if (ts.isConditionalExpression(node)) return union(
    resolveStrings(node.whenTrue, sf, seen, depth + 1),
    resolveStrings(node.whenFalse, sf, seen, depth + 1), "ternary");

  if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    || node.operatorToken.kind === ts.SyntaxKind.BarBarToken))
    return union(resolveStrings(node.left, sf, seen, depth + 1),
      resolveStrings(node.right, sf, seen, depth + 1), "fallback");

  // `REGISTRY.table` / `src.table` — the object resolves to one or more object literals, and the
  // property is read off every one of them. This is how the platform's own table registries are written.
  if (ts.isPropertyAccessExpression(node)) {
    const objs = resolveObjects(node.expression, sf, new Set(), depth + 1);
    if (!objs) return { values: null, why: `property read on an object this scanner cannot resolve (${truncate(node.expression.getText(sf), 40)})` };
    const vals: string[] = [];
    for (const o of objs) {
      const p = o.properties.find(pr => ts.isPropertyAssignment(pr) && pr.name && propName(pr.name, sf) === node.name.text);
      if (!p || !ts.isPropertyAssignment(p)) continue;                    // absent property → undefined, no table
      const r = resolveStrings(p.initializer, sf, seen, depth + 1);
      if (!r.values) return { values: null, why: `property .${node.name.text}: ${r.why}` };
      vals.push(...r.values);
    }
    return { values: dedupe(vals), why: `.${node.name.text} over ${objs.length} registry entr(y|ies)` };
  }

  if (ts.isElementAccessExpression(node)) {
    const objs = resolveObjects(node.expression, sf, new Set(), depth + 1);
    if (!objs) return { values: null, why: `element access on an object this scanner cannot resolve` };
    const vals: string[] = [];
    for (const o of objs) for (const p of o.properties) {
      if (!ts.isPropertyAssignment(p)) return { values: null, why: "registry uses spread or shorthand" };
      const r = resolveStrings(p.initializer, sf, seen, depth + 1);
      if (!r.values) return { values: null, why: `element access: ${r.why}` };
      vals.push(...r.values);
    }
    return { values: dedupe(vals), why: "every value of the map" };
  }

  if (ts.isIdentifier(node)) return resolveIdentifier(node, sf, seen, depth);

  return { values: null, why: `unsupported expression (${ts.SyntaxKind[node.kind]})` };
}

function resolveIdentifier(id: ts.Identifier, sf: ts.SourceFile, seen: Set<ts.Node>, depth: number): Resolution {
  const name = id.text;
  const values: string[] = [];
  let saw = false, blocked = "";

  for (const b of findBindings(name, sf)) {
    saw = true;
    const exprs = b.kind === "expr" ? [b.expr] : b.exprs;
    for (const e of exprs) {
      const r = resolveStrings(e, sf, seen, depth + 1);
      if (!r.values) { blocked = r.why; continue; }
      values.push(...r.values);
    }
  }
  if (values.length) return { values: dedupe(values), why: `binding ${name}` };

  // A parameter, resolved from the call sites of its own function in this file.
  const param = findParameter(name, id);
  if (param) {
    const args = callArguments(param, sf);
    if (!args.length) return { values: null, why: `parameter ${name} of ${param.fnName ?? "an anonymous function"} has no resolvable call site in this file` };
    const vals: string[] = [];
    for (const a of args) {
      const r = resolveStrings(a, sf, seen, depth + 1);
      if (!r.values) return { values: null, why: `parameter ${name}: call site — ${r.why}` };
      vals.push(...r.values);
    }
    return { values: dedupe(vals), why: `parameter ${name} from ${args.length} call site(s)` };
  }
  return { values: null, why: saw ? `identifier ${name}: ${blocked}` : `identifier ${name} is not bound in this file` };
}

/** The object literals an expression can evaluate to — a registry constant, or an element of one. */
function resolveObjects(node: ts.Expression, sf: ts.SourceFile, seen: Set<ts.Node>, depth: number): ts.ObjectLiteralExpression[] | null {
  if (depth > 8 || seen.has(node)) return null;
  seen.add(node);
  if (ts.isObjectLiteralExpression(node)) return [node];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
    || ts.isSatisfiesExpression(node)) return resolveObjects(node.expression, sf, seen, depth + 1);
  if (ts.isArrayLiteralExpression(node)) {
    const out: ts.ObjectLiteralExpression[] = [];
    for (const el of node.elements) {
      const r = resolveObjects(el, sf, seen, depth + 1);
      if (!r) return null;
      out.push(...r);
    }
    return out;
  }
  if (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)) {
    // REGISTRY[key] / REGISTRY.key — any entry of the registry.
    const objs = resolveObjects(node.expression, sf, seen, depth + 1);
    if (!objs) return null;
    const out: ts.ObjectLiteralExpression[] = [];
    for (const o of objs) for (const p of o.properties) {
      if (!ts.isPropertyAssignment(p)) return null;
      const r = resolveObjects(p.initializer, sf, seen, depth + 1);
      if (!r) return null;
      out.push(...r);
    }
    return out;
  }
  if (ts.isIdentifier(node)) {
    const out: ts.ObjectLiteralExpression[] = [];
    let saw = false;
    for (const b of findBindings(node.text, sf)) {
      saw = true;
      const exprs = b.kind === "expr" ? [b.expr] : b.exprs;
      for (const e of exprs) {
        const r = resolveObjects(e, sf, seen, depth + 1);
        if (!r) return null;
        out.push(...r);
      }
    }
    if (saw) return out;
    const param = findParameter(node.text, node);
    if (param) {
      const args = callArguments(param, sf);
      if (!args.length) return null;
      const acc: ts.ObjectLiteralExpression[] = [];
      for (const a of args) {
        const r = resolveObjects(a, sf, seen, depth + 1);
        if (!r) return null;
        acc.push(...r);
      }
      return acc;
    }
    return null;
  }
  return null;
}

type Binding = { kind: "expr"; expr: ts.Expression } | { kind: "exprs"; exprs: ts.Expression[] };

/** Every `const NAME = …`, `for (const NAME of …)` and `for (const [_, NAME] of Object.entries(MAP))`. */
function findBindings(name: string, sf: ts.SourceFile): Binding[] {
  const out: Binding[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer)
      out.push({ kind: "expr", expr: n.initializer });

    if (ts.isForOfStatement(n) && ts.isVariableDeclarationList(n.initializer)) {
      for (const d of n.initializer.declarations) {
        // for (const table of SOMETHING)
        if (ts.isIdentifier(d.name) && d.name.text === name) {
          const elems = elementsOf(n.expression, sf);
          if (elems) out.push({ kind: "exprs", exprs: elems });
          continue;
        }
        // for (const [key, table] of Object.entries(MAP))
        if (!ts.isArrayBindingPattern(d.name)) continue;
        const idx = d.name.elements.findIndex(e => ts.isBindingElement(e) && ts.isIdentifier(e.name) && e.name.text === name);
        if (idx < 0) continue;
        const src = n.expression;
        if (ts.isCallExpression(src) && ts.isPropertyAccessExpression(src.expression)
          && src.expression.name.text === "entries" && ts.isIdentifier(src.expression.expression)
          && src.expression.expression.text === "Object" && src.arguments[0] && idx === 1) {
          const objs = resolveObjects(src.arguments[0] as ts.Expression, sf, new Set(), 0);
          // Object.entries over a MAP: index 0 is the key, index 1 the value.
          if (objs) {
            const vals: ts.Expression[] = [];
            for (const o of objs) for (const p of o.properties) if (ts.isPropertyAssignment(p)) vals.push(p.initializer);
            out.push({ kind: "exprs", exprs: vals });
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The elements of an array-valued expression, when they can be seen. */
function elementsOf(node: ts.Expression, sf: ts.SourceFile): ts.Expression[] | null {
  if (ts.isArrayLiteralExpression(node)) return [...node.elements];
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node))
    return elementsOf(node.expression, sf);
  if (ts.isIdentifier(node)) {
    const bindings = findBindings(node.text, sf);
    const out: ts.Expression[] = [];
    for (const b of bindings) {
      if (b.kind !== "expr") return null;
      const e = elementsOf(b.expr, sf);
      if (!e) return null;
      out.push(...e);
    }
    return out.length ? out : null;
  }
  return null;
}

/** The function this identifier is a parameter of, and which position it sits in. */
type ParamRef = { fnName: string | null; index: number; fn: ts.SignatureDeclaration };
function findParameter(name: string, use: ts.Node): ParamRef | null {
  let node: ts.Node | undefined = use;
  while (node) {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node)
      || ts.isArrowFunction(node)) {
      const index = node.parameters.findIndex(p => ts.isIdentifier(p.name) && p.name.text === name);
      if (index >= 0) {
        let fnName: string | null = null;
        const named = node as ts.FunctionDeclaration;
        if (named.name && ts.isIdentifier(named.name)) fnName = named.name.text;
        else if (node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name))
          fnName = node.parent.name.text;
        return { fnName, index, fn: node };
      }
    }
    node = node.parent;
  }
  return null;
}

/**
 * Every argument passed at that position, from the call sites in this file.
 *
 * An ANONYMOUS callback gets its arguments from the iteration it is handed to — `SOURCES.map(s => …)`
 * binds `s` to each element of SOURCES — which is how the platform's registry-driven loaders are written
 * and the reason `.from(src.table)` is resolvable at all.
 */
function callArguments(param: ParamRef, sf: ts.SourceFile): ts.Expression[] {
  const out: ts.Expression[] = [];
  if (param.fnName) {
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === param.fnName) {
        const a = n.arguments[param.index];
        if (a) out.push(a);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (out.length) return out;
  }
  // An inline callback: `ARRAY.map(x => …)` / `.forEach` / `.filter` — parameter 0 is an element.
  const p = param.fn.parent;
  if (p && ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && param.index === 0
    && ["map", "forEach", "filter", "flatMap", "find", "some", "every"].includes(p.expression.name.text)) {
    const elems = elementsOf(p.expression.expression, sf);
    if (elems) return elems;
  }
  return out;
}

// ── SMALL HELPERS ────────────────────────────────────────────────────────────────────────────────────

function allSpecifiersAreTypes(clause: ts.ImportClause): boolean {
  if (clause.name) return false;                       // a default import is a value
  const b = clause.namedBindings;
  if (!b || ts.isNamespaceImport(b)) return false;     // `import * as x` is a value
  // `import { type A, b }` keeps a runtime edge through `b`; `import { type A }` does not.
  return b.elements.length > 0 && b.elements.every(e => e.isTypeOnly);
}

function bindingNames(name: ts.BindingName, out: string[] = []): string[] {
  if (ts.isIdentifier(name)) out.push(name.text);
  else for (const e of name.elements) if (ts.isBindingElement(e)) bindingNames(e.name, out);
  return out;
}

const isFunctionLike = (e: ts.Expression): boolean =>
  ts.isArrowFunction(e) || ts.isFunctionExpression(e) || ts.isClassExpression(e)
  || ((ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e)) && isFunctionLike(e.expression));

function collectIdentifiers(node: ts.Node, out: Set<string>, skip?: string): void {
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text !== skip) {
      // A property NAME is not a reference to a binding; `a.b` mentions `a`, not `b`.
      const p = n.parent;
      const isPropName = p && ((ts.isPropertyAccessExpression(p) && p.name === n)
        || (ts.isPropertyAssignment(p) && p.name === n)
        || (ts.isPropertySignature(p) && p.name === n));
      if (!isPropName) out.add(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
}

const propName = (n: ts.PropertyName, sf: ts.SourceFile) => n.getText(sf).replace(/^["']|["']$/g, "");
function parse(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
const dedupe = (a: string[]) => [...new Set(a)];
const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");
function union(a: Resolution, b: Resolution, why: string): Resolution {
  if (!a.values) return { values: null, why: `${why}: ${a.why}` };
  if (!b.values) return { values: null, why: `${why}: ${b.why}` };
  return { values: dedupe([...a.values, ...b.values]), why };
}

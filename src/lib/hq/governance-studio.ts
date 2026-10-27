// Competen HQ — Organisation & Governance Studio (COMPETEN-SCHOLAR-GOV-IMPLEMENT-01, Addendum V1.2, migration 620).
//
// A STRUCTURE is one governance context keyed to a product line. Its VERSIONS each hold the whole structure as one
// definition: levels, units, positions, relationships, workflow links and independence pairs. Only a draft is edited.
// Publication (owner only) projects the version into the 610 tables, so every existing screen, guard and separation-
// of-duties check reads the published structure, and a version that breaks any of them does not publish.
//
// ⚠ THE DATABASE DECIDES, THIS FILE EXPLAINS. The hq_gov_studio_* functions re-check the gate, refuse a stale
// revision, refuse removal (retire instead), refuse retiring a position with a live record, keep published versions
// immutable and write the audit row first. validateDefinition() below mirrors those rules so the editor can say WHY
// before saving. applyStudioOp() never removes anything: every "remove" is a retirement.
//
// ⚠ NOTHING HERE GRANTS ANYTHING. A position has no capability. authority_position is a reference to an existing
// hq_position, used only to show the right and to apply the 580 pairs. New relationships always publish PENDING.
//
// ⚠ MIGRATION 620 MAY BE ABSENT. The loader then says the studio is unavailable, and every write answers 503.
//
// Pure apart from the loader: type-only import of the admin client, no next/* import.

import type { createAdminClient } from "@/lib/supabase/server";
import { readFail, readOk, type Read } from "./appointments";
import { isMissingRelation } from "./governance-model";

type Admin = ReturnType<typeof createAdminClient>;

// ── The definition ───────────────────────────────────────────────────────────
export type GovLevelDef = { level: number; label: string };
export type GovUnitDef = {
  code: string; level?: number | null; kind: string; name: string; description?: string; product_line?: string; parent?: string;
  constitution_status?: string; constitution_note?: string; interim_authority?: string; document_status?: string; document_ref?: string;
  sort?: number; retired?: boolean;
};
export type GovPositionDef = {
  code: string; unit: string; name: string; description?: string; kind: string; nomination_source?: string; provider?: string;
  accountability?: string; authority_position?: string; exclusive?: boolean; requirements?: string; sort?: number; retired?: boolean;
};
export type GovRelationshipDef = { code: string; from: string; to: string; type: string; scope: string; sort?: number; retired?: boolean };
export type GovLinkDef = {
  code: string; position: string; kind: string; clearance_domain?: string; step?: number; label: string; route?: string;
  capability?: string; note?: string; sort?: number; retired?: boolean;
};
export type GovPairDef = { a: string; b: string; reason: string };
export type GovDefinition = {
  levels: GovLevelDef[]; units: GovUnitDef[]; positions: GovPositionDef[]; relationships: GovRelationshipDef[];
  links: GovLinkDef[]; independence_pairs: GovPairDef[];
};

export const UNIT_KINDS = ["holding_company", "board", "committee", "product_lead", "department", "portfolio", "unit", "service"] as const;
export const UNIT_KIND_LABEL: Record<string, string> = {
  holding_company: "Holding company", board: "Board", committee: "Committee", product_lead: "Product lead office",
  department: "Department", portfolio: "Portfolio", unit: "Unit", service: "Shared service (no level)",
};
export const POSITION_KINDS = ["director", "committee_function", "lead", "portfolio", "it_function", "position", "member"] as const;
export const POSITION_KIND_LABEL: Record<string, string> = {
  director: "Director (board seat)", committee_function: "Committee function", lead: "Lead", portfolio: "Portfolio holder",
  it_function: "IT function", position: "Position", member: "Member",
};
export const CONSTITUTION_STATUSES = ["established", "configured", "pending_incorporation", "pending_constitution"] as const;
export const DOCUMENT_STATUSES = ["none", "draft", "approved"] as const;
export const VERSION_STATUS_LABEL: Record<string, string> = {
  draft: "Draft", review: "In review", approved: "Approved", published: "Published", superseded: "Superseded", discarded: "Discarded",
};
export const CODE_RE = /^[a-z][a-z0-9_]{2,62}$/;

export const emptyDefinition = (): GovDefinition => ({ levels: [], units: [], positions: [], relationships: [], links: [], independence_pairs: [] });

/** Read a stored definition defensively: a missing list is an empty list, never a crash. */
export function asDefinition(raw: unknown): GovDefinition {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = <T,>(k: string) => (Array.isArray(o[k]) ? (o[k] as T[]) : []);
  return {
    levels: list<GovLevelDef>("levels"), units: list<GovUnitDef>("units"), positions: list<GovPositionDef>("positions"),
    relationships: list<GovRelationshipDef>("relationships"), links: list<GovLinkDef>("links"),
    independence_pairs: list<GovPairDef>("independence_pairs"),
  };
}

/** A code from a name, unique within the definition. */
export function codeFromName(name: string, taken: Set<string>): string {
  let base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
  if (!/^[a-z]/.test(base)) base = `x_${base}`;
  if (base.length < 3) base = `${base}_unit`;
  let code = base;
  for (let i = 2; taken.has(code); i++) code = `${base}_${i}`;
  return code;
}
const allCodes = (d: GovDefinition) => new Set([...d.units, ...d.positions, ...d.relationships, ...d.links].map(x => x.code));

// ── Operations: add, edit, move, retire, restore. Never remove. ─────────────
type UnitFields = Partial<Omit<GovUnitDef, "code" | "retired">>;
type PositionFields = Partial<Omit<GovPositionDef, "code" | "retired">>;
export type StudioOp =
  | { op: "level_set"; level: number; label: string }
  | { op: "unit_add"; unit: Omit<GovUnitDef, "code"> & { code?: string } }
  | { op: "unit_edit"; code: string; fields: UnitFields }
  | { op: "unit_move"; code: string; parent: string | null; level?: number | null }
  | { op: "unit_retire"; code: string }
  | { op: "unit_restore"; code: string }
  | { op: "position_add"; position: Omit<GovPositionDef, "code"> & { code?: string } }
  | { op: "position_edit"; code: string; fields: PositionFields }
  | { op: "position_move"; code: string; unit: string }
  | { op: "position_retire"; code: string }
  | { op: "position_restore"; code: string }
  | { op: "relationship_add"; relationship: Omit<GovRelationshipDef, "code"> & { code?: string } }
  | { op: "relationship_retire"; code: string }
  | { op: "relationship_restore"; code: string }
  | { op: "pair_add"; pair: GovPairDef };
export const STUDIO_OPS = ["level_set", "unit_add", "unit_edit", "unit_move", "unit_retire", "unit_restore", "position_add",
  "position_edit", "position_move", "position_retire", "position_restore", "relationship_add", "relationship_retire",
  "relationship_restore", "pair_add"] as const;

const clean = <T extends Record<string, unknown>>(o: T): T => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    const val = typeof v === "string" ? v.trim() : v;
    if (val !== undefined && val !== null && val !== "") out[k] = val;
  }
  return out as T;
};
// Fields an edit may set. code, retired and (for a position) unit change only through their own operation.
const UNIT_EDITABLE = ["level", "kind", "name", "description", "product_line", "constitution_status", "constitution_note", "interim_authority", "document_status", "document_ref", "sort"] as const;
const POSITION_EDITABLE = ["name", "description", "kind", "nomination_source", "provider", "accountability", "authority_position", "exclusive", "requirements", "sort"] as const;
const pick = (fields: Record<string, unknown>, allowed: readonly string[]) =>
  Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
/** An emptied field is removed rather than stored as an empty string. */
const merge = <T extends object>(item: T, fields: Record<string, unknown>): T => {
  const next: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  for (const [k, v] of Object.entries(fields)) {
    const val = typeof v === "string" ? v.trim() : v;
    if (val === "" || val === null || val === undefined) delete next[k]; else next[k] = val;
  }
  return next as T;
};

/** Apply one operation to a draft. Pure. Refuses with a sentence rather than producing a broken definition. */
export function applyStudioOp(def: GovDefinition, op: StudioOp): { ok: true; def: GovDefinition } | { ok: false; error: string } {
  const d: GovDefinition = structuredClone(def);
  const unit = (c: string) => d.units.find(u => u.code === c);
  const position = (c: string) => d.positions.find(p => p.code === c);
  const fail = (error: string) => ({ ok: false as const, error });
  switch (op.op) {
    case "level_set": {
      if (!Number.isInteger(op.level) || op.level < 1 || op.level > 9) return fail("A level is a whole number from 1 to 9.");
      if (!op.label?.trim()) return fail("A level needs a label.");
      const at = d.levels.find(l => l.level === op.level);
      if (at) at.label = op.label.trim(); else d.levels.push({ level: op.level, label: op.label.trim() });
      d.levels.sort((a, b) => a.level - b.level);
      return { ok: true, def: d };
    }
    case "unit_add": {
      if (!op.unit.name?.trim()) return fail("A unit needs a name.");
      const code = op.unit.code?.trim() || codeFromName(op.unit.name, allCodes(d));
      if (allCodes(d).has(code)) return fail(`The code ${code} is already used in this structure.`);
      const u = clean({ ...op.unit, code }) as GovUnitDef;
      if (u.kind === "service") delete u.level;
      d.units.push(u);
      return { ok: true, def: d };
    }
    case "unit_edit": {
      const u = unit(op.code);
      if (!u) return fail("No such unit.");
      Object.assign(u, merge(u, pick(op.fields as Record<string, unknown>, UNIT_EDITABLE)));
      if (u.kind === "service") delete u.level;
      return { ok: true, def: d };
    }
    case "unit_move": {
      const u = unit(op.code);
      if (!u) return fail("No such unit.");
      if (op.parent === op.code) return fail("A unit cannot sit inside itself.");
      if (op.parent && !unit(op.parent)) return fail("No such parent unit.");
      for (let p = op.parent ? unit(op.parent) : undefined, i = 0; p && i < 50; p = p.parent ? unit(p.parent) : undefined, i++)
        if (p.code === op.code) return fail("That move would put the unit inside one of its own sub-units.");
      if (op.parent) u.parent = op.parent; else delete u.parent;
      if (op.level !== undefined && u.kind !== "service") { if (op.level === null) delete u.level; else u.level = op.level; }
      return { ok: true, def: d };
    }
    case "unit_retire":
    case "unit_restore": {
      const u = unit(op.code);
      if (!u) return fail("No such unit.");
      if (op.op === "unit_retire") {
        if (d.positions.some(p => p.unit === u.code && !p.retired)) return fail("Retire or move this unit's active positions first.");
        u.retired = true;
      } else delete u.retired;
      return { ok: true, def: d };
    }
    case "position_add": {
      if (!op.position.name?.trim()) return fail("A position needs a name.");
      if (!unit(op.position.unit)) return fail("Choose the unit the position sits in.");
      const code = op.position.code?.trim() || codeFromName(op.position.name, allCodes(d));
      if (allCodes(d).has(code)) return fail(`The code ${code} is already used in this structure.`);
      d.positions.push(clean({ ...op.position, code }) as GovPositionDef);
      return { ok: true, def: d };
    }
    case "position_edit": {
      const p = position(op.code);
      if (!p) return fail("No such position.");
      Object.assign(p, merge(p, pick(op.fields as Record<string, unknown>, POSITION_EDITABLE)));
      return { ok: true, def: d };
    }
    case "position_move": {
      const p = position(op.code);
      if (!p) return fail("No such position.");
      const to = unit(op.unit);
      if (!to) return fail("No such unit.");
      if (to.retired) return fail("A position cannot move into a retired unit.");
      p.unit = op.unit;
      return { ok: true, def: d };
    }
    case "position_retire":
    case "position_restore": {
      const p = position(op.code);
      if (!p) return fail("No such position.");
      if (op.op === "position_retire") p.retired = true;
      else {
        if (unit(p.unit)?.retired) return fail("Restore the unit first.");
        delete p.retired;
      }
      return { ok: true, def: d };
    }
    case "relationship_add": {
      const r = op.relationship;
      if (!unit(r.from) || !unit(r.to)) return fail("Choose both units.");
      if (r.from === r.to) return fail("A relationship joins two different units.");
      if (!r.type) return fail("Choose a relationship type.");
      if (!r.scope?.trim()) return fail("Describe the scope of the relationship.");
      const code = r.code?.trim() || codeFromName(`${r.from}_${r.type}_${r.to}`, allCodes(d));
      if (allCodes(d).has(code)) return fail(`The code ${code} is already used in this structure.`);
      d.relationships.push(clean({ ...r, code }) as GovRelationshipDef);
      return { ok: true, def: d };
    }
    case "relationship_retire":
    case "relationship_restore": {
      const r = d.relationships.find(x => x.code === op.code);
      if (!r) return fail("No such relationship.");
      if (op.op === "relationship_retire") r.retired = true; else delete r.retired;
      return { ok: true, def: d };
    }
    case "pair_add": {
      const { a, b, reason } = op.pair;
      if (!position(a) || !position(b) || a === b) return fail("Choose two different positions.");
      if (!reason?.trim()) return fail("State why the two positions must stay independent.");
      if (d.independence_pairs.some(x => (x.a === a && x.b === b) || (x.a === b && x.b === a))) return fail("That pair is already recorded.");
      d.independence_pairs.push({ a, b, reason: reason.trim() });
      return { ok: true, def: d };
    }
  }
}

/**
 * Problems that would stop publication. Mirrors the database (620 projection and the 610 constraints) so the editor can
 * say why before submitting. The database re-checks everything.
 */
export function validateDefinition(def: GovDefinition, ctx: {
  base?: GovDefinition | null; relationTypes?: string[]; positionCodes?: string[]; liveSeats?: string[];
} = {}): string[] {
  const errs: string[] = [];
  const levels = new Set(def.levels.map(l => l.level));
  const units = new Map(def.units.map(u => [u.code, u]));
  const seen = new Set<string>();
  for (const x of [...def.units, ...def.positions, ...def.relationships, ...def.links]) {
    if (!CODE_RE.test(x.code)) errs.push(`${x.code || "(blank)"}: a code is 3 to 63 lower-case letters, digits or underscores.`);
    if (seen.has(x.code)) errs.push(`${x.code}: the code is used twice.`);
    seen.add(x.code);
  }
  for (const u of def.units) {
    if (!(UNIT_KINDS as readonly string[]).includes(u.kind)) errs.push(`${u.name}: unknown unit kind ${u.kind}.`);
    if (u.kind === "service" && u.level != null) errs.push(`${u.name}: a shared service has no level.`);
    if (u.kind !== "service" && (u.level == null || !levels.has(u.level))) errs.push(`${u.name}: choose a level this version defines.`);
    if (u.parent && !units.has(u.parent)) errs.push(`${u.name}: its parent unit does not exist.`);
    if (u.document_status === "approved" && !u.document_ref) errs.push(`${u.name}: an approved document needs its reference.`);
    if (u.retired && def.positions.some(p => p.unit === u.code && !p.retired)) errs.push(`${u.name}: retired, but it still holds active positions.`);
  }
  for (const u of def.units) {
    for (let p = u.parent ? units.get(u.parent) : undefined, i = 0; p; p = p.parent ? units.get(p.parent) : undefined, i++) {
      if (p.code === u.code || i > 50) { errs.push(`${u.name}: it sits inside itself.`); break; }
    }
  }
  for (const p of def.positions) {
    if (!units.has(p.unit)) errs.push(`${p.name}: its unit does not exist.`);
    else if (!p.retired && units.get(p.unit)!.retired) errs.push(`${p.name}: active, but its unit is retired.`);
    if (!(POSITION_KINDS as readonly string[]).includes(p.kind)) errs.push(`${p.name}: unknown position kind ${p.kind}.`);
    if (p.kind === "director" && p.authority_position) errs.push(`${p.name}: a board seat is never linked to a platform position.`);
    if (p.authority_position && ctx.positionCodes && !ctx.positionCodes.includes(p.authority_position))
      errs.push(`${p.name}: the linked HQ position ${p.authority_position} does not exist.`);
    if (p.retired && ctx.liveSeats?.includes(p.code)) errs.push(`${p.name}: has a live appointment record. End it before retiring the position.`);
  }
  for (const r of def.relationships) {
    if (!units.has(r.from) || !units.has(r.to)) errs.push(`${r.code}: both units must exist.`);
    if (!r.retired && ctx.relationTypes && !ctx.relationTypes.includes(r.type)) errs.push(`${r.code}: the relationship type ${r.type} is not active.`);
  }
  if (ctx.base) {
    const has = (list: { code: string }[], code: string) => list.some(x => x.code === code);
    for (const [name, a, b] of [["unit", ctx.base.units, def.units], ["position", ctx.base.positions, def.positions],
                                ["relationship", ctx.base.relationships, def.relationships], ["link", ctx.base.links, def.links]] as const)
      for (const x of a) if (!has(b, x.code)) errs.push(`${x.code}: this ${name} is in the published structure. Retire it instead of removing it.`);
    for (const r of def.relationships) {
      const was = ctx.base.relationships.find(x => x.code === r.code);
      if (was && (was.from !== r.from || was.to !== r.to || was.type !== r.type || was.scope !== r.scope))
        errs.push(`${r.code}: a published relationship never changes its units, type or scope. Retire it and add a new one.`);
    }
  }
  return errs;
}

// ── Preview: what a draft changes against the published version ────────────
export type GovChange = { kind: "level" | "unit" | "position" | "relationship" | "link" | "pair"; code: string; name: string;
  change: "added" | "retired" | "restored" | "changed" | "moved"; detail?: string };

export function diffDefinitions(base: GovDefinition | null, draft: GovDefinition): GovChange[] {
  const out: GovChange[] = [];
  const b = base ?? emptyDefinition();
  for (const l of draft.levels) {
    const was = b.levels.find(x => x.level === l.level);
    if (!was) out.push({ kind: "level", code: String(l.level), name: l.label, change: "added" });
    else if (was.label !== l.label) out.push({ kind: "level", code: String(l.level), name: l.label, change: "changed", detail: `was ${was.label}` });
  }
  const walk = <T extends { code: string; retired?: boolean }>(kind: GovChange["kind"], a: T[], c: T[], name: (x: T) => string, moveKey?: keyof T) => {
    for (const x of c) {
      const was = a.find(y => y.code === x.code);
      if (!was) { out.push({ kind, code: x.code, name: name(x), change: "added" }); continue; }
      if (!was.retired && x.retired) { out.push({ kind, code: x.code, name: name(x), change: "retired" }); continue; }
      if (was.retired && !x.retired) { out.push({ kind, code: x.code, name: name(x), change: "restored" }); continue; }
      if (moveKey && was[moveKey] !== x[moveKey]) out.push({ kind, code: x.code, name: name(x), change: "moved", detail: `${String(was[moveKey] ?? "top")} → ${String(x[moveKey] ?? "top")}` });
      const fields = Object.keys({ ...was, ...x }).filter(k => k !== moveKey && k !== "retired" && JSON.stringify((was as Record<string, unknown>)[k]) !== JSON.stringify((x as Record<string, unknown>)[k]));
      if (fields.length) out.push({ kind, code: x.code, name: name(x), change: "changed", detail: fields.join(", ") });
    }
  };
  walk("unit", b.units, draft.units, u => u.name, "parent");
  walk("position", b.positions, draft.positions, p => p.name, "unit");
  walk("relationship", b.relationships, draft.relationships, r => `${r.from} → ${r.to}`);
  walk("link", b.links, draft.links, l => l.label);
  for (const p of draft.independence_pairs)
    if (!b.independence_pairs.some(x => (x.a === p.a && x.b === p.b) || (x.a === p.b && x.b === p.a)))
      out.push({ kind: "pair", code: `${p.a}|${p.b}`, name: `${p.a} / ${p.b}`, change: "added", detail: p.reason });
  return out;
}

// ── Loader ───────────────────────────────────────────────────────────────────
export type GovVersionSummary = {
  id: string; versionNo: number; title: string; status: string; changeSummary: string | null; revision: number;
  effectiveFrom: string | null; publishedAt: string | null; approvalBasis: string | null; selfApproved: boolean;
  createdAt: string | null; editedAt: string | null; submittedAt: string | null; approvedAt: string | null; supersededAt: string | null;
};
export type GovRelationType = { code: string; label: string; lineStyle: "solid" | "dashed" | "dotted"; description: string | null; isActive: boolean };
export type GovStructureSummary = { code: string; name: string; productLine: string; description: string | null };
export type GovStudioLoad =
  | { state: "absent"; reason: string }
  | { state: "unreadable"; error: string }
  | { state: "ok"; structures: GovStructureSummary[]; structure: GovStructureSummary | null; versions: GovVersionSummary[];
      /** The version on screen, with its definition. */
      selected: (GovVersionSummary & { definition: GovDefinition }) | null;
      published: (GovVersionSummary & { definition: GovDefinition }) | null;
      relationTypes: GovRelationType[]; positionCodes: Read<{ code: string; name: string }[]>; liveSeats: Read<string[]>;
      productLines: { code: string; name: string }[] };

type VersionRow = { id: string; version_no: number; title: string; status: string; change_summary: string | null; revision: number;
  effective_from: string | null; published_at: string | null; approval_basis: string | null; self_approved: boolean | null;
  created_at: string | null; edited_at: string | null; submitted_at: string | null; approved_at: string | null; superseded_at: string | null;
  definition?: unknown };
const toSummary = (v: VersionRow): GovVersionSummary => ({
  id: v.id, versionNo: v.version_no, title: v.title, status: v.status, changeSummary: v.change_summary, revision: v.revision,
  effectiveFrom: v.effective_from, publishedAt: v.published_at, approvalBasis: v.approval_basis, selfApproved: v.self_approved === true,
  createdAt: v.created_at, editedAt: v.edited_at, submittedAt: v.submitted_at, approvedAt: v.approved_at, supersededAt: v.superseded_at,
});
const VERSION_COLS = "id, version_no, title, status, change_summary, revision, effective_from, published_at, approval_basis, self_approved, created_at, edited_at, submitted_at, approved_at, superseded_at";

/** The studio for one structure (default: the first), showing one version (default: the open one, else the published one). */
export async function loadStudio(admin: Admin, opts: { structure?: string | null; version?: string | null } = {}): Promise<GovStudioLoad> {
  const [structRes, typeRes, lineRes] = await Promise.all([
    admin.from("hq_gov_structure").select("code, name, product_line_code, description").order("code").limit(200),
    admin.from("hq_gov_relation_type").select("code, label, line_style, description, is_active, sort").order("sort").limit(200),
    admin.from("plat_product_line").select("code, name").order("sort").limit(50),
  ]);
  const missing = [structRes, typeRes].find(r => r.error && isMissingRelation(r.error.message, r.error.code));
  if (missing) return { state: "absent", reason: "Migration 620 is not applied to this database, so the Organisation & Governance Studio is not available. Nothing was read and nothing can be changed." };
  const failed = [structRes, typeRes].find(r => r.error);
  if (failed?.error) return { state: "unreadable", error: failed.error.message };

  const structures = ((structRes.data ?? []) as { code: string; name: string; product_line_code: string; description: string | null }[])
    .map(s => ({ code: s.code, name: s.name, productLine: s.product_line_code, description: s.description }));
  const structure = structures.find(s => s.code === opts.structure) ?? structures.find(s => s.code === "scholar") ?? structures[0] ?? null;
  const relationTypes = ((typeRes.data ?? []) as { code: string; label: string; line_style: string; description: string | null; is_active: boolean }[])
    .map(t => ({ code: t.code, label: t.label, lineStyle: (t.line_style === "dashed" || t.line_style === "dotted" ? t.line_style : "solid") as GovRelationType["lineStyle"], description: t.description, isActive: t.is_active }));
  const productLines = lineRes.error ? [] : ((lineRes.data ?? []) as { code: string; name: string }[]);

  const [posRes, apptRes] = await Promise.all([
    admin.from("hq_position").select("code, name, is_active").order("name").limit(500),
    admin.from("hq_gov_seat_appointment").select("seat_code, status").neq("status", "ended").limit(5000),
  ]);
  const positionCodes: Read<{ code: string; name: string }[]> = posRes.error ? readFail(posRes.error.message)
    : readOk(((posRes.data ?? []) as { code: string; name: string | null; is_active: boolean | null }[]).filter(p => p.is_active !== false).map(p => ({ code: p.code, name: p.name ?? p.code })));
  const liveSeats: Read<string[]> = apptRes.error ? readFail(apptRes.error.message) : readOk([...new Set(((apptRes.data ?? []) as { seat_code: string }[]).map(a => a.seat_code))]);

  if (!structure) return { state: "ok", structures, structure: null, versions: [], selected: null, published: null, relationTypes, positionCodes, liveSeats, productLines };

  const verRes = await admin.from("hq_gov_structure_version").select(VERSION_COLS).eq("structure_code", structure.code).order("version_no", { ascending: false }).limit(500);
  if (verRes.error) return { state: "unreadable", error: verRes.error.message };
  const versions = ((verRes.data ?? []) as VersionRow[]).map(toSummary);
  const publishedSummary = versions.find(v => v.status === "published") ?? null;
  const open = versions.find(v => v.status === "draft" || v.status === "review" || v.status === "approved") ?? null;
  const selectedSummary = versions.find(v => v.id === opts.version) ?? open ?? publishedSummary;

  const ids = [...new Set([selectedSummary?.id, publishedSummary?.id].filter((x): x is string => !!x))];
  const defRes = ids.length ? await admin.from("hq_gov_structure_version").select("id, definition").in("id", ids) : { data: [], error: null };
  if (defRes.error) return { state: "unreadable", error: defRes.error.message };
  const defs = new Map(((defRes.data ?? []) as { id: string; definition: unknown }[]).map(r => [r.id, asDefinition(r.definition)]));
  const withDef = (v: GovVersionSummary | null) => (v && defs.has(v.id) ? { ...v, definition: defs.get(v.id)! } : null);

  return { state: "ok", structures, structure, versions, selected: withDef(selectedSummary), published: withDef(publishedSummary),
    relationTypes, positionCodes, liveSeats, productLines };
}

// ── Requests ─────────────────────────────────────────────────────────────────
export type StudioAction =
  | { action: "create_structure"; code: string; name: string; productLine: string; description: string | null; reason: string }
  | { action: "create_draft"; structure: string; title: string | null; reason: string }
  | { action: "edit"; version: string; revision: number; op: StudioOp; reason: string }
  | { action: "save_details"; version: string; revision: number; title: string | null; changeSummary: string | null; reason: string }
  | { action: "transition"; version: string; step: "submit" | "return" | "discard" | "approve"; reason: string }
  | { action: "publish"; version: string; effectiveFrom: string | null; basis: string; reason: string }
  | { action: "add_relation_type"; code: string; label: string; lineStyle: "solid" | "dashed" | "dotted"; description: string | null; reason: string };
/** Approve, publish and structure creation are owner-only (the database refuses anyone else too). */
export const OWNER_ONLY_ACTIONS = ["create_structure", "publish"] as const;
export const isOwnerOnly = (a: StudioAction) => a.action === "create_structure" || a.action === "publish" || (a.action === "transition" && a.step === "approve");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const opt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseStudioAction(b: unknown): { ok: true; value: StudioAction } | { ok: false; error: string } {
  const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const reason = str(o.reason);
  if (reason.length < 5) return { ok: false, error: "A reason of at least 5 characters is required. It is written to the audit trail." };
  const version = str(o.version);
  const needVersion = () => (UUID_RE.test(version) ? null : "version is required.");
  switch (str(o.action)) {
    case "create_structure": {
      const code = str(o.code), name = str(o.name), productLine = str(o.product_line);
      if (!CODE_RE.test(code)) return { ok: false, error: "The structure code must be 3 to 63 lower-case letters, digits or underscores." };
      if (!name || !productLine) return { ok: false, error: "A structure needs a name and a product line." };
      return { ok: true, value: { action: "create_structure", code, name, productLine, description: opt(o.description), reason } };
    }
    case "create_draft": {
      const structure = str(o.structure);
      return CODE_RE.test(structure) ? { ok: true, value: { action: "create_draft", structure, title: opt(o.title), reason } } : { ok: false, error: "structure is required." };
    }
    case "edit": {
      const e = needVersion(); if (e) return { ok: false, error: e };
      const op = o.op as StudioOp | undefined;
      if (!op || typeof op !== "object" || !(STUDIO_OPS as readonly string[]).includes((op as { op?: string }).op ?? ""))
        return { ok: false, error: "op must be one of the studio operations." };
      if (!Number.isInteger(o.revision)) return { ok: false, error: "revision is required." };
      return { ok: true, value: { action: "edit", version, revision: o.revision as number, op, reason } };
    }
    case "save_details": {
      const e = needVersion(); if (e) return { ok: false, error: e };
      if (!Number.isInteger(o.revision)) return { ok: false, error: "revision is required." };
      return { ok: true, value: { action: "save_details", version, revision: o.revision as number, title: opt(o.title), changeSummary: opt(o.change_summary), reason } };
    }
    case "transition": {
      const e = needVersion(); if (e) return { ok: false, error: e };
      const step = str(o.step);
      if (!["submit", "return", "discard", "approve"].includes(step)) return { ok: false, error: "step must be submit, return, discard or approve." };
      return { ok: true, value: { action: "transition", version, step: step as "submit", reason } };
    }
    case "publish": {
      const e = needVersion(); if (e) return { ok: false, error: e };
      const basis = str(o.basis);
      const eff = opt(o.effective_from);
      if (basis.length < 5) return { ok: false, error: "Publication names its basis: the decision or approval reference." };
      if (eff && !/^\d{4}-\d{2}-\d{2}$/.test(eff)) return { ok: false, error: "The effective date must be YYYY-MM-DD." };
      return { ok: true, value: { action: "publish", version, effectiveFrom: eff, basis, reason } };
    }
    case "add_relation_type": {
      const code = str(o.code), label = str(o.label), lineStyle = str(o.line_style) || "solid";
      if (!CODE_RE.test(code)) return { ok: false, error: "The type code must be 3 to 63 lower-case letters, digits or underscores." };
      if (!label) return { ok: false, error: "A relationship type needs a label." };
      if (!["solid", "dashed", "dotted"].includes(lineStyle)) return { ok: false, error: "The line style is solid, dashed or dotted." };
      return { ok: true, value: { action: "add_relation_type", code, label, lineStyle: lineStyle as "solid", description: opt(o.description), reason } };
    }
    default:
      return { ok: false, error: "action must be one of create_structure, create_draft, edit, save_details, transition, publish, add_relation_type." };
  }
}

type Actor = { id: string; name: string | null; trace: string | null };
/** The function for every action except edit and save_details, which the route builds from the draft it reads. */
export function studioRpcFor(a: Exclude<StudioAction, { action: "edit" } | { action: "save_details" }>, actor: Actor): { fn: string; args: Record<string, unknown> } {
  const base = { p_actor: actor.id, p_actor_name: actor.name, p_trace: actor.trace, p_reason: a.reason };
  switch (a.action) {
    case "create_structure": return { fn: "hq_gov_studio_create_structure", args: { ...base, p_code: a.code, p_name: a.name, p_product_line: a.productLine, p_description: a.description } };
    case "create_draft": return { fn: "hq_gov_studio_create_draft", args: { ...base, p_structure: a.structure, p_title: a.title } };
    case "transition": return { fn: "hq_gov_studio_transition", args: { ...base, p_version: a.version, p_action: a.step } };
    case "publish": return { fn: "hq_gov_studio_publish", args: { ...base, p_version: a.version, p_effective_from: a.effectiveFrom, p_basis: a.basis } };
    case "add_relation_type": return { fn: "hq_gov_studio_add_relation_type", args: { ...base, p_code: a.code, p_label: a.label, p_line_style: a.lineStyle, p_description: a.description } };
  }
}
export const saveDraftRpc = (actor: Actor, version: string, revision: number, def: GovDefinition, reason: string, title: string | null = null, summary: string | null = null) => ({
  fn: "hq_gov_studio_save_draft",
  args: { p_actor: actor.id, p_actor_name: actor.name, p_trace: actor.trace, p_version: version, p_revision: revision, p_definition: def, p_title: title, p_change_summary: summary, p_reason: reason },
});

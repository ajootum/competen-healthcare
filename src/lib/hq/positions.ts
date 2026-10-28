// Competen HQ — positions and their grants, administered from the screen rather than written by a migration.
//
// HQ-POSITION-ADMIN-01, migration 500. Owner, 2026-10-25: "Can you make creation of roles in HQ no code
// i.e. configureable?" Until 500 every hq_position and hq_position_capability row came from a migration.
//
// ⚠ THE DATABASE DECIDES, THIS FILE EXPLAINS. Every write goes through one hq_position_admin_* function,
// which checks ownership, writes the audit_log row FIRST and then the change, in one transaction. The
// separation-of-duties pairs are refused by a trigger on hq_position_capability for EVERY writer, migrations
// included. The two lists below mirror that migration so the screen can say WHY before the owner presses the
// button, and positions.test.ts reads the migration file to prove they still agree.
//
// ⚠ CAPABILITIES STAY CODE. A capability is enforced by routes, and hq-guard B1 requires the applied catalogue
// to equal HQ_CAPABILITIES. So the screen grants only codes in that catalogue, and "register" only inserts a
// code the catalogue already defines (with the space the catalogue gives it), never one the client invents.
//
// Pure module: type-only import of the admin client, no next/* import.

import type { createAdminClient } from "@/lib/supabase/server";
import { HQ_CAPABILITIES, HQ_CAPABILITY_CODES, HQ_SPACES, spaceOfCapability, type HqSpace } from "./spaces";
import { readFail, readOk, type Read } from "./appointments";

type Admin = ReturnType<typeof createAdminClient>;

export type HqSensitiveClass = "clinical" | "financial" | "platform";

/** Mirrors hq_capability_sensitive_class() as migration 620 last defined it (511 plus the studio right). A grant of one needs an explicit acknowledgement. */
export const HQ_SENSITIVE_CAPABILITIES: Record<HqSensitiveClass, readonly string[]> = {
  clinical: ["hq.quality.clinical.approve", "hq.quality.clinical.govern", "hq.competency.verification.manage", "hq.competency.verification.assess"],
  financial: ["hq.practice.commercial.manage", "hq.individual.commercial.manage", "hq.learning.price.approve", "hq.platform.ai.manage"],
  platform: [
    "hq.platform.users.view", "hq.platform.users.reset", "hq.platform.system.view", "hq.platform.settings.view",
    "hq.platform.operations.view", "hq.platform.tenants.view", "hq.platform.audit.view", "hq.individual.pilot.grant",
    "hq.individual.config.manage", "hq.individual.professional.verify", "hq.practice.licence.verify",
    "hq.practice.provision.execute", "hq.practice.flags.manage", "hq.practice.release.activate",
    "hq.practice.release.rollback", "hq.practice.export.execute", "hq.practice.change.approve",
    "hq.practice.risk.accept", "hq.practice.configuration.manage", "hq.learning.certificate.issue", "hq.platform.governance.manage",
  ],
};

export const SENSITIVE_LABEL: Record<HqSensitiveClass, string> = {
  clinical: "Clinical decision right",
  financial: "Financial right",
  platform: "Platform or owner-level right",
};

export function sensitiveClassOf(code: string): HqSensitiveClass | null {
  for (const k of Object.keys(HQ_SENSITIVE_CAPABILITIES) as HqSensitiveClass[])
    if (HQ_SENSITIVE_CAPABILITIES[k].includes(code)) return k;
  return null;
}

/**
 * The 15 separation-of-duties pairs, mirrored from the hq_sod_pair_policy seed of migration 640 (the 580 list,
 * same order). Since HQ-SOD-CROSSCUT-01 a pair is CONFIGURATION: allowed or blocked on positions. Only a
 * `liftable` pair may be allowed, and only because an equal or stronger item-level safeguard exists (`safeguard`,
 * enforced by the database for every writer). Liftable is set by migration, never by the screen.
 */
export type HqCapabilityPair = { a: string; b: string; reason: string; liftable: boolean; safeguard: string | null };
export const HQ_CAPABILITY_PAIRS: readonly HqCapabilityPair[] = [
  { a: "hq.quality.clinical.approve", b: "hq.quality.competency.author", reason: "a competency author cannot hold clinical approval", liftable: true,
    safeguard: "No reviewer decides a competency version that they, or any earlier version, authored, edited or submitted, read from every version and the audit trail (395, 640)" },
  { a: "hq.quality.clinical.approve", b: "hq.quality.case.author", reason: "a case author cannot hold clinical approval", liftable: true,
    safeguard: "No reviewer decides a version of a case when they authored, edited or submitted any version of that case (422, 640)" },
  { a: "hq.quality.clinical.approve", b: "hq.learning.course.author", reason: "a course author cannot hold clinical approval", liftable: true,
    safeguard: "No reviewer decides a version of a learning offering when they authored, edited or submitted any version of it (461, 640)" },
  { a: "hq.quality.clinical.approve", b: "hq.learning.ckri.educator", reason: "a knowledge educator cannot hold clinical approval", liftable: true,
    safeguard: "No reviewer decides a version of a knowledge resource when they authored, submitted or educator-reviewed any version of it (442, 640)" },
  { a: "hq.quality.clinical.approve", b: "hq.quality.clinical.govern", reason: "a clinical reviewer cannot set reviewer scopes", liftable: true,
    safeguard: "Nobody sets or widens their own reviewer scope, and lowering the number of independent approvals needs the platform owner (640)" },
  { a: "hq.quality.case.author", b: "hq.quality.case.publish", reason: "a case author cannot publish cases", liftable: true,
    safeguard: "An author, editor or submitter of a case version cannot publish it (640, verified absent from 422 before lifting)" },
  { a: "hq.learning.course.author", b: "hq.learning.course.publish", reason: "a course author cannot publish courses", liftable: true,
    safeguard: "An author, editor or submitter of a learning version cannot publish it (460, 461, 640)" },
  { a: "hq.learning.ckri.educator", b: "hq.quality.knowledge.publish", reason: "a knowledge educator cannot publish knowledge resources", liftable: true,
    safeguard: "An author, submitter or reviewing educator of a knowledge version cannot publish it (640)" },
  { a: "hq.quality.research.propose", b: "hq.quality.research.review", reason: "a research proposer cannot review research", liftable: false, safeguard: null },
  { a: "hq.quality.research.propose", b: "hq.quality.research.govern", reason: "a research proposer cannot govern research", liftable: false, safeguard: null },
  // Migration 511, COMPETENCY-01 C5: the Competency Assessor is a separate authority from content approval and the Studio.
  { a: "hq.competency.verification.assess", b: "hq.quality.clinical.approve", reason: "a competency assessor cannot hold clinical content approval", liftable: false, safeguard: null },
  { a: "hq.competency.verification.assess", b: "hq.quality.clinical.govern", reason: "a competency assessor cannot govern clinical reviewer scopes", liftable: false, safeguard: null },
  { a: "hq.competency.verification.assess", b: "hq.quality.competency.author", reason: "a competency assessor cannot author competency content", liftable: false, safeguard: null },
  { a: "hq.competency.verification.assess", b: "hq.competency.verification.manage", reason: "a competency assessor cannot set assessment criteria, scopes or assignments", liftable: false, safeguard: null },
  // Migration 580 (owner CENTRAL GOVERNANCE): a competency author never publishes competency frameworks.
  { a: "hq.quality.competency.author", b: "hq.quality.competency.publish", reason: "a competency author cannot publish competency frameworks", liftable: true,
    safeguard: "The publisher of a shared framework is never its submitter or a contributor in its audit trail (580, 640)" },
];

/** Every pair, exactly as 580 defined hq_capability_exclusions(). The strict set, and the fail-closed one. */
export const HQ_CAPABILITY_EXCLUSIONS: readonly { a: string; b: string; reason: string }[] = HQ_CAPABILITY_PAIRS.map(({ a, b, reason }) => ({ a, b, reason }));

/** The first live capability on the position that `code` may not sit beside, or null. */
export function exclusionConflict(
  code: string, liveCodes: string[], exclusions: readonly { a: string; b: string; reason: string }[] = HQ_CAPABILITY_EXCLUSIONS,
): { with: string; reason: string } | null {
  for (const e of exclusions) {
    if (e.a === code && liveCodes.includes(e.b)) return { with: e.b, reason: e.reason };
    if (e.b === code && liveCodes.includes(e.a)) return { with: e.a, reason: e.reason };
  }
  return null;
}

// ── Separation-of-duties configuration (migration 640) ───────────────────────
export const SOD_CONTENT_KINDS = ["competency_framework", "case", "resource", "learning"] as const;
export type HqSodContentKind = (typeof SOD_CONTENT_KINDS)[number];
export type HqSodPairState = HqCapabilityPair & { allowed: boolean };
export type HqSodPolicy = {
  /** hq_config.sod_strict_positions: every pair blocked on positions again. */
  strict: boolean;
  /** hq_config.multiple_appointments: a person may hold several live HQ appointments. */
  multipleAppointments: boolean;
  pairs: HqSodPairState[];
  contentRules: { kind: HqSodContentKind; label: string; publisherNotApprover: boolean }[];
};

/**
 * The pairs the database refuses on a position right now. ⚠ FAIL CLOSED: when the policy cannot be read (640
 * absent, or a read error) every pair counts, which is exactly what 580 enforced.
 */
export function effectiveExclusions(policy: Read<HqSodPolicy>): readonly { a: string; b: string; reason: string }[] {
  if (!policy.ok) return HQ_CAPABILITY_EXCLUSIONS;
  return policy.value.pairs.filter(p => policy.value.strict || !p.allowed).map(({ a, b, reason }) => ({ a, b, reason }));
}

type PairRow = { capability_a: string; capability_b: string; reason: string; liftable: boolean; item_safeguard: string | null; allowed: boolean };
type RuleRow = { content_kind: string; label: string; publisher_not_approver: boolean };
type SodConfigRow = { sod_strict_positions?: boolean | null; multiple_appointments?: boolean | null };

/** Pure: the policy from its rows, in the catalogue's order. A pair the code does not know is still shown, last. */
export function buildSodPolicy(pairs: PairRow[], rules: RuleRow[], cfg: SodConfigRow | null): HqSodPolicy {
  const order = (r: PairRow) => { const i = HQ_CAPABILITY_PAIRS.findIndex(p => p.a === r.capability_a && p.b === r.capability_b); return i < 0 ? 999 : i; };
  return {
    strict: cfg?.sod_strict_positions === true,
    multipleAppointments: cfg?.multiple_appointments !== false,
    pairs: [...pairs].sort((x, y) => order(x) - order(y)).map(r => ({
      a: r.capability_a, b: r.capability_b, reason: r.reason, liftable: r.liftable, safeguard: r.item_safeguard, allowed: r.allowed,
    })),
    contentRules: rules
      .filter(r => (SOD_CONTENT_KINDS as readonly string[]).includes(r.content_kind))
      .sort((x, y) => SOD_CONTENT_KINDS.indexOf(x.content_kind as HqSodContentKind) - SOD_CONTENT_KINDS.indexOf(y.content_kind as HqSodContentKind))
      .map(r => ({ kind: r.content_kind as HqSodContentKind, label: r.label, publisherNotApprover: r.publisher_not_approver })),
  };
}

/** The policy, read once. Unreadable (never a guessed default) when 640 is absent or a read fails. */
export async function loadSodPolicy(admin: Admin): Promise<Read<HqSodPolicy>> {
  const [pairs, rules, cfg] = await Promise.all([
    admin.from("hq_sod_pair_policy").select("capability_a, capability_b, reason, liftable, item_safeguard, allowed").limit(200),
    admin.from("hq_sod_content_rule").select("content_kind, label, publisher_not_approver").limit(50),
    admin.from("hq_config").select("sod_strict_positions, multiple_appointments").eq("id", "singleton").limit(1),
  ]);
  const err = pairs.error ?? rules.error ?? cfg.error;
  if (err) return readFail(err.message);
  return readOk(buildSodPolicy((pairs.data ?? []) as PairRow[], (rules.data ?? []) as RuleRow[], ((cfg.data ?? [])[0] ?? null) as SodConfigRow | null));
}

// ── Requests ─────────────────────────────────────────────────────────────────
export const POSITION_CODE_RE = /^[a-z][a-z0-9_]{2,62}$/;
export const MIN_REASON = 5;

export type HqPositionAction =
  | { action: "create"; code: string; space: HqSpace; name: string; description: string | null; reason: string }
  | { action: "update"; code: string; name: string; description: string | null; reason: string }
  | { action: "set_active"; code: string; active: boolean; reason: string }
  | { action: "grant"; code: string; capability: string; reason: string; acknowledgeSensitive: boolean }
  | { action: "end_grant"; code: string; capability: string; reason: string }
  | { action: "register"; capability: string; label: string; description: string | null; reason: string }
  // Migration 640: the separation-of-duties configuration. Owner only, like every action here.
  | { action: "set_pair"; a: string; b: string; allowed: boolean; reason: string }
  | { action: "set_settings"; strict: boolean; multipleAppointments: boolean; reason: string }
  | { action: "set_content_rule"; kind: HqSodContentKind; publisherNotApprover: boolean; reason: string };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const optStr = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Parse a request body. Pure. The database re-checks everything here, so this exists to refuse early with a
 * sentence and, above all, to keep the CAPABILITY inside the code catalogue: that is the one check the
 * database cannot make, because it does not know what the code defines.
 */
export function parsePositionAction(b: unknown): { ok: true; value: HqPositionAction } | { ok: false; error: string } {
  const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const action = str(o.action);
  const reason = str(o.reason);
  const code = str(o.code);
  if (reason.length < MIN_REASON) return { ok: false, error: `A reason of at least ${MIN_REASON} characters is required. It is written to the audit trail.` };
  const needCode = () => (POSITION_CODE_RE.test(code) ? null : "The position code must be 3 to 63 lower-case letters, digits or underscores, starting with a letter.");
  const needCatalogue = (cap: string) => (HQ_CAPABILITY_CODES.includes(cap) ? null : `${cap || "That capability"} is not in the code catalogue (src/lib/hq/spaces.ts). Capabilities are defined in code, never here.`);

  switch (action) {
    case "create": {
      const space = str(o.space);
      const name = str(o.name);
      const e = needCode()
        ?? (!(HQ_SPACES as readonly string[]).includes(space) ? "The space must be one of the five HQ spaces." : null)
        ?? (!name || name.length > 120 ? "The name is required and at most 120 characters." : null);
      return e ? { ok: false, error: e } : { ok: true, value: { action, code, space: space as HqSpace, name, description: optStr(o.description), reason } };
    }
    case "update": {
      const name = str(o.name);
      const e = needCode() ?? (!name || name.length > 120 ? "The name is required and at most 120 characters." : null);
      return e ? { ok: false, error: e } : { ok: true, value: { action, code, name, description: optStr(o.description), reason } };
    }
    case "set_active": {
      if (typeof o.active !== "boolean") return { ok: false, error: "active must be true or false." };
      const e = needCode();
      return e ? { ok: false, error: e } : { ok: true, value: { action, code, active: o.active, reason } };
    }
    case "grant":
    case "end_grant": {
      const capability = str(o.capability);
      const e = needCode() ?? (action === "grant" ? needCatalogue(capability) : capability ? null : "capability is required.");
      if (e) return { ok: false, error: e };
      return action === "grant"
        ? { ok: true, value: { action, code, capability, reason, acknowledgeSensitive: o.acknowledge_sensitive === true } }
        : { ok: true, value: { action, code, capability, reason } };
    }
    case "register": {
      const capability = str(o.capability);
      const label = str(o.label);
      const e = needCatalogue(capability) ?? (!label ? "The label is required." : null);
      return e ? { ok: false, error: e } : { ok: true, value: { action, capability, label, description: optStr(o.description), reason } };
    }
    case "set_pair": {
      const a = str(o.a), b2 = str(o.b);
      if (typeof o.allowed !== "boolean") return { ok: false, error: "allowed must be true or false." };
      if (!HQ_CAPABILITY_PAIRS.some(p => (p.a === a && p.b === b2) || (p.a === b2 && p.b === a))) return { ok: false, error: "That is not one of the separation-of-duties pairs." };
      return { ok: true, value: { action, a, b: b2, allowed: o.allowed, reason } };
    }
    case "set_settings": {
      if (typeof o.strict !== "boolean" || typeof o.multiple_appointments !== "boolean") return { ok: false, error: "strict and multiple_appointments must each be true or false." };
      return { ok: true, value: { action, strict: o.strict, multipleAppointments: o.multiple_appointments, reason } };
    }
    case "set_content_rule": {
      const kind = str(o.kind);
      if (!(SOD_CONTENT_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "That is not a content type with separation rules." };
      if (typeof o.publisher_not_approver !== "boolean") return { ok: false, error: "publisher_not_approver must be true or false." };
      return { ok: true, value: { action, kind: kind as HqSodContentKind, publisherNotApprover: o.publisher_not_approver, reason } };
    }
    default:
      return { ok: false, error: "action must be one of create, update, set_active, grant, end_grant, register, set_pair, set_settings, set_content_rule." };
  }
}

/** The function and its arguments for one action. The space of a registered capability comes from code. */
export function rpcFor(a: HqPositionAction, actor: { id: string; name: string | null; trace: string | null }): { fn: string; args: Record<string, unknown> } {
  const base = { p_actor: actor.id, p_actor_name: actor.name, p_trace: actor.trace };
  switch (a.action) {
    case "create": return { fn: "hq_position_admin_create", args: { ...base, p_code: a.code, p_space: a.space, p_name: a.name, p_description: a.description, p_reason: a.reason } };
    case "update": return { fn: "hq_position_admin_update", args: { ...base, p_code: a.code, p_name: a.name, p_description: a.description, p_reason: a.reason } };
    case "set_active": return { fn: "hq_position_admin_set_active", args: { ...base, p_code: a.code, p_active: a.active, p_reason: a.reason } };
    case "grant": return { fn: "hq_position_admin_grant", args: { ...base, p_position: a.code, p_capability: a.capability, p_reason: a.reason, p_acknowledge_sensitive: a.acknowledgeSensitive } };
    case "end_grant": return { fn: "hq_position_admin_end_grant", args: { ...base, p_position: a.code, p_capability: a.capability, p_reason: a.reason } };
    case "register": return { fn: "hq_position_admin_register", args: { ...base, p_code: a.capability, p_space: spaceOfCapability(a.capability), p_label: a.label, p_description: a.description, p_reason: a.reason } };
    case "set_pair": return { fn: "hq_sod_admin_set_pair", args: { ...base, p_capability_a: a.a, p_capability_b: a.b, p_allowed: a.allowed, p_reason: a.reason } };
    case "set_settings": return { fn: "hq_sod_admin_set_settings", args: { ...base, p_strict: a.strict, p_multiple: a.multipleAppointments, p_reason: a.reason } };
    case "set_content_rule": return { fn: "hq_sod_admin_set_content_rule", args: { ...base, p_content_kind: a.kind, p_publisher_not_approver: a.publisherNotApprover, p_reason: a.reason } };
  }
}

/**
 * A database refusal, as an HTTP status and the database's own sentence.
 *
 * ⚠ A MISSING FUNCTION IS NOT A REFUSAL. Before migration 500 is applied the RPC does not exist, and the
 * screen must say that writes are unavailable -- never that the owner lacks the right.
 */
export function statusForDbError(message: string, code?: string | null): { status: number; error: string } {
  if (code === "PGRST202" || code === "42883" || /could not find the function|function .* does not exist/i.test(message))
    return /hq_sod_admin/.test(message)
      ? { status: 503, error: "Separation-of-duties settings are not available yet: migration 640 is not applied to this database. Nothing was changed." }
      : { status: 503, error: "Position administration is not available yet: migration 500 is not applied to this database. Nothing was changed." };
  const m = /(?:hq_position(?:_admin|_capability)?|hq_sod) (\w+): ([\s\S]*)$/.exec(message);
  const tag = m?.[1] ?? "";
  const text = m ? m[2] : message;
  const status =
    tag === "owner_required" ? 403
    : tag === "not_found" ? 404
    : tag === "exists" || tag === "history" || tag === "separation_of_duties" || tag === "unchanged"
      || tag === "not_liftable" || tag === "conflict" || tag === "single_appointment" ? 409
    : tag === "invalid" || tag === "sensitive" ? 400
    : 500;
  return { status, error: status === 500 ? `The change was not written: ${message}` : text };
}

// ── The board ────────────────────────────────────────────────────────────────
export type HqGrantView = {
  id: string;
  capability: string;
  label: string | null;
  source: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  live: boolean;
  grantReason: string | null;
  endReason: string | null;
  sensitive: HqSensitiveClass | null;
  /** In the code catalogue. A grant of a code the code no longer defines is shown, never hidden. */
  inCodeCatalogue: boolean;
};
export type HqPositionAdminView = {
  code: string; space: HqSpace; name: string; description: string | null; isActive: boolean;
  grants: Read<HqGrantView[]>;
};
export type HqCatalogueEntry = { code: string; space: HqSpace; applied: boolean; label: string | null; sensitive: HqSensitiveClass | null };
export type HqPositionBoard = {
  positions: Read<HqPositionAdminView[]>;
  /** The code catalogue, each entry marked applied or not. Unreadable when hq_capability cannot be read. */
  catalogue: Read<HqCatalogueEntry[]>;
  /** Applied codes the code catalogue does not define. hq-guard B1 is red while this is non-empty. */
  appliedNotInCode: Read<string[]>;
  /** Migration 640: which pairs are blocked, strict separation, multiple appointments, content rules. */
  sod?: Read<HqSodPolicy>;
};

type PosRow = { code: string; space: string; name: string | null; description: string | null; is_active: boolean | null };
type GrantRow = { id: string; position_code: string; capability_code: string; source: string | null; effective_from: string | null; effective_to: string | null; grant_reason?: string | null; end_reason?: string | null };
type CapRow = { code: string; label: string | null };

/** Live at `now` by the same window rule as activeGrants. Pure. */
const isLive = (g: { effective_from: string | null; effective_to: string | null }, now: number) =>
  (g.effective_from ? new Date(g.effective_from).getTime() <= now : true) && (g.effective_to ? now < new Date(g.effective_to).getTime() : true);

export function buildPositionBoard(
  positions: Read<PosRow[]>, grants: Read<GrantRow[]>, caps: Read<CapRow[]>, now: number = Date.now(),
): HqPositionBoard {
  const labels = new Map<string, string | null>(caps.ok ? caps.value.map(c => [c.code, c.label]) : []);
  const catalogue: Read<HqCatalogueEntry[]> = caps.ok
    ? readOk(HQ_CAPABILITIES.map(c => ({ code: c.code, space: c.space, applied: labels.has(c.code), label: labels.get(c.code) ?? null, sensitive: sensitiveClassOf(c.code) })))
    : readFail(caps.error);
  const appliedNotInCode: Read<string[]> = caps.ok
    ? readOk(caps.value.map(c => c.code).filter(c => !HQ_CAPABILITY_CODES.includes(c)).sort())
    : readFail(caps.error);

  const view: Read<HqPositionAdminView[]> = !positions.ok ? readFail(positions.error) : readOk(
    positions.value
      .filter(p => (HQ_SPACES as readonly string[]).includes(p.space))
      .map(p => ({
        code: p.code,
        space: p.space as HqSpace,
        name: p.name ?? p.code,
        description: p.description,
        isActive: p.is_active !== false,
        grants: grants.ok
          ? readOk(grants.value.filter(g => g.position_code === p.code).map(g => ({
              id: g.id,
              capability: g.capability_code,
              label: labels.get(g.capability_code) ?? null,
              source: g.source ?? "position_default",
              effectiveFrom: g.effective_from,
              effectiveTo: g.effective_to,
              live: isLive(g, now),
              grantReason: g.grant_reason ?? null,
              endReason: g.end_reason ?? null,
              sensitive: sensitiveClassOf(g.capability_code),
              inCodeCatalogue: HQ_CAPABILITY_CODES.includes(g.capability_code),
            })).sort((a, b) => Number(b.live) - Number(a.live) || a.capability.localeCompare(b.capability)))
          : readFail<HqGrantView[]>(grants.error),
      }))
      .sort((a, b) => a.space.localeCompare(b.space) || a.name.localeCompare(b.name)),
  );
  return { positions: view, catalogue, appliedNotInCode };
}

/**
 * The board, read once. ⚠ The grant read asks for the 500 columns and falls back to the 264 shape when they
 * are absent, so the screen still READS on a database without 500 (and says writes are unavailable).
 */
export async function loadPositionBoard(admin: Admin): Promise<HqPositionBoard & { migrationApplied: boolean }> {
  const [posRes, capRes, sod] = await Promise.all([
    admin.from("hq_position").select("code, space, name, description, is_active").limit(500),
    admin.from("hq_capability").select("code, label").limit(500),
    loadSodPolicy(admin),
  ]);
  let migrationApplied = true;
  let grantRes = await admin.from("hq_position_capability")
    .select("id, position_code, capability_code, source, effective_from, effective_to, grant_reason, end_reason").limit(5000);
  if (grantRes.error && /grant_reason|end_reason|column/i.test(grantRes.error.message)) {
    migrationApplied = false;
    grantRes = await admin.from("hq_position_capability")
      .select("id, position_code, capability_code, source, effective_from, effective_to").limit(5000) as typeof grantRes;
  }
  const board = buildPositionBoard(
    posRes.error ? readFail(posRes.error.message) : readOk((posRes.data ?? []) as PosRow[]),
    grantRes.error ? readFail(grantRes.error.message) : readOk((grantRes.data ?? []) as GrantRow[]),
    capRes.error ? readFail(capRes.error.message) : readOk((capRes.data ?? []) as CapRow[]),
  );
  return { ...board, sod, migrationApplied };
}

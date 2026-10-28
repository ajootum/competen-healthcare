import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  HQ_CAPABILITY_EXCLUSIONS, HQ_CAPABILITY_PAIRS, buildSodPolicy, effectiveExclusions, exclusionConflict, parsePositionAction,
  rpcFor, statusForDbError,
} from "./positions";
import { effectiveAuthority, type GovernanceContext } from "./governance-context";
import { readFail, readOk } from "./appointments";

// HQ-SOD-CROSSCUT-01, migration 640: cross-cutting roles, the pairs as configuration, multiple appointments.
// The database decides (640's guards, proved by planted violations in docs/evidence/HQ-SOD-CROSSCUT-01). These
// prove the code mirrors 640 and that every read of the configuration fails CLOSED.
const SQL_580 = readFileSync("supabase/migrations/580-competency-framework-publication-authority.sql", "utf8");
const SQL_640 = readFileSync("supabase/migrations/640-hq-cross-cutting-roles-item-level-sod.sql", "utf8");
const ROLLBACK_640 = readFileSync("docs/evidence/HQ-SOD-CROSSCUT-01/ROLLBACK-640.sql", "utf8");
const bodyOf = (sql: string, fn: string) => {
  const at = sql.indexOf(`create or replace function ${fn}(`);
  return sql.slice(at, sql.indexOf("$$;", at));
};
const pairsOf = (fn: string) => [...fn.matchAll(/\('(hq\.[^']+)', '(hq\.[^']+)', '([^']+)'\)/g)].map(m => ({ a: m[1], b: m[2], reason: m[3] }));
/** The hq_sod_pair_policy seed rows of 640. */
const seedOf = (sql: string) => {
  const at = sql.indexOf("insert into hq_sod_pair_policy");
  const block = sql.slice(at, sql.indexOf("on conflict (capability_a, capability_b) do nothing", at));
  return [...block.matchAll(/\('(hq\.[^']+)', '(hq\.[^']+)', '([^']+)', (true|false),\s*(?:'([^']+)'|null), (true|false)\)/g)]
    .map(m => ({ a: m[1], b: m[2], reason: m[3], liftable: m[4] === "true", safeguard: m[5] ?? null, allowed: m[6] === "true" }));
};

describe("migration 640 and positions.ts agree", () => {
  it("the 640 seed is the 580 list, same order and reasons, and HQ_CAPABILITY_PAIRS mirrors it exactly", () => {
    const seed = seedOf(SQL_640);
    expect(seed.length).toBe(15);
    expect(seed.map(({ a, b, reason }) => ({ a, b, reason }))).toEqual(pairsOf(bodyOf(SQL_580, "hq_capability_exclusions")));
    expect(seed.map(({ a, b, reason, liftable, safeguard }) => ({ a, b, reason, liftable, safeguard }))).toEqual(HQ_CAPABILITY_PAIRS);
    expect(HQ_CAPABILITY_EXCLUSIONS).toEqual(pairsOf(bodyOf(SQL_580, "hq_capability_exclusions")));
  });

  it("a pair is allowed by default exactly where it is liftable, and liftable exactly where a safeguard is named", () => {
    for (const p of seedOf(SQL_640)) {
      expect(p.allowed).toBe(p.liftable);
      expect(p.safeguard !== null).toBe(p.liftable);
    }
  });

  it("the competency assessor pairs and the research pairs are never liftable", () => {
    const never = HQ_CAPABILITY_PAIRS.filter(p => !p.liftable);
    expect(never.length).toBe(6);
    expect(never.every(p => p.a === "hq.competency.verification.assess" || p.a === "hq.quality.research.propose")).toBe(true);
  });

  it("the rollback restores 580's list exactly (immutable, all 15 blocked)", () => {
    const restored = bodyOf(ROLLBACK_640, "hq_capability_exclusions");
    expect(restored).toContain("immutable");
    expect(pairsOf(restored)).toEqual(HQ_CAPABILITY_EXCLUSIONS);
  });

  it("640 reads the pairs from configuration, stable, with strict separation overriding every pair", () => {
    const fn = bodyOf(SQL_640, "hq_capability_exclusions");
    expect(fn).toMatch(/\bstable\b/);
    expect(fn).toMatch(/from hq_sod_pair_policy p\s+where p\.allowed = false\s+or coalesce\(\(select c\.sod_strict_positions/);
  });

  it("the Scholar Clinical Lead is seeded with its seven grants and nobody is appointed", () => {
    expect(SQL_640).toMatch(/\('scholar_clinical_lead', 'quality', 'Scholar Clinical Lead',/);
    for (const c of ["hq.platform.home.view", "hq.quality.competency.author", "hq.quality.case.author", "hq.quality.clinical.approve",
      "hq.quality.clinical.govern", "hq.quality.competency.publish", "hq.quality.case.publish"]) expect(SQL_640).toContain(`('${c}')`);
    expect(SQL_640).not.toMatch(/insert into ogs_office_appointments/);
  });
});

describe("effectiveExclusions", () => {
  const pairs = HQ_CAPABILITY_PAIRS.map(p => ({ ...p, allowed: p.liftable }));
  const policy = (strict: boolean) => readOk({ strict, multipleAppointments: true, pairs, contentRules: [] });

  it("fails closed: an unreadable policy blocks every pair, exactly as 580 did", () => {
    expect(effectiveExclusions(readFail("relation hq_sod_pair_policy does not exist"))).toEqual(HQ_CAPABILITY_EXCLUSIONS);
  });
  it("blocks only what the configuration blocks, and everything when strict", () => {
    expect(effectiveExclusions(policy(false)).length).toBe(6);
    expect(effectiveExclusions(policy(true)).length).toBe(15);
  });
  it("a cross-cutting lead may hold author, approve, govern and publish, never the assessor right beside approval", () => {
    const ex = effectiveExclusions(policy(false));
    const lead = ["hq.quality.competency.author", "hq.quality.case.author", "hq.quality.clinical.approve", "hq.quality.clinical.govern", "hq.quality.case.publish"];
    expect(exclusionConflict("hq.quality.competency.publish", lead, ex)).toBeNull();
    expect(exclusionConflict("hq.competency.verification.assess", lead, ex)?.reason).toBe("a competency assessor cannot hold clinical content approval");
    // The control: under strict separation the same grant is refused.
    expect(exclusionConflict("hq.quality.competency.publish", lead, effectiveExclusions(policy(true)))).not.toBeNull();
  });
  it("buildSodPolicy keeps the catalogue order and fails safe on missing settings", () => {
    const rows = [...HQ_CAPABILITY_PAIRS].reverse().map(p => ({ capability_a: p.a, capability_b: p.b, reason: p.reason, liftable: p.liftable, item_safeguard: p.safeguard, allowed: false }));
    const built = buildSodPolicy(rows, [{ content_kind: "case", label: "Clinical cases", publisher_not_approver: true }, { content_kind: "bogus", label: "x", publisher_not_approver: true }], null);
    expect(built.pairs.map(p => p.a + p.b)).toEqual(HQ_CAPABILITY_PAIRS.map(p => p.a + p.b));
    expect(built.strict).toBe(false);
    expect(built.multipleAppointments).toBe(true);
    expect(built.contentRules).toEqual([{ kind: "case", label: "Clinical cases", publisherNotApprover: true }]);
  });
});

describe("multiple appointments: effectiveAuthority", () => {
  const ctx = (id: string, pos: string, line: string | null, caps: string[]): GovernanceContext =>
    ({ appointmentId: id, positionCode: pos, positionName: pos, productLineCode: line, capabilities: caps });
  const lead = ctx("a1", "scholar_clinical_lead", null, ["hq.quality.case.author", "hq.quality.clinical.approve"]);
  const educator = ctx("a2", "clinical_case_educator", null, ["hq.learning.course.author"]);
  const practice = ctx("a3", "practice_product_director", "practice", ["hq.practice.flags.manage"]);

  it("is the union of valid appointments in the active product line when switched on", () => {
    expect(effectiveAuthority(lead, [lead, educator, practice], true)).toEqual({
      positions: ["clinical_case_educator", "scholar_clinical_lead"],
      capabilities: ["hq.learning.course.author", "hq.quality.case.author", "hq.quality.clinical.approve"],
    });
  });
  it("never reaches another product line (GOV-MC-001 acceptance 4)", () => {
    expect(effectiveAuthority(lead, [lead, educator, practice], true).capabilities).not.toContain("hq.practice.flags.manage");
    expect(effectiveAuthority(practice, [lead, educator, practice], true).capabilities).toEqual(["hq.practice.flags.manage"]);
  });
  it("is the one active appointment when switched off, and nothing without one", () => {
    expect(effectiveAuthority(lead, [lead, educator, practice], false)).toEqual({ positions: ["scholar_clinical_lead"], capabilities: lead.capabilities });
    expect(effectiveAuthority(null, [lead], true)).toEqual({ positions: [], capabilities: [] });
  });
});

describe("the separation-of-duties actions", () => {
  const actor = { id: "00000000-0000-0000-0000-000000000001", name: "Owner", trace: null };
  it("set_pair names only a known pair, either way round, and maps to the owner-only function", () => {
    expect(parsePositionAction({ action: "set_pair", a: "hq.x", b: "hq.y", allowed: true, reason: "because" }).ok).toBe(false);
    const p = parsePositionAction({ action: "set_pair", a: "hq.quality.case.publish", b: "hq.quality.case.author", allowed: false, reason: "tighten" });
    expect(p.ok).toBe(true);
    if (p.ok) expect(rpcFor(p.value, actor)).toEqual({ fn: "hq_sod_admin_set_pair", args: { p_actor: actor.id, p_actor_name: "Owner", p_trace: null, p_capability_a: "hq.quality.case.publish", p_capability_b: "hq.quality.case.author", p_allowed: false, p_reason: "tighten" } });
  });
  it("set_settings and set_content_rule need real booleans and a known content type", () => {
    expect(parsePositionAction({ action: "set_settings", strict: "yes", multiple_appointments: true, reason: "because" }).ok).toBe(false);
    expect(parsePositionAction({ action: "set_content_rule", kind: "poems", publisher_not_approver: true, reason: "because" }).ok).toBe(false);
    const s = parsePositionAction({ action: "set_settings", strict: true, multiple_appointments: false, reason: "grown up" });
    expect(s.ok && rpcFor(s.value, actor).fn).toBe("hq_sod_admin_set_settings");
    const r = parsePositionAction({ action: "set_content_rule", kind: "case", publisher_not_approver: true, reason: "stricter" });
    expect(r.ok && rpcFor(r.value, actor).args.p_content_kind).toBe("case");
    expect(parsePositionAction({ action: "set_pair", a: "hq.quality.case.publish", b: "hq.quality.case.author", allowed: true, reason: "no" }).ok).toBe(false);
  });
  it("maps the 640 refusals to 409/403, and a missing 640 function to 'not applied'", () => {
    expect(statusForDbError("hq_sod not_liftable: a competency assessor cannot hold clinical content approval has no equal or stronger item-level safeguard").status).toBe(409);
    expect(statusForDbError("hq_sod conflict: position scholar_clinical_lead holds both. End one first").status).toBe(409);
    expect(statusForDbError("hq_sod single_appointment: multiple concurrent HQ appointments are switched off").status).toBe(409);
    expect(statusForDbError("hq_position_admin owner_required: changing HQ positions requires platform ownership").status).toBe(403);
    const missing = statusForDbError("Could not find the function public.hq_sod_admin_set_pair", "PGRST202");
    expect(missing.status).toBe(503);
    expect(missing.error).toMatch(/migration 640/);
  });
});

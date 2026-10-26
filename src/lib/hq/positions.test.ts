import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  HQ_CAPABILITY_EXCLUSIONS, HQ_SENSITIVE_CAPABILITIES, buildPositionBoard, exclusionConflict, parsePositionAction,
  rpcFor, sensitiveClassOf, statusForDbError, type HqGrantView,
} from "./positions";
import { HQ_CAPABILITY_CODES } from "./spaces";
import { readFail, readOk } from "./appointments";

// The LATEST migration that defines each function is the one the database runs: 500 first, 511 (COMPETENCY-01 C5) after,
// then 580 (framework publication) for the exclusions only. The sensitive classes are still 511's.
const SQL = readFileSync("supabase/migrations/511-competency-assessor-separation-of-duties.sql", "utf8");
const SQL_580 = readFileSync("supabase/migrations/580-competency-framework-publication-authority.sql", "utf8");
const SQL_500 = readFileSync("supabase/migrations/500-hq-position-administration.sql", "utf8");
const bodyOf = (sql: string, fn: string) => {
  const at = sql.indexOf(`create or replace function ${fn}(`);
  return sql.slice(at, sql.indexOf("$$;", at));
};
const body = (fn: string) => bodyOf(SQL, fn);
const pairsOf = (fn: string) => [...fn.matchAll(/\('(hq\.[^']+)', '(hq\.[^']+)', '([^']+)'\)/g)].map(m => ({ a: m[1], b: m[2], reason: m[3] }));

describe("the latest migrations (511, 580) and positions.ts agree", () => {
  it("the excluded pairs are the same set, in the same order", () => {
    const pairs = pairsOf(bodyOf(SQL_580, "hq_capability_exclusions"));
    expect(pairs.length).toBe(15);
    expect(pairs).toEqual(HQ_CAPABILITY_EXCLUSIONS);
  });

  it("580 keeps every pair of 511, in order, and only adds the author/publish pair", () => {
    const before = pairsOf(body("hq_capability_exclusions"));
    expect(before.length).toBe(14);
    const after = pairsOf(bodyOf(SQL_580, "hq_capability_exclusions"));
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual([{ a: "hq.quality.competency.author", b: "hq.quality.competency.publish", reason: "a competency author cannot publish competency frameworks" }]);
    expect(exclusionConflict("hq.quality.competency.publish", ["hq.quality.competency.author"])?.with).toBe("hq.quality.competency.author");
    // Its rollback restores 511's list exactly.
    const rollback = readFileSync("docs/evidence/CFCA/ROLLBACK-580.sql", "utf8");
    expect(pairsOf(bodyOf(rollback, "hq_capability_exclusions"))).toEqual(before);
  });

  it("511 keeps every pair of 500, in order, and only adds", () => {
    const before = pairsOf(bodyOf(SQL_500, "hq_capability_exclusions"));
    expect(before.length).toBe(10);
    expect(pairsOf(body("hq_capability_exclusions")).slice(0, before.length)).toEqual(before);
  });

  it("the Competency Assessor sits with none of content approval, reviewer governance, authoring or the Studio", () => {
    for (const b of ["hq.quality.clinical.approve", "hq.quality.clinical.govern", "hq.quality.competency.author", "hq.competency.verification.manage"])
      expect(exclusionConflict("hq.competency.verification.assess", [b])?.with).toBe(b);
    expect(exclusionConflict("hq.competency.verification.manage", ["hq.quality.clinical.approve"])).toBeNull();
    expect(sensitiveClassOf("hq.competency.verification.assess")).toBe("clinical");
  });

  it("the sensitive classes are the same sets", () => {
    const fn = body("hq_capability_sensitive_class");
    for (const [cls, codes] of Object.entries(HQ_SENSITIVE_CAPABILITIES)) {
      const clause = new RegExp(`when p_code in \\(([^)]*)\\) then '${cls}'`).exec(fn);
      expect(clause, cls).not.toBeNull();
      const sqlCodes = [...clause![1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
      expect(sqlCodes).toEqual([...codes].sort());
    }
  });

  it("every code in both lists is defined in the code catalogue", () => {
    const named = [...HQ_CAPABILITY_EXCLUSIONS.flatMap(e => [e.a, e.b]), ...Object.values(HQ_SENSITIVE_CAPABILITIES).flat()];
    expect(named.filter(c => !HQ_CAPABILITY_CODES.includes(c))).toEqual([]);
  });

  it("the author rights never sit with clinical approval", () => {
    for (const a of ["hq.quality.competency.author", "hq.quality.case.author", "hq.learning.course.author"])
      expect(exclusionConflict("hq.quality.clinical.approve", [a])?.with).toBe(a);
    expect(exclusionConflict("hq.quality.competency.author", ["hq.quality.clinical.approve"])).not.toBeNull();
    expect(exclusionConflict("hq.quality.competency.author", ["hq.platform.home.view"])).toBeNull();
  });
});

describe("parsePositionAction", () => {
  const reason = "the owner asked for it";
  it("refuses a capability the code catalogue does not define, for grant and register", () => {
    expect(parsePositionAction({ action: "grant", code: "competency_author", capability: "hq.made.up", reason }).ok).toBe(false);
    expect(parsePositionAction({ action: "register", capability: "hq.made.up", label: "X", reason }).ok).toBe(false);
    expect(parsePositionAction({ action: "grant", code: "competency_author", capability: "hq.quality.competency.author", reason }).ok).toBe(true);
  });
  it("needs a reason for every action", () => {
    expect(parsePositionAction({ action: "create", code: "competency_author", space: "quality", name: "A" }).ok).toBe(false);
    expect(parsePositionAction({ action: "set_active", code: "competency_author", active: false, reason: "no" }).ok).toBe(false);
  });
  it("refuses a bad code, a sixth space and an unknown action", () => {
    expect(parsePositionAction({ action: "create", code: "Competency Author", space: "quality", name: "A", reason }).ok).toBe(false);
    expect(parsePositionAction({ action: "create", code: "competency_author", space: "clinical", name: "A", reason }).ok).toBe(false);
    expect(parsePositionAction({ action: "delete", code: "competency_author", reason }).ok).toBe(false);
  });
  it("acknowledges a sensitive grant only on an explicit true", () => {
    const p = parsePositionAction({ action: "grant", code: "x_pos", capability: "hq.quality.clinical.approve", reason, acknowledge_sensitive: "true" });
    expect(p.ok && p.value.action === "grant" && p.value.acknowledgeSensitive).toBe(false);
  });
  it("takes a registered capability's space from code, never from the request", () => {
    const p = parsePositionAction({ action: "register", capability: "hq.quality.competency.author", label: "Competency authoring", space: "platform", reason });
    expect(p.ok).toBe(true);
    if (p.ok) expect(rpcFor(p.value, { id: "u", name: null, trace: null }).args.p_space).toBe("quality");
  });
});

describe("statusForDbError", () => {
  it("maps the database's refusals", () => {
    expect(statusForDbError("hq_position_admin owner_required: changing HQ positions requires platform ownership").status).toBe(403);
    expect(statusForDbError("hq_position_capability separation_of_duties: x already holds y").status).toBe(409);
    expect(statusForDbError("hq_position_admin history: held before").status).toBe(409);
    expect(statusForDbError("hq_position_capability history: a grant is never rewritten").status).toBe(409);
    expect(statusForDbError("hq_position_admin sensitive: ack").status).toBe(400);
    expect(statusForDbError("hq_position_admin not_found: no such HQ position").error).toBe("no such HQ position");
  });
  it("reads a missing function as 'not applied', never as a refusal of the person", () => {
    expect(statusForDbError("Could not find the function public.hq_position_admin_create", "PGRST202").status).toBe(503);
  });
  it("anything else is a 500 that carries the message", () => {
    expect(statusForDbError("connection reset").status).toBe(500);
  });
});

describe("buildPositionBoard", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const pos = readOk([{ code: "competency_author", space: "quality", name: "Competency Author", description: null, is_active: true }]);
  const grants = readOk([
    { id: "1", position_code: "competency_author", capability_code: "hq.quality.competency.author", source: "explicit_grant", effective_from: "2026-10-25T10:00:00Z", effective_to: null },
    { id: "2", position_code: "competency_author", capability_code: "hq.platform.users.view", source: "explicit_grant", effective_from: "2026-10-25T10:00:00Z", effective_to: "2026-10-25T11:00:00Z", end_reason: "not needed" },
  ]);
  it("keeps ended grants as history and marks them not live", () => {
    const b = buildPositionBoard(pos, grants, readOk([{ code: "hq.quality.competency.author", label: "Competency authoring" }]), now);
    const g = b.positions.ok ? b.positions.value[0].grants : readFail<HqGrantView[]>("x");
    expect(g.ok && g.value.map(x => [x.capability, x.live])).toEqual([["hq.quality.competency.author", true], ["hq.platform.users.view", false]]);
    expect(g.ok && g.value[1].endReason).toBe("not needed");
    expect(g.ok && g.value[1].sensitive).toBe(sensitiveClassOf("hq.platform.users.view"));
  });
  it("marks code-defined capabilities missing from the database, and the reverse", () => {
    const b = buildPositionBoard(pos, grants, readOk([{ code: "hq.platform.home.view", label: "HQ Home" }, { code: "hq.rogue.code", label: null }]), now);
    expect(b.catalogue.ok && b.catalogue.value.find(c => c.code === "hq.quality.competency.author")?.applied).toBe(false);
    expect(b.catalogue.ok && b.catalogue.value.find(c => c.code === "hq.platform.home.view")?.applied).toBe(true);
    expect(b.appliedNotInCode.ok && b.appliedNotInCode.value).toEqual(["hq.rogue.code"]);
  });
  it("an unreadable catalogue is unreadable, never an empty list", () => {
    const b = buildPositionBoard(pos, grants, readFail("boom"), now);
    expect(b.catalogue.ok).toBe(false);
    expect(b.appliedNotInCode.ok).toBe(false);
  });
});

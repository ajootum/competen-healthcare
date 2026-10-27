import { describe, expect, it } from "vitest";
import {
  applyStudioOp, asDefinition, codeFromName, diffDefinitions, isOwnerOnly, parseStudioAction, studioRpcFor, validateDefinition,
  type GovDefinition, type StudioOp,
} from "./governance-studio";

// A small Scholar-shaped published structure: two levels, a shared service, a board seat, a portfolio with a live record.
const published = (): GovDefinition => ({
  levels: [{ level: 1, label: "Corporate governance" }, { level: 3, label: "Product and operations" }],
  units: [
    { code: "competen_holdings", level: 1, kind: "holding_company", name: "Competen Holdings", constitution_status: "established" },
    { code: "scholar_board", level: 1, kind: "board", name: "Competen Scholar Board", parent: "competen_holdings", constitution_status: "pending_incorporation" },
    { code: "scholar_product_operations", level: 3, kind: "product_lead", name: "Scholar Product and Operations", parent: "scholar_board" },
    { code: "holdings_technology_services", kind: "service", name: "Holdings Technology Services", parent: "competen_holdings" },
  ],
  positions: [
    { code: "board_independent_director", unit: "scholar_board", name: "Independent director", kind: "director", exclusive: true },
    { code: "portfolio_student_success", unit: "scholar_product_operations", name: "Student Success", kind: "portfolio" },
    { code: "portfolio_finance_administration", unit: "scholar_product_operations", name: "Finance and Administration", kind: "portfolio" },
  ],
  relationships: [{ code: "board_to_product", from: "scholar_board", to: "scholar_product_operations", type: "corporate_reporting", scope: "Reports to the corporate authority" }],
  links: [], independence_pairs: [],
});
const ctx = { relationTypes: ["corporate_reporting", "escalation"], positionCodes: ["clinical_content_reviewer"], liveSeats: ["portfolio_student_success"] };
const run = (def: GovDefinition, ...ops: StudioOp[]) => ops.reduce((d, op) => {
  const r = applyStudioOp(d, op);
  if (!r.ok) throw new Error(r.error);
  return r.def;
}, def);

describe("the acceptance scenario, on the definition", () => {
  it("adds a department, a position in it, moves and renames positions, adds an escalation line, and previews it", () => {
    const base = published();
    const draft = run(base,
      { op: "unit_add", unit: { name: "Scholar Quality Office", kind: "department", level: 3, parent: "scholar_product_operations" } },
      { op: "position_add", position: { name: "Quality Office Lead", unit: "scholar_quality_office", kind: "lead", requirements: "Quality qualification" } },
      { op: "position_move", code: "portfolio_finance_administration", unit: "scholar_quality_office" },
      { op: "position_edit", code: "portfolio_student_success", fields: { name: "Student Success and Wellbeing" } },
      { op: "relationship_add", relationship: { from: "scholar_quality_office", to: "scholar_board", type: "escalation", scope: "Quality concerns" } },
    );
    expect(validateDefinition(draft, { ...ctx, base })).toEqual([]);
    const changes = diffDefinitions(base, draft);
    expect(changes.map(c => `${c.change} ${c.kind} ${c.code}`)).toEqual([
      "added unit scholar_quality_office",
      "changed position portfolio_student_success",
      "moved position portfolio_finance_administration",
      "added position quality_office_lead",
      "added relationship scholar_quality_office_escalation_scholar_board",
    ]);
    // The published definition is untouched: the operations work on a copy.
    expect(base.units).toHaveLength(4);
    expect(base.positions.find(p => p.code === "portfolio_student_success")?.name).toBe("Student Success");
  });
});

describe("operations never remove", () => {
  it("retires and restores instead, and refuses retiring a unit with active positions", () => {
    const d = published();
    expect(applyStudioOp(d, { op: "unit_retire", code: "scholar_product_operations" })).toMatchObject({ ok: false });
    const r = run(d, { op: "position_retire", code: "portfolio_finance_administration" });
    expect(r.positions).toHaveLength(3);
    expect(r.positions.find(p => p.code === "portfolio_finance_administration")?.retired).toBe(true);
    expect(run(r, { op: "position_restore", code: "portfolio_finance_administration" }).positions.find(p => p.code === "portfolio_finance_administration")?.retired).toBeUndefined();
  });

  it("refuses a move that would put a unit inside itself or its own sub-unit", () => {
    const d = published();
    expect(applyStudioOp(d, { op: "unit_move", code: "scholar_board", parent: "scholar_board" })).toMatchObject({ ok: false });
    expect(applyStudioOp(d, { op: "unit_move", code: "competen_holdings", parent: "scholar_product_operations" })).toMatchObject({ ok: false });
  });

  it("keeps a shared service without a level whatever the edit says", () => {
    const d = run(published(), { op: "unit_edit", code: "holdings_technology_services", fields: { level: 2 } });
    expect(d.units.find(u => u.code === "holdings_technology_services")?.level).toBeUndefined();
  });

  it("never lets an edit change a code or a retirement, and drops an emptied field", () => {
    const d = run(published(), { op: "position_edit", code: "portfolio_student_success", fields: { code: "x", retired: true, unit: "scholar_board", description: "", name: "S" } as never });
    const p = d.positions.find(x => x.name === "S")!;
    expect(p).toMatchObject({ code: "portfolio_student_success", unit: "scholar_product_operations" });
    expect(p.retired).toBeUndefined();
    expect("description" in p).toBe(false);
  });

  it("makes unique codes from names", () => {
    expect(codeFromName("Quality Office", new Set(["quality_office"]))).toBe("quality_office_2");
    expect(codeFromName("2nd Board", new Set())).toBe("x_2nd_board");
  });
});

describe("validation mirrors the database", () => {
  it("refuses dropping a published item, changing a published relationship, retiring a seat with a live record", () => {
    const base = published();
    const dropped = { ...base, positions: base.positions.filter(p => p.code !== "portfolio_finance_administration") };
    expect(validateDefinition(dropped, { ...ctx, base }).join(" ")).toMatch(/Retire it instead of removing it/);
    const rescoped = { ...base, relationships: [{ ...base.relationships[0], scope: "changed" }] };
    expect(validateDefinition(rescoped, { ...ctx, base }).join(" ")).toMatch(/never changes its units, type or scope/);
    const retired = run(base, { op: "position_retire", code: "portfolio_student_success" });
    expect(validateDefinition(retired, { ...ctx, base }).join(" ")).toMatch(/live appointment record/);
  });

  it("refuses a board seat linked to a position, an unknown linked position, a level that is not defined, an inactive type", () => {
    const d = run(published(),
      { op: "position_edit", code: "board_independent_director", fields: { authority_position: "clinical_content_reviewer" } },
      { op: "position_edit", code: "portfolio_student_success", fields: { authority_position: "invented_position" } },
      { op: "unit_add", unit: { name: "Floating", kind: "department", level: 7 } },
      { op: "relationship_add", relationship: { from: "scholar_board", to: "competen_holdings", type: "retired_type", scope: "x" } });
    const errs = validateDefinition(d, ctx).join(" | ");
    expect(errs).toMatch(/board seat is never linked/);
    expect(errs).toMatch(/invented_position does not exist/);
    expect(errs).toMatch(/choose a level this version defines/);
    expect(errs).toMatch(/retired_type is not active/);
  });

  it("reads a stored definition defensively", () => {
    expect(asDefinition({ units: "bad", levels: [{ level: 1, label: "x" }] })).toMatchObject({ units: [], positions: [], levels: [{ level: 1, label: "x" }] });
  });
});

describe("requests", () => {
  const reason = "owner restructure";
  const version = "11111111-1111-4111-8111-111111111111";
  it("parses each action and refuses what is malformed", () => {
    expect(parseStudioAction({ action: "edit", version, revision: 3, op: { op: "unit_retire", code: "x_unit" }, reason }).ok).toBe(true);
    expect(parseStudioAction({ action: "edit", version, revision: 3, op: { op: "unit_delete", code: "x" }, reason }).ok).toBe(false);
    expect(parseStudioAction({ action: "edit", version, op: { op: "unit_retire", code: "x" }, reason }).ok).toBe(false);
    expect(parseStudioAction({ action: "publish", version, basis: "OD", reason }).ok).toBe(false);
    expect(parseStudioAction({ action: "transition", version, step: "publish", reason }).ok).toBe(false);
    expect(parseStudioAction({ action: "create_draft", structure: "scholar", reason: "x" }).ok).toBe(false);
  });

  it("marks approve, publish and structure creation owner-only", () => {
    const p = (b: Record<string, unknown>) => { const r = parseStudioAction({ reason, ...b }); if (!r.ok) throw new Error(r.error); return r.value; };
    expect(isOwnerOnly(p({ action: "transition", version, step: "approve" }))).toBe(true);
    expect(isOwnerOnly(p({ action: "transition", version, step: "submit" }))).toBe(false);
    expect(isOwnerOnly(p({ action: "publish", version, basis: "Owner decision OD-1" }))).toBe(true);
    expect(isOwnerOnly(p({ action: "create_structure", code: "enterprise_main", name: "Enterprise", product_line: "enterprise" }))).toBe(true);
    expect(isOwnerOnly(p({ action: "create_draft", structure: "scholar" }))).toBe(false);
  });

  it("maps to the audited functions with the session as the actor", () => {
    const r = parseStudioAction({ action: "publish", version, basis: "Owner decision OD-1", effective_from: "2026-11-01", reason });
    expect(r.ok && studioRpcFor(r.value as never, { id: "me", name: null, trace: "t" })).toEqual({
      fn: "hq_gov_studio_publish", args: { p_actor: "me", p_actor_name: null, p_trace: "t", p_reason: reason, p_version: version, p_effective_from: "2026-11-01", p_basis: "Owner decision OD-1" },
    });
  });
});

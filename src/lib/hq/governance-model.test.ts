import { describe, expect, it } from "vitest";
import { buildGovBoard, govRpcFor, govStatusForDbError, isMissingRelation, parseGovAction, seatStatusOf } from "./governance-model";
import { readFail, readOk } from "./appointments";

const body = (code: string, level: number, kind: string, extra: Record<string, unknown> = {}) => ({
  code, level, kind, name: code, description: null, product_line_code: null, parent_body_code: null,
  constitution_status: "pending_constitution", constitution_note: null, interim_authority: null,
  document_status: "none", document_ref: null, sort: 10, is_active: true, ...extra,
});
const seat = (code: string, body_code: string, extra: Record<string, unknown> = {}) => ({
  code, body_code, name: code, description: null, seat_kind: "committee_function", nomination_source: null, provider: null,
  accountability: null, authority_position_code: null, exclusive: false, sort: 10, is_active: true, ...extra,
});
const appt = (id: string, seat_code: string, status: string, created_at = "2026-10-27T10:00:00Z") => ({
  id, seat_code, person_id: null, holder_name: "Holder", status, basis: status === "nominated" ? null : "Resolution R-1",
  effective_from: "2026-10-27", effective_to: status === "ended" ? "2026-10-28" : null, end_reason: status === "ended" ? "term over" : null, created_at,
});

const base = () => ({
  bodies: [
    body("competen_holdings", 1, "holding_company", { constitution_status: "established" }),
    body("scholar_board", 1, "board", { constitution_status: "pending_incorporation", interim_authority: "Competen Holdings (interim)", document_status: "approved", document_ref: null }),
    body("scholar_governance_committee", 2, "committee"),
    body("scholar_product_operations", 3, "product_lead"),
    body("holdings_technology_services", null as unknown as number, "service", { constitution_status: "configured" }),
  ],
  seats: [
    seat("board_independent_director", "scholar_board", { seat_kind: "director", exclusive: true }),
    seat("committee_clinical_content_reviewer", "scholar_governance_committee", { authority_position_code: "clinical_content_reviewer" }),
    seat("committee_ai_governance_rep", "scholar_governance_committee"),
    seat("portfolio_product_technology", "scholar_product_operations", { seat_kind: "portfolio" }),
    seat("it_holdings_technology_authority", "holdings_technology_services", { seat_kind: "it_function", provider: "holdings" }),
  ],
  appointments: [] as ReturnType<typeof appt>[],
  declarations: [] as { appointment_id: string; interest: string; mitigation: string | null; declared_at: string | null }[],
  delegations: [
    { code: "holdings_interim_scholar", from_body_code: "competen_holdings", to_body_code: "scholar_board", relation: "interim_authority", scope: "Interim", status: "interim", basis: "Owner GO", decided_at: null, sort: 10 },
    { code: "board_to_committee", from_body_code: "scholar_board", to_body_code: "scholar_governance_committee", relation: "specialist_oversight", scope: "Specialist oversight", status: "pending", basis: null, decided_at: null, sort: 20 },
    { code: "committee_technology_joint_review", from_body_code: "scholar_governance_committee", to_body_code: "holdings_technology_services", relation: "joint_review", scope: "Bridge", status: "pending", basis: null, decided_at: null, sort: 70 },
  ],
  links: [
    { code: "ai_2", seat_code: "committee_ai_governance_rep", kind: "ai_escalation", clearance_domain: null, step: 2, label: "Assess", route: "/super-admin/ai/analytics", capability_code: "hq.platform.ai.view", note: null, sort: 120 },
    { code: "ccr", seat_code: "committee_clinical_content_reviewer", kind: "approval_workflow", clearance_domain: null, step: null, label: "Queue", route: "/super-admin/clinical-review", capability_code: "hq.quality.clinical.approve", note: null, sort: 10 },
    { code: "ai_1", seat_code: "committee_clinical_content_reviewer", kind: "ai_escalation", clearance_domain: null, step: 1, label: "Monitor", route: "/super-admin/ai/analytics", capability_code: "hq.platform.ai.view", note: null, sort: 110 },
    { code: "cs", seat_code: "committee_clinical_content_reviewer", kind: "joint_clearance", clearance_domain: "scholar", step: null, label: "Clinical safety", route: "/super-admin/clinical-review", capability_code: "hq.quality.clinical.approve", note: null, sort: 210 },
    { code: "pa", seat_code: "portfolio_product_technology", kind: "joint_clearance", clearance_domain: "scholar", step: null, label: "Product acceptance", route: null, capability_code: null, note: "No product workflow records it yet.", sort: 230 },
    { code: "pr", seat_code: "it_holdings_technology_authority", kind: "joint_clearance", clearance_domain: "holdings", step: null, label: "Production release", route: null, capability_code: null, note: "Owner GO.", sort: 270 },
  ],
  exclusions: [],
  statusItems: [
    { code: "recovery_capability", subject: "Recovery", status: "unverified", evidence: "Local backups", residual_risk: "Data loss since last backup", decided_at: null, sort: 40 },
    { code: "bad", subject: "Claimed", status: "verified", evidence: null, residual_risk: null, decided_at: null, sort: 50 },
  ],
  positions: readOk([{ code: "clinical_content_reviewer", name: "Clinical Content Reviewer", is_active: true }]),
  holderCounts: readOk(new Map<string, number>()),
});

describe("seat status", () => {
  it("is vacant with no record or only ended ones, and follows the live record otherwise", () => {
    expect(seatStatusOf([])).toBe("vacant");
    expect(seatStatusOf([{ status: "ended" }])).toBe("vacant");
    expect(seatStatusOf([{ status: "ended" }, { status: "nominated" }])).toBe("nominated");
    expect(seatStatusOf([{ status: "interim" }])).toBe("interim");
    expect(seatStatusOf([{ status: "active" }])).toBe("appointed");
  });
});

describe("the board", () => {
  it("shows every seat vacant and outstanding when nobody is appointed", () => {
    const b = buildGovBoard(base());
    expect(b.counts).toEqual({ seats: 5, vacant: 5, nominated: 0, interim: 0, appointed: 0 });
    expect(b.outstanding.map(o => o.seat)).toEqual(["board_independent_director", "committee_clinical_content_reviewer", "committee_ai_governance_rep", "portfolio_product_technology", "it_holdings_technology_authority"]);
  });

  it("never shows a document as approved without a reference, and keeps the interim authority beside the board", () => {
    const board = buildGovBoard(base()).bodies.find(x => x.code === "scholar_board")!;
    expect(board.documentStatus).toBe("draft");
    expect(board.interimAuthority).toMatch(/interim/);
  });

  it("shows a linked position's HQ holders without filling the seat, and an unreadable count as unknown", () => {
    const counts = readOk(new Map([["clinical_content_reviewer", 1]]));
    const s = buildGovBoard({ ...base(), holderCounts: counts }).bodies[2].seats.find(x => x.code === "committee_clinical_content_reviewer")!;
    expect(s.status).toBe("vacant");
    expect(s.authorityPosition).toMatchObject({ name: "Clinical Content Reviewer", activeHolders: { ok: true, value: 1 } });
    const b2 = buildGovBoard({ ...base(), holderCounts: readFail("boom") });
    expect(b2.bodies[2].seats.find(x => x.code === "committee_clinical_content_reviewer")!.authorityPosition!.activeHolders.ok).toBe(false);
    expect(b2.notes.join(" ")).toMatch(/unknown, not zero/);
  });

  it("marks only interim and approved delegations active", () => {
    const d = buildGovBoard(base()).delegations;
    expect(d.map(x => [x.code, x.active])).toEqual([["holdings_interim_scholar", true], ["board_to_committee", false], ["committee_technology_joint_review", false]]);
    expect(d.find(x => x.code === "committee_technology_joint_review")?.relation).toBe("joint_review");
  });

  it("orders the AI escalation path by step and carries each step's seat status", () => {
    const appointments = [appt("a1", "committee_ai_governance_rep", "nominated")];
    const e = buildGovBoard({ ...base(), appointments }).escalation;
    expect(e.map(x => x.step)).toEqual([1, 2]);
    expect(e[1].seatStatus).toBe("nominated");
  });

  it("keeps ended records as history beside the live one", () => {
    const appointments = [appt("a1", "committee_ai_governance_rep", "ended", "2026-10-01T00:00:00Z"), appt("a2", "committee_ai_governance_rep", "active")];
    const s = buildGovBoard({ ...base(), appointments }).bodies[2].seats.find(x => x.code === "committee_ai_governance_rep")!;
    expect(s.status).toBe("appointed");
    expect(s.current?.id).toBe("a2");
    expect(s.history.map(h => h.id)).toEqual(["a1"]);
  });
});

describe("V1.1", () => {
  it("puts Holdings Technology Services beside the three levels, after them, with no level", () => {
    const bodies = buildGovBoard(base()).bodies;
    const hts = bodies.find(x => x.code === "holdings_technology_services")!;
    expect(hts.level).toBeNull();
    expect(bodies[bodies.length - 1].code).toBe("holdings_technology_services");
    expect(bodies.filter(x => x.level !== null).map(x => x.level)).toEqual([1, 1, 2, 3]);
  });

  it("splits the joint clearances by domain and keeps a clearance with no workflow unrouted", () => {
    const c = buildGovBoard(base()).clearances;
    expect(c.filter(x => x.domain === "scholar").map(x => x.code)).toEqual(["cs", "pa"]);
    expect(c.filter(x => x.domain === "holdings").map(x => x.code)).toEqual(["pr"]);
    expect(c.find(x => x.code === "pa")).toMatchObject({ route: null, seatName: "portfolio_product_technology", seatStatus: "vacant" });
    // Clearances are not listed as ordinary seat links.
    const ccr = buildGovBoard(base()).bodies.flatMap(x => x.seats).find(x => x.code === "committee_clinical_content_reviewer")!;
    expect(ccr.links.map(l => l.kind)).toContain("joint_clearance");
  });

  it("never shows a status item as verified without evidence", () => {
    const items = buildGovBoard(base()).statusItems;
    expect(items.map(i => [i.code, i.status])).toEqual([["recovery_capability", "unverified"], ["bad", "unverified"]]);
    expect(items[0].residualRisk).toMatch(/Data loss/);
  });

  it("needs evidence before a status item is recorded as verified", () => {
    const reason = "owner reviewed evidence";
    expect(parseGovAction({ action: "set_status_item", code: "recovery_capability", status: "verified", evidence: "short", reason }).ok).toBe(false);
    const p = parseGovAction({ action: "set_status_item", code: "recovery_capability", status: "verified", evidence: "Restore drill PASS on a production copy", reason });
    expect(p.ok && govRpcFor(p.value, { id: "me", name: null, trace: "t" }).fn).toBe("hq_gov_admin_set_status_item");
  });
});

describe("requests", () => {
  const reason = "owner decision recorded";
  it("needs a reason, a seat, a holder, and for interim or active a basis and interests", () => {
    expect(parseGovAction({ action: "appoint", seat: "x_seat", holder_name: "A", status: "nominated", reason: "no" }).ok).toBe(false);
    expect(parseGovAction({ action: "appoint", seat: "x_seat", status: "nominated", reason }).ok).toBe(false);
    expect(parseGovAction({ action: "appoint", seat: "x_seat", holder_name: "A", status: "active", basis: "R-1 resolution", reason }).ok).toBe(false);
    expect(parseGovAction({ action: "appoint", seat: "x_seat", holder_name: "A", status: "approved", reason }).ok).toBe(false);
    expect(parseGovAction({ action: "appoint", seat: "x_seat", holder_name: "A", status: "nominated", reason }).ok).toBe(true);
    expect(parseGovAction({ action: "set_delegation", code: "board_to_committee", status: "approved", reason }).ok).toBe(false);
    expect(parseGovAction({ action: "grant", reason }).ok).toBe(false);
  });

  it("maps each action to its owner-only function with the session actor", () => {
    const p = parseGovAction({ action: "set_delegation", code: "board_to_committee", status: "withdrawn", reason });
    expect(p.ok && govRpcFor(p.value, { id: "me", name: null, trace: "t" })).toEqual({
      fn: "hq_gov_admin_set_delegation", args: { p_actor: "me", p_actor_name: null, p_trace: "t", p_reason: reason, p_code: "board_to_committee", p_status: "withdrawn", p_basis: null },
    });
  });

  it("reads a tagged refusal as a refusal even when its sentence says does not exist", () => {
    expect(govStatusForDbError("hq_gov not_found: the seat x does not exist or is inactive").status).toBe(404);
    expect(govStatusForDbError('relation "hq_gov_body" does not exist', "42P01").status).toBe(503);
    expect(govStatusForDbError("hq_gov owner_required: no").status).toBe(403);
    expect(isMissingRelation("Could not find the table 'public.hq_gov_body' in the schema cache", "PGRST205")).toBe(true);
  });
});

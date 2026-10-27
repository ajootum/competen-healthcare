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
  ],
  seats: [
    seat("board_independent_director", "scholar_board", { seat_kind: "director", exclusive: true }),
    seat("committee_clinical_content_reviewer", "scholar_governance_committee", { authority_position_code: "clinical_content_reviewer" }),
    seat("committee_ai_governance_rep", "scholar_governance_committee"),
  ],
  appointments: [] as ReturnType<typeof appt>[],
  declarations: [] as { appointment_id: string; interest: string; mitigation: string | null; declared_at: string | null }[],
  delegations: [
    { code: "holdings_interim_scholar", from_body_code: "competen_holdings", to_body_code: "scholar_board", scope: "Interim", status: "interim", basis: "Owner GO", decided_at: null, sort: 10 },
    { code: "board_to_committee", from_body_code: "scholar_board", to_body_code: "scholar_governance_committee", scope: "Specialist oversight", status: "pending", basis: null, decided_at: null, sort: 20 },
  ],
  links: [
    { code: "ai_2", seat_code: "committee_ai_governance_rep", kind: "ai_escalation", step: 2, label: "Assess", route: "/super-admin/ai/analytics", capability_code: "hq.platform.ai.view", note: null, sort: 120 },
    { code: "ccr", seat_code: "committee_clinical_content_reviewer", kind: "approval_workflow", step: null, label: "Queue", route: "/super-admin/clinical-review", capability_code: "hq.quality.clinical.approve", note: null, sort: 10 },
    { code: "ai_1", seat_code: "committee_clinical_content_reviewer", kind: "ai_escalation", step: 1, label: "Monitor", route: "/super-admin/ai/analytics", capability_code: "hq.platform.ai.view", note: null, sort: 110 },
  ],
  exclusions: [],
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
    expect(b.counts).toEqual({ seats: 3, vacant: 3, nominated: 0, interim: 0, appointed: 0 });
    expect(b.outstanding.map(o => o.seat)).toEqual(["board_independent_director", "committee_clinical_content_reviewer", "committee_ai_governance_rep"]);
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
    expect(d.map(x => [x.code, x.active])).toEqual([["holdings_interim_scholar", true], ["board_to_committee", false]]);
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

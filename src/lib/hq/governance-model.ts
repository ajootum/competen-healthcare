// Competen HQ — Scholar Governance Model V1 with Addendum V1.1: the registry of bodies, seats, delegations and the workflows
// each seat runs through (COMPETEN-SCHOLAR-GOV-IMPLEMENT-01, migration 610).
//
// ⚠ A REGISTRY, NOT AN AUTHORITY STORE. Nothing in the HQ guard reads these tables, and no table in 610 has a
// capability column. Platform authority stays an HQ appointment to an hq_position (appointments.ts). A seat's
// `authorityPosition` is a LINK: it shows which existing position holds the right the seat's work needs and
// how many people hold it today, and the database uses it for the 580 separation-of-duties pairs. Filling a
// seat appoints nobody to the position, and holding the position does not fill the seat. The screen says so.
//
// ⚠ THE DATABASE DECIDES, THIS FILE EXPLAINS. Every write is one owner-only hq_gov_admin_* function that writes
// its audit_log row first. A trigger refuses, for every writer: a director appointed before incorporation, an
// interim board holder, two board seats, an exclusive seat beside any other, a seat-level independence pair,
// and a 580 capability pair across the person's live seats and active HQ appointments.
//
// ⚠ MIGRATION 610 MAY BE ABSENT. main can carry this code before 610 reaches a database. The loader then says
// the registry is unavailable, and every write answers 503. It never draws an empty structure.
//
// Pure apart from the loader: type-only import of the admin client, no next/* import.

import type { createAdminClient } from "@/lib/supabase/server";
import { appointmentGrantsAccess } from "@/lib/ogs/lifecycle";
import { isHqOfficeType } from "./spaces";
import { readFail, readOk, type Read } from "./appointments";

type Admin = ReturnType<typeof createAdminClient>;

// ── Vocabulary ───────────────────────────────────────────────────────────────
export type GovSeatStatus = "vacant" | "nominated" | "interim" | "appointed";
export const SEAT_STATUS_LABEL: Record<GovSeatStatus, string> = {
  vacant: "Vacant", nominated: "Vacant (nominated)", interim: "Interim", appointed: "Appointed",
};
export const LEVEL_LABEL: Record<1 | 2 | 3, string> = {
  1: "Level 1 · Corporate governance",
  2: "Level 2 · Academic, clinical and AI governance",
  3: "Level 3 · Product and operations",
};
export const CONSTITUTION_LABEL: Record<string, string> = {
  established: "Established",
  configured: "Configured",
  pending_incorporation: "Not incorporated",
  pending_constitution: "Not constituted",
};
export const DOCUMENT_LABEL: Record<string, string> = { none: "No governing document", draft: "Draft, not approved", approved: "Approved" };
export const DELEGATION_LABEL: Record<string, string> = {
  pending: "Pending: inactive", interim: "Interim", approved: "Approved", withdrawn: "Withdrawn",
};
export const LINK_KIND_LABEL: Record<string, string> = {
  approval_workflow: "Clinical content approval", framework_governance: "Competency framework governance",
  administration: "Scholar administration", ai_escalation: "AI safety and incident escalation",
  joint_clearance: "Joint specialist clearance",
};
/** V1.1: what each line between bodies IS. Corporate reporting is never drawn as oversight, or the reverse. */
export const RELATION_LABEL: Record<string, string> = {
  interim_authority: "Interim corporate authority", corporate_reporting: "Corporate reporting (solid line)",
  mandate: "Mandate", specialist_oversight: "Specialist oversight (consultation, not line management)",
  joint_review: "Joint specialist review (dashed bridge)", service: "Shared service relationship",
};
export const STATUS_ITEM_LABEL: Record<string, string> = {
  proposed: "Proposed", pending: "Pending", unverified: "Unverified", deferred: "Deferred (owner decision)", verified: "Verified",
};

/** The authority boundaries of the model, shown verbatim on the screen. */
export const AUTHORITY_BOUNDARIES: readonly string[] = [
  "Shareholding grants no office, clinical approval or platform access.",
  "Board and committee seats grant no platform capability. Platform authority comes only from an HQ appointment to a position.",
  "Committee membership does not grant clinical approval. Independent clinical review stays mandatory where required.",
  "Holdings retains shared technical, security and AI infrastructure authority. Scholar retains educational and learner-service accountability.",
  "Pending or withdrawn delegations are inactive. A body that is not established cannot delegate.",
  "Board constitution and appointments remain pending until Competen Scholar is incorporated. Until then Holdings provides documented interim authority.",
  "Holdings Technology Services is a shared corporate service beside the three Scholar levels, not a fourth level. Its functions are accountabilities, not necessarily separate employees, and carry no automatic privilege.",
  "The Scholar Technology Liaison has no automatic production deployment, security-administration or privileged access.",
  "A change touching both educational or clinical and technical domains needs each relevant clearance, given independently, before activation.",
  "The Product Lead reports to the corporate authority. The Committee gives specialist oversight and is not the Product Lead's line manager.",
];

// ── Row shapes ───────────────────────────────────────────────────────────────
type BodyRow = {
  code: string; level: number | null; kind: string; name: string; description: string | null; product_line_code: string | null;
  parent_body_code: string | null; constitution_status: string; constitution_note: string | null; interim_authority: string | null;
  document_status: string; document_ref: string | null; sort: number | null; is_active: boolean | null;
};
type SeatRow = {
  code: string; body_code: string; name: string; description: string | null; seat_kind: string; nomination_source: string | null;
  provider: string | null; accountability: string | null; authority_position_code: string | null; exclusive: boolean | null;
  sort: number | null; is_active: boolean | null;
};
type ApptRow = {
  id: string; seat_code: string; person_id: string | null; holder_name: string | null; status: string; basis: string | null;
  effective_from: string | null; effective_to: string | null; end_reason: string | null; created_at: string | null;
};
type DeclRow = { appointment_id: string; interest: string; mitigation: string | null; declared_at: string | null };
type DelegationRow = { code: string; from_body_code: string; to_body_code: string; relation: string; scope: string; status: string; basis: string | null; decided_at: string | null; sort: number | null };
type LinkRow = { code: string; seat_code: string; kind: string; clearance_domain: string | null; step: number | null; label: string; route: string | null; capability_code: string | null; note: string | null; sort: number | null };
type StatusItemRow = { code: string; subject: string; status: string; evidence: string | null; residual_risk: string | null; decided_at: string | null; sort: number | null };
type ExclusionRow = { seat_a: string; seat_b: string; reason: string };
type PositionRow = { code: string; name: string | null; is_active: boolean | null };
type OfficeRow = { id: string; office_type: string | null; is_active: boolean | null; status: string | null };
type HqApptRow = { office_id: string; role: string | null; status: string | null };

// ── Views ────────────────────────────────────────────────────────────────────
export type GovRecordView = {
  id: string; holderName: string | null; hasProfile: boolean; status: string; basis: string | null;
  effectiveFrom: string | null; effectiveTo: string | null; endReason: string | null;
  interests: { interest: string; mitigation: string | null; declaredAt: string | null }[];
};
export type GovPositionLink = {
  code: string; name: string;
  /** People holding the position by an ACTIVE HQ appointment today. Unreadable is never a zero. */
  activeHolders: Read<number>;
};
export type GovSeatView = {
  code: string; name: string; description: string | null; kind: string; nominationSource: string | null; provider: string | null;
  accountability: string | null; exclusive: boolean; status: GovSeatStatus;
  /** The live record (nominated, interim or active), or null when the seat is vacant. */
  current: GovRecordView | null;
  history: GovRecordView[];
  authorityPosition: GovPositionLink | null;
  links: GovLinkView[];
  /** Seats this seat may not be combined with, by the seat-level independence pairs. */
  independentOf: { seat: string; reason: string }[];
};
export type GovBodyView = {
  /** null for a shared service beside the three levels (V1.1 Holdings Technology Services). */
  code: string; level: 1 | 2 | 3 | null; kind: string; name: string; description: string | null; parent: string | null;
  constitution: string; constitutionNote: string | null; interimAuthority: string | null;
  documentStatus: string; documentRef: string | null; seats: GovSeatView[];
};
export type GovDelegationView = { code: string; from: string; to: string; relation: string; scope: string; status: string; basis: string | null; decidedAt: string | null; active: boolean };
/** route null: a clearance with no workflow in the product. Its note says where it is recorded instead. */
export type GovLinkView = { code: string; seat: string; kind: string; domain: string | null; step: number | null; label: string; route: string | null; capability: string | null; note: string | null };
export type GovStatusItemView = { code: string; subject: string; status: string; evidence: string | null; residualRisk: string | null; decidedAt: string | null };
export type GovBoard = {
  bodies: GovBodyView[];
  delegations: GovDelegationView[];
  escalation: (GovLinkView & { seatName: string; seatStatus: GovSeatStatus })[];
  clearances: (GovLinkView & { seatName: string; seatStatus: GovSeatStatus })[];
  statusItems: GovStatusItemView[];
  outstanding: { seat: string; seatName: string; body: string; status: GovSeatStatus }[];
  counts: { seats: number; vacant: number; nominated: number; interim: number; appointed: number };
  notes: string[];
};
export type GovLoad =
  | { state: "absent"; reason: string }
  | { state: "unreadable"; error: string }
  | { state: "ok"; board: GovBoard };

/** What a live record means for the seat. Ended records are history. */
export function seatStatusOf(records: { status: string }[]): GovSeatStatus {
  const live = records.find(r => r.status !== "ended");
  if (!live) return "vacant";
  return live.status === "active" ? "appointed" : live.status === "interim" ? "interim" : "nominated";
}

/** A missing table or function is "610 is not applied", never a refusal and never an empty registry. */
export function isMissingRelation(message: string, code?: string | null): boolean {
  return code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42883"
    || /does not exist|could not find the (table|function)|schema cache/i.test(message);
}

const bySort = <T extends { sort?: number | null }>(a: T, b: T) => (a.sort ?? 100) - (b.sort ?? 100);

/** Pure. Builds the board from rows already read. */
export function buildGovBoard(input: {
  bodies: BodyRow[]; seats: SeatRow[]; appointments: ApptRow[]; declarations: DeclRow[]; delegations: DelegationRow[];
  links: LinkRow[]; exclusions: ExclusionRow[]; statusItems: StatusItemRow[];
  positions: Read<PositionRow[]>; holderCounts: Read<Map<string, number>>;
}): GovBoard {
  const notes: string[] = [];
  const posName = new Map(input.positions.ok ? input.positions.value.map(p => [p.code, p.name ?? p.code]) : []);
  if (!input.positions.ok) notes.push(`Position names could not be read (${input.positions.error}), so linked positions show their codes.`);
  if (!input.holderCounts.ok) notes.push(`HQ appointments could not be read (${input.holderCounts.error}), so linked-position holder counts are unknown, not zero.`);

  const declsBy = new Map<string, DeclRow[]>();
  for (const d of input.declarations) declsBy.set(d.appointment_id, [...(declsBy.get(d.appointment_id) ?? []), d]);
  const toRecord = (a: ApptRow): GovRecordView => ({
    id: a.id, holderName: a.holder_name, hasProfile: !!a.person_id, status: a.status, basis: a.basis,
    effectiveFrom: a.effective_from, effectiveTo: a.effective_to, endReason: a.end_reason,
    interests: (declsBy.get(a.id) ?? []).map(d => ({ interest: d.interest, mitigation: d.mitigation, declaredAt: d.declared_at })),
  });
  const linksBySeat = new Map<string, GovLinkView[]>();
  const linkViews = [...input.links].sort(bySort).map(l => ({ code: l.code, seat: l.seat_code, kind: l.kind, domain: l.clearance_domain, step: l.step, label: l.label, route: l.route, capability: l.capability_code, note: l.note }));
  for (const l of linkViews) linksBySeat.set(l.seat, [...(linksBySeat.get(l.seat) ?? []), l]);

  const seatViews = new Map<string, GovSeatView>();
  for (const s of [...input.seats].filter(s => s.is_active !== false).sort(bySort)) {
    const recs = input.appointments.filter(a => a.seat_code === s.code)
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    const live = recs.find(r => r.status !== "ended") ?? null;
    const pos = s.authority_position_code;
    seatViews.set(s.code, {
      code: s.code, name: s.name, description: s.description, kind: s.seat_kind, nominationSource: s.nomination_source,
      provider: s.provider, accountability: s.accountability, exclusive: s.exclusive === true,
      status: seatStatusOf(recs), current: live ? toRecord(live) : null,
      history: recs.filter(r => r.status === "ended").map(toRecord),
      authorityPosition: pos ? {
        code: pos, name: posName.get(pos) ?? pos,
        activeHolders: input.holderCounts.ok ? readOk(input.holderCounts.value.get(pos) ?? 0) : readFail(input.holderCounts.error),
      } : null,
      links: linksBySeat.get(s.code) ?? [],
      independentOf: input.exclusions.filter(x => x.seat_a === s.code || x.seat_b === s.code)
        .map(x => ({ seat: x.seat_a === s.code ? x.seat_b : x.seat_a, reason: x.reason })),
    });
  }

  const bodyName = new Map(input.bodies.map(b => [b.code, b.name]));
  const bodies: GovBodyView[] = [...input.bodies].filter(b => b.is_active !== false)
    .sort((a, b) => (a.level ?? 9) - (b.level ?? 9) || bySort(a, b))
    .map(b => ({
      code: b.code, level: (b.level === 1 || b.level === 2 || b.level === 3 ? b.level : null) as 1 | 2 | 3 | null, kind: b.kind, name: b.name,
      description: b.description, parent: b.parent_body_code ? bodyName.get(b.parent_body_code) ?? b.parent_body_code : null,
      constitution: b.constitution_status, constitutionNote: b.constitution_note, interimAuthority: b.interim_authority,
      // ⚠ An "approved" document with no reference is impossible in the database. Belt and braces here too.
      documentStatus: b.document_status === "approved" && !b.document_ref ? "draft" : b.document_status,
      documentRef: b.document_ref,
      seats: input.seats.filter(s => s.body_code === b.code && seatViews.has(s.code)).sort(bySort).map(s => seatViews.get(s.code)!),
    }));

  const delegations = [...input.delegations].sort(bySort).map(d => ({
    code: d.code, from: bodyName.get(d.from_body_code) ?? d.from_body_code, to: bodyName.get(d.to_body_code) ?? d.to_body_code, relation: d.relation,
    scope: d.scope, status: d.status, basis: d.basis, decidedAt: d.decided_at,
    active: d.status === "approved" || d.status === "interim",
  }));

  const escalation = linkViews.filter(l => l.kind === "ai_escalation")
    .sort((a, b) => (a.step ?? 99) - (b.step ?? 99))
    .map(l => ({ ...l, seatName: seatViews.get(l.seat)?.name ?? l.seat, seatStatus: seatViews.get(l.seat)?.status ?? "vacant" as GovSeatStatus }));

  const clearances = linkViews.filter(l => l.kind === "joint_clearance")
    .map(l => ({ ...l, seatName: seatViews.get(l.seat)?.name ?? l.seat, seatStatus: seatViews.get(l.seat)?.status ?? "vacant" as GovSeatStatus }));
  const statusItems = [...input.statusItems].sort(bySort).map(i => ({
    code: i.code, subject: i.subject,
    // ⚠ Verified without written evidence is impossible in the database. Belt and braces here too.
    status: i.status === "verified" && !i.evidence ? "unverified" : i.status,
    evidence: i.evidence, residualRisk: i.residual_risk, decidedAt: i.decided_at,
  }));

  const allSeats = bodies.flatMap(b => b.seats.map(s => ({ s, body: b.name })));
  const outstanding = allSeats.filter(({ s }) => s.status === "vacant" || s.status === "nominated")
    .map(({ s, body }) => ({ seat: s.code, seatName: s.name, body, status: s.status }));
  const count = (st: GovSeatStatus) => allSeats.filter(({ s }) => s.status === st).length;
  return {
    bodies, delegations, escalation, clearances, statusItems, outstanding,
    counts: { seats: allSeats.length, vacant: count("vacant"), nominated: count("nominated"), interim: count("interim"), appointed: count("appointed") },
    notes,
  };
}

/** The registry, read once. Every structural read must succeed, or the board is not drawn. */
export async function loadGovBoard(admin: Admin): Promise<GovLoad> {
  const [bodies, seats, appts, decls, dels, links, excl, items] = await Promise.all([
    admin.from("hq_gov_body").select("code, level, kind, name, description, product_line_code, parent_body_code, constitution_status, constitution_note, interim_authority, document_status, document_ref, sort, is_active").limit(200),
    admin.from("hq_gov_seat").select("code, body_code, name, description, seat_kind, nomination_source, provider, accountability, authority_position_code, exclusive, sort, is_active").limit(500),
    admin.from("hq_gov_seat_appointment").select("id, seat_code, person_id, holder_name, status, basis, effective_from, effective_to, end_reason, created_at").limit(5000),
    admin.from("hq_gov_interest_declaration").select("appointment_id, interest, mitigation, declared_at").order("declared_at").limit(5000),
    admin.from("hq_gov_delegation").select("code, from_body_code, to_body_code, relation, scope, status, basis, decided_at, sort").limit(200),
    admin.from("hq_gov_link").select("code, seat_code, kind, clearance_domain, step, label, route, capability_code, note, sort").limit(500),
    admin.from("hq_gov_seat_exclusion").select("seat_a, seat_b, reason").limit(500),
    admin.from("hq_gov_status_item").select("code, subject, status, evidence, residual_risk, decided_at, sort").limit(200),
  ]);
  const structural = [bodies, seats, appts, decls, dels, links, excl, items];
  const missing = structural.find(r => r.error && isMissingRelation(r.error.message, r.error.code));
  if (missing) return { state: "absent", reason: "Migration 610 is not applied to this database, so the Scholar governance registry is not available. Nothing was read and nothing can be recorded." };
  const failed = structural.find(r => r.error);
  if (failed?.error) return { state: "unreadable", error: failed.error.message };

  const seatRows = (seats.data ?? []) as SeatRow[];
  const linked = [...new Set(seatRows.map(s => s.authority_position_code).filter((c): c is string => !!c))];
  const [posRes, officeRes] = await Promise.all([
    linked.length ? admin.from("hq_position").select("code, name, is_active").in("code", linked) : Promise.resolve({ data: [], error: null }),
    admin.from("ogs_offices").select("id, office_type, is_active, status").limit(500),
  ]);
  const positions: Read<PositionRow[]> = posRes.error ? readFail(posRes.error.message) : readOk((posRes.data ?? []) as PositionRow[]);

  // Holder counts by the guard's own rules: an active appointment, in a live hq_ office, whose role is the position.
  let holderCounts: Read<Map<string, number>>;
  if (officeRes.error) holderCounts = readFail(officeRes.error.message);
  else {
    const officeIds = ((officeRes.data ?? []) as OfficeRow[])
      .filter(o => isHqOfficeType(o.office_type) && o.is_active !== false && o.status !== "dissolved" && o.status !== "archived")
      .map(o => o.id);
    if (!officeIds.length || !linked.length) holderCounts = readOk(new Map());
    else {
      const { data, error } = await admin.from("ogs_office_appointments").select("office_id, role, status")
        .in("office_id", officeIds).in("role", linked).limit(2000);
      if (error) holderCounts = readFail(error.message);
      else {
        const m = new Map<string, number>();
        for (const a of (data ?? []) as HqApptRow[]) if (a.role && appointmentGrantsAccess(a.status)) m.set(a.role, (m.get(a.role) ?? 0) + 1);
        holderCounts = readOk(m);
      }
    }
  }

  return {
    state: "ok",
    board: buildGovBoard({
      bodies: (bodies.data ?? []) as BodyRow[], seats: seatRows, appointments: (appts.data ?? []) as ApptRow[],
      declarations: (decls.data ?? []) as DeclRow[], delegations: (dels.data ?? []) as DelegationRow[],
      links: (links.data ?? []) as LinkRow[], exclusions: (excl.data ?? []) as ExclusionRow[],
      statusItems: (items.data ?? []) as StatusItemRow[], positions, holderCounts,
    }),
  };
}

// ── Requests ─────────────────────────────────────────────────────────────────
export const GOV_MIN_REASON = 5;
const SEAT_CODE_RE = /^[a-z][a-z0-9_]{2,62}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GovAction =
  | { action: "appoint"; seat: string; personId: string | null; holderName: string | null; status: "nominated" | "interim" | "active"; basis: string | null; interests: string | null; reason: string }
  | { action: "end"; appointmentId: string; reason: string }
  | { action: "declare_interest"; appointmentId: string; interest: string; mitigation: string | null; reason: string }
  | { action: "set_delegation"; code: string; status: "pending" | "interim" | "approved" | "withdrawn"; basis: string | null; reason: string }
  | { action: "set_status_item"; code: string; status: GovStatusItemStatus; evidence: string | null; residualRisk: string | null; reason: string };
export type GovStatusItemStatus = "proposed" | "pending" | "unverified" | "deferred" | "verified";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const opt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Parse a request body. Pure. The database re-checks everything: this refuses early, with a sentence. */
export function parseGovAction(b: unknown): { ok: true; value: GovAction } | { ok: false; error: string } {
  const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const reason = str(o.reason);
  if (reason.length < GOV_MIN_REASON) return { ok: false, error: `A reason of at least ${GOV_MIN_REASON} characters is required. It is written to the audit trail.` };
  switch (str(o.action)) {
    case "appoint": {
      const seat = str(o.seat);
      const status = str(o.status);
      const personId = opt(o.person_id);
      const holderName = opt(o.holder_name);
      if (!SEAT_CODE_RE.test(seat)) return { ok: false, error: "Choose a seat." };
      if (status !== "nominated" && status !== "interim" && status !== "active") return { ok: false, error: "The status must be nominated, interim or active." };
      if (personId && !UUID_RE.test(personId)) return { ok: false, error: "person_id must be a profile id." };
      if (!personId && !holderName) return { ok: false, error: "Name the holder: choose a person, or enter a name for someone without a Competen account." };
      const basis = opt(o.basis);
      const interests = opt(o.interests);
      if (status !== "nominated" && (!basis || basis.length < 5)) return { ok: false, error: "An interim or active appointment names its lawful basis: the resolution, instrument or decision reference." };
      if (status !== "nominated" && !interests) return { ok: false, error: "A declaration of interests is required. Write None declared if there are none." };
      return { ok: true, value: { action: "appoint", seat, personId, holderName, status, basis, interests, reason } };
    }
    case "end": {
      const id = str(o.appointment_id);
      return UUID_RE.test(id) ? { ok: true, value: { action: "end", appointmentId: id, reason } } : { ok: false, error: "appointment_id is required." };
    }
    case "declare_interest": {
      const id = str(o.appointment_id);
      const interest = str(o.interest);
      if (!UUID_RE.test(id)) return { ok: false, error: "appointment_id is required." };
      if (!interest) return { ok: false, error: "The interest is required." };
      return { ok: true, value: { action: "declare_interest", appointmentId: id, interest, mitigation: opt(o.mitigation), reason } };
    }
    case "set_delegation": {
      const code = str(o.code);
      const status = str(o.status);
      if (!SEAT_CODE_RE.test(code)) return { ok: false, error: "Choose a delegation." };
      if (!["pending", "interim", "approved", "withdrawn"].includes(status)) return { ok: false, error: "The status must be pending, interim, approved or withdrawn." };
      const basis = opt(o.basis);
      if ((status === "interim" || status === "approved") && (!basis || basis.length < 5)) return { ok: false, error: "An interim or approved delegation names its basis." };
      return { ok: true, value: { action: "set_delegation", code, status: status as "pending" | "interim" | "approved" | "withdrawn", basis, reason } };
    }
    case "set_status_item": {
      const code = str(o.code);
      const status = str(o.status);
      if (!SEAT_CODE_RE.test(code)) return { ok: false, error: "Choose a status item." };
      if (!["proposed", "pending", "unverified", "deferred", "verified"].includes(status)) return { ok: false, error: "The status must be proposed, pending, unverified, deferred or verified." };
      const evidence = opt(o.evidence);
      if (status === "verified" && (!evidence || evidence.length < 10)) return { ok: false, error: "Verified needs the evidence written down." };
      return { ok: true, value: { action: "set_status_item", code, status: status as GovStatusItemStatus, evidence, residualRisk: opt(o.residual_risk), reason } };
    }
    default:
      return { ok: false, error: "action must be one of appoint, end, declare_interest, set_delegation, set_status_item." };
  }
}

/** The function and its arguments for one action. The actor is the session, never the body. */
export function govRpcFor(a: GovAction, actor: { id: string; name: string | null; trace: string | null }): { fn: string; args: Record<string, unknown> } {
  const base = { p_actor: actor.id, p_actor_name: actor.name, p_trace: actor.trace, p_reason: a.reason };
  switch (a.action) {
    case "appoint": return { fn: "hq_gov_admin_appoint", args: { ...base, p_seat: a.seat, p_person: a.personId, p_holder_name: a.holderName, p_status: a.status, p_basis: a.basis, p_interests: a.interests } };
    case "end": return { fn: "hq_gov_admin_end", args: { ...base, p_appointment: a.appointmentId } };
    case "declare_interest": return { fn: "hq_gov_admin_declare_interest", args: { ...base, p_appointment: a.appointmentId, p_interest: a.interest, p_mitigation: a.mitigation } };
    case "set_delegation": return { fn: "hq_gov_admin_set_delegation", args: { ...base, p_code: a.code, p_status: a.status, p_basis: a.basis } };
    case "set_status_item": return { fn: "hq_gov_admin_set_status_item", args: { ...base, p_code: a.code, p_status: a.status, p_evidence: a.evidence, p_residual_risk: a.residualRisk } };
  }
}

/** A database refusal as an HTTP status and the database's own sentence. A missing function is 503, not 403. */
export function govStatusForDbError(message: string, code?: string | null): { status: number; error: string } {
  // The function's own tagged sentence first: "hq_gov not_found: ... does not exist" is a refusal, not an absence.
  const m = /hq_gov (\w+): ([\s\S]*)$/.exec(message);
  if (!m && isMissingRelation(message, code))
    return { status: 503, error: "Scholar governance records are not available yet: migration 610 is not applied to this database. Nothing was changed." };
  const tag = m?.[1] ?? "";
  const text = m ? m[2] : message;
  const status =
    tag === "owner_required" ? 403
    : tag === "not_found" ? 404
    : tag === "exists" || tag === "history" || tag === "separation_of_duties" || tag === "unchanged" ? 409
    : tag === "invalid" ? 400
    : code === "23514" ? 400
    : 500;
  return { status, error: status === 500 ? `The change was not written: ${message}` : text };
}

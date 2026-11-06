/* eslint-disable @typescript-eslint/no-explicit-any */
import { HQ_SPACES, appointmentInTerm, isHqOfficeType } from "../spaces";
import { appointmentGrantsAccess } from "@/lib/ogs/lifecycle";
import type { createAdminClient } from "@/lib/supabase/server";

// HQ-RECORD-SEARCH-01: the four platform-owned record types the HQ palette may search, and nothing else.
//
// ⚠ THIS IS A CLOSED LIST, NOT A FRAMEWORK. Code and title fields only: no description, content or snapshot is read, searched
// or previewed. Platform-owned rows only: a hospital's framework and an individual's or organisation's instrument are filtered
// IN THE QUERY (not afterwards). Never add learner records, individual_*, assessment instances or responses, practice_*,
// hospitals, organisations, tenants, profiles or audit_log here. HQ staff NAMES are the one people source (key `staff`): see its entry. This does NOT extend
// src/lib/individual/search/registry.ts and does NOT touch the plane boundary: these tables are not governed by it.
//
// ⚠ ONE ROUTE PER TYPE (src/app/api/hq/search/<key>/route.ts) with a literal hqApiGate([...]), because hq-scan reads the gate
// per verb: a single [type] route would hide each capability from the scanner. The route's literal MUST equal `capability`
// below (record-search.test.ts proves it).

type Admin = ReturnType<typeof createAdminClient>;

export type HqRecordSearchKey = "policies" | "instruments" | "frameworks" | "positions" | "staff";
export type HqSearchRow = { id: string; code: string | null; title: string };

export interface HqRecordSource {
  key: HqRecordSearchKey;
  product: string;
  module: string;
  recordType: string;
  capability: string;
  destination: (id: string) => string;
  /** the row fields the matcher sees. */
  fields: readonly ("code" | "title")[];
  /** the database columns read, and the only ones. */
  columns: readonly string[];
  /** throws on a source failure (the route answers 502). */
  read: (admin: Admin) => Promise<HqSearchRow[]>;
}

const PRODUCT = "Competen Platform";
const fail = (e: { message?: string } | null | undefined): never => { throw new Error(e?.message ?? "read failed"); };

export const HQ_RECORD_SOURCES: readonly HqRecordSource[] = [
  {
    key: "policies", product: PRODUCT, module: "Policy Manager", recordType: "Governed policy",
    capability: "hq.quality.policy.view", destination: id => `/super-admin/policy-manager/${id}`,
    fields: ["code", "title"], columns: ["id", "code", "title"],
    // as listPolicies (studio/read.ts) reads hq_policy, narrowed to the search columns.
    read: async admin => {
      const { data, error } = await admin.from("hq_policy").select("id, code, title").order("created_at", { ascending: false }).limit(2000);
      if (error) fail(error);
      return ((data ?? []) as any[]).map(r => ({ id: r.id, code: r.code ?? null, title: r.title ?? "" }));
    },
  },
  {
    key: "instruments", product: PRODUCT, module: "Checklist Studio", recordType: "Instrument",
    capability: "hq.assessment.studio.view", destination: id => `/super-admin/checklist-studio/${id}`,
    fields: ["code", "title"], columns: ["id", "code", "name"],
    // as listLibrary reads asmt_instrument, PLUS the holdings filter the Studio page does not apply: an instrument owned by an
    // organisation, a product line or an individual is not a platform record and is never offered.
    read: async admin => {
      const { data, error } = await admin.from("asmt_instrument").select("id, code, name").eq("owner_scope", "holdings").order("created_at", { ascending: false }).limit(2000);
      if (error) fail(error);
      return ((data ?? []) as any[]).map(r => ({ id: r.id, code: r.code ?? null, title: r.name ?? "" }));
    },
  },
  {
    key: "frameworks", product: PRODUCT, module: "Clinical Knowledge Studio", recordType: "Framework",
    capability: "hq.learning.content.view", destination: id => `/super-admin/content/${id}`,
    fields: ["code", "title"], columns: ["id", "code", "name"],
    // as /super-admin/content reads frameworks (active ones), PLUS hospital_id is null: a hospital's own framework is tenant data.
    read: async admin => {
      const { data, error } = await admin.from("frameworks").select("id, code, name").is("hospital_id", null).eq("is_active", true).order("name").limit(2000);
      if (error) fail(error);
      return ((data ?? []) as any[]).map(r => ({ id: r.id, code: r.code ?? null, title: r.name ?? "" }));
    },
  },
  {
    key: "positions", product: PRODUCT, module: "Positions and grants", recordType: "Position",
    capability: "hq.platform.users.view", destination: () => "/super-admin/users/positions",
    fields: ["code", "title"], columns: ["code", "name", "space"],
    // as readPositionRows (positions.ts) reads hq_position, base columns only. `space` is read to keep the board's own rule (only
    // the five HQ spaces) and is never searched. A position's id IS its code. There is no per-record page: the board is the destination.
    read: async admin => {
      const { data, error } = await admin.from("hq_position").select("code, name, space").limit(500);
      if (error) fail(error);
      return ((data ?? []) as any[])
        .filter(r => (HQ_SPACES as readonly string[]).includes(r.space))
        .map(r => ({ id: r.code, code: r.code ?? null, title: r.name ?? r.code ?? "" }));
    },
  },
  {
    key: "staff", product: PRODUCT, module: "Positions and appointments", recordType: "HQ staff member",
    capability: "hq.platform.users.view", destination: () => "/super-admin/users/appointments",
    fields: ["code", "title"], columns: ["id", "office_id", "person_name", "role", "status", "term_start", "term_end"],
    // ⚠ STAFF DIRECTORY, NAME AND POSITION TITLE ONLY. Title = the person's name (the appointment's own person_name, so profiles is
    // NOT read at all: no email, phone or any employment field can come back), code = the position's title. HQ offices only
    // (isHqOfficeType), and only appointments in force today (the board's own grantsAccess && inTerm), so an ended or pending
    // appointment is not a directory entry. Not learners, not practice staff, not profiles at large. The destination is the page that
    // lists them, behind the same capability. The route also writes an audit row (no query text) because this is a sensitive search.
    read: async admin => {
      const offices = await admin.from("ogs_offices").select("id, office_type").limit(500);
      if (offices.error) fail(offices.error);
      const officeIds = ((offices.data ?? []) as any[]).filter(o => isHqOfficeType(o.office_type)).map(o => o.id);
      if (!officeIds.length) return [];
      const [appts, pos] = await Promise.all([
        admin.from("ogs_office_appointments").select("id, office_id, person_name, role, status, term_start, term_end").in("office_id", officeIds).limit(2000),
        admin.from("hq_position").select("code, name").limit(500),
      ]);
      if (appts.error) fail(appts.error);
      if (pos.error) fail(pos.error);
      const posName = new Map(((pos.data ?? []) as any[]).map(p => [p.code, p.name]));
      return ((appts.data ?? []) as any[])
        .filter(a => a.person_name && String(a.person_name).trim() && appointmentGrantsAccess(a.status) && appointmentInTerm(a.term_start, a.term_end))
        .map(a => ({ id: a.id, code: posName.get(a.role) ?? a.role ?? null, title: String(a.person_name).trim() }));
    },
  },
];

export const hqRecordSource = (key: HqRecordSearchKey): HqRecordSource => HQ_RECORD_SOURCES.find(s => s.key === key)!;

/** What the palette is told about a source it may call. No capability, no table, no column. */
export type HqRecordSourceView = { key: HqRecordSearchKey; product: string; module: string; recordType: string; endpoint: string };

/** The sources to hand to the palette: only for capabilities the viewer holds (an owner holds all), and only when the flag is on. */
export function hqRecordSourcesFor(viewer: { isOwner: boolean; capabilities: readonly string[] }, flagOn: boolean): HqRecordSourceView[] {
  if (!flagOn) return [];
  return HQ_RECORD_SOURCES
    .filter(s => viewer.isOwner || viewer.capabilities.includes(s.capability))
    .map(s => ({ key: s.key, product: s.product, module: s.module, recordType: s.recordType, endpoint: `/api/hq/search/${s.key}` }));
}

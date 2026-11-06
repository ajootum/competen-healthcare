import { HQ_SPACES } from "../spaces";
import type { createAdminClient } from "@/lib/supabase/server";

// HQ-RECORD-SEARCH-01: the four platform-owned record types the HQ palette may search, and nothing else.
//
// ⚠ THIS IS A CLOSED LIST, NOT A FRAMEWORK. Code and title fields only: no description, content or snapshot is read, searched
// or previewed. Platform-owned rows only: a hospital's framework and an individual's or organisation's instrument are filtered
// IN THE QUERY (not afterwards). Never add learner records, individual_*, assessment instances or responses, practice_*,
// hospitals, organisations, tenants, profiles, audit_log, appointments or staff names here. This does NOT extend
// src/lib/individual/search/registry.ts and does NOT touch the plane boundary: these tables are not governed by it.
//
// ⚠ ONE ROUTE PER TYPE (src/app/api/hq/search/<key>/route.ts) with a literal hqApiGate([...]), because hq-scan reads the gate
// per verb: a single [type] route would hide each capability from the scanner. The route's literal MUST equal `capability`
// below (record-search.test.ts proves it).

type Admin = ReturnType<typeof createAdminClient>;

export type HqRecordSearchKey = "policies" | "instruments" | "frameworks" | "positions";
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

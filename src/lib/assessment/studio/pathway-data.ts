/* eslint-disable @typescript-eslint/no-explicit-any */
// ASMT-PATHWAY-01 -- the pathway to publication, the SERVER half: who holds each Studio capability through a live
// appointment (as the Framework Governance Workspace's actorsFor does), and the pathway model of one version from the
// same lifecycle read every Studio page already makes. Reads: hq_position_capability, hq_position, ogs_office_appointments,
// profiles (names); the catalogue availability of a published checklist comes through the catalogue's own loader. Never a capture table.
import type { createAdminClient } from "@/lib/supabase/server";
import { activeGrants, appointmentInTerm, narrowToScope } from "@/lib/hq/spaces";
import { loadAvailability } from "../catalogue/availability";
import { CAP } from "./transitions";
import { lifecycleData, type LifecycleData } from "./page-data";
import { nameMap } from "./read";
import { pathwayOf, summarize, NO_HOLDERS, type PathwayHolder, type PathwayHolders, type PathwayModel, type PathwaySummary } from "./pathway";
import { VERSION_TABLE, type DefinitionKind, type LifecycleRow, type StudioIssue } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

const GROUPS = { author: CAP.author, review: CAP.review, domainReview: CAP.domainReview, publish: CAP.publish } as const;
type Group = keyof typeof GROUPS;

/**
 * The appointed holders of the four Studio capabilities, by name and position, from the live appointments. An owner is
 * not assumed to hold anything: the database wants appointments, so this list says exactly who the database will admit.
 * A read failure comes back as readable: false, said on screen, never as an empty list that looks like "nobody".
 */
export async function loadHolders(admin: Admin): Promise<PathwayHolders> {
  try {
    const caps = Object.values(GROUPS) as string[];
    const grants = await admin.from("hq_position_capability").select("position_code, capability_code, effective_from, effective_to").in("capability_code", caps).limit(1000);
    if (grants.error) throw grants.error;
    const live = activeGrants((grants.data ?? []) as any[]);
    const positionsOf = (cap: string) => [...new Set(live.filter((g: any) => g.capability_code === cap).map((g: any) => g.position_code as string))].sort();
    const positions = { author: positionsOf(CAP.author), review: positionsOf(CAP.review), domainReview: positionsOf(CAP.domainReview), publish: positionsOf(CAP.publish) };
    const allPositions = [...new Set(Object.values(positions).flat())];
    if (!allPositions.length) return { ...NO_HOLDERS, positions, readable: true };
    const [appts, posRows] = await Promise.all([
      admin.from("ogs_office_appointments").select("id, person_id, role, status, term_start, term_end, capability_scope").in("role", allPositions).eq("status", "active").limit(1000),
      admin.from("hq_position").select("code, name").in("code", allPositions),
    ]);
    if (appts.error) throw appts.error;
    const posName = new Map(((posRows.data ?? []) as any[]).map((p) => [p.code, p.name as string]));
    const rows = ((appts.data ?? []) as any[]).filter((a) => appointmentInTerm(a.term_start, a.term_end));
    const names = await nameMap(admin, rows.map((a) => a.person_id));
    const holdersOf = (group: Group): PathwayHolder[] => {
      const cap = GROUPS[group];
      const seen = new Set<string>();
      const out: PathwayHolder[] = [];
      for (const a of rows) {
        if (!positions[group].includes(a.role)) continue;
        if (narrowToScope([cap], a.capability_scope).length === 0) continue;
        const key = `${a.person_id}:${a.role}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ personId: a.person_id, name: names[a.person_id] ?? "Unnamed person", position: posName.get(a.role) ?? a.role });
      }
      return out.sort((x, y) => x.name.localeCompare(y.name));
    };
    return { author: holdersOf("author"), review: holdersOf("review"), domainReview: holdersOf("domainReview"), publish: holdersOf("publish"), positions, readable: true };
  } catch {
    return { ...NO_HOLDERS, readable: false };
  }
}

export type PathwayVersion = LifecycleRow & { risk?: "standard" | "high"; requires_domain_review?: boolean; delivery_modes?: string[] };

export interface PathwayOptions {
  kind: DefinitionKind;
  /** null = a catalogue identity with no version yet */
  version: PathwayVersion | null;
  actorId: string;
  caps: string[];
  validation?: StudioIssue[];
  /** reuse the page's lifecycle read instead of reading again */
  life?: LifecycleData;
  holders?: PathwayHolders;
  /** checklists: the instrument id, to read its catalogue availability once published */
  instrumentId?: string | null;
  /** the version numbers of the definition's other versions, to say which one superseded a retired one */
  versionNos?: Record<string, number>;
  /** checklists: whether the catalogue already makes it available in a product (the catalogue passes what it read) */
  catalogueAvailability?: boolean | null;
}

/** The latest return to draft since the last submission: who returned it and the reason. Pure. */
export function latestReturn(events: { event: string; actor_id: string | null; reason: string | null; created_at: string }[], decisions: { decision: string; reviewer_id: string; rationale: string | null; created_at: string }[]): { by: string | null; note: string | null } | null {
  const sorted = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  let lastSubmit = -1, lastReturn = -1;
  sorted.forEach((e, k) => { if (e.event === "submitted") lastSubmit = k; if (e.event === "returned") lastReturn = k; });
  if (lastReturn < 0 || lastReturn < lastSubmit) return null;
  const ret = sorted[lastReturn];
  const since = lastSubmit >= 0 ? sorted[lastSubmit].created_at : "";
  const notes = decisions.filter((d) => d.decision !== "approved" && d.created_at >= since && d.created_at <= ret.created_at && d.rationale).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { by: ret.actor_id, note: ret.reason ?? notes[0]?.rationale ?? null };
}

/** The pathway model for one version (or for the identity before its first version). */
export async function pathwayModel(admin: Admin, o: PathwayOptions): Promise<PathwayModel> {
  const holders = o.holders ?? await loadHolders(admin);
  const v = o.version;
  if (!v) {
    return pathwayOf({
      kind: o.kind, versionNo: null, state: null, actorId: o.actorId, caps: o.caps, availability: null, approval: null, authoredBy: [], editedBy: [], submittedBy: null, involved: [],
      decisions: [], contentHash: null, requiresDomainReview: false, deliveryModes: [], validation: [], returned: null, supersededBy: null, catalogueAvailability: null, holders, names: {},
    });
  }
  const validation = o.validation ?? [];
  const life = o.life ?? await lifecycleData(admin, { kind: o.kind, version: v, actorId: o.actorId, caps: o.caps, validationErrors: validation.length, versionNos: o.versionNos });
  // The catalogue's availability is the catalogue's read (plane boundary AC9): the catalogue passes it in, the Studio asks its loader.
  let catalogueAvailability: boolean | null = o.catalogueAvailability ?? null;
  if (catalogueAvailability === null && o.kind === "instrument" && v.state === "published" && o.instrumentId) {
    catalogueAvailability = (await loadAvailability(admin, o.instrumentId).catch(() => [])).some((a) => a.enabled);
  }
  const supersededBy = v.state === "retired" && o.versionNos ? Math.max(0, ...Object.values(o.versionNos).filter((n) => n > v.version_no)) || null : null;
  return pathwayOf({
    kind: o.kind, versionNo: v.version_no, state: v.state, actorId: o.actorId, caps: o.caps, availability: life.availability, approval: life.approval,
    authoredBy: v.authored_by ?? [], editedBy: v.edited_by ?? [], submittedBy: v.submitted_by, involved: life.involved, decisions: life.decisions, contentHash: v.content_hash,
    requiresDomainReview: Boolean(v.requires_domain_review), deliveryModes: v.delivery_modes ?? ["n/a"], validation,
    returned: latestReturn(life.events, life.decisions), supersededBy, catalogueAvailability, holders, names: life.names,
  });
}

/** The short form for the catalogue drawer, the catalogue page and the import finish step. */
export async function pathwaySummary(admin: Admin, o: PathwayOptions): Promise<PathwaySummary> {
  return summarize(await pathwayModel(admin, o));
}

const LIFE = "id, version_no, state, content_hash, authored_by, edited_by, last_edited_by, submitted_by, submitted_at, published_by, published_at, retired_by, retired_at, duplicated_from_version_id, created_at";

/** One version's lifecycle row (plus the checklist's risk, domain-review and delivery-mode columns), or null. */
export async function loadVersionRow(admin: Admin, kind: DefinitionKind, versionId: string): Promise<(PathwayVersion & { instrument_id?: string }) | null> {
  const cols = kind === "instrument" ? `${LIFE}, instrument_id, risk, requires_domain_review, delivery_modes` : LIFE;
  const { data } = await admin.from(VERSION_TABLE[kind]).select(cols).eq("id", versionId).maybeSingle();
  return (data as any) ?? null;
}

/** The summary for a version named by id: what the import and template finish steps show for each registered draft. */
export async function pathwaySummaryByVersion(admin: Admin, kind: DefinitionKind, versionId: string, viewer: { actorId: string; caps: string[] }, holders?: PathwayHolders): Promise<PathwaySummary | null> {
  const v = await loadVersionRow(admin, kind, versionId);
  if (!v) return null;
  return pathwaySummary(admin, { kind, version: v, actorId: viewer.actorId, caps: viewer.caps, holders, instrumentId: v.instrument_id ?? null });
}

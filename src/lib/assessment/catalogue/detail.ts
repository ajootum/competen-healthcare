import { loadInstrumentTerms, loadTaxonomy, type InstrumentTerm } from "./classify";
import { loadAvailability, type ProductAvailability } from "./availability";
import { loadRelations, loadReferences, type InstrumentReference, type RelatedInstrument } from "./relations";
import { loadInstrumentCollections } from "./collections";
import { deriveStatus, STATUS_LABEL, versionLabel, type StatusCode } from "./shape";
import { must, type Admin, type Row } from "./db";
import { loadImportProvenance, type ImportProvenance } from "../import/provenance";
import { pathwaySummary } from "../studio/pathway-data";
import type { PathwaySummary } from "../studio/pathway";

/**
 * One instrument, read for the drawer and the full page. Everything is READ from where it lives and nothing is copied:
 * the versions and their dates are asmt_instrument_version rows (the published one is authoritative), the permitted
 * delivery modes are the latest PUBLISHED version's, and the trail is the append-only event table. The catalogue shows
 * these and edits none of them. Content belongs to Checklist Studio.
 */
export type VersionSummary = {
  id: string; versionNo: number; label: string; state: StatusCode; stateLabel: string;
  createdAt: string; submittedAt: string | null; publishedAt: string | null; retiredAt: string | null;
  effectiveFrom: string | null; reviewDue: string | null;
  authors: string[]; publisher: string | null;
  /** The newest version. */
  isLatest: boolean;
  /** The published version, the one that is authoritative. */
  isAuthoritative: boolean;
};

export type CatalogueEvent = { event: string; at: string; actor: string | null; detail: Record<string, unknown> };

export type InstrumentDetail = {
  id: string; code: string; name: string; kind: string; description: string | null;
  familyCode: string | null; familyLabel: string | null;
  owningEntity: string; responsibleAuthority: string | null; governanceNote: string | null;
  createdAt: string; createdBy: string | null;
  /** The import this instrument was registered from (migration 930), when it was imported. */
  importId: string | null; importSheet: string | null;
  importRecord: ImportProvenance | null;
  status: StatusCode; statusLabel: string; versionNo: number | null; version: string; publishedVersionNo: number | null;
  terms: InstrumentTerm[];
  /** From the published version. Empty when nothing is published. */
  permittedModes: string[];
  references: InstrumentReference[];
  relations: RelatedInstrument[];
  availability: ProductAvailability[];
  versions: VersionSummary[];
  collections: { id: string; code: string; name: string }[];
  events: CatalogueEvent[];
  /** ASMT-PATHWAY-01: the Studio's pathway to publication for the latest version (or the identity with no version), for the viewer. */
  pathway: PathwaySummary | null;
};

/** Who is looking: their standing on the next step is read off the Studio capabilities they hold. Without it, the pathway is drawn for nobody in particular. */
export type PathwayViewer = { actorId: string; caps: string[] };

export async function loadInstrumentDetail(admin: Admin, id: string, viewer?: PathwayViewer): Promise<InstrumentDetail | null> {
  const inst = must(await admin.from("asmt_instrument")
    .select("id, code, name, kind, description, family_code, owning_entity, responsible_authority, governance_note, created_at, created_by, import_id, import_sheet")
    .eq("id", id).maybeSingle(), "instrument") as Row | null;
  if (!inst) return null;

  const [fam, taxonomy, vers, events] = await Promise.all([
    inst.family_code ? admin.from("asmt_instrument_family").select("code, label").eq("code", inst.family_code).maybeSingle() : Promise.resolve({ data: null, error: null }),
    loadTaxonomy(admin),
    admin.from("asmt_instrument_version")
      .select("id, version_no, state, created_at, submitted_at, published_at, retired_at, effective_from, review_due, delivery_modes, authored_by, published_by, content_hash, edited_by, last_edited_by, submitted_by, retired_by, duplicated_from_version_id, risk, requires_domain_review")
      .eq("instrument_id", id).order("version_no", { ascending: false }),
    admin.from("asmt_definition_event").select("event, created_at, actor_id, detail").eq("subject_table", "asmt_instrument").eq("subject_id", id)
      .order("created_at", { ascending: false }).limit(25),
  ]);
  const versionRows = (must(vers as { data: Row[] | null; error: { message: string } | null }, "versions") ?? []) as Row[];
  const eventRows = (must(events as { data: Row[] | null; error: { message: string } | null }, "events") ?? []) as Row[];

  const [terms, references, relations, availability, collections, importRecord] = await Promise.all([
    loadInstrumentTerms(admin, id, taxonomy), loadReferences(admin, id), loadRelations(admin, id), loadAvailability(admin, id), loadInstrumentCollections(admin, id),
    inst.import_id ? loadImportProvenance(admin, inst.import_id) : Promise.resolve(null),
  ]);

  // Names for the people on the record.
  const peopleIds = [...new Set([
    ...(inst.created_by ? [inst.created_by] : []),
    ...versionRows.flatMap(v => [...(v.authored_by ?? []), ...(v.published_by ? [v.published_by] : [])]),
    ...eventRows.flatMap(e => (e.actor_id ? [e.actor_id] : [])),
  ])] as string[];
  const names = new Map<string, string>();
  if (peopleIds.length) {
    const p = (must(await admin.from("profiles").select("id, full_name").in("id", peopleIds), "people") ?? []) as Row[];
    for (const r of p) names.set(r.id, r.full_name || "Unnamed person");
  }
  const nameOf = (uid: string | null | undefined) => (uid ? names.get(uid) ?? "Unknown person" : null);

  const latest = versionRows[0] ?? null;
  const published = versionRows.find(v => v.state === "published") ?? null;
  const status = deriveStatus(latest?.state);
  const who = viewer ?? { actorId: "", caps: [] };
  const pathway = await pathwaySummary(admin, {
    kind: "instrument", version: latest as never, actorId: who.actorId, caps: who.caps, instrumentId: id, versionNos: Object.fromEntries(versionRows.map(v => [v.id, v.version_no])),
    catalogueAvailability: availability.some(a => a.enabled),
  }).catch(() => null);

  return {
    id: inst.id, code: inst.code, name: inst.name, kind: inst.kind, description: inst.description ?? null,
    familyCode: inst.family_code ?? null, familyLabel: ((fam as { data: Row | null }).data?.label as string | undefined) ?? null,
    owningEntity: inst.owning_entity ?? "Competen Holdings", responsibleAuthority: inst.responsible_authority ?? null, governanceNote: inst.governance_note ?? null,
    createdAt: inst.created_at, createdBy: nameOf(inst.created_by),
    importId: inst.import_id ?? null, importSheet: inst.import_sheet ?? null, importRecord,
    status, statusLabel: STATUS_LABEL[status], versionNo: latest?.version_no ?? null, version: versionLabel(latest?.version_no), publishedVersionNo: published?.version_no ?? null,
    terms,
    permittedModes: (published?.delivery_modes as string[] | undefined) ?? [],
    references, relations, availability,
    versions: versionRows.map(v => ({
      id: v.id, versionNo: v.version_no, label: versionLabel(v.version_no), state: deriveStatus(v.state), stateLabel: STATUS_LABEL[deriveStatus(v.state)],
      createdAt: v.created_at, submittedAt: v.submitted_at ?? null, publishedAt: v.published_at ?? null, retiredAt: v.retired_at ?? null,
      effectiveFrom: v.effective_from ?? null, reviewDue: v.review_due ?? null,
      authors: ((v.authored_by ?? []) as string[]).map(a => nameOf(a) ?? "Unknown person"), publisher: nameOf(v.published_by),
      isLatest: v.id === latest?.id, isAuthoritative: v.id === published?.id,
    })),
    collections,
    events: eventRows.map(e => ({ event: e.event, at: e.created_at, actor: nameOf(e.actor_id), detail: (e.detail ?? {}) as Record<string, unknown> })),
    pathway,
  };
}

/** The label of a delivery mode code: "self_assessment" becomes "Self assessment". */
export const modeWords = (code: string) => {
  const s = code.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
};

const EVENT_WORDS: Record<string, string> = {
  catalogue_registered: "Identity registered",
  catalogue_updated: "Identity or governance details changed",
  catalogue_classified: "Classification changed",
  catalogue_availability: "Product availability changed",
  catalogue_relation: "Relations or references changed",
  catalogue_collection: "Collection membership changed",
  catalogue_imported: "Content imported from a workbook",
  catalogue_from_template: "Created from a template",
  created: "Version created",
  duplicated: "Version duplicated to a new draft",
  submitted: "Version put forward for review",
  returned: "Version returned to draft",
  approved: "Version approved",
  published: "Version published",
  retired: "Version retired",
};
export const eventWords = (code: string) => EVENT_WORDS[code] ?? code.replace(/_/g, " ");

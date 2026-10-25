/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpdHours, learnerView, normaliseBlueprint, RELATION_LABEL, type Blueprint, type Relation } from "./blueprint";

// ── THE UNIFIED LEARNING CATALOGUE ── COMPETEN-LEARNING-01 S2, product definition s4 ──────────────────────────────
//
// What a learner may discover: the PUBLISHED version of every active offering that is deliverable now (461:
// published, and approved for its exact version when its route is clinical). Competen, partner and external learning
// in one list, each labelled by who provides it and how it is delivered. Browsing needs no development need or plan.
//
// ⚠ HOLDINGS CONTENT ONLY (ADR-017). This reads the 460 catalogue through the service role and nothing
// organisation-owned. No personal data is read here except, in offeringForLearner, the person's own record and access.
//
// ⚠ AN EXTERNAL LISTING IS LABELLED AS ONE. listingApproved is true for it, clinicallyApproved is always false, and
// the provider, the payment responsibility and the certificate issuer are the listing's own words.

export type CatalogueFilters = {
  q?: string | null; delivery?: "hosted" | "external" | null; source?: string | null; level?: string | null; format?: string | null;
  professionTermId?: string | null; specialtyTermId?: string | null; topic?: string | null; competencyId?: string | null;
  providerId?: string | null; cost?: "free" | "paid" | "external" | null; certificate?: boolean | null; maxMinutes?: number | null;
};
export type Price = { id: string; currency: string; amountMinor: number; accessDays: number | null; termsVersion: string };
export type CatalogueItem = {
  offeringId: string; code: string; title: string; summary: string; source: string; delivery: string; offeringType: string; versionId: string; versionNo: number;
  level: string | null; format: string | null; durationMinutes: number | null; topics: string[]; access: "free" | "paid" | "external";
  provider: { id: string; name: string; kind: string } | null; issuer: { id: string; name: string } | null; commercial: { id: string; name: string } | null;
  certificateOffered: boolean; cpdHours: number | null; cpdNote: string; prices: Price[];
  competencies: { id: string; name: string; relation: Relation; relationLabel: string }[];
  clinicallyApproved: boolean; listingApproved: boolean; reviewDueOn: string | null;
  external: Blueprint["external"];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = (e: any) => /does not exist|schema cache|could not find/i.test(e?.message ?? "");

/** The deliverable published versions, filtered in the query where the database holds the column. null = unreadable. */
export async function publishedCatalogue(admin: any, f: CatalogueFilters = {}): Promise<CatalogueItem[] | null> {
  let q = admin.from("learning_offering_version")
    .select("id, offering_id, version_no, content, review_route, level, format, duration_minutes, access_model, review_due_on, topics, profession_term_ids, specialty_term_ids, delivery_provider_id, certificate_issuer_id, commercial_provider_id, learning_offering!inner(id, code, title, source, delivery, offering_type, status)")
    .eq("state", "published").eq("learning_offering.status", "active").order("published_at", { ascending: false }).limit(300);
  if (f.delivery) q = q.eq("learning_offering.delivery", f.delivery);
  if (f.source) q = q.eq("learning_offering.source", f.source);
  if (f.level) q = q.eq("level", f.level);
  if (f.format) q = q.eq("format", f.format);
  if (f.cost) q = q.eq("access_model", f.cost);
  if (f.providerId && UUID.test(f.providerId)) q = q.eq("delivery_provider_id", f.providerId);
  if (f.professionTermId && UUID.test(f.professionTermId)) q = q.contains("profession_term_ids", [f.professionTermId]);
  if (f.specialtyTermId && UUID.test(f.specialtyTermId)) q = q.contains("specialty_term_ids", [f.specialtyTermId]);
  if (f.topic) q = q.contains("topics", [f.topic.slice(0, 80)]);
  if (f.maxMinutes) q = q.lte("duration_minutes", f.maxMinutes);
  const { data: vs, error } = await q;
  if (error) return missing(error) ? [] : null;
  let rows = (vs ?? []) as any[];
  if (f.q) { const needle = f.q.trim().toLowerCase().slice(0, 100); rows = rows.filter(v => `${v.learning_offering.title} ${v.content?.summary ?? ""} ${(v.topics ?? []).join(" ")}`.toLowerCase().includes(needle)); }
  if (!rows.length) return [];
  const ids = rows.map(v => v.id);
  const [links, provs, prices, deliverable] = await Promise.all([
    admin.from("learning_offering_version_outcome").select("version_id, competency_id, relation").in("version_id", ids),
    admin.from("learning_provider").select("id, name, kind"),
    admin.from("learning_offering_price").select("id, offering_id, currency, amount_minor, access_days, terms_version").eq("state", "approved").in("offering_id", rows.map(v => v.offering_id)),
    Promise.all(rows.map(async v => { const { data } = await admin.rpc("learning_offering_deliverable", { p_version: v.id }); return data === true; })),
  ]);
  if (links.error || provs.error) return null;
  const compIds = [...new Set((links.data ?? []).map((l: any) => l.competency_id))];
  const { data: comps } = compIds.length ? await admin.from("framework_competencies").select("id, name").in("id", compIds) : { data: [] };
  const compName = new Map<string, string>((comps ?? []).map((c: any) => [c.id, c.name]));
  const prov = new Map<string, any>((provs.data ?? []).map((p: any) => [p.id, p]));
  const items: CatalogueItem[] = [];
  rows.forEach((v, i) => {
    if (!deliverable[i]) return;
    const o = v.learning_offering;
    const b = normaliseBlueprint(v.content, o.delivery);
    const mine = (links.data ?? []).filter((l: any) => l.version_id === v.id);
    if (f.competencyId && !mine.some((l: any) => l.competency_id === f.competencyId)) return;
    if (f.certificate === true && !b.certificate.offered) return;
    const seen = new Set<string>();
    const competencies = mine.filter((l: any) => { const k = `${l.competency_id}:${l.relation}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((l: any) => ({ id: l.competency_id, name: compName.get(l.competency_id) ?? "A CFCA competency", relation: l.relation as Relation, relationLabel: RELATION_LABEL[l.relation as Relation] ?? l.relation }));
    const p = prov.get(v.delivery_provider_id), iss = prov.get(v.certificate_issuer_id), com = prov.get(v.commercial_provider_id);
    items.push({
      offeringId: o.id, code: o.code, title: o.title, summary: b.summary, source: o.source, delivery: o.delivery, offeringType: o.offering_type, versionId: v.id, versionNo: v.version_no,
      level: v.level, format: v.format, durationMinutes: v.duration_minutes, topics: v.topics ?? [], access: b.access.model,
      provider: p ? { id: p.id, name: p.name, kind: p.kind } : null, issuer: iss && b.certificate.offered ? { id: iss.id, name: iss.name } : null, commercial: com ? { id: com.id, name: com.name } : null,
      certificateOffered: b.certificate.offered, cpdHours: o.delivery === "hosted" ? cpdHours(b) : b.cpd.hours, cpdNote: b.cpd.note,
      prices: (prices.data ?? []).filter((x: any) => x.offering_id === o.id).map((x: any) => ({ id: x.id, currency: x.currency, amountMinor: Number(x.amount_minor), accessDays: x.access_days, termsVersion: x.terms_version })),
      competencies, clinicallyApproved: v.review_route === "clinical", listingApproved: v.review_route === "listing", reviewDueOn: v.review_due_on, external: b.external,
    });
  });
  return items;
}

/** One offering for one learner: the deliverable published version (learner view, no answer key), and their own state. */
export async function offeringForLearner(admin: any, userId: string, code: string): Promise<{
  item: CatalogueItem; content: Blueprint; record: any | null; access: { live: boolean; entitlementId: string | null; endsAt: string | null };
} | null> {
  if (!/^LRN-[A-Z0-9][A-Z0-9-]{2,40}$/.test(code)) return null;
  const { data: o } = await admin.from("learning_offering").select("id").eq("code", code).maybeSingle();
  if (!o) return null;
  const all = await publishedCatalogue(admin, {});
  const item = (all ?? []).find(i => i.offeringId === o.id);
  if (!item) return null;
  const { data: v } = await admin.from("learning_offering_version").select("content").eq("id", item.versionId).maybeSingle();
  const content = learnerView(normaliseBlueprint(v?.content, item.delivery as "hosted" | "external"));
  const [{ data: rec }, { data: ent }] = await Promise.all([
    admin.from("learning_record").select("id, version_id, status, completion_kind, completed_at, last_activity_key, evidence_class, access_kind, course_entitlement_id").eq("user_id", userId).eq("offering_id", o.id).order("enrolled_at", { ascending: false }).limit(1),
    admin.from("individual_live_course_entitlement").select("id, ends_at").eq("user_id", userId).eq("offering_id", o.id).limit(1),
  ]);
  const live = (ent ?? [])[0] ?? null;
  return { item, content, record: (rec ?? [])[0] ?? null, access: { live: !!live, entitlementId: live?.id ?? null, endsAt: live?.ends_at ?? null } };
}

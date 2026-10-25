/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { currencyExponent, majorToMinor } from "@/lib/commerce/gateway";
import { loadRequiredApprovals, reviewerAppointments, scopeCovers, type ReviewerScope } from "@/lib/competency/clinical-review";
import { BLUEPRINT_SCHEMA, blueprintProblems, externalTemplate, hostedTemplate, normaliseBlueprint, outcomeRows, type Blueprint } from "./blueprint";
import { LEARNING_TERMS, loadLearningPolicy } from "./policy";

// ── THE LEARNING STUDIO ── COMPETEN-LEARNING-01 S1, migrations 460, 461, 463, 464 ──────────────────────────────────
//
// Behind four separate HQ authorities (D8, 464), fixed per action by /api/hq/learning:
//   hq.learning.course.author      providers, offerings, drafts, outcome mapping, media, submission, price proposals
//   hq.learning.course.publish     publication (and, for an external listing, listing approval), retirement, policy
//   hq.learning.price.approve      price decisions (463 checks the capability and the independence again)
//   hq.learning.certificate.issue  certificate authorisation and revocation (462 checks both again)
// Clinical approval is NOT here: it is the existing 395 decision route (hq.quality.clinical.approve), on the Learning
// review page, with the trigger deciding every write.
//
// ⚠ THE CASE LIBRARY PATTERN (owner GO S1). Versions are hashed and frozen from submission by the database. Whoever
// edits a draft becomes one of its authors, so nobody who shaped a version can approve or publish it.
//
// ⚠ AN EXTERNAL LISTING IS NOT CLINICALLY ENDORSED. Its route is `listing`: publication approves the listing (accurate,
// linked, reviewed by a date) and nothing else. learning_offering_approved is false for it, and every surface says so.
//
// ⚠ THE DATABASE REFUSES, THIS MODULE EXPLAINS. It never re-implements a 460-464 rule as the only control.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const OFFERING_CODE = /^LRN-[A-Z0-9][A-Z0-9-]{2,40}$/;
export const PROVIDER_CODE = /^[A-Z0-9][A-Z0-9-]{1,40}$/;
const missing = (e: any) => /does not exist|schema cache|could not find/i.test(e?.message ?? "");
type R<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// ── Providers ─────────────────────────────────────────────────────────────────────────────────────────────

export type Provider = { id: string; code: string; name: string; kind: "competen" | "partner" | "external"; websiteUrl: string | null; status: string };

export async function listProviders(admin: any): Promise<Provider[] | null> {
  const { data, error } = await admin.from("learning_provider").select("id, code, name, kind, website_url, status").order("name").limit(500);
  if (error) return missing(error) ? [] : null;
  return (data ?? []).map((p: any) => ({ id: p.id, code: p.code, name: p.name, kind: p.kind, websiteUrl: p.website_url, status: p.status }));
}

export async function createProvider(admin: any, me: string, a: { code: string; name: string; kind: string; websiteUrl?: string | null; description?: string | null }): Promise<R<{ providerId: string }>> {
  if (!PROVIDER_CODE.test(a.code ?? "")) return { ok: false, error: "A provider code is capitals, digits and hyphens (for example COMPETEN)." };
  if (!["competen", "partner", "external"].includes(a.kind)) return { ok: false, error: "Choose whether the provider is Competen, a partner or external." };
  const name = (a.name ?? "").trim();
  if (name.length < 2 || name.length > 160) return { ok: false, error: "Give the provider its name." };
  const url = (a.websiteUrl ?? "").trim() || null;
  if (url && !/^https:\/\//.test(url)) return { ok: false, error: "A provider website is a secure (https) link." };
  const { data, error } = await admin.from("learning_provider").insert({ code: a.code, name, kind: a.kind, website_url: url, description: (a.description ?? "").trim().slice(0, 2000) || null, created_by: me }).select("id").single();
  if (error) return { ok: false, error: /duplicate|unique/i.test(error.message) ? "That provider code is taken." : missing(error) ? "Competen Learning is not available on this environment yet." : "The provider could not be saved just now." };
  return { ok: true, providerId: data.id };
}

// ── Offerings and drafts ──────────────────────────────────────────────────────────────────────────────────

export type Responsibilities = { contentOwnerId: string | null; deliveryProviderId: string | null; certificateIssuerId: string | null; commercialProviderId: string | null };
const respColumns = (r: Partial<Responsibilities>) => ({
  content_owner_id: isId(r.contentOwnerId) ? r.contentOwnerId : null, delivery_provider_id: isId(r.deliveryProviderId) ? r.deliveryProviderId : null,
  certificate_issuer_id: isId(r.certificateIssuerId) ? r.certificateIssuerId : null, commercial_provider_id: isId(r.commercialProviderId) ? r.commercialProviderId : null,
});

/** Create an offering with its first draft: a hosted course template, or an external listing template. */
export async function createOffering(admin: any, me: string, a: { code: string; title: string; source: string; delivery: string; offeringType: string; responsibilities?: Partial<Responsibilities> })
  : Promise<R<{ offeringId: string; versionId: string }>> {
  if (!OFFERING_CODE.test(a.code ?? "")) return { ok: false, error: "An offering code is LRN- then capitals, digits and hyphens." };
  const title = (a.title ?? "").trim();
  if (title.length < 2 || title.length > 200) return { ok: false, error: "Give it a title." };
  if (!["competen", "partner", "external"].includes(a.source)) return { ok: false, error: "Say whose learning this is: Competen, a partner, or an external provider." };
  const delivery = a.source === "external" ? "external" : a.delivery === "external" ? "external" : "hosted";
  const policy = await loadLearningPolicy(admin);
  if (!policy.offeringTypes.includes(a.offeringType)) return { ok: false, error: `The offering type must be one the Learning policy lists (${policy.offeringTypes.join(", ")}).` };
  const { data: o, error } = await admin.from("learning_offering").insert({ code: a.code, title, source: a.source, delivery, offering_type: a.offeringType, created_by: me }).select("id").single();
  if (error) return { ok: false, error: /duplicate|unique/i.test(error.message) ? "That offering code is taken." : missing(error) ? "Competen Learning is not available on this environment yet." : "The offering could not be created just now." };
  const content = delivery === "hosted" ? hostedTemplate(title) : externalTemplate(title);
  const { data: v, error: vErr } = await admin.from("learning_offering_version").insert({
    offering_id: o.id, version_no: 1, content, review_route: delivery === "hosted" ? "clinical" : "listing", authored_by: [me], ...respColumns(a.responsibilities ?? {}),
  }).select("id").single();
  if (vErr) { await admin.rpc("learning_offering_retire", { p_offering: o.id }); return { ok: false, error: "The draft could not be created, so the empty offering was retired." }; }
  return { ok: true, offeringId: o.id, versionId: v.id };
}

/** A new draft from the latest version. One open draft per offering. The parent's authors stay authors. */
export async function newDraft(admin: any, me: string, offeringId: string): Promise<R<{ versionId: string }>> {
  if (!isId(offeringId)) return { ok: false, error: "No such offering." };
  const { data: vs, error } = await admin.from("learning_offering_version").select("id, version_no, state, content, authored_by, review_route, risk, content_owner_id, delivery_provider_id, certificate_issuer_id, commercial_provider_id")
    .eq("offering_id", offeringId).order("version_no", { ascending: false });
  if (error || !vs?.length) return { ok: false, error: "The offering could not be read just now." };
  if (vs.some((v: any) => v.state === "draft")) return { ok: false, error: "This offering already has a draft. Finish or delete it first." };
  const b = vs[0];
  const { data: v, error: vErr } = await admin.from("learning_offering_version").insert({
    offering_id: offeringId, version_no: b.version_no + 1, content: b.content, review_route: b.review_route, risk: b.risk, authored_by: [...new Set([...(b.authored_by ?? []), me])],
    origin_kind: "revision", parent_version_id: b.id, content_owner_id: b.content_owner_id, delivery_provider_id: b.delivery_provider_id,
    certificate_issuer_id: b.certificate_issuer_id, commercial_provider_id: b.commercial_provider_id,
  }).select("id").single();
  if (vErr) return { ok: false, error: "The draft could not be created just now." };
  await syncOutcomes(admin, v.id, b.content);
  return { ok: true, versionId: v.id };
}

export async function deleteDraft(admin: any, versionId: string): Promise<R> {
  if (!isId(versionId)) return { ok: false, error: "No such draft." };
  const { data, error } = await admin.from("learning_offering_version").delete().eq("id", versionId).eq("state", "draft").select("id");
  if (error) return { ok: false, error: "The draft could not be deleted just now." };
  return data?.length ? { ok: true } : { ok: false, error: "Only an unsubmitted draft can be deleted." };
}

/** The CFCA rows follow the objectives, exactly (460 learning_offering_version_outcome). */
async function syncOutcomes(admin: any, versionId: string, content: any): Promise<boolean> {
  const want = outcomeRows({ objectives: Array.isArray(content?.objectives) ? content.objectives : [] } as Blueprint);
  const del = await admin.from("learning_offering_version_outcome").delete().eq("version_id", versionId);
  if (del.error) return false;
  if (!want.length) return true;
  const ins = await admin.from("learning_offering_version_outcome").insert(want.map(r => ({ version_id: versionId, ...r })));
  return !ins.error;
}

/**
 * Save a draft. The editor becomes an author (395 and 460 independence). Provenance stays the record's: an AI draft
 * stays marked until an author records that they checked it. Problems are reported, not hidden.
 */
export async function saveDraft(admin: any, me: string, versionId: string, a: { content: unknown; responsibilities?: Partial<Responsibilities>; risk?: string; checked?: boolean })
  : Promise<R<{ problems: string[] }>> {
  if (!isId(versionId)) return { ok: false, error: "No such draft." };
  const c = a.content as any;
  if (!c || typeof c !== "object" || Array.isArray(c) || c.schema !== BLUEPRINT_SCHEMA) return { ok: false, error: "That is not a learning-blueprint/1 document." };
  if (JSON.stringify(c).length > 600_000) return { ok: false, error: "That course is too large. Split it into modules or offerings." };
  const { data: v, error } = await admin.from("learning_offering_version").select("id, state, authored_by, content, learning_offering!inner(delivery)").eq("id", versionId).maybeSingle();
  if (error || !v) return { ok: false, error: "The draft could not be read just now." };
  if (v.state !== "draft") return { ok: false, error: "Only a draft can be edited. Start a new draft from this version." };
  const delivery = v.learning_offering.delivery as "hosted" | "external";
  const b = normaliseBlueprint(c, delivery);
  // Provenance is the record's: an editor cannot relabel an AI draft as their own writing, only record that they checked it.
  const stored = v.content?.provenance?.kind === "ai_draft" ? "ai_draft" : "educator";
  const kind = stored === "ai_draft" && a.checked !== true ? "ai_draft" : "educator";
  b.provenance = { ...b.provenance, kind, note: stored === "ai_draft" && kind === "educator" ? `AI draft checked by an educator on ${new Date().toISOString().slice(0, 10)}` : b.provenance.note };
  const { error: uErr } = await admin.from("learning_offering_version").update({
    content: b, authored_by: [...new Set([...(v.authored_by ?? []), me])], risk: a.risk === "high" ? "high" : "standard",
    ...(a.responsibilities ? respColumns(a.responsibilities) : {}),
  }).eq("id", versionId).eq("state", "draft");
  if (uErr) return { ok: false, error: "The draft could not be saved just now." };
  await syncOutcomes(admin, versionId, b);
  const policy = await loadLearningPolicy(admin);
  return { ok: true, problems: [...blueprintProblems(b, delivery, policy), ...(await outcomeReferenceProblems(admin, b))] };
}

/** Every outcome a version names must be a recorded outcome of a competency of a SHARED framework. Fails closed. */
export async function outcomeReferenceProblems(admin: any, b: Pick<Blueprint, "objectives">): Promise<string[]> {
  const refs = b.objectives.flatMap(o => o.outcomeRefs.map(r => ({ o: o.id, ...r })));
  if (!refs.length) return [];
  const { data, error } = await admin.from("framework_competencies").select("id, learning_outcomes, framework_domains!inner(frameworks!inner(hospital_id))").in("id", [...new Set(refs.map(r => r.competencyId))]);
  if (error) return ["CFCA: the competencies could not be read just now, so the mapping was not checked"];
  const known = new Map<string, any>((data ?? []).map((c: any) => [c.id, c]));
  const p: string[] = [];
  for (const r of refs) {
    const c = known.get(r.competencyId);
    if (!c) p.push(`Objective ${r.o}: a competency that is not in the catalogue.`);
    else if (c.framework_domains?.frameworks?.hospital_id) p.push(`Objective ${r.o}: only competencies of shared frameworks are used.`);
    else if (r.index >= 0 && !(r.index < (Array.isArray(c.learning_outcomes) ? c.learning_outcomes.length : 0))) p.push(`Objective ${r.o}: a learning outcome its competency does not record.`);
  }
  return p;
}

/** Submit: complete, mapped (clinical route), with both responsibilities named, put forward by one of its authors. */
export async function submitVersion(admin: any, me: string, versionId: string): Promise<R<{ reviewVersionId: string | null; required: number | null }> | { ok: false; error: string; problems: string[] }> {
  if (!isId(versionId)) return { ok: false, error: "No such draft." };
  const { data: v, error } = await admin.from("learning_offering_version").select("id, state, authored_by, content, risk, review_route, content_owner_id, delivery_provider_id, certificate_issuer_id, learning_offering!inner(delivery)").eq("id", versionId).maybeSingle();
  if (error || !v) return { ok: false, error: "The draft could not be read just now." };
  if (v.state !== "draft") return { ok: false, error: "This version is already submitted." };
  if (!(v.authored_by ?? []).includes(me)) return { ok: false, error: "Only one of the draft's authors can submit it. Save a change to it first." };
  const delivery = v.learning_offering.delivery as "hosted" | "external";
  const b = normaliseBlueprint(v.content, delivery);
  const policy = await loadLearningPolicy(admin);
  const problems = [...blueprintProblems(b, delivery, policy), ...(await outcomeReferenceProblems(admin, b))];
  if (!v.content_owner_id || !v.delivery_provider_id) problems.push("Name the content owner and the delivery provider.");
  if (b.certificate.offered && !v.certificate_issuer_id) problems.push("A course that offers a certificate names its certificate issuer.");
  if (problems.length) return { ok: false, error: "It is not ready to go forward.", problems };
  const required = v.review_route === "clinical" ? (await loadRequiredApprovals(admin))[v.risk === "high" ? "high" : "standard"] : 1;
  const { data: ccv, error: sErr } = await admin.rpc("learning_offering_submit", { p_version: versionId, p_submitter: me, p_required: required });
  if (sErr) return { ok: false, error: /competencies/i.test(sErr.message) ? "Map the learning to its CFCA competencies first." : /https/i.test(sErr.message) ? "An external listing needs its secure (https) link." : /content owner/i.test(sErr.message) ? "Name the content owner and the delivery provider." : "It could not be submitted just now." };
  return { ok: true, reviewVersionId: (ccv as string | null) ?? null, required: v.review_route === "clinical" ? required : null };
}

/** Publish (and for a listing, approve the listing). A separate act by someone who wrote nothing of the version. */
export async function publishVersion(admin: any, me: string, versionId: string): Promise<R> {
  if (!isId(versionId)) return { ok: false, error: "No such version." };
  const { error } = await admin.rpc("learning_offering_publish", { p_version: versionId, p_publisher: me });
  if (!error) return { ok: true };
  const m = error.message ?? "";
  return { ok: false, error: /not independent/i.test(m) ? "You wrote or edited this version, so someone else must publish it." : /not clinically approved/i.test(m) ? "This exact version is not clinically approved yet." : /retired/i.test(m) ? "The offering is retired." : /only a submitted/i.test(m) ? "Only a submitted version can be published." : "It could not be published just now." };
}

export async function retireOffering(admin: any, offeringId: string): Promise<R> {
  if (!isId(offeringId)) return { ok: false, error: "No such offering." };
  const { error } = await admin.rpc("learning_offering_retire", { p_offering: offeringId });
  return error ? { ok: false, error: "It could not be retired just now." } : { ok: true };
}

// ── Media (lesson files, written once, never overwritten) ─────────────────────────────────────────────────

export const MEDIA_BUCKET = "learning-content";
export const MEDIA_MIME = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;

/** Pure: the stored path for an upload to one draft: <version id>/<random>-<safe name>. Matches blueprintProblems. */
export function mediaPath(versionId: string, fileName: string, rand: string): string {
  const safe = (fileName || "file").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "file";
  return `${versionId.toLowerCase()}/${rand.slice(0, 12)}-${safe}`;
}

export async function uploadMedia(admin: any, me: string, versionId: string, file: File): Promise<R<{ mediaPath: string }>> {
  if (!isId(versionId)) return { ok: false, error: "No such draft." };
  if (!(MEDIA_MIME as readonly string[]).includes(file.type)) return { ok: false, error: "Upload a PDF, PNG, JPEG or WebP file. A video is added as a secure link." };
  if (file.size <= 0 || file.size > MEDIA_MAX_BYTES) return { ok: false, error: "The file must be between 1 byte and 20 MB." };
  const { data: v } = await admin.from("learning_offering_version").select("state, authored_by").eq("id", versionId).maybeSingle();
  if (!v || v.state !== "draft") return { ok: false, error: "Files are added to a draft only." };
  const path = mediaPath(versionId, file.name, randomUUID().replace(/-/g, ""));
  const { error } = await admin.storage.from(MEDIA_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: "The file could not be stored just now." };
  void me;
  return { ok: true, mediaPath: path };
}

// ── Prices (proposal by an author, decision by a different price approver) ────────────────────────────────

export type PriceView = { id: string; offeringId: string; currency: string; amountMinor: number; accessDays: number | null; termsVersion: string; operatingEntity: string; state: string; proposedBy: string; proposedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; proposalNote: string | null };
const priceView = (p: any): PriceView => ({ id: p.id, offeringId: p.offering_id, currency: p.currency, amountMinor: Number(p.amount_minor), accessDays: p.access_days, termsVersion: p.terms_version,
  operatingEntity: p.operating_entity, state: p.state, proposedBy: p.proposed_by, proposedAt: p.proposed_at, decidedBy: p.decided_by, decidedAt: p.decided_at, decisionNote: p.decision_note, proposalNote: p.proposal_note });

/** Pure: a proposal body, checked as 463 checks it. The amount is in major units, converted by the gateway's table. */
export function validatePrice(a: { currency: unknown; amountMajor: unknown; accessDays: unknown }): { ok: true; currency: string; amountMinor: number; accessDays: number | null } | { ok: false; error: string } {
  const currency = typeof a.currency === "string" ? a.currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currency) || currencyExponent(currency) === null) return { ok: false, error: "Choose a currency the payment provider supports." };
  const major = Number(a.amountMajor);
  const minor = Number.isFinite(major) && major > 0 ? majorToMinor(major, currency) : null;
  if (minor === null || minor <= 0) return { ok: false, error: `Enter a price above zero, in whole ${currency} units the currency allows.` };
  // A price finer than the currency's smallest unit is refused, never silently rounded into another price (as plans.ts).
  if (Math.abs(major * 10 ** (currencyExponent(currency) ?? 0) - minor) > 1e-6) return { ok: false, error: `A ${currency} price cannot be divided that finely.` };
  const days = a.accessDays === null || a.accessDays === "" || a.accessDays === undefined ? null : Number(a.accessDays);
  if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 3660)) return { ok: false, error: "Access is 1 to 3660 days, or blank for as long as the terms allow." };
  return { ok: true, currency, amountMinor: minor, accessDays: days };
}

export async function proposePrice(admin: any, me: string, a: { offeringId: string; currency: unknown; amountMajor: unknown; accessDays: unknown; note?: string }): Promise<R<{ priceId: string }>> {
  if (!isId(a.offeringId)) return { ok: false, error: "No such offering." };
  const v = validatePrice(a);
  if (!v.ok) return v;
  const { data: o } = await admin.from("learning_offering").select("id, delivery, status").eq("id", a.offeringId).maybeSingle();
  if (!o || o.status !== "active") return { ok: false, error: "Prices are proposed for active offerings only." };
  if (o.delivery !== "hosted") return { ok: false, error: "An external provider takes its own payment. Record the fee in the listing instead." };
  const policy = await loadLearningPolicy(admin);
  if (!LEARNING_TERMS[policy.termsVersion]) return { ok: false, error: "The purchase terms in the Learning policy are not recognised." };
  const { data, error } = await admin.from("learning_offering_price").insert({
    offering_id: a.offeringId, currency: v.currency, amount_minor: v.amountMinor, access_days: v.accessDays, terms_version: policy.termsVersion,
    proposed_by: me, proposal_note: (a.note ?? "").trim().slice(0, 1000) || null,
  }).select("id").single();
  if (error) return { ok: false, error: missing(error) ? "Course pricing is not available on this environment yet (migration 463)." : "The price could not be proposed just now." };
  return { ok: true, priceId: data.id };
}

export async function decidePrice(admin: any, me: string, priceId: string, approve: boolean, note: string | null): Promise<R> {
  if (!isId(priceId)) return { ok: false, error: "No such price." };
  if (!approve && (note ?? "").trim().length < 3) return { ok: false, error: "Say why the price is rejected." };
  const { error } = await admin.rpc("learning_offering_price_decide", { p_price: priceId, p_decider: me, p_approve: approve, p_note: note });
  if (!error) return { ok: true };
  const m = error.message ?? "";
  return { ok: false, error: /not independent/i.test(m) ? "You proposed this price, so someone else must decide it." : /not authorised/i.test(m) ? "You do not hold an active Learning Price Approver appointment." : /only a proposal/i.test(m) ? "This price is already decided." : "The decision could not be recorded just now." };
}

export async function retirePrice(admin: any, priceId: string): Promise<R> {
  if (!isId(priceId)) return { ok: false, error: "No such price." };
  const { error } = await admin.rpc("learning_offering_price_retire", { p_price: priceId });
  return error ? { ok: false, error: /only an approved/i.test(error.message) ? "Only an approved price is retired. A proposal is decided." : "The price could not be retired just now." } : { ok: true };
}

export async function listPrices(admin: any, f: { offeringId?: string; state?: string } = {}): Promise<PriceView[] | null> {
  let q = admin.from("learning_offering_price").select("*").order("proposed_at", { ascending: false }).limit(500);
  if (f.offeringId && isId(f.offeringId)) q = q.eq("offering_id", f.offeringId);
  if (f.state) q = q.eq("state", f.state);
  const { data, error } = await q;
  if (error) return missing(error) ? [] : null;
  return (data ?? []).map(priceView);
}

// ── Certificate authority (per version, by an independent holder of hq.learning.certificate.issue) ─────────

export async function authoriseCertificates(admin: any, me: string, versionId: string, outcomes: unknown, note: string | null): Promise<R<{ authorisationId: string }>> {
  if (!isId(versionId)) return { ok: false, error: "No such version." };
  const outs = Array.isArray(outcomes) ? [...new Set(outcomes.filter((o): o is string => o === "course_completion" || o === "assessed_knowledge"))] : [];
  if (!outs.length) return { ok: false, error: "Choose what certificates of this version may state: course completion, assessed knowledge, or both." };
  const { data: v } = await admin.from("learning_offering_version").select("certificate_issuer_id").eq("id", versionId).maybeSingle();
  if (!v?.certificate_issuer_id) return { ok: false, error: "This version names no certificate issuer." };
  const { data, error } = await admin.from("learning_certificate_authorisation").insert({ version_id: versionId, issuer_provider_id: v.certificate_issuer_id, outcomes: outs, authorised_by: me, note: (note ?? "").trim().slice(0, 1000) || null }).select("id").single();
  if (!error) return { ok: true, authorisationId: data.id };
  const m = error.message ?? "";
  return { ok: false, error: /not independent/i.test(m) ? "You wrote or submitted this version, so someone else must authorise its certificates." : /not authorised/i.test(m) ? "You do not hold an active Learning Certificate Issuer appointment."
    : /already has a live/i.test(m) ? "This version is already authorised. Withdraw that first." : /does not offer/i.test(m) ? "This version does not offer a certificate." : /submitted or published/i.test(m) ? "Only a submitted or published version is authorised." : "The authorisation could not be recorded just now." };
}

export async function withdrawCertificateAuthorisation(admin: any, me: string, authorisationId: string): Promise<R> {
  if (!isId(authorisationId)) return { ok: false, error: "No such authorisation." };
  const { data, error } = await admin.from("learning_certificate_authorisation").update({ withdrawn_at: new Date().toISOString(), withdrawn_by: me }).eq("id", authorisationId).is("withdrawn_at", null).select("id");
  if (error) return { ok: false, error: "It could not be withdrawn just now." };
  return data?.length ? { ok: true } : { ok: false, error: "That authorisation is already withdrawn." };
}

export async function revokeCertificate(admin: any, me: string, certificateId: string, reason: string): Promise<R> {
  if (!isId(certificateId)) return { ok: false, error: "No such certificate." };
  const why = (reason ?? "").trim();
  if (why.length < 3 || why.length > 500) return { ok: false, error: "Say why the certificate is revoked." };
  const { data, error } = await admin.from("learning_certificate").update({ revoked_at: new Date().toISOString(), revoked_by: me, revoked_reason: why }).eq("id", certificateId).is("revoked_at", null).select("id");
  if (error) return { ok: false, error: "It could not be revoked just now." };
  return data?.length ? { ok: true } : { ok: false, error: "That certificate is already revoked." };
}

// ── Reading ───────────────────────────────────────────────────────────────────────────────────────────────

export type OfferingRow = { id: string; code: string; title: string; source: string; delivery: string; offeringType: string; status: string; latest: { id: string; versionNo: number; state: string } | null; published: string | null };

export async function listOfferings(admin: any): Promise<OfferingRow[] | null> {
  const { data: os, error } = await admin.from("learning_offering").select("id, code, title, source, delivery, offering_type, status, updated_at").order("updated_at", { ascending: false }).limit(500);
  if (error) return missing(error) ? [] : null;
  if (!os?.length) return [];
  const { data: vs, error: vErr } = await admin.from("learning_offering_version").select("id, offering_id, version_no, state").in("offering_id", os.map((o: any) => o.id));
  if (vErr) return null;
  return os.map((o: any) => {
    const mine = (vs ?? []).filter((v: any) => v.offering_id === o.id).sort((a: any, b: any) => b.version_no - a.version_no);
    return { id: o.id, code: o.code, title: o.title, source: o.source, delivery: o.delivery, offeringType: o.offering_type, status: o.status,
      latest: mine[0] ? { id: mine[0].id, versionNo: mine[0].version_no, state: mine[0].state } : null, published: mine.find((v: any) => v.state === "published")?.id ?? null };
  });
}

export type ReviewState = "draft" | "in_review" | "changes_requested" | "approved" | "listing_pending" | "published" | "superseded" | "retired";
/** Pure: a version's state in words -- never "approved" unless the 395 record says so, and never for a listing. */
export function versionState(state: string, route: string, decisions: { decision: string }[], required: number | null): ReviewState {
  if (state === "draft" || state === "published" || state === "superseded" || state === "retired") return state as ReviewState;
  if (route === "listing") return "listing_pending";
  if (decisions.some(d => d.decision === "rejected")) return "changes_requested";
  return required !== null && decisions.filter(d => d.decision === "approved").length >= required ? "approved" : "in_review";
}

export type VersionView = { id: string; versionNo: number; state: string; review: ReviewState; route: string; approvals: number; required: number | null; authors: string[]; risk: string;
  submittedAt: string | null; publishedAt: string | null; publishedBy: string | null; content: Blueprint; responsibilities: Responsibilities; comments: { decision: string; comment: string | null; at: string }[];
  certificate: { id: string; outcomes: string[]; authorisedBy: string; authorisedAt: string; withdrawnAt: string | null }[] };

export async function offeringDetail(admin: any, offeringId: string): Promise<{ offering: any; versions: VersionView[]; prices: PriceView[]; audit: { at: string; actor: string | null; action: string }[] } | null> {
  if (!isId(offeringId)) return null;
  const { data: o, error } = await admin.from("learning_offering").select("id, code, title, source, delivery, offering_type, status").eq("id", offeringId).maybeSingle();
  if (error || !o) return null;
  const { data: vs, error: vErr } = await admin.from("learning_offering_version").select("*").eq("offering_id", offeringId).order("version_no", { ascending: false });
  if (vErr) return null;
  const ids = (vs ?? []).map((v: any) => v.id);
  const [ccv, auths, prices, audit] = await Promise.all([
    ids.length ? admin.from("clinical_content_version").select("id, learning_version_id, required_approvals").in("learning_version_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? admin.from("learning_certificate_authorisation").select("id, version_id, outcomes, authorised_by, authorised_at, withdrawn_at").in("version_id", ids) : Promise.resolve({ data: [] }),
    listPrices(admin, { offeringId }),
    admin.from("audit_log").select("created_at, actor_name, action").in("entity_id", [offeringId, ...ids]).order("created_at", { ascending: false }).limit(200),
  ]);
  const { data: ds } = ccv.data?.length ? await admin.from("clinical_review_decision").select("version_id, decision, comment, created_at").in("version_id", ccv.data.map((x: any) => x.id)) : { data: [] };
  const versions: VersionView[] = (vs ?? []).map((v: any) => {
    const review = (ccv.data ?? []).filter((x: any) => x.learning_version_id === v.id);
    const decisions = (ds ?? []).filter((d: any) => review.some((r: any) => r.id === d.version_id));
    const required = review[0]?.required_approvals ?? null;
    return { id: v.id, versionNo: v.version_no, state: v.state, review: versionState(v.state, v.review_route, decisions, required), route: v.review_route,
      approvals: decisions.filter((d: any) => d.decision === "approved").length, required, authors: v.authored_by ?? [], risk: v.risk, submittedAt: v.submitted_at, publishedAt: v.published_at, publishedBy: v.published_by,
      content: normaliseBlueprint(v.content, o.delivery), responsibilities: { contentOwnerId: v.content_owner_id, deliveryProviderId: v.delivery_provider_id, certificateIssuerId: v.certificate_issuer_id, commercialProviderId: v.commercial_provider_id },
      comments: decisions.map((d: any) => ({ decision: d.decision, comment: d.comment, at: d.created_at })),
      certificate: (auths.data ?? []).filter((x: any) => x.version_id === v.id).map((x: any) => ({ id: x.id, outcomes: x.outcomes, authorisedBy: x.authorised_by, authorisedAt: x.authorised_at, withdrawnAt: x.withdrawn_at })) };
  });
  return { offering: o, versions, prices: prices ?? [], audit: (audit.data ?? []).map((a: any) => ({ at: a.created_at, actor: a.actor_name, action: a.action })) };
}

/** The publisher's queue: submitted versions, with whether each may be published now. */
export async function publicationQueue(admin: any): Promise<{ versionId: string; offeringId: string; code: string; title: string; route: string; delivery: string; versionNo: number; submittedAt: string; ready: boolean; authors: string[] }[] | null> {
  const { data: vs, error } = await admin.from("learning_offering_version").select("id, offering_id, version_no, review_route, submitted_at, authored_by, learning_offering!inner(code, title, delivery, status)").eq("state", "submitted").order("submitted_at").limit(200);
  if (error) return missing(error) ? [] : null;
  const out = [];
  for (const v of vs ?? []) {
    let ready = v.review_route === "listing";
    if (!ready) { const { data } = await admin.rpc("learning_offering_approved", { p_version: v.id }); ready = data === true; }
    out.push({ versionId: v.id, offeringId: v.offering_id, code: v.learning_offering.code, title: v.learning_offering.title, route: v.review_route, delivery: v.learning_offering.delivery, versionNo: v.version_no, submittedAt: v.submitted_at, ready, authors: v.authored_by ?? [] });
  }
  return out;
}

/**
 * The clinical reviewer's Learning queue: kind-learning 395 versions this reviewer may decide now -- independent, still
 * current, not decided by them, and covered for EVERY competency by one of their appointments (the 461 rule). A
 * convenience: the trigger decides every write, through the existing /api/hq/clinical-review route.
 */
export async function learningReviewQueue(admin: any, reviewerId: string): Promise<{ appointments: { id: string; scopes: ReviewerScope[] }[]; items: { reviewVersionId: string; versionId: string; title: string; required: number; approvals: number; appointmentId: string; submittedAt: string; content: Blueprint; competencies: string[] }[] } | null> {
  const appointments = await reviewerAppointments(admin, reviewerId);
  if (appointments === null) return null;
  if (!appointments.some(a => a.scopes.length)) return { appointments, items: [] };
  const { data: ccv, error } = await admin.from("clinical_content_version").select("id, learning_version_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, created_at").eq("content_kind", "learning").order("created_at", { ascending: false }).limit(200);
  if (error) return missing(error) ? { appointments, items: [] } : null;
  const mine = (ccv ?? []).filter((v: any) => v.submitted_by !== reviewerId && !(v.authored_by ?? []).includes(reviewerId));
  if (!mine.length) return { appointments, items: [] };
  const vids = mine.map((v: any) => v.learning_version_id);
  const [{ data: ds }, { data: lvs }, { data: links }] = await Promise.all([
    admin.from("clinical_review_decision").select("version_id, reviewer_id, decision").in("version_id", mine.map((v: any) => v.id)),
    admin.from("learning_offering_version").select("id, content_hash, state, learning_offering!inner(delivery)").in("id", vids),
    admin.from("learning_offering_version_outcome").select("version_id, competency_id").in("version_id", vids),
  ]);
  const compIds = [...new Set((links ?? []).map((l: any) => l.competency_id))];
  const { data: comps } = compIds.length ? await admin.from("framework_competencies").select("id, name, domain_id, framework_domains!inner(id, framework_id, frameworks!inner(id, profession_term_id, specialty_term_id))").in("id", compIds) : { data: [] };
  const comp = new Map<string, any>((comps ?? []).map((c: any) => [c.id, c]));
  const lv = new Map<string, any>((lvs ?? []).map((x: any) => [x.id, x]));
  const items = [];
  for (const v of mine) {
    const d = (ds ?? []).filter((x: any) => x.version_id === v.id);
    if (d.some((x: any) => x.decision === "rejected" || x.reviewer_id === reviewerId)) continue;
    const approvals = d.filter((x: any) => x.decision === "approved").length;
    const cur = lv.get(v.learning_version_id);
    if (approvals >= v.required_approvals || !cur || cur.state !== "submitted" || cur.content_hash !== v.content_hash) continue;
    const taught = (links ?? []).filter((l: any) => l.version_id === v.learning_version_id).map((l: any) => comp.get(l.competency_id)).filter(Boolean);
    if (!taught.length) continue;
    const covering = appointments.find(a => taught.every((c: any) => { const dom = c.framework_domains, fw = dom?.frameworks;
      return !!dom && !!fw && scopeCovers(a.scopes, { domainId: dom.id, frameworkId: fw.id, professionTermId: fw.profession_term_id, specialtyTermId: fw.specialty_term_id }); }));
    if (!covering) continue;
    const content = normaliseBlueprint(v.content_snapshot, cur.learning_offering.delivery);
    items.push({ reviewVersionId: v.id, versionId: v.learning_version_id, title: content.title || "Learning", required: v.required_approvals, approvals, appointmentId: covering.id, submittedAt: v.created_at, content, competencies: taught.map((c: any) => c.name) });
  }
  return { appointments, items };
}

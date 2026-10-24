/* eslint-disable @typescript-eslint/no-explicit-any */
import { REVIEWER_POSITION, reviewerAppointments, scopeCovers, type ReviewerScope, type ScopeKind } from "./clinical-review";

// ── CLINICAL REVIEW: WHAT THE HQ PAGES READ ── migration 395 ──────────────────────────────────────────────
//
// The reviewer's queue and the governance view. Shared content only. The queue is a CONVENIENCE: it lists what
// a reviewer may act on by the same rules the 395 trigger enforces (independent, in scope, current), and the
// trigger still decides every write.

export type QueueItem = {
  versionId: string; competencyId: string; title: string; home: string; domain: string;
  snapshot: { description: string | null; outcomes: string[]; skills: string[]; risk: string | null };
  required: number; approvals: number; risk: string | null; submittedAt: string; appointmentId: string;
};

const rows = async (p: PromiseLike<any>) => { try { const r = await p; return r?.error ? null : (r?.data ?? []); } catch { return null; } };

/** What this reviewer may decide now. null = could not be read. */
export async function reviewQueue(admin: any, reviewerId: string): Promise<{ appointments: { id: string; scopes: ReviewerScope[] }[]; items: QueueItem[] } | null> {
  const appointments = await reviewerAppointments(admin, reviewerId);
  if (appointments === null) return null;
  if (!appointments.some(a => a.scopes.length)) return { appointments, items: [] };
  const versions = await rows(admin.from("clinical_content_version").select("id, competency_id, content_hash, content_snapshot, authored_by, submitted_by, required_approvals, risk_basis, created_at")
    .order("created_at", { ascending: false }).limit(300));
  if (versions === null) return null;
  const open = versions.filter((v: any) => v.submitted_by !== reviewerId && !(v.authored_by ?? []).includes(reviewerId));
  if (!open.length) return { appointments, items: [] };
  const compIds = [...new Set(open.map((v: any) => v.competency_id))] as string[];
  const [decisions, hashes, comps] = await Promise.all([
    rows(admin.from("clinical_review_decision").select("version_id, reviewer_id, decision").in("version_id", open.map((v: any) => v.id))),
    (async () => { const r = await admin.rpc("competency_content_hashes", { p_ids: compIds }); return r.error ? null : r.data ?? []; })(),
    rows(admin.from("framework_competencies").select("id, name, domain_id").in("id", compIds)),
  ]);
  if (decisions === null || hashes === null || comps === null) return null;
  const doms = await rows(admin.from("framework_domains").select("id, name, framework_id").in("id", [...new Set(comps.map((c: any) => c.domain_id))]));
  if (doms === null) return null;
  const fws = await rows(admin.from("frameworks").select("id, name, profession_term_id, specialty_term_id").in("id", [...new Set(doms.map((d: any) => d.framework_id))]).is("hospital_id", null));
  if (fws === null) return null;
  const hash = new Map<string, string>(hashes.map((h: any) => [h.competency_id, h.content_hash]));
  const comp = new Map<string, any>(comps.map((c: any) => [c.id, c])), dom = new Map<string, any>(doms.map((d: any) => [d.id, d])), fw = new Map<string, any>(fws.map((f: any) => [f.id, f]));
  const items: QueueItem[] = [];
  for (const v of open) {
    const ds = decisions.filter((d: any) => d.version_id === v.id);
    if (ds.some((d: any) => d.decision === "rejected" || d.reviewer_id === reviewerId)) continue;
    const approvals = ds.filter((d: any) => d.decision === "approved").length;
    if (approvals >= v.required_approvals || hash.get(v.competency_id) !== v.content_hash) continue;
    const c = comp.get(v.competency_id), d = c ? dom.get(c.domain_id) : null, f = d ? fw.get(d.framework_id) : null;
    if (!c || !d || !f) continue;
    const covering = appointments.find(a => scopeCovers(a.scopes, { domainId: d.id, frameworkId: f.id, professionTermId: f.profession_term_id, specialtyTermId: f.specialty_term_id }));
    if (!covering) continue;
    const s = v.content_snapshot ?? {};
    items.push({
      versionId: v.id, competencyId: c.id, title: s.name ?? c.name, home: f.name, domain: d.name, required: v.required_approvals, approvals,
      risk: v.risk_basis ?? null, submittedAt: v.created_at, appointmentId: covering.id,
      snapshot: { description: s.description ?? null, outcomes: Array.isArray(s.learning_outcomes) ? s.learning_outcomes : [], skills: Array.isArray(s.skills) ? s.skills : [], risk: s.risk_category ?? null },
    });
  }
  return { appointments, items };
}

export type ReviewerView = { appointmentId: string; personId: string | null; name: string; scopes: (ReviewerScope & { label: string })[] };
export type ScopeOption = { kind: ScopeKind; ref: string; label: string };

/** Every active clinical reviewer appointment, with its scopes, and what a scope may name. */
export async function governanceView(admin: any): Promise<{ reviewers: ReviewerView[]; options: ScopeOption[]; frameworks: { id: string; name: string; specialtyTermId: string | null }[]; specialties: { id: string; value: string }[] } | null> {
  const [appts, terms, fws] = await Promise.all([
    rows(admin.from("ogs_office_appointments").select("id, person_id, person_name").eq("role", REVIEWER_POSITION).eq("status", "active").limit(500)),
    rows(admin.from("taxonomy_terms").select("id, value, taxonomies!inner(kind)").in("taxonomies.kind", ["profession", "specialty"]).order("value").limit(1000)),
    rows(admin.from("frameworks").select("id, name, specialty_term_id").is("hospital_id", null).order("name").limit(500)),
  ]);
  if (appts === null || terms === null || fws === null) return null;
  const doms = fws.length ? await rows(admin.from("framework_domains").select("id, name, framework_id").in("framework_id", fws.map((f: any) => f.id)).order("name").limit(3000)) : [];
  if (doms === null) return null;
  const scopes = appts.length ? await rows(admin.from("clinical_reviewer_scope").select("id, appointment_id, scope_kind, scope_ref").in("appointment_id", appts.map((a: any) => a.id)).is("ended_at", null)) : [];
  if (scopes === null) return null;
  const people = appts.length ? await rows(admin.from("profiles").select("id, full_name").in("id", appts.map((a: any) => a.person_id).filter(Boolean))) : [];
  if (people === null) return null;
  const fwName = new Map<string, string>(fws.map((f: any) => [f.id, f.name]));
  const options: ScopeOption[] = [
    ...terms.map((t: any) => ({ kind: t.taxonomies.kind as ScopeKind, ref: t.id, label: `${t.taxonomies.kind === "profession" ? "Profession" : "Specialty"}: ${t.value}` })),
    ...fws.map((f: any) => ({ kind: "framework" as const, ref: f.id, label: `Framework: ${f.name}` })),
    ...doms.map((d: any) => ({ kind: "domain" as const, ref: d.id, label: `Domain: ${fwName.get(d.framework_id) ?? "?"} > ${d.name}` })),
  ];
  const label = new Map(options.map(o => [`${o.kind}:${o.ref}`, o.label]));
  const name = new Map<string, string>(people.map((p: any) => [p.id, p.full_name]));
  return {
    reviewers: appts.map((a: any) => ({
      appointmentId: a.id, personId: a.person_id, name: name.get(a.person_id) ?? a.person_name ?? "Unnamed appointment",
      scopes: scopes.filter((s: any) => s.appointment_id === a.id).map((s: any) => ({ id: s.id, appointmentId: a.id, kind: s.scope_kind, ref: s.scope_ref, label: label.get(`${s.scope_kind}:${s.scope_ref}`) ?? `${s.scope_kind} (no longer listed)` })),
    })),
    options,
    frameworks: fws.map((f: any) => ({ id: f.id, name: f.name, specialtyTermId: f.specialty_term_id ?? null })),
    specialties: terms.filter((t: any) => t.taxonomies.kind === "specialty").map((t: any) => ({ id: t.id, value: t.value })),
  };
}

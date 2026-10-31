/* eslint-disable @typescript-eslint/no-explicit-any */
import { approverPositions, carryingApproval, reviewerAppointments, scopeCovers, type ReviewerScope, type ScopeKind } from "./clinical-review";

// ── CLINICAL REVIEW: WHAT THE HQ PAGES READ ── migration 395 ──────────────────────────────────────────────
//
// The reviewer's queue and the governance view. Shared content only. The queue is a CONVENIENCE: it lists what
// a reviewer may act on by the same rules the 395 trigger enforces (independent, in scope, current), and the
// trigger still decides every write.

export type QueueItem = {
  versionId: string; competencyId: string; title: string; home: string; domain: string;
  snapshot: { description: string | null; outcomes: string[]; skills: string[]; risk: string | null };
  required: number; approvals: number; risk: string | null; submittedAt: string; appointmentId: string;
  /** Migration 422: a clinical case version, reviewed through the same process. Its content is the exact version. */
  kind: "competency" | "case" | "method"; caseContent?: any;
  /** Migration 690: an assessment method version, reviewed through the same process. Its content is the exact draft
   *  (`{ method, version_no, content }`), with `applies` naming what its applicability resolves to. */
  methodContent?: any;
  /** CFCA-STUDIO-P1 (670): the criteria by component. Live rows, shown only for a CURRENT version (its hash, which
   *  covers each criterion and its component, still matches), so they are exactly what is being approved. */
  criteria?: { component: string | null; text: string; sourceRef: string | null }[];
  /** FDS-02 S5 (770): the version is the content PROPOSED in an open revision draft of a published framework (isNew: a
   *  competency the revision adds). Its criteria are the revision's. Learners still read the published content. */
  revision?: { id: string; isNew: boolean };
};

const rows = async (p: PromiseLike<any>) => { try { const r = await p; return r?.error ? null : (r?.data ?? []); } catch { return null; } };

/** What this reviewer may decide now. null = could not be read. */
export async function reviewQueue(admin: any, reviewerId: string): Promise<{ appointments: { id: string; scopes: ReviewerScope[] }[]; items: QueueItem[] } | null> {
  const appointments = await reviewerAppointments(admin, reviewerId);
  if (appointments === null) return null;
  if (!appointments.some(a => a.scopes.length)) return { appointments, items: [] };
  const versions = await rows(admin.from("clinical_content_version").select("*")
    .order("created_at", { ascending: false }).limit(300));
  if (versions === null) return null;
  // Migration 640: independence covers every version of a competency, so a resubmission naming somebody else is
  // still not this reviewer's to decide. The trigger refuses it either way. This keeps it out of the queue.
  const mine = (v: any) => v.submitted_by === reviewerId || (v.authored_by ?? []).includes(reviewerId);
  // 770: a version of a NEW competency of a revision names it by proposed_competency_id until it is published.
  const subject = (v: any): string | null => v.competency_id ?? v.proposed_competency_id ?? null;
  const ownCompetencies = new Set(versions.filter((v: any) => subject(v) && mine(v)).map((v: any) => subject(v)));
  const independent = versions.filter((v: any) => !mine(v) && !(subject(v) && ownCompetencies.has(subject(v))));
  // Migration 422: a case version has no competency_id. The competency path reads competency versions only, so one
  // case in review never makes the whole queue unreadable. Cases are listed below, by their own rule.
  const open = independent.filter((v: any) => subject(v));
  const cases = independent.filter((v: any) => !v.competency_id && v.case_version_id);
  // Migration 690: a method version has neither. Independence covers EVERY version of the same method (author, editor or
  // submitter of any), so the method rows are read first. They are read apart: an unreadable method row costs only the
  // method items, never the competencies and cases beside them.
  const methods = await methodCandidates(admin, reviewerId, versions, mine);
  if (!open.length && !cases.length && !methods.length) return { appointments, items: [] };
  const compIds = [...new Set(open.map((v: any) => subject(v)))] as string[];
  const caseVersionIds = cases.map((v: any) => v.case_version_id);
  const [decisions, hashes, caseRows, links] = await Promise.all([
    rows(admin.from("clinical_review_decision").select("version_id, reviewer_id, decision").in("version_id", [...open, ...cases, ...methods.map(m => m.v)].map((v: any) => v.id))),
    compIds.length ? (async () => { const r = await admin.rpc("competency_content_hashes", { p_ids: compIds }); return r.error ? null : r.data ?? []; })() : Promise.resolve([]),
    caseVersionIds.length ? rows(admin.from("case_library_version").select("id, content_hash, state").in("id", caseVersionIds)) : Promise.resolve([]),
    caseVersionIds.length ? rows(admin.from("case_library_version_competency").select("version_id, competency_id").in("version_id", caseVersionIds)) : Promise.resolve([]),
  ]);
  if (decisions === null || hashes === null || caseRows === null || links === null) return null;
  // 770: what open revision drafts propose for these competencies (none before 770, or when unreadable: then a revision
  // version is simply not listed, never shown as current).
  const proposals: any[] = compIds.length ? await (async () => { try { const r = await admin.rpc("framework_revision_open_hashes", { p_ids: compIds }); return r.error ? [] : r.data ?? []; } catch { return []; } })() : [];
  const proposal = new Map<string, any>(proposals.map((p: any) => [p.competency_id, p]));
  const methodApplies = (v: any) => { const a = v.content_snapshot?.content?.applicability ?? {};
    const list = (x: any) => (Array.isArray(x) ? x.filter((y: any) => typeof y === "string") : []) as string[];
    return { frameworkIds: list(a.frameworkIds), competencyIds: list(a.competencyIds) }; };
  const methodComp = methods.flatMap(m => methodApplies(m.v).competencyIds), methodFw = methods.flatMap(m => methodApplies(m.v).frameworkIds);
  const allComp = [...new Set([...compIds, ...links.map((l: any) => l.competency_id), ...methodComp])];
  const comps = allComp.length ? await rows(admin.from("framework_competencies").select("id, name, domain_id").in("id", allComp)) : [];
  if (comps === null) return null;
  const doms = await rows(admin.from("framework_domains").select("id, name, framework_id").in("id", [...new Set([...comps.map((c: any) => c.domain_id), ...proposals.map((p: any) => p.domain_id)])]));
  if (doms === null) return null;
  // 771: a new competency may be proposed in a NEW domain of its revision, which has no live row yet. Its framework is the
  // revision's (framework_revision_open_hashes says which), its name the revision's. Unreadable or before 771: not listed.
  const missing = [...new Set(proposals.filter((p: any) => p.is_new && p.domain_id && !doms.some((d: any) => d.id === p.domain_id)).map((p: any) => p.domain_id as string))];
  if (missing.length) {
    const nd = await (async () => { try { const r = await admin.from("framework_revision_domain").select("domain_id, name, revision_id").in("domain_id", missing).is("origin_domain_id", null); return r.error ? [] : r.data ?? []; } catch { return []; } })();
    for (const d of nd as any[]) {
      const p = proposals.find((x: any) => x.domain_id === d.domain_id && x.revision_id === d.revision_id);
      if (p) doms.push({ id: d.domain_id, name: d.name, framework_id: p.framework_id });
    }
  }
  const fws = await rows(admin.from("frameworks").select("id, name, profession_term_id, specialty_term_id").in("id", [...new Set([...doms.map((d: any) => d.framework_id), ...methodFw])]).is("hospital_id", null));
  if (fws === null) return null;
  const hash = new Map<string, string>(hashes.map((h: any) => [h.competency_id, h.content_hash]));
  const comp = new Map<string, any>(comps.map((c: any) => [c.id, c])), dom = new Map<string, any>(doms.map((d: any) => [d.id, d])), fw = new Map<string, any>(fws.map((f: any) => [f.id, f]));
  const items: QueueItem[] = [];
  for (const v of open) {
    const ds = decisions.filter((d: any) => d.version_id === v.id);
    if (ds.some((d: any) => d.decision === "rejected" || d.reviewer_id === reviewerId)) continue;
    const approvals = ds.filter((d: any) => d.decision === "approved").length;
    const id = subject(v) as string, prop = proposal.get(id);
    const viaProposal = hash.get(id) !== v.content_hash && prop?.proposed_hash === v.content_hash;
    if (approvals >= v.required_approvals || (hash.get(id) !== v.content_hash && !viaProposal)) continue;
    const c = comp.get(id) ?? (prop?.is_new ? { id, name: v.content_snapshot?.name ?? "New competency", domain_id: prop.domain_id } : null);
    const d = c ? dom.get(c.domain_id) : null, f = d ? fw.get(d.framework_id) : null;
    if (!c || !d || !f) continue;
    const covering = appointments.find(a => scopeCovers(a.scopes, { domainId: d.id, frameworkId: f.id, professionTermId: f.profession_term_id, specialtyTermId: f.specialty_term_id }));
    if (!covering) continue;
    const s = v.content_snapshot ?? {};
    items.push({
      versionId: v.id, competencyId: c.id, title: s.name ?? c.name, home: f.name, domain: d.name, required: v.required_approvals, approvals,
      risk: v.risk_basis ?? null, submittedAt: v.created_at, appointmentId: covering.id, kind: "competency",
      snapshot: { description: s.description ?? null, outcomes: Array.isArray(s.learning_outcomes) ? s.learning_outcomes : [], skills: Array.isArray(s.skills) ? s.skills : [], risk: s.risk_category ?? null },
      ...(viaProposal ? { revision: { id: prop.revision_id, isNew: !!prop.is_new } } : {}),
    });
  }
  // Cases (422): current (the case version's hash still matches), and in scope only if ONE appointment's scopes cover
  // EVERY competency the case teaches -- the rule the 422 trigger applies to the decision itself.
  const caseRow = new Map<string, any>(caseRows.map((r: any) => [r.id, r]));
  for (const v of cases) {
    const ds = decisions.filter((d: any) => d.version_id === v.id);
    if (ds.some((d: any) => d.decision === "rejected" || d.reviewer_id === reviewerId)) continue;
    const approvals = ds.filter((d: any) => d.decision === "approved").length;
    const cv = caseRow.get(v.case_version_id);
    if (approvals >= v.required_approvals || !cv || cv.state !== "submitted" || cv.content_hash !== v.content_hash) continue;
    const taught = links.filter((l: any) => l.version_id === v.case_version_id).map((l: any) => comp.get(l.competency_id)).filter(Boolean);
    if (!taught.length) continue;
    const covering = appointments.find(a => taught.every((c: any) => { const d = dom.get(c.domain_id), f = d ? fw.get(d.framework_id) : null;
      return !!d && !!f && scopeCovers(a.scopes, { domainId: d.id, frameworkId: f.id, professionTermId: f.profession_term_id, specialtyTermId: f.specialty_term_id }); }));
    if (!covering) continue;
    const s = v.content_snapshot ?? {};
    const first = taught[0], d0 = dom.get(first.domain_id), f0 = d0 ? fw.get(d0.framework_id) : null;
    items.push({
      versionId: v.id, competencyId: "", title: s.title ?? "Clinical case", home: f0?.name ?? "Clinical case", domain: taught.map((c: any) => c.name).join(", "),
      required: v.required_approvals, approvals, risk: v.risk_basis ?? null, submittedAt: v.created_at, appointmentId: covering.id, kind: "case", caseContent: s,
      snapshot: { description: s.summary ?? null, outcomes: Array.isArray(s.learningObjectives) ? s.learningObjectives.map((l: any) => l?.text).filter(Boolean) : [], skills: [], risk: s.metadata?.risk ?? null },
    });
  }
  // Methods (690): current (still the draft, not changed since it was put forward) and in scope only if ONE appointment
  // covers EVERY framework (a framework, profession or specialty scope of it) and EVERY competency the method names.
  for (const m of methods) {
    try {
      const v = m.v, ds = decisions.filter((d: any) => d.version_id === v.id);
      if (ds.some((d: any) => d.decision === "rejected" || d.reviewer_id === reviewerId)) continue;
      const approvals = ds.filter((d: any) => d.decision === "approved").length;
      if (approvals >= v.required_approvals) continue;
      const s = v.content_snapshot ?? {}, content = s.content ?? {}, ap = methodApplies(v);
      if (!ap.frameworkIds.length && !ap.competencyIds.length) continue;
      const fwsNamed = ap.frameworkIds.map(id => fw.get(id)), taught = ap.competencyIds.map(id => comp.get(id));
      if (fwsNamed.some(f => !f) || taught.some(c => !c)) continue;
      const place = (c: any) => { const d = dom.get(c.domain_id), f = d ? fw.get(d.framework_id) : null; return d && f ? { d, f } : null; };
      if (taught.some(c => !place(c))) continue;
      const covering = appointments.find(a => fwsNamed.every((f: any) => scopeCovers(a.scopes.filter(sc => sc.kind !== "domain"), { domainId: "", frameworkId: f.id, professionTermId: f.profession_term_id, specialtyTermId: f.specialty_term_id }))
        && taught.every((c: any) => { const { d, f } = place(c)!; return scopeCovers(a.scopes, { domainId: d.id, frameworkId: f.id, professionTermId: f.profession_term_id, specialtyTermId: f.specialty_term_id }); }));
      if (!covering) continue;
      const homes = [...new Set([...fwsNamed.map((f: any) => f.name), ...taught.map((c: any) => place(c)!.f.name)])] as string[];
      items.push({
        versionId: v.id, competencyId: "", title: `${s.method?.name ?? "Assessment method"} v${s.version_no ?? "?"}`, home: homes.join(", "),
        domain: taught.length ? taught.map((c: any) => c.name).join(", ") : "Every competency in the framework",
        required: v.required_approvals, approvals, risk: v.risk_basis ?? null, submittedAt: v.created_at, appointmentId: covering.id, kind: "method",
        methodContent: { ...s, applies: { frameworks: fwsNamed.map((f: any) => f.name), competencies: taught.map((c: any) => ({ name: c.name, framework: place(c)!.f.name })) } },
        snapshot: { description: typeof content.summary === "string" ? content.summary : null,
          outcomes: Array.isArray(content.outcomes) ? content.outcomes.map((o: any) => o?.label).filter(Boolean) : [], skills: [], risk: null },
      });
    } catch { /* one unreadable method row never makes the queue unreadable */ }
  }
  const ids = items.filter(i => i.kind === "competency" && !i.revision).map(i => i.competencyId);
  if (ids.length) {
    const read = (cols: string) => admin.from("competency_skills").select(cols).in("competency_id", ids).order("sort_order").limit(20000);
    let r = await read("competency_id, name, sort_order, component_code, source_ref");
    if (r.error) r = await read("competency_id, name, sort_order");
    for (const it of items) if (it.kind === "competency") it.criteria = ((r.data ?? []) as any[]).filter(k => k.competency_id === it.competencyId)
      .map(k => ({ component: k.component_code ?? null, text: k.name, sourceRef: k.source_ref ?? null }));
  }
  // 770: a proposed version shows the criteria the revision proposes (active ones, the ones its hash covers).
  for (const it of items) if (it.kind === "competency" && it.revision) {
    const r = await rows(admin.from("framework_revision_criterion").select("name, sort_order, component_code, source_ref, is_active").eq("revision_id", it.revision.id).eq("competency_id", it.competencyId).order("sort_order").limit(2000));
    it.criteria = (r ?? []).filter((k: any) => k.is_active !== false).map((k: any) => ({ component: k.component_code ?? null, text: k.name, sourceRef: k.source_ref ?? null }));
  }
  return { appointments, items };
}

/**
 * Method versions (690) this reviewer may act on by independence and currency: put forward by somebody else, never
 * authored, edited or put forward by this reviewer for ANY version of the same method, and still the unchanged draft
 * (state draft and not updated since it was put forward -- the database compares the exact hash). Scope is applied by
 * the caller, who has the framework and competency rows. A failed read returns none: it costs only the method items.
 */
async function methodCandidates(admin: any, reviewerId: string, versions: any[], mine: (v: any) => boolean): Promise<{ v: any; row: any }[]> {
  const all = versions.filter((v: any) => !v.competency_id && v.method_version_id);
  if (!all.length) return [];
  try {
    const own = await rows(admin.from("competency_verification_method_version").select("id, state, updated_at, method_id").in("id", all.map((v: any) => v.method_version_id)));
    if (own === null) return [];
    const byId = new Map<string, any>(own.map((r: any) => [r.id, r]));
    const methodIds = [...new Set(own.map((r: any) => r.method_id).filter(Boolean))] as string[];
    // Every version of those methods, for author/editor independence, and the method's creator.
    const sib = methodIds.length ? await rows(admin.from("competency_verification_method_version").select("id, method_id, authored_by, edited_by").in("method_id", methodIds)) : [];
    const made = methodIds.length ? await rows(admin.from("competency_verification_method").select("id, created_by").in("id", methodIds)) : [];
    if (sib === null || made === null) return [];
    const mineMethod = new Set<string>();
    for (const r of sib) if (r.authored_by === reviewerId || (r.edited_by ?? []).includes(reviewerId)) mineMethod.add(r.method_id);
    for (const r of made) if (r.created_by === reviewerId) mineMethod.add(r.id);
    for (const v of all) { const r = byId.get(v.method_version_id); if (r && mine(v)) mineMethod.add(r.method_id); }
    return all.flatMap((v: any) => {
      const r = byId.get(v.method_version_id);
      if (!r || mine(v) || mineMethod.has(r.method_id)) return [];
      if (r.state !== "draft" || !r.updated_at || !v.created_at || new Date(r.updated_at).getTime() > new Date(v.created_at).getTime()) return [];
      return [{ v, row: r }];
    });
  } catch { return []; }
}

export type ReviewerView = { appointmentId: string; personId: string | null; name: string; scopes: (ReviewerScope & { label: string })[] };
export type ScopeOption = { kind: ScopeKind; ref: string; label: string };

/** Every active clinical reviewer appointment, with its scopes, and what a scope may name. */
export async function governanceView(admin: any): Promise<{ reviewers: ReviewerView[]; options: ScopeOption[]; frameworks: { id: string; name: string; specialtyTermId: string | null }[]; specialties: { id: string; value: string }[] } | null> {
  // HQ-SOD-CROSSCUT-01: every appointment to a position granting approval, not only the reviewer position.
  const approvers = await approverPositions(admin);
  if (approvers === null) return null;
  const [appts, terms, fws] = await Promise.all([
    approvers.length ? carryingApproval((cols: string) => admin.from("ogs_office_appointments").select(cols).in("role", approvers).eq("status", "active").limit(500), "id, person_id, person_name, role") : Promise.resolve([]),
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

// Compliance Management (GOV-001.3) loader — the obligations register plus an
// honestly-derived multi-domain compliance view. Platform-wide, fail-soft:
// the register reads gov_obligations (migration 059; ready=false with an
// honest banner until applied), while the domain bars are DERIVED from real
// existing signals — clinical (audit compliance), training (pathway items),
// competency (validated coverage), documentation (policy currency). The
// calendar merges obligation expiries with policy review dates. Evidence
// counts come from the clinical evidence store (labelled as such — GRC
// attachments are not modelled yet).
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const bucket = (rows: any[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = r[key] ?? "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };
const DAY = 86400000;
const DONE_ITEMS = new Set(["completed", "passed", "done", "closed"]);

export async function loadComplianceManagement(admin: any) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const soonStr = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);

  const [oblRows, hospitals, qfRows, auditRows, itemRows, itemProv, compRows, scoreRows, polRows, evCount, evKinds] = await Promise.all([
    admin.from("gov_obligations").select("id, title, source_authority, domain, status, risk_rating, review_frequency, expiry_date, hospital_id, owner_name, created_at").order("created_at", { ascending: false }).limit(2000),
    admin.from("hospitals").select("id, name").limit(2000),
    admin.from("quality_frameworks").select("id, code, name").eq("is_active", true).limit(200),
    admin.from("audits").select("compliance_pct").limit(5000),
    admin.from("pathway_items").select("status").limit(20000),
    // Provenance read SEPARATELY and allowed to fail. Folding these columns into the query above would mean
    // that before migration 183 the whole select errors, `items` reads as empty, and the training figure
    // silently disappears -- a missing column quietly deleting a compliance number is the exact fail-soft
    // shape this file is being changed to stop.
    admin.from("pathway_items").select("status, completion_method, verified_at").limit(20000),
    admin.from("framework_competencies").select("id").limit(20000),
    admin.from("competency_scores").select("competency_id, is_passing, educator_validated").limit(60000),
    admin.from("policies").select("title, review_date, is_active").limit(4000),
    admin.from("evidence").select("*", { count: "exact", head: true }),
    admin.from("evidence").select("kind").limit(10000),
  ]);

  // ── Obligations register (fail-soft until migration 059 is applied) ─────────
  const ready = !oblRows.error;
  const obligations = (ready ? oblRows.data ?? [] : []) as any[];
  const hospName = new Map<string, string>((hospitals.error ? [] : hospitals.data ?? []).map((h: any) => [h.id, h.name]));
  const byStatus = bucket(obligations, "status");
  const byDomain = bucket(obligations, "domain");
  const expiringSoon = obligations.filter(o => o.expiry_date && o.expiry_date >= todayStr && o.expiry_date <= soonStr).length;
  const expired = obligations.filter(o => o.expiry_date && o.expiry_date < todayStr).length;

  const register = obligations.slice(0, 8).map(o => ({
    id: o.id, title: o.title, authority: o.source_authority, domain: o.domain,
    status: o.status, risk: o.risk_rating,
    scope: o.hospital_id ? (hospName.get(o.hospital_id) ?? "Tenant") : "Platform-wide",
    expiry: o.expiry_date, owner: o.owner_name,
  }));

  // ── Derived domain compliance (real signals, no register required) ──────────
  const compVals = (auditRows.error ? [] : auditRows.data ?? []).map((a: any) => a.compliance_pct).filter((x: any) => x != null).map(Number);
  const clinical = compVals.length ? Math.round(compVals.reduce((a: number, b: number) => a + b, 0) / compVals.length) : null;
  // Training: what the learner ticked, and what anyone actually checked (XWI P2-8).
  //
  // This used to publish ONE number -- completed items over all items -- beside audit compliance, which is
  // externally measured. Learners mark their own pathway items complete, so that number was pure
  // self-attestation wearing the same badge as a measured one. Self-attestation is legitimate for reading a
  // policy or watching a video; presenting it as assurance is not. So the figure is now split, and where
  // provenance is not recorded it says so rather than picking the flattering reading.
  const items = (itemRows.error ? [] : itemRows.data ?? []) as any[];
  const done = items.filter(i => DONE_ITEMS.has(String(i.status ?? "").toLowerCase()));
  const training = items.length ? Math.round((done.length / items.length) * 100) : null;

  const provRows = (itemProv.error ? [] : itemProv.data ?? []) as any[];
  const provenanceAvailable = !itemProv.error;
  const provDone = provRows.filter(i => DONE_ITEMS.has(String(i.status ?? "").toLowerCase()));
  // Assured = a second party verified it, or the learner backed it with something the system observed.
  // A null completion_method is UNRECORDED, and unrecorded is not assured.
  const assuredDone = provDone.filter(i => i.verified_at || ["evidence", "course", "assessment"].includes(String(i.completion_method ?? "")));
  const trainingAssured = provenanceAvailable && provRows.length ? Math.round((assuredDone.length / provRows.length) * 100) : null;
  const trainingProvenance = {
    available: provenanceAvailable,
    reason: provenanceAvailable ? null : "Run migration 183 to record how learning was completed. Until then this platform cannot distinguish a self-attested tick from a verified completion.",
    completed: provDone.length,
    assured: assuredDone.length,
    selfAttested: provDone.length - assuredDone.length,
  };
  const totalComps = compRows.error ? 0 : (compRows.data ?? []).length;
  const validated = new Set((scoreRows.error ? [] : scoreRows.data ?? []).filter((s: any) => s.is_passing && s.educator_validated).map((s: any) => s.competency_id)).size;
  const competency = totalComps ? Math.round((validated / totalComps) * 100) : null;
  const activePol = (polRows.error ? [] : polRows.data ?? []).filter((p: any) => p.is_active !== false);
  const datedPol = activePol.filter((p: any) => p.review_date);
  const documentation = datedPol.length ? Math.round((datedPol.filter((p: any) => p.review_date >= todayStr).length / datedPol.length) * 100) : null;

  const derivedDomains = [
    { label: "Clinical (audit compliance)", value: clinical },
    { label: "Training (learner-reported)", value: training, note: "Self-reported unless verified" },
    { label: "Training (verified or evidenced)", value: trainingAssured, note: trainingProvenance.reason ?? `${trainingProvenance.selfAttested} of ${trainingProvenance.completed} completions rest on the learner's word alone` },
    { label: "Competency (validated coverage)", value: competency },
    { label: "Documentation (policy currency)", value: documentation },
  ];

  // ── Compliance calendar: obligation expiries ∪ policy reviews ───────────────
  const calendar = [
    ...obligations.filter(o => o.expiry_date).map(o => ({ date: o.expiry_date, title: o.title, kind: "obligation" })),
    ...datedPol.map((p: any) => ({ date: p.review_date, title: p.title, kind: "policy review" })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 7)
   .map(e => ({ ...e, overdue: e.date < todayStr, dueSoon: e.date >= todayStr && e.date <= soonStr }));

  const evidenceKinds = bucket(evKinds.error ? [] : evKinds.data ?? [], "kind");

  return {
    ready,
    kpis: {
      total: ready ? obligations.length : null,
      compliant: ready ? byStatus.compliant ?? 0 : null,
      atRisk: ready ? byStatus.at_risk ?? 0 : null,
      nonCompliant: ready ? byStatus.non_compliant ?? 0 : null,
      notAssessed: ready ? byStatus.not_assessed ?? 0 : null,
      expiringSoon: ready ? expiringSoon : null,
    },
    expired: ready ? expired : null,
    waived: ready ? byStatus.waived ?? 0 : null,
    byDomain: Object.entries(byDomain).map(([domain, n]) => ({ domain, n })).sort((a, b) => (b.n as number) - (a.n as number)),
    register,
    derivedDomains,
    trainingProvenance,
    calendar,
    evidence: { total: num(evCount), kinds: evidenceKinds },
    pickers: {
      frameworks: (qfRows.error ? [] : qfRows.data ?? []).map((f: any) => ({ id: f.id, label: `${f.code} — ${f.name}` })),
      obligations: obligations.slice(0, 500).map(o => ({ id: o.id, label: `${o.title} (${String(o.status).replace(/_/g, " ")})` })),
    },
    generatedAt: new Date().toISOString(),
  };
}

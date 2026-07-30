/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-001 — Competency Governance Registry & Master Control System.
// The single per-competency governance RECORD. For every competency DEFINITION it answers the CGR-001
// question — "what exists, who owns it, what evidence/decisions back it, which standards it maps to, when
// it's due for review, and what is its risk" — by JOINING real stores that already exist but were never
// joined into one governance view:
//   • framework_competencies      → identity + risk_category (low|standard|high|critical)   [mig 003/011]
//   • framework_domains→frameworks → clinical domain + parent framework pub_status/review    [mig 003/127]
//   • content_responsibilities     → ownership (product_owner) + governance roles + review_due [mig 023]
//   • competency_standard_mappings → regulatory alignment (standard bodies, coverage)         [mig 129]
//   • competency_decisions         → evidence of governed use (count / validated / version)   [mig 011]
//   • change_requests (open)       → pending controlled change                                [mig 012]
// From those real facts it derives a governance COMPLETENESS score (0–100) and a governance STATE
// (governed / monitor / at_risk / ungoverned) per the CGR-001 "governance before deployment" principle
// (owner + evidence + regulatory alignment + current review). No migration — a read model over the
// governance spine. Nothing is fabricated; absent facts render as genuine gaps (no owner, 0 standards, …).

type Admin = any;

const todayISO = () => new Date().toISOString().slice(0, 10);
const RISK_W: Record<string, number> = { critical: 4, high: 3, standard: 2, low: 1 };
const CAP = 500; // registry sample ceiling; population total reported separately.

const chunk = <T>(a: T[], n: number): T[][] => {
  const o: T[][] = [];
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
  return o;
};

export type GovState = "governed" | "monitor" | "at_risk" | "ungoverned";

export type GovRecord = {
  id: string;
  name: string;
  code: string | null;
  domain: string | null;
  framework: string | null;
  frameworkStatus: string | null; // parent framework pub_status
  risk: string; // low | standard | high | critical
  owner: string | null; // product_owner name (null = unowned)
  governanceRoles: number; // active reviewer/approver/evidence-owner responsibilities
  reviewDue: string | null; // earliest active review_due
  reviewOverdue: boolean;
  standards: number; // regulatory/standard mappings
  standardsFull: number; // coverage = full
  decisions: number; // governed competency decisions referencing this definition
  validated: number; // decisions with a validation
  latestVersion: number; // max version_num among decisions
  openChanges: number; // open change requests
  score: number; // governance completeness 0–100
  state: GovState;
};

const STATE_RANK: Record<GovState, number> = { at_risk: 0, ungoverned: 1, monitor: 2, governed: 3 };

export type RegistryData = {
  provisioned: boolean;
  total: number; // whole-population competency count
  loaded: number; // records built (<= CAP)
  capped: boolean;
  records: GovRecord[];
  states: Record<GovState, number>;
  kpis: {
    ownerPct: number;
    standardsPct: number;
    evidencePct: number;
    overdue: number;
    highRisk: number;
    avgScore: number;
    withOwner: number;
    withStandards: number;
  };
};

function emptyData(total: number): RegistryData {
  return {
    provisioned: false,
    total,
    loaded: 0,
    capped: false,
    records: [],
    states: { governed: 0, monitor: 0, at_risk: 0, ungoverned: 0 },
    kpis: { ownerPct: 0, standardsPct: 0, evidencePct: 0, overdue: 0, highRisk: 0, avgScore: 0, withOwner: 0, withStandards: 0 },
  };
}

export async function loadGovernanceRegistry(admin: Admin): Promise<RegistryData> {
  const today = todayISO();

  const totalRes = await admin.from("framework_competencies").select("id", { count: "exact", head: true });
  const total = totalRes.count ?? 0;

  const { data: comps, error } = await admin
    .from("framework_competencies")
    .select("id, name, code, risk_category, framework_domains ( name, frameworks ( id, name, pub_status, review_date ) )")
    .limit(CAP);
  if (error || !comps?.length) return emptyData(total);

  const ids = comps.map((c: any) => c.id);

  const ownerOf = new Map<string, string>(); // content_id -> owner user_id
  const ownerUserIds = new Set<string>();
  const govRoles = new Map<string, number>(); // content_id -> # active non-owner governance responsibilities
  const reviewDue = new Map<string, string>(); // content_id -> earliest active review_due
  const stds = new Map<string, { total: number; full: number }>();
  const decs = new Map<string, { count: number; validated: number; maxV: number }>();
  const changes = new Map<string, number>();

  for (const grp of chunk(ids, 150)) {
    const [resp, sm, cd, cr] = await Promise.all([
      admin.from("content_responsibilities").select("content_id, user_id, responsibility_type, review_due").eq("content_type", "competency").eq("status", "active").in("content_id", grp),
      admin.from("competency_standard_mappings").select("competency_id, coverage").in("competency_id", grp),
      admin.from("competency_decisions").select("competency_id, validated_at, version_num").in("competency_id", grp),
      admin.from("change_requests").select("entity_id").eq("status", "open").in("entity_id", grp),
    ]);
    for (const r of resp.data ?? []) {
      if (r.responsibility_type === "product_owner") {
        if (!ownerOf.has(r.content_id)) ownerOf.set(r.content_id, r.user_id);
        ownerUserIds.add(r.user_id);
      } else {
        govRoles.set(r.content_id, (govRoles.get(r.content_id) ?? 0) + 1);
      }
      if (r.review_due) {
        const cur = reviewDue.get(r.content_id);
        if (!cur || r.review_due < cur) reviewDue.set(r.content_id, r.review_due);
      }
    }
    for (const s of sm.data ?? []) {
      const e = stds.get(s.competency_id) ?? { total: 0, full: 0 };
      e.total++;
      if (s.coverage === "full") e.full++;
      stds.set(s.competency_id, e);
    }
    for (const d of cd.data ?? []) {
      if (!d.competency_id) continue;
      const e = decs.get(d.competency_id) ?? { count: 0, validated: 0, maxV: 0 };
      e.count++;
      if (d.validated_at) e.validated++;
      if ((d.version_num ?? 0) > e.maxV) e.maxV = d.version_num ?? 0;
      decs.set(d.competency_id, e);
    }
    for (const c of cr.data ?? []) changes.set(c.entity_id, (changes.get(c.entity_id) ?? 0) + 1);
  }

  const nameById = new Map<string, string>();
  if (ownerUserIds.size) {
    const { data: profs } = await admin.from("profiles").select("id, full_name").in("id", [...ownerUserIds]);
    for (const p of profs ?? []) nameById.set(p.id, p.full_name ?? "—");
  }

  const records: GovRecord[] = comps.map((c: any) => {
    const dom = c.framework_domains;
    const fw = dom?.frameworks;
    const risk = (c.risk_category ?? "standard") as string;
    const ownerUid = ownerOf.get(c.id);
    const owner = ownerUid ? nameById.get(ownerUid) ?? "Assigned" : null;
    const rd = reviewDue.get(c.id) ?? null;
    const reviewOverdue = !!rd && rd < today;
    const st = stds.get(c.id) ?? { total: 0, full: 0 };
    const de = decs.get(c.id) ?? { count: 0, validated: 0, maxV: 0 };
    const fwStatus = (fw?.pub_status ?? null) as string | null;

    // Governance completeness — the CGR-001 "governance before deployment" checklist, scored from real facts.
    let score = 0;
    if (owner) score += 25; // assigned owner
    if (st.total > 0) score += 20; // regulatory alignment
    if (rd) score += reviewOverdue ? 5 : 20; // review date set (and current)
    if (de.count > 0) score += 15; // evidence of governed use
    if (fwStatus === "approved" || fwStatus === "published") score += 20; // approval pathway complete

    let state: GovState;
    if (!owner && st.total === 0 && de.count === 0) state = "ungoverned";
    else if (reviewOverdue || ((risk === "high" || risk === "critical") && !owner) || score < 45) state = "at_risk";
    else if (score < 75) state = "monitor";
    else state = "governed";

    return {
      id: c.id,
      name: c.name,
      code: c.code ?? null,
      domain: dom?.name ?? null,
      framework: fw?.name ?? null,
      frameworkStatus: fwStatus,
      risk,
      owner,
      governanceRoles: govRoles.get(c.id) ?? 0,
      reviewDue: rd,
      reviewOverdue,
      standards: st.total,
      standardsFull: st.full,
      decisions: de.count,
      validated: de.validated,
      latestVersion: de.maxV,
      openChanges: changes.get(c.id) ?? 0,
      score,
      state,
    };
  });

  records.sort(
    (a, b) => RISK_W[b.risk] - RISK_W[a.risk] || STATE_RANK[a.state] - STATE_RANK[b.state] || a.name.localeCompare(b.name),
  );

  const n = records.length;
  const withOwner = records.filter((r) => r.owner).length;
  const withStandards = records.filter((r) => r.standards > 0).length;
  const withEvidence = records.filter((r) => r.decisions > 0).length;
  const pct = (x: number) => (n ? Math.round((x / n) * 100) : 0);

  return {
    provisioned: true,
    total,
    loaded: n,
    capped: total > CAP,
    records,
    states: {
      governed: records.filter((r) => r.state === "governed").length,
      monitor: records.filter((r) => r.state === "monitor").length,
      at_risk: records.filter((r) => r.state === "at_risk").length,
      ungoverned: records.filter((r) => r.state === "ungoverned").length,
    },
    kpis: {
      ownerPct: pct(withOwner),
      standardsPct: pct(withStandards),
      evidencePct: pct(withEvidence),
      overdue: records.filter((r) => r.reviewOverdue).length,
      highRisk: records.filter((r) => r.risk === "high" || r.risk === "critical").length,
      avgScore: n ? Math.round(records.reduce((a, r) => a + r.score, 0) / n) : 0,
      withOwner,
      withStandards,
    },
  };
}

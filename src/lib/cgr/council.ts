/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-010 — Competency Governance Operating Model & Governance Council.
// "Who governs competency systems, who makes decisions, and how is accountability maintained?" The LIVE layer is
// the real competency-governance council structure (distinct from OGS office governance):
//   • governance_committees (mig 012) — the councils: name, level (enterprise→specialty), quorum, active.
//   • committee_members (mig 012)     — membership by role (chair / member / reviewer), joined to profiles.
//   • frameworks.governance_committee_id (mig 012) — what each council GOVERNS (frameworks) + the accountability
//     coverage gap (frameworks with no governing council = §4.1 "clear accountability" breach).
// The decision-rights matrix (§8), RACI (§10) and meeting cadence (§9) are the office's STATED operating model —
// rendered as clearly-labelled reference on the page, not computed. No migration; read model.

type Admin = any;
const LEVEL_ORDER = ["enterprise", "country", "facility", "department", "specialty"] as const;

export async function loadGovernanceCouncil(admin: Admin) {
  const [comRes, memRes, fwRes] = await Promise.all([
    admin.from("governance_committees").select("id, name, level, quorum, is_active").limit(300),
    admin.from("committee_members").select("committee_id, profile_id, role").limit(3000),
    admin.from("frameworks").select("id, name, governance_committee_id, pub_status").limit(600),
  ]);

  const coms = (comRes.error ? [] : comRes.data ?? []) as any[];
  const mems = (memRes.error ? [] : memRes.data ?? []) as any[];
  const fws = (fwRes.error ? [] : fwRes.data ?? []) as any[];

  const nameById = new Map<string, string>();
  const memberIds = [...new Set(mems.map((m) => m.profile_id).filter(Boolean))];
  if (memberIds.length) {
    const { data: profs } = await admin.from("profiles").select("id, full_name").in("id", memberIds);
    for (const p of profs ?? []) nameById.set(p.id, p.full_name ?? "—");
  }

  const councils = coms.map((c) => {
    const m = mems.filter((x) => x.committee_id === c.id);
    const chairs = m.filter((x) => x.role === "chair").map((x) => nameById.get(x.profile_id) ?? "—");
    const reviewers = m.filter((x) => x.role === "reviewer").length;
    const governed = fws.filter((f) => f.governance_committee_id === c.id).length;
    const quorum = c.quorum ?? 1;
    return {
      id: c.id,
      name: c.name,
      level: c.level ?? "facility",
      quorum,
      active: c.is_active !== false,
      members: m.length,
      chairs,
      reviewers,
      frameworksGoverned: governed,
      meetsQuorum: m.length >= quorum,
    };
  }).sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || b.frameworksGoverned - a.frameworksGoverned);

  const byLevel = LEVEL_ORDER.map((level) => {
    const g = councils.filter((c) => c.level === level);
    return g.length ? { level, councils: g.length, members: g.reduce((s, c) => s + c.members, 0) } : null;
  }).filter(Boolean) as any[];

  const fwGoverned = fws.filter((f) => f.governance_committee_id).length;
  const ungoverned = fws.filter((f) => !f.governance_committee_id);

  const totalMembers = mems.length;
  const totalChairs = mems.filter((m) => m.role === "chair").length;

  return {
    provisioned: coms.length > 0,
    councils,
    byLevel,
    ungovernedFrameworks: ungoverned.slice(0, 10).map((f) => ({ id: f.id, name: f.name, pubStatus: f.pub_status ?? "draft" })),
    kpis: {
      councils: coms.length,
      active: councils.filter((c) => c.active).length,
      members: totalMembers,
      chairs: totalChairs,
      quorumMet: councils.filter((c) => c.meetsQuorum).length,
      frameworks: fws.length,
      fwGoverned,
      fwUngoverned: ungoverned.length,
      coveragePct: fws.length ? Math.round((fwGoverned / fws.length) * 100) : null,
    },
  };
}

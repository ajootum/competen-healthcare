/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-025 — Competency Governance Global Learning & Workforce Capability Intelligence.
// Read in the GOVERNANCE context: the capability of the workforce that GOVERNS competency — §5.1 "critical skill
// availability" and §8 "succession planning" applied to governance roles. Clinical workforce capability
// (role→competency coverage, learning effectiveness) is owned by CMO workforce-mapping + CAPM — cross-linked.
// The genuinely-unsurfaced signals, all real:
//   • Governance load distribution — content_responsibilities grouped by holder: who carries how much, and the
//     CONCENTRATION (top-holder share) — key-person risk nothing shows today.
//   • Succession exposure (§8) — competencies whose entire governance rests on ONE person (single point of
//     failure), and competencies with no owner at all (unowned load).
//   • Assessor capacity (§5.1) — assessor_authorizations: who can actually assess, at what independence, active
//     vs expiring — the capacity to deliver assessment.
// No migration; read model.

type Admin = any;
const todayISO = () => new Date().toISOString().slice(0, 10);
const horizonISO = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const roleLabel = (t: string) => (t || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export async function loadGovernanceWorkforce(admin: Admin) {
  const [respRes, authRes, compRes] = await Promise.all([
    admin.from("content_responsibilities").select("user_id, content_type, content_id, content_name, responsibility_type, review_due").eq("status", "active").limit(6000),
    admin.from("assessor_authorizations").select("user_id, independence, status, valid_until").limit(4000),
    admin.from("framework_competencies").select("id", { count: "exact", head: true }),
  ]);

  const resp = (respRes.error ? [] : respRes.data ?? []) as any[];
  const auth = (authRes.error ? [] : authRes.data ?? []) as any[];
  const totalComps = compRes.error ? 0 : compRes.count ?? 0;

  const ids = [...new Set([...resp.map((r) => r.user_id), ...auth.map((a) => a.user_id)].filter(Boolean))];
  const nameById = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await admin.from("profiles").select("id, full_name").in("id", ids);
    for (const p of profs ?? []) nameById.set(p.id, p.full_name ?? "—");
  }

  // Governance load per holder.
  const loadMap = new Map<string, { total: number; roles: Set<string>; objects: Set<string> }>();
  const objMap = new Map<string, { name: string; type: string; holders: Set<string> }>();
  for (const r of resp) {
    const e = loadMap.get(r.user_id) ?? { total: 0, roles: new Set<string>(), objects: new Set<string>() };
    e.total++;
    e.roles.add(r.responsibility_type);
    e.objects.add(`${r.content_type}|${r.content_id}`);
    loadMap.set(r.user_id, e);

    const key = `${r.content_type}|${r.content_id}`;
    const o = objMap.get(key) ?? { name: r.content_name ?? r.content_type, type: r.content_type, holders: new Set<string>() };
    o.holders.add(r.user_id);
    objMap.set(key, o);
  }

  const holders = [...loadMap.entries()]
    .map(([id, e]) => ({ name: nameById.get(id) ?? "—", responsibilities: e.total, objects: e.objects.size, roles: [...e.roles].map(roleLabel) }))
    .sort((a, b) => b.responsibilities - a.responsibilities);

  const totalResp = resp.length;
  const topShare = totalResp && holders.length ? Math.round((holders[0].responsibilities / totalResp) * 100) : 0;
  const top3Share = totalResp && holders.length ? Math.round((holders.slice(0, 3).reduce((t, h) => t + h.responsibilities, 0) / totalResp) * 100) : 0;

  // Succession exposure — objects governed by exactly one person.
  const singlePoint = [...objMap.values()].filter((o) => o.holders.size === 1);
  const governedObjects = objMap.size;

  // Assessor capacity.
  const soon = horizonISO(30);
  const today = todayISO();
  const activeAuth = auth.filter((a) => a.status === "active");
  const assessorIds = new Set(activeAuth.map((a) => a.user_id));
  const byIndep: Record<string, number> = { independent: 0, supervised: 0, countersigned: 0 };
  for (const a of activeAuth) if (a.independence in byIndep) byIndep[a.independence]++;
  const expiring = activeAuth.filter((a) => a.valid_until && a.valid_until <= soon && a.valid_until >= today).length;
  const lapsed = auth.filter((a) => a.status === "active" && a.valid_until && a.valid_until < today).length;

  return {
    provisioned: resp.length > 0 || auth.length > 0,
    kpis: {
      holders: holders.length,
      responsibilities: totalResp,
      governedObjects,
      totalComps,
      topShare,
      top3Share,
      singlePoint: singlePoint.length,
      assessors: assessorIds.size,
      independent: byIndep.independent,
      expiring,
      lapsed,
    },
    holders: holders.slice(0, 10),
    singlePointList: singlePoint.slice(0, 10).map((o) => ({ name: o.name, type: o.type })),
    assessorCapacity: { byIndep, active: activeAuth.length, expiring, lapsed },
  };
}

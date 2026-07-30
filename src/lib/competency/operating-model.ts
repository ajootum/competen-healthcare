/* eslint-disable @typescript-eslint/no-explicit-any */
// CMO-017 — Operating Model & Future Evolution (lean). The operating model and the 5-year roadmap are the office's
// stated FRAMEWORK (narrative, rendered statically on the page). The one thing derived from REAL data here is the
// organisational maturity SNAPSHOT: a composite of live signals — workforce competency coverage (CMO-007),
// program effectiveness (CMO-006) and mapping coverage — mapped onto a 5-level maturity model. Composes the two
// scoped loaders + one campaign count; nothing fabricated. Hospital-scoped. No migration.

import { loadProgramManagement } from "@/lib/competency/program-management";
import { loadWorkforceMapping } from "@/lib/competency/workforce-mapping";

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const scoped = (q: any, hid: string | null, isSuper: boolean) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
const cnt = (q: any) => Promise.resolve(q).then((r: any) => (r.error ? null : r.count ?? 0)).catch(() => null);

// 5-level maturity model (level 1 Initial … level 5 Optimising).
const LEVELS = [{ min: 85, num: 5, label: "Optimising" }, { min: 70, num: 4, label: "Managed" }, { min: 55, num: 3, label: "Defined" }, { min: 40, num: 2, label: "Developing" }, { min: 0, num: 1, label: "Initial" }];
const levelOf = (s: number) => LEVELS.find(l => s >= l.min)!;

export async function loadOperatingModel(admin: Admin, hid: string | null, isSuper: boolean) {
  const [prog, map, campActive]: any[] = await Promise.all([
    loadProgramManagement(admin, hid, isSuper).catch(() => ({ provisioned: false })),
    loadWorkforceMapping(admin, hid, isSuper).catch(() => ({ provisioned: false })),
    cnt(scoped(admin.from("cdp_campaigns").select("id", { count: "exact", head: true }).eq("status", "active"), hid, isSuper)),
  ]);

  const competence = map?.provisioned ? (map.kpis.avgProfileCoverage ?? null) : null;
  const programEff = prog?.provisioned && !prog?.empty ? prog.kpis.avgCompletion : null;
  const mappingCov = map?.provisioned ? map.kpis.mappingCoverage : null;

  const dims = [competence, programEff, mappingCov].filter((x): x is number => x != null);
  const composite = dims.length ? Math.round(dims.reduce((a, b) => a + b, 0) / dims.length) : null;
  const level = composite != null ? levelOf(composite) : null;

  return {
    provisioned: composite != null,
    composite,
    maturityLevel: level?.label ?? "—",
    maturityNum: level?.num ?? 0,
    dimensions: [
      { label: "Workforce competence", value: competence },
      { label: "Program effectiveness", value: programEff },
      { label: "Workforce mapping", value: mappingCov },
    ],
    kpis: {
      competence, programEff, mappingCov,
      activeInitiatives: (prog?.provisioned && !prog?.empty ? prog.kpis.active : 0) + (campActive ?? 0),
      atRiskPrograms: prog?.provisioned && !prog?.empty ? prog.kpis.atRisk : 0,
      criticalGaps: map?.provisioned ? map.kpis.criticalGaps : 0,
    },
  };
}

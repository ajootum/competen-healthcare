// COMP-024 Competency Mobility & Recognition. The equivalency rules engine: source→target competency
// mappings with a recognition type, applied to a professional's portable competencies (those earned at a
// DIFFERENT hospital) to produce a recognition decision. Real over competency_equivalencies (mig 123) +
// competency_decisions. Cross-organisation data is inherently sparse in a single tenant — handled honestly.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const nameOf = (row: any) => { const fc = row?.framework_competencies; return (Array.isArray(fc) ? fc[0]?.name : fc?.name) ?? null; };

// Equivalence type → recognition outcome + colour (COMP-024 §5/§6).
export const RECOG: Record<string, { label: string; recognition: string; color: string; tone: string }> = {
  exact: { label: "Exact", recognition: "Full", color: "#10b981", tone: "emerald" },
  equivalent: { label: "Equivalent", recognition: "Full", color: "#22c55e", tone: "emerald" },
  conditional: { label: "Conditional", recognition: "Conditional", color: "#f59e0b", tone: "amber" },
  bridging: { label: "Bridging", recognition: "Conditional", color: "#3b82f6", tone: "blue" },
  denied: { label: "Denied", recognition: "None", color: "#ef4444", tone: "rose" },
};

export async function loadRecognition(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const rulesRes = await scope(admin.from("competency_equivalencies").select("id, source_competency_id, source_label, target_competency_id, equivalence_type, bridging_note, rationale, created_by_name, created_at").order("created_at", { ascending: false }).limit(2000));
  if (rulesRes.error) return { provisioned: false as const };
  const ruleRows = (rulesRes.data ?? []) as any[];

  // Resolve competency names for the rules.
  const compIds = [...new Set([...ruleRows.map(r => r.source_competency_id), ...ruleRows.map(r => r.target_competency_id)].filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  if (compIds.length) { const { data } = await admin.from("framework_competencies").select("id, name").in("id", compIds.slice(0, 1000)); ((data ?? []) as any[]).forEach(c => nameById.set(c.id, c.name)); }

  const rules = ruleRows.map(r => ({
    id: r.id,
    source: r.source_label ?? nameById.get(r.source_competency_id) ?? "—",
    target: nameById.get(r.target_competency_id) ?? "—",
    type: r.equivalence_type,
    recognition: RECOG[r.equivalence_type]?.recognition ?? "—",
    bridgingNote: r.bridging_note,
    createdBy: r.created_by_name,
    when: r.created_at,
  }));

  const typeCount = (t: string) => ruleRows.filter(r => r.equivalence_type === t).length;
  const byType = Object.keys(RECOG).map(t => ({ type: t, ...RECOG[t], n: typeCount(t) })).filter(x => x.n > 0);
  const targetsCovered = new Set(ruleRows.map(r => r.target_competency_id).filter(Boolean)).size;

  // Cross-organisation competencies: this hospital's staff holding a competency earned at a DIFFERENT hospital,
  // run through the rules. Hospital-scope only (enterprise/super has no single "recognising here").
  let crossOrg: { person: string; competency: string; type: string; recognition: string; tone: string }[] = [];
  let crossOrgTotal = 0;
  if (!isSuper && hid) {
    const { data: staff } = await admin.from("profiles").select("id, full_name").eq("hospital_id", hid).limit(5000);
    const staffIds = ((staff ?? []) as any[]).map(s => s.id);
    const staffName = new Map<string, string>(((staff ?? []) as any[]).map(s => [s.id, s.full_name]));
    if (staffIds.length) {
      const ruleBySource = new Map<string, any>();
      ruleRows.forEach(r => { if (r.source_competency_id) ruleBySource.set(r.source_competency_id, r); });
      let decs: any[] = [];
      for (let i = 0; i < staffIds.length; i += 200) {
        const { data } = await admin.from("competency_decisions").select("nurse_id, competency_id, hospital_id, outcome, framework_competencies(name)").in("nurse_id", staffIds.slice(i, i + 200)).neq("hospital_id", hid).eq("outcome", "competent").limit(20000);
        decs = decs.concat(data ?? []);
      }
      crossOrgTotal = decs.length;
      crossOrg = decs.slice(0, 100).map(d => {
        const rule = ruleBySource.get(d.competency_id);
        const rec = rule ? RECOG[rule.equivalence_type] : null;
        return { person: staffName.get(d.nurse_id) ?? "Worker", competency: nameOf(d) ?? "a competency", type: rule?.equivalence_type ?? "unmapped", recognition: rec?.recognition ?? "Assessment required", tone: rec?.tone ?? "slate" };
      });
    }
  }

  const fullN = typeCount("exact") + typeCount("equivalent");
  const condN = typeCount("conditional") + typeCount("bridging");
  const deniedN = typeCount("denied");

  return {
    provisioned: true as const,
    empty: ruleRows.length === 0,
    kpis: { rules: ruleRows.length, full: fullN, conditional: condN, denied: deniedN, targetsCovered, crossOrgPending: crossOrg.filter(c => c.recognition === "Assessment required").length },
    rules, byType, crossOrg, crossOrgTotal,
  };
}

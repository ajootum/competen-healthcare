// Clinical Indicators (UMG-QS-008) — the Unit Manager's lens over the clinical-quality indicators
// (quality_indicators + indicator_measurements, migration 019), scoped via the hospital's quality_objects.
// Real: KPIs (active / on-target / at-escalation / no-data), the indicator register with each indicator's
// latest measured value, target, RAG status (direction-aware) and a recent-value trend. Fail-soft +
// provisioned-aware. Indicator definitions and measurement entry live in the quality workspace (next-phase
// surfaces here).
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

function rag(value: number | null, target: number | null, escalation: number | null, direction: string): "green" | "amber" | "red" | "gray" {
  if (value == null || target == null) return "gray";
  if (direction === "lower_is_better") {
    if (value <= target) return "green";
    if (escalation != null && value <= escalation) return "amber";
    return escalation != null ? "red" : "amber";
  }
  if (value >= target) return "green";
  if (escalation != null && value >= escalation) return "amber";
  return escalation != null ? "red" : "amber";
}

export async function loadClinicalIndicators(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Hospital's quality objects → their indicators.
  const objRes = await scope(admin.from("quality_objects").select("id, name")).limit(3000);
  if (objRes.error && missing(objRes.error)) return { provisioned: false as const };
  const objs = (objRes.error ? [] : objRes.data ?? []) as any[];
  const objIds = objs.map(o => o.id);
  if (!objIds.length) return { provisioned: true as const, hasData: false, kpis: emptyKpis(), indicators: [] };

  const indRes = await admin.from("quality_indicators").select("id, code, name, unit, direction, target_value, escalation_value, frequency, quality_object_id").in("quality_object_id", objIds).eq("is_active", true).limit(2000);
  const inds = (indRes.error ? [] : indRes.data ?? []) as any[];
  if (!inds.length) return { provisioned: true as const, hasData: false, kpis: emptyKpis(), indicators: [] };

  // Measurements for these indicators (hospital-scoped), oldest→newest for the trend.
  const indIds = inds.map(i => i.id);
  const mByInd = new Map<string, { period: string; value: number }[]>();
  try {
    const mq = admin.from("indicator_measurements").select("indicator_id, period, value").in("indicator_id", indIds).order("period", { ascending: true }).limit(20000);
    const { data } = await (isSuper ? mq : mq.eq("hospital_id", hid ?? NONE));
    (data ?? []).forEach((m: any) => { if (!mByInd.has(m.indicator_id)) mByInd.set(m.indicator_id, []); mByInd.get(m.indicator_id)!.push({ period: m.period, value: Number(m.value) }); });
  } catch { /* fail-soft */ }

  const objName = new Map(objs.map(o => [o.id, o.name]));
  const indicators = inds.map(i => {
    const ms = mByInd.get(i.id) ?? [];
    const latest = ms.length ? ms[ms.length - 1] : null;
    const target = i.target_value != null ? Number(i.target_value) : null;
    const escalation = i.escalation_value != null ? Number(i.escalation_value) : null;
    const status = rag(latest?.value ?? null, target, escalation, i.direction);
    return {
      code: i.code, name: i.name, unit: i.unit, direction: i.direction, frequency: i.frequency,
      object: objName.get(i.quality_object_id) ?? null,
      target, escalation, value: latest?.value ?? null, period: latest?.period ?? null,
      status, trend: ms.slice(-8).map(m => m.value),
    };
  }).sort((a, b) => { const rank = { red: 0, amber: 1, gray: 2, green: 3 } as any; return rank[a.status] - rank[b.status]; });

  const kpis = {
    total: indicators.length,
    onTarget: indicators.filter(i => i.status === "green").length,
    warning: indicators.filter(i => i.status === "amber").length,
    atEscalation: indicators.filter(i => i.status === "red").length,
    noData: indicators.filter(i => i.status === "gray").length,
    measured: indicators.filter(i => i.value != null).length,
  };

  return { provisioned: true as const, hasData: indicators.some(i => i.value != null), kpis, indicators };
}

function emptyKpis() { return { total: 0, onTarget: 0, warning: 0, atEscalation: 0, noData: 0, measured: 0 }; }

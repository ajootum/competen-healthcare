/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-044 Assessment Standard Setting — cut-score studies (cst_standard_settings + cst_standard_judgements,
// migration 132). The recommended cut is computed from per-item mean judge ratings (Angoff-family:
// rating = minimally-competent probability 0–1, so cut% = mean per-item rating × 100). Impact (pass rate
// at that cut) is derived from the linked bank's REAL knowledge_attempts. Everything computed on read.

const NONE = "00000000-0000-0000-0000-000000000000";

export const SS_METHODS = [
  { key: "angoff", label: "Angoff" }, { key: "modified_angoff", label: "Modified Angoff" }, { key: "ebel", label: "Ebel" },
  { key: "borderline_group", label: "Borderline Group" }, { key: "borderline_regression", label: "Borderline Regression" },
  { key: "hofstee", label: "Hofstee" }, { key: "bookmark", label: "Bookmark" }, { key: "custom", label: "Custom" },
];
export const SS_METHOD_LABEL: Record<string, string> = Object.fromEntries(SS_METHODS.map(m => [m.key, m.label]));
export const SS_STATUS_TONE: Record<string, string> = {
  draft: "text-gray-500 bg-gray-50 border-gray-200", calibration: "text-blue-600 bg-blue-50 border-blue-200",
  in_progress: "text-amber-600 bg-amber-50 border-amber-200", review: "text-violet-600 bg-violet-50 border-violet-200",
  approved: "text-teal-600 bg-teal-50 border-teal-200", published: "text-teal-700 bg-teal-50 border-teal-200",
};

export type Judgement = { id: string; judge_name: string; item_label: string; rating: number; round: number };
export type Study = {
  id: string; name: string; method: string; methodLabel: string; status: string; bankId: string | null; bankName: string | null;
  targetLow: number | null; targetHigh: number | null; finalCut: number | null; createdBy: string | null;
  judges: number; items: number; judgements: Judgement[];
  cutPct: number | null; impactPassRate: number | null; impactAttempts: number;
};

export async function loadStandardSettings(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const res = await scope(admin.from("cst_standard_settings").select("id, name, method, status, bank_id, target_pass_low, target_pass_high, final_cut, created_by_name, created_at").order("created_at", { ascending: false }).limit(500));
  if (res.error) return { provisioned: false as const };
  const studies = (res.data ?? []) as any[];

  const ids = studies.map(s => s.id);
  const jByStudy = new Map<string, Judgement[]>();
  if (ids.length) {
    const { data: js } = await admin.from("cst_standard_judgements").select("id, study_id, judge_name, item_label, rating, round").in("study_id", ids).limit(30000);
    for (const j of (js ?? []) as any[]) { const a = jByStudy.get(j.study_id) ?? []; a.push({ id: j.id, judge_name: j.judge_name, item_label: j.item_label, rating: Number(j.rating), round: j.round }); jByStudy.set(j.study_id, a); }
  }

  // Bank names + attempt scores (for impact).
  const bankIds = [...new Set(studies.map(s => s.bank_id).filter(Boolean))] as string[];
  const bankName = new Map<string, string>();
  const scoresByBank = new Map<string, number[]>();
  if (bankIds.length) {
    const { data: bk } = await admin.from("question_banks").select("id, name").in("id", bankIds);
    for (const b of (bk ?? []) as any[]) bankName.set(b.id, b.name);
    const { data: at } = await admin.from("knowledge_attempts").select("bank_id, score").in("bank_id", bankIds).limit(40000);
    for (const a of (at ?? []) as any[]) { const arr = scoresByBank.get(a.bank_id) ?? []; arr.push(Number(a.score) || 0); scoresByBank.set(a.bank_id, arr); }
  }

  const full: Study[] = studies.map(s => {
    const js = jByStudy.get(s.id) ?? [];
    const perItem = new Map<string, { sum: number; n: number }>();
    for (const j of js) { const g = perItem.get(j.item_label) ?? { sum: 0, n: 0 }; g.sum += j.rating; g.n++; perItem.set(j.item_label, g); }
    const itemMeans = [...perItem.values()].map(g => g.sum / g.n);
    const items = perItem.size;
    const judges = new Set(js.map(j => j.judge_name)).size;
    const cutPct = items ? Math.round((itemMeans.reduce((a, b) => a + b, 0) / items) * 100) : null;
    const scores = s.bank_id ? (scoresByBank.get(s.bank_id) ?? []) : [];
    const impactPassRate = cutPct != null && scores.length ? Math.round((scores.filter(x => x >= cutPct).length / scores.length) * 100) : null;
    return {
      id: s.id, name: s.name, method: s.method, methodLabel: SS_METHOD_LABEL[s.method] ?? s.method, status: s.status,
      bankId: s.bank_id, bankName: s.bank_id ? (bankName.get(s.bank_id) ?? null) : null,
      targetLow: s.target_pass_low, targetHigh: s.target_pass_high, finalCut: s.final_cut != null ? Number(s.final_cut) : null,
      createdBy: s.created_by_name, judges, items, judgements: js,
      cutPct, impactPassRate, impactAttempts: scores.length,
    };
  });

  const count = (st: string) => full.filter(s => s.status === st).length;
  return {
    provisioned: true as const,
    empty: full.length === 0,
    kpis: { total: full.length, active: count("in_progress") + count("calibration") + count("review"), approved: count("approved") + count("published"), draft: count("draft") },
    studies: full,
  };
}

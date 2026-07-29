/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-036 Adaptive Examination Designer — adaptive exam blueprints (cst_adaptive_exams, migration 136).
// Each blueprint configures the item-pool bank, length, starting difficulty, mastery threshold and a
// standard-error stopping rule. The pool's real item count is surfaced so a blueprint whose bank is too
// small to sustain the maximum length is flagged. The adaptive delivery engine is the runtime layer.

const NONE = "00000000-0000-0000-0000-000000000000";

export const DIFFICULTIES = [{ key: "easy", label: "Easy" }, { key: "medium", label: "Medium" }, { key: "hard", label: "Hard" }];
export const DIFF_LABEL_A: Record<string, string> = Object.fromEntries(DIFFICULTIES.map(d => [d.key, d.label]));
export const AD_STATUS_TONE: Record<string, string> = { draft: "text-gray-500 bg-gray-50 border-gray-200", active: "text-teal-600 bg-teal-50 border-teal-200", archived: "text-gray-400 bg-gray-50 border-gray-200" };

export type AdaptiveExam = { id: string; name: string; description: string | null; bankId: string | null; bankName: string | null; poolSize: number; minItems: number; maxItems: number; startDifficulty: string; startLabel: string; passThreshold: number; seStop: number; status: string; createdBy: string | null; poolAdequate: boolean };

export async function loadAdaptiveExams(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const res = await scope(admin.from("cst_adaptive_exams").select("id, name, description, bank_id, min_items, max_items, start_difficulty, pass_threshold, se_stop, status, created_by_name, created_at").order("created_at", { ascending: false }).limit(500));
  if (res.error) return { provisioned: false as const };
  const rows = (res.data ?? []) as any[];

  const bankIds = [...new Set(rows.map(r => r.bank_id).filter(Boolean))] as string[];
  const bankName = new Map<string, string>();
  const poolSize = new Map<string, number>();
  if (bankIds.length) {
    const { data: bk } = await admin.from("question_banks").select("id, name").in("id", bankIds);
    for (const b of (bk ?? []) as any[]) bankName.set(b.id, b.name);
    const { data: qs } = await admin.from("questions").select("bank_id").in("bank_id", bankIds).limit(60000);
    for (const q of (qs ?? []) as any[]) if (q.bank_id) poolSize.set(q.bank_id, (poolSize.get(q.bank_id) ?? 0) + 1);
  }

  const exams: AdaptiveExam[] = rows.map(r => {
    const pool = r.bank_id ? (poolSize.get(r.bank_id) ?? 0) : 0;
    return {
      id: r.id, name: r.name, description: r.description, bankId: r.bank_id, bankName: r.bank_id ? (bankName.get(r.bank_id) ?? null) : null,
      poolSize: pool, minItems: r.min_items, maxItems: r.max_items, startDifficulty: r.start_difficulty, startLabel: DIFF_LABEL_A[r.start_difficulty] ?? r.start_difficulty,
      passThreshold: r.pass_threshold, seStop: Number(r.se_stop), status: r.status, createdBy: r.created_by_name,
      poolAdequate: !!r.bank_id && pool >= r.max_items,
    };
  });

  const count = (s: string) => exams.filter(e => e.status === s).length;
  return {
    provisioned: true as const,
    empty: exams.length === 0,
    kpis: { total: exams.length, active: count("active"), draft: count("draft"), poolWarnings: exams.filter(e => e.bankId && !e.poolAdequate).length },
    exams,
  };
}

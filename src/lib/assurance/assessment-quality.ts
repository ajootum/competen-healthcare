/* eslint-disable @typescript-eslint/no-explicit-any */
// CAPA-003 — Assessment Quality Engine. Classical test-theory item analysis over the REAL knowledge-item grain:
// `quiz_attempts` (question_id, user_id, is_correct, selected_answer) joined to `questions` (content, category,
// difficulty, type) — both in schema.sql. Computes per-item DIFFICULTY (p-value = share correct) and
// DISCRIMINATION (upper-minus-lower index: do stronger candidates get it right more than weaker ones?), flags
// items that are too easy/hard or that discriminate poorly/negatively, and rolls up quality by category. No
// migration — the item store already exists. Enterprise-wide (super-admin); scopes via profiles if hospital-bound.

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const isMissing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const MIN_Q_N = 8;   // min attempts on an item before we judge its discrimination
const MIN_U_N = 3;   // min attempts by a user before they count toward the ability ranking

// Item verdict from difficulty (p) + discrimination (d).
function verdict(p: number, d: number | null): { label: string; tone: string; flag: boolean } {
  if (d != null && d < 0) return { label: "Negative discrimination", tone: "rose", flag: true };
  if (p < 0.2) return { label: "Too hard", tone: "rose", flag: true };
  if (p > 0.95) return { label: "Too easy", tone: "amber", flag: true };
  if (d != null && d < 0.15) return { label: "Weak discrimination", tone: "amber", flag: true };
  if (p > 0.9) return { label: "Easy", tone: "amber", flag: false };
  return { label: "Good", tone: "emerald", flag: false };
}

export async function loadAssessmentQuality(admin: Admin, hid: string | null, isSuper: boolean) {
  const probe = await admin.from("quiz_attempts").select("id").limit(1);
  if (probe.error && isMissing(probe.error)) return { provisioned: false as const };

  let aq = admin.from("quiz_attempts").select("question_id, user_id, is_correct").not("question_id", "is", null).not("is_correct", "is", null).limit(100000);
  if (!isSuper) {
    const { data: profs } = await admin.from("profiles").select("id").eq("hospital_id", hid ?? NONE).limit(20000);
    const ids = (profs ?? []).map((p: any) => p.id);
    aq = aq.in("user_id", ids.length ? ids.slice(0, 3000) : [NONE]);
  }
  const { data } = await aq;
  const attempts = (data ?? []) as any[];
  if (!attempts.length) return emptyResult();

  // Per-user ability (mean correctness), for the upper/lower discrimination split.
  const userAgg = new Map<string, { n: number; c: number }>();
  for (const a of attempts) { const g = userAgg.get(a.user_id) ?? { n: 0, c: 0 }; g.n++; if (a.is_correct) g.c++; userAgg.set(a.user_id, g); }
  const ranked = [...userAgg.entries()].filter(([, g]) => g.n >= MIN_U_N).map(([u, g]) => ({ u, ability: g.c / g.n })).sort((a, b) => a.ability - b.ability);
  const cut = Math.max(1, Math.floor(ranked.length / 3));
  const lower = new Set(ranked.slice(0, cut).map(x => x.u));
  const upper = new Set(ranked.slice(-cut).map(x => x.u));
  const canDiscriminate = ranked.length >= 6; // need a meaningful group split

  // Per-item stats.
  const perQ = new Map<string, { n: number; c: number; uN: number; uC: number; lN: number; lC: number }>();
  for (const a of attempts) {
    const g = perQ.get(a.question_id) ?? { n: 0, c: 0, uN: 0, uC: 0, lN: 0, lC: 0 };
    g.n++; if (a.is_correct) g.c++;
    if (upper.has(a.user_id)) { g.uN++; if (a.is_correct) g.uC++; }
    if (lower.has(a.user_id)) { g.lN++; if (a.is_correct) g.lC++; }
    perQ.set(a.question_id, g);
  }

  // Join question metadata.
  const qIds = [...perQ.keys()];
  const qMeta = new Map<string, any>();
  if (qIds.length) { const { data: qs } = await admin.from("questions").select("id, content, category, difficulty, type").in("id", qIds.slice(0, 5000)); (qs ?? []).forEach((q: any) => qMeta.set(q.id, q)); }

  const items = qIds.map(id => {
    const g = perQ.get(id)!;
    const p = g.c / g.n;
    const d = (canDiscriminate && g.uN >= 2 && g.lN >= 2 && g.n >= MIN_Q_N) ? (g.uC / g.uN - g.lC / g.lN) : null;
    const v = verdict(p, d);
    const q = qMeta.get(id) ?? {};
    return {
      id, content: (q.content ?? "Item").slice(0, 120), category: q.category ?? "Uncategorised", type: q.type ?? "mcq",
      labelledDifficulty: q.difficulty ?? "medium",
      attempts: g.n, pValue: round2(p), discrimination: d == null ? null : round2(d),
      verdict: v.label, tone: v.tone, flag: v.flag,
    };
  });

  // Order: flagged first (negative disc → too hard/easy → weak), then by attempts.
  const rank: Record<string, number> = { "Negative discrimination": 0, "Too hard": 1, "Too easy": 2, "Weak discrimination": 3, Easy: 4, Good: 5 };
  items.sort((a, b) => (rank[a.verdict] - rank[b.verdict]) || b.attempts - a.attempts);

  const analysed = items.filter(i => i.discrimination != null);
  const flagged = items.filter(i => i.flag);
  const byCatMap = new Map<string, { p: number[]; d: number[]; n: number }>();
  for (const i of items) { const g = byCatMap.get(i.category) ?? { p: [], d: [], n: 0 }; g.p.push(i.pValue); if (i.discrimination != null) g.d.push(i.discrimination); g.n++; byCatMap.set(i.category, g); }
  const byCategory = [...byCatMap.entries()].map(([category, g]) => ({ category, items: g.n, avgDifficulty: round2(mean(g.p)), avgDiscrimination: g.d.length ? round2(mean(g.d)) : null })).sort((a, b) => b.items - a.items).slice(0, 10);

  return {
    provisioned: true as const, empty: false,
    kpis: {
      items: items.length,
      attempts: attempts.length,
      avgDifficulty: round2(mean(items.map(i => i.pValue))),
      avgDiscrimination: analysed.length ? round2(mean(analysed.map(i => i.discrimination as number))) : null,
      flagged: flagged.length,
      itemHealth: items.length ? Math.round(((items.length - flagged.length) / items.length) * 100) : 100,
      discriminable: analysed.length,
    },
    items: items.slice(0, 100),
    flagged: flagged.slice(0, 20),
    byCategory,
  };
}

function emptyResult() {
  return {
    provisioned: true as const, empty: true,
    kpis: { items: 0, attempts: 0, avgDifficulty: 0, avgDiscrimination: null as number | null, flagged: 0, itemHealth: 100, discriminable: 0 },
    items: [] as any[], flagged: [] as any[], byCategory: [] as any[],
  };
}

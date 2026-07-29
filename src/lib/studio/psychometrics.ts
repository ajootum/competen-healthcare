/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-045 Quality & Psychometrics — computes REAL item statistics from knowledge_attempts (migration 022),
// which store per-item responses in the `answers` jsonb ({question_id: chosen}) graded chosen ===
// questions.correct_answer (same comparison the /api/knowledge grader uses, so these stats match live
// grading exactly). Difficulty (p-value), point-biserial discrimination, distractor effectiveness, KR-20
// reliability and SEM are computed on read — no stored psychometric columns. Honest: a bank with too few
// attempts is reported as insufficient (item statistics need a reasonable candidate sample).

export const MIN_ATTEMPTS = 5;

export type ItemStat = { id: string; content: string; p: number; discrimination: number; responses: number; flags: string[]; distractors: { label: string; n: number; correct: boolean }[] };

export async function loadPsychometricsOverview(admin: any) {
  const bRes = await admin.from("question_banks").select("id, name, pass_mark, is_active").eq("is_active", true).order("name").limit(400);
  if (bRes.error) return { provisioned: false as const, banks: [], totalBanks: 0, analysable: 0 };
  const bankList = (bRes.data ?? []) as any[];
  const { data: atts } = await admin.from("knowledge_attempts").select("bank_id, score, passed").limit(80000);
  const byBank = new Map<string, { n: number; scoreSum: number; passed: number }>();
  for (const a of (atts ?? []) as any[]) { const g = byBank.get(a.bank_id) ?? { n: 0, scoreSum: 0, passed: 0 }; g.n++; g.scoreSum += Number(a.score) || 0; if (a.passed) g.passed++; byBank.set(a.bank_id, g); }
  const banks = bankList.map(b => { const g = byBank.get(b.id) ?? { n: 0, scoreSum: 0, passed: 0 }; return { id: b.id, name: b.name, passMark: b.pass_mark, attempts: g.n, meanScore: g.n ? Math.round(g.scoreSum / g.n) : 0, passRate: g.n ? Math.round((g.passed / g.n) * 100) : 0 }; });
  banks.sort((a, b) => b.attempts - a.attempts);
  return { provisioned: true as const, banks, totalBanks: banks.length, analysable: banks.filter(r => r.attempts >= MIN_ATTEMPTS).length };
}

export async function loadBankPsychometrics(admin: any, bankId: string) {
  const { data: bank } = await admin.from("question_banks").select("id, name, pass_mark").eq("id", bankId).maybeSingle();
  if (!bank) return { found: false as const };
  const { data: qData } = await admin.from("questions").select("id, content, correct_answer, options").eq("bank_id", bankId).limit(2000);
  const questions = (qData ?? []) as any[];
  const { data: aData } = await admin.from("knowledge_attempts").select("answers, correct, total, score, passed").eq("bank_id", bankId).limit(20000);
  const attempts = (aData ?? []) as any[];
  const n = attempts.length;
  const base = { found: true as const, bank: { name: bank.name, passMark: bank.pass_mark } };
  if (n < MIN_ATTEMPTS || questions.length === 0) return { ...base, attempts: n, insufficient: true as const, items: [] as ItemStat[], reliability: null };

  const totals = attempts.map(a => Number(a.correct) || 0);
  const meanTotal = totals.reduce((s, x) => s + x, 0) / n;
  const varTotal = totals.reduce((s, x) => s + (x - meanTotal) ** 2, 0) / n;
  const sdTotal = Math.sqrt(varTotal);

  const items: ItemStat[] = questions.map(q => {
    const resp: { total: number; correct: boolean; chosen: any }[] = [];
    for (let i = 0; i < attempts.length; i++) {
      const ans = attempts[i].answers;
      if (!ans || typeof ans !== "object" || !(q.id in ans)) continue;
      const chosen = (ans as any)[q.id];
      resp.push({ total: totals[i], correct: chosen === q.correct_answer, chosen });
    }
    const rn = resp.length;
    const p = rn ? resp.filter(r => r.correct).length / rn : 0;
    const g1 = resp.filter(r => r.correct).map(r => r.total);
    const g0 = resp.filter(r => !r.correct).map(r => r.total);
    const m1 = g1.length ? g1.reduce((s, x) => s + x, 0) / g1.length : 0;
    const m0 = g0.length ? g0.reduce((s, x) => s + x, 0) / g0.length : 0;
    const disc = sdTotal > 0 && g1.length && g0.length ? ((m1 - m0) / sdTotal) * Math.sqrt(p * (1 - p)) : 0;
    const distMap = new Map<string, number>();
    for (const r of resp) { const key = r.chosen == null ? "(blank)" : String(r.chosen); distMap.set(key, (distMap.get(key) ?? 0) + 1); }
    const distractors = [...distMap.entries()].map(([label, cnt]) => ({ label: label.length > 44 ? label.slice(0, 44) + "…" : label, n: cnt, correct: label === q.correct_answer })).sort((a, b) => b.n - a.n).slice(0, 6);
    const flags: string[] = [];
    if (p < 0.2) flags.push("too hard"); else if (p > 0.9) flags.push("too easy");
    if (disc < 0.2) flags.push("low discrimination");
    return { id: q.id, content: String(q.content ?? "").replace(/\s+/g, " ").slice(0, 90), p: Math.round(p * 100) / 100, discrimination: Math.round(disc * 100) / 100, responses: rn, flags, distractors };
  });

  const k = items.length;
  const sumPQ = items.reduce((s, it) => s + it.p * (1 - it.p), 0);
  const kr20 = k > 1 && varTotal > 0 ? (k / (k - 1)) * (1 - sumPQ / varTotal) : null;
  const sem = kr20 != null ? sdTotal * Math.sqrt(Math.max(0, 1 - kr20)) : null;
  const meanScore = attempts.reduce((s, a) => s + (Number(a.score) || 0), 0) / n;

  return {
    ...base, attempts: n, insufficient: false as const, items,
    reliability: {
      kr20: kr20 != null ? Math.round(kr20 * 100) / 100 : null,
      sem: sem != null ? Math.round(sem * 100) / 100 : null,
      meanScore: Math.round(meanScore),
      passRate: Math.round((attempts.filter(a => a.passed).length / n) * 100),
      meanP: Math.round((items.reduce((s, it) => s + it.p, 0) / k) * 100) / 100,
      meanDisc: Math.round((items.reduce((s, it) => s + it.discrimination, 0) / k) * 100) / 100,
      items: k,
      flagged: items.filter(it => it.flags.length > 0).length,
    },
  };
}

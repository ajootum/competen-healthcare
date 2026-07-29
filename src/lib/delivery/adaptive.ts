/* eslint-disable @typescript-eslint/no-explicit-any */
// CDP-003 — Adaptive delivery runtime (computerised adaptive testing). Consumes the cst_adaptive_exams
// blueprints (136) + a question bank and delivers a real CAT: a 1PL/Rasch ability estimate (theta) updated by
// Newton-Raphson MLE after each response, the next item chosen for maximum Fisher information at the current
// theta, and the test stopped on the standard-error rule (or min/max items). Real over cst_adaptive_exams +
// questions (schema.sql, categorical difficulty → b = -1/0/+1) + cdp_adaptive_sessions (146). The correct
// answer never leaves the server — scoring is server-side.

import { emitDomainEvent, EVENT } from "@/lib/orchestration/events";

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const B: Record<string, number> = { easy: -1, medium: 0, hard: 1 };
const bOf = (d: string | null) => B[d ?? "medium"] ?? 0;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const P = (theta: number, b: number) => 1 / (1 + Math.exp(-(theta - b)));
const info = (theta: number, b: number) => { const p = P(theta, b); return p * (1 - p); };
const masteryPct = (theta: number) => Math.round(100 * P(theta, 0)); // P(correct on a medium item) as ability %

type Item = { question_id: string; b: number; u: number };

// Newton-Raphson MLE of theta for the 1PL model; clamped so all-correct / all-wrong don't diverge.
function estimateTheta(items: Item[]): number {
  let theta = 0;
  for (let it = 0; it < 20; it++) {
    let num = 0, den = 0;
    for (const { b, u } of items) { const p = P(theta, b); num += u - p; den += p * (1 - p); }
    if (den < 1e-6) break;
    theta = clamp(theta + num / den, -4, 4);
  }
  return Math.round(theta * 1000) / 1000;
}
function seOf(theta: number, items: Item[]): number {
  const I = items.reduce((s, { b }) => s + info(theta, b), 0);
  return I > 0 ? Math.round((1 / Math.sqrt(I)) * 1000) / 1000 : 1;
}
function selectNext(pool: { id: string; b: number }[], administered: Set<string>, theta: number): { id: string; b: number } | null {
  let best: { id: string; b: number } | null = null, bestD = Infinity;
  for (const q of pool) { if (administered.has(q.id)) continue; const d = Math.abs(q.b - theta); if (d < bestD) { bestD = d; best = q; } }
  return best;
}

async function loadPool(admin: Admin, bankId: string) {
  const { data } = await admin.from("questions").select("id, difficulty").eq("bank_id", bankId).eq("is_published", true).limit(5000);
  return ((data ?? []) as any[]).map(q => ({ id: q.id as string, b: bOf(q.difficulty) }));
}
async function loadItem(admin: Admin, qid: string) {
  const { data } = await admin.from("questions").select("id, content, type, options").eq("id", qid).maybeSingle();
  return data ? { id: data.id, content: data.content, type: data.type, options: data.options } : null;
}

// Active adaptive exams the learner can take, with their last result.
export async function listAdaptiveExams(admin: Admin, nurseId: string, hid: string | null) {
  const { data: exams, error } = await admin.from("cst_adaptive_exams").select("id, name, description, min_items, max_items, pass_threshold, hospital_id").eq("status", "active").or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`).limit(200);
  if (error) return { provisioned: false as const };
  const { data: sess } = await admin.from("cdp_adaptive_sessions").select("exam_id, status, score_pct, passed, completed_at").eq("nurse_id", nurseId).order("completed_at", { ascending: false }).limit(500);
  const last = new Map<string, any>();
  for (const s of (sess ?? []) as any[]) if (s.exam_id && !last.has(s.exam_id)) last.set(s.exam_id, s);
  return { provisioned: true as const, exams: ((exams ?? []) as any[]).map(e => ({ id: e.id, name: e.name, description: e.description, minItems: e.min_items, maxItems: e.max_items, passThreshold: e.pass_threshold, last: last.get(e.id) ?? null })) };
}

export async function startAdaptiveSession(admin: Admin, examId: string, nurseId: string) {
  const { data: exam } = await admin.from("cst_adaptive_exams").select("id, hospital_id, name, bank_id, min_items, max_items, start_difficulty, status").eq("id", examId).maybeSingle();
  if (!exam) return { ok: false as const, error: "Exam not found" };
  if (exam.status !== "active") return { ok: false as const, error: "Exam is not active" };
  if (!exam.bank_id) return { ok: false as const, error: "Exam has no item bank" };
  const pool = await loadPool(admin, exam.bank_id);
  if (pool.length < Math.max(exam.min_items, 1)) return { ok: false as const, error: `Item bank has ${pool.length} question(s); needs at least ${exam.min_items}` };

  const theta0 = bOf(exam.start_difficulty);
  const first = selectNext(pool, new Set(), theta0);
  if (!first) return { ok: false as const, error: "No items available" };
  const { data: prof } = await admin.from("profiles").select("hospital_id").eq("id", nurseId).maybeSingle();
  const { data: sess, error } = await admin.from("cdp_adaptive_sessions").insert({ hospital_id: prof?.hospital_id ?? exam.hospital_id ?? null, exam_id: examId, nurse_id: nurseId, theta: theta0, se: 1 }).select("id").single();
  if (error) return { ok: false as const, error: error.message };
  const item = await loadItem(admin, first.id);
  return { ok: true as const, session_id: sess.id, exam: { name: exam.name, min: exam.min_items, max: exam.max_items }, item, progress: { administered: 0, max: exam.max_items } };
}

export async function submitAdaptiveAnswer(admin: Admin, sessionId: string, questionId: string, answer: string, nurseId: string) {
  const { data: sess } = await admin.from("cdp_adaptive_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!sess) return { ok: false as const, error: "Session not found" };
  if (sess.nurse_id !== nurseId) return { ok: false as const, error: "Not your session" };
  if (sess.status !== "in_progress") return { ok: false as const, error: "Session already complete" };
  const items = (sess.items ?? []) as Item[];
  if (items.some(i => i.question_id === questionId)) return { ok: false as const, error: "Item already answered" };

  const { data: q } = await admin.from("questions").select("id, difficulty, correct_answer").eq("id", questionId).maybeSingle();
  if (!q) return { ok: false as const, error: "Question not found" };
  const correct = String(answer ?? "").trim().toLowerCase() === String(q.correct_answer ?? "").trim().toLowerCase();
  const newItems: Item[] = [...items, { question_id: q.id, b: bOf(q.difficulty), u: correct ? 1 : 0 }];
  const theta = estimateTheta(newItems);
  const se = seOf(theta, newItems);
  const administered = newItems.length;
  const correctN = newItems.filter(i => i.u === 1).length;

  const { data: exam } = await admin.from("cst_adaptive_exams").select("bank_id, min_items, max_items, se_stop, pass_threshold").eq("id", sess.exam_id).maybeSingle();
  const maxItems = exam?.max_items ?? 60, minItems = exam?.min_items ?? 20, seStop = Number(exam?.se_stop ?? 0.3), passThreshold = exam?.pass_threshold ?? 70;

  const pool = exam?.bank_id ? await loadPool(admin, exam.bank_id) : [];
  const administeredSet = new Set(newItems.map(i => i.question_id));
  const next = selectNext(pool, administeredSet, theta);
  const stop = administered >= maxItems || (administered >= minItems && se <= seStop) || !next;

  if (stop) {
    const pct = masteryPct(theta);
    const passed = pct >= passThreshold;
    await admin.from("cdp_adaptive_sessions").update({ theta, se, administered, correct: correctN, items: newItems, status: "complete", score_pct: pct, passed, completed_at: new Date().toISOString() }).eq("id", sessionId);
    await emitDomainEvent(admin, { event_type: EVENT.ASSESSMENT_COMPLETED, subject_type: "cdp_adaptive_session", subject_id: sessionId, hospital_id: sess.hospital_id, actor_id: nurseId, payload: { exam_id: sess.exam_id, score_pct: pct, passed, items: administered, adaptive: true } });
    return { ok: true as const, done: true, correct, result: { scorePct: pct, passed, administered, correctN, theta: Math.round(theta * 100) / 100 } };
  }
  await admin.from("cdp_adaptive_sessions").update({ theta, se, administered, correct: correctN, items: newItems }).eq("id", sessionId);
  const item = await loadItem(admin, next!.id);
  return { ok: true as const, done: false, correct, item, progress: { administered, max: maxItems, se: Math.round(se * 100) / 100 } };
}

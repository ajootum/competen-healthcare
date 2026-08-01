import { currentTraceId } from "@/lib/trace";
/* eslint-disable @typescript-eslint/no-explicit-any */
// CDP-004 — Microlearning & Reinforcement engine. Spaced-repetition (SM-2) over cdp_reinforcement_cards (143):
// one card per (learner, competency), generated from achieved competency_decisions. The learner self-grades
// recall (0..5); SM-2 recomputes the ease factor + interval and reschedules the next review, so achieved
// competencies are retained instead of decaying. Real over competency_decisions (011) + framework_competencies
// + profiles. No fabricated content — the card is a retrieval-practice prompt, graded by the learner.

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const today = () => new Date().toISOString().slice(0, 10);

// The SM-2 spaced-repetition algorithm. quality 0..5 (grade of recall). Returns the new schedule state.
export function sm2(prev: { ease: number; interval: number; reps: number }, quality: number) {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  let ease = prev.ease, interval = prev.interval, reps = prev.reps;
  if (q < 3) { reps = 0; interval = 1; }                       // lapse → restart, review tomorrow
  else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.max(1, Math.round(interval * ease));
  }
  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  return { ease: Math.round(ease * 1000) / 1000, interval, reps, quality: q };
}

// Learner side: the cards due for review now + a small stat line.
export async function learnerReinforcement(admin: Admin, nurseId: string) {
  const t = today();
  const dueRes = await admin.from("cdp_reinforcement_cards")
    .select("id, subject, prompt, next_review_at, repetitions, interval_days, reviews")
    .eq("nurse_id", nurseId).eq("status", "active").lte("next_review_at", t)
    .order("next_review_at").limit(50);
  if (dueRes.error) return { provisioned: false as const };
  const [total, mastered] = await Promise.all([
    admin.from("cdp_reinforcement_cards").select("id", { count: "exact", head: true }).eq("nurse_id", nurseId),
    admin.from("cdp_reinforcement_cards").select("id", { count: "exact", head: true }).eq("nurse_id", nurseId).eq("status", "mastered"),
  ]);
  return { provisioned: true as const, due: (dueRes.data ?? []) as any[], stats: { total: total.count ?? 0, dueNow: (dueRes.data ?? []).length, mastered: mastered.count ?? 0 } };
}

// Learner reviews one card: apply SM-2 and reschedule. Owner-checked.
export async function reviewCard(admin: Admin, cardId: string, nurseId: string, quality: number) {
  const { data: card } = await admin.from("cdp_reinforcement_cards").select("id, nurse_id, ease_factor, interval_days, repetitions, reviews").eq("id", cardId).maybeSingle();
  if (!card) return { ok: false as const, error: "Card not found" };
  if (card.nurse_id !== nurseId) return { ok: false as const, error: "Not your card" };
  const next = sm2({ ease: card.ease_factor ?? 2.5, interval: card.interval_days ?? 0, reps: card.repetitions ?? 0 }, quality);
  const nextDate = new Date(Date.now() + next.interval * 864e5).toISOString().slice(0, 10);
  const status = next.reps >= 5 && next.interval >= 60 ? "mastered" : "active";
  const { error } = await admin.from("cdp_reinforcement_cards").update({
    ease_factor: next.ease, interval_days: next.interval, repetitions: next.reps,
    next_review_at: nextDate, last_reviewed_at: new Date().toISOString(), last_quality: next.quality,
    reviews: (card.reviews ?? 0) + 1, status,
  }).eq("id", cardId);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, nextReviewAt: nextDate, intervalDays: next.interval, status };
}

// Operator side: reinforcement coverage across the tenant.
export async function loadReinforcementQueue(admin: Admin, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const t = today();
  const totalRes = await scope(admin.from("cdp_reinforcement_cards").select("id", { count: "exact", head: true }));
  if (totalRes.error) return { provisioned: false as const };
  const [dueRes, masteredRes, rowsRes] = await Promise.all([
    scope(admin.from("cdp_reinforcement_cards").select("id", { count: "exact", head: true }).eq("status", "active").lte("next_review_at", t)),
    scope(admin.from("cdp_reinforcement_cards").select("id", { count: "exact", head: true }).eq("status", "mastered")),
    scope(admin.from("cdp_reinforcement_cards").select("nurse_id, subject, status, next_review_at").limit(20000)),
  ]);
  const rows = (rowsRes.data ?? []) as any[];
  const learners = new Set(rows.map(r => r.nurse_id)).size;
  const bySubject = new Map<string, { subject: string; cards: number; due: number }>();
  for (const r of rows) {
    const s = bySubject.get(r.subject) ?? { subject: r.subject, cards: 0, due: 0 };
    s.cards++; if (r.status === "active" && r.next_review_at <= t) s.due++;
    bySubject.set(r.subject, s);
  }
  const subjects = [...bySubject.values()].sort((a, b) => b.cards - a.cards).slice(0, 25);
  return { provisioned: true as const, kpis: { total: totalRes.count ?? 0, due: dueRes.count ?? 0, mastered: masteredRes.count ?? 0, learners }, subjects };
}

// Generate reinforcement cards from achieved competency decisions (one per learner+competency, idempotent).
const ACHIEVED = ["competent", "competent_with_conditions", "provisionally_competent"];
export async function generateFromDecisions(admin: Admin, hid: string | null, isSuper: boolean, actor: { id: string | null; name: string | null }) {
  const { data: decisions, error } = await admin.from("competency_decisions")
    .select("nurse_id, competency_id, outcome").in("outcome", ACHIEVED).not("competency_id", "is", null).limit(20000);
  if (error) return { ok: false as const, error: error.message, created: 0, skipped: 0 };

  const pairs = new Map<string, { nurse_id: string; competency_id: string }>();
  for (const d of (decisions ?? []) as any[]) pairs.set(`${d.nurse_id}|${d.competency_id}`, { nurse_id: d.nurse_id, competency_id: d.competency_id });
  const pairList = [...pairs.values()];
  if (!pairList.length) return { ok: true as const, created: 0, skipped: 0 };

  const nurseIds = [...new Set(pairList.map(p => p.nurse_id))];
  const compIds = [...new Set(pairList.map(p => p.competency_id))];
  const [existRes, compRes, profRes] = await Promise.all([
    admin.from("cdp_reinforcement_cards").select("nurse_id, competency_id").in("nurse_id", nurseIds.slice(0, 2000)),
    admin.from("framework_competencies").select("id, name").in("id", compIds.slice(0, 2000)),
    admin.from("profiles").select("id, hospital_id").in("id", nurseIds.slice(0, 2000)),
  ]);
  const have = new Set(((existRes.data ?? []) as any[]).map(c => `${c.nurse_id}|${c.competency_id}`));
  const compName = new Map(((compRes.data ?? []) as any[]).map(c => [c.id, c.name]));
  const nurseHosp = new Map(((profRes.data ?? []) as any[]).map(p => [p.id, p.hospital_id]));

  const fresh = pairList.filter(p => !have.has(`${p.nurse_id}|${p.competency_id}`) && (isSuper || nurseHosp.get(p.nurse_id) === hid));
  const rows = fresh.map(p => {
    const name = (compName.get(p.competency_id) as string) ?? "competency";
    return { hospital_id: (nurseHosp.get(p.nurse_id) as string | null) ?? null, nurse_id: p.nurse_id, competency_id: p.competency_id, subject: name, prompt: `Recall the key steps, indications and safety checks for "${name}".`, source: "decision" };
  });

  let created = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error: insErr } = await admin.from("cdp_reinforcement_cards").insert(rows.slice(i, i + 500)).select("id");
    if (!insErr) created += (data ?? []).length;
  }
  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: actor.id, actor_name: actor.name, action: "reinforcement_generate", entity_type: "cdp_reinforcement_cards", new_value: { candidates: pairList.length, created } });
  return { ok: true as const, created, skipped: pairList.length - fresh.length };
}

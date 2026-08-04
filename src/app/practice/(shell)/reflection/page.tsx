import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import {
  reflectionJournal, listReflections, REFLECTION_CATEGORIES, REFLECTION_PROMPTS, REFLECTION_LIMITS,
} from "@/lib/practice/reflection";
import ReflectionComposer from "./ReflectionComposer";

// /practice/reflection -- CPR-230 CLINICAL REFLECTION.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE COMP'S SIX HEADLINE TILES ARE FIVE RATES AND A STREAK, AND NONE OF THEM SURVIVES.
//
// "28 reflections, up 21% vs last 30 days" · "64 learning points, up 18%" · "17 actions, up 13%" ·
// "11 completed, 65% completion rate" · "Reflection Streak: 12 days -- Keep it going!" · "Growth Score
// 82/100, up 8 pts". Underneath, four bars claiming reflection produced Better Decisions 82% and
// Improved Outcomes 78%.
//
// The streak is refused for a reason of its own, not merely as a number: it rewards the ACT of
// reflecting rather than the substance, and what it reliably produces is entries written to keep a
// counter alive. It also punishes leave, illness and a fortnight of nights.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// PRIVATE BY DEFAULT -- and the page says what private does and does not mean, because "Your
// reflections are secure" in the comp's footer would let somebody believe a written reflection cannot
// be requested in professional proceedings. It can.

export const dynamic = "force-dynamic";

export default async function ReflectionPage({ searchParams }: {
  searchParams: Promise<{ encounterId?: string; mine?: string; category?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");

  const { encounterId, mine, category } = await searchParams;
  const admin = createAdminClient();

  const [journal, reflections] = await Promise.all([
    reflectionJournal(admin, shell.ctx),
    listReflections(admin, shell.ctx, {
      mineOnly: mine === "1", encounterId, category, limit: 20,
    }),
  ]);

  const card = "rounded-xl border border-gray-200 bg-white p-4";

  return (
    <div className="max-w-6xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Clinical reflection</h1>
        <p className="mt-0.5 text-[13px] text-gray-500">
          Yours, and private unless you decide otherwise.
        </p>
      </div>

      {/* ── The strip (comp: six tiles, five rates and a streak) ────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Reflections</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{journal.reflections}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">{journal.aboutAConsultation} about a consultation</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Shared with the practice</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{journal.shared}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">of {journal.reflections} &middot; the rest only you can read</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Actions you committed to</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{journal.actions.committed}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            {journal.actions.done} done &middot; {journal.actions.open} still open
          </p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Learning shared</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{journal.learningsShared}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            <Link href="/practice/cases" className="hover:underline">in case memory</Link>
          </p>
        </div>
        {/* THE COMP'S STREAK TILE AND GROWTH SCORE, IN THEIR DESIGNED POSITION. */}
        <div className={`${card} border-dashed bg-gray-50/60`}>
          <p className="text-[11px] font-semibold text-gray-500">Streak &middot; growth score</p>
          <p className="mt-1 text-2xl font-bold text-gray-300">&mdash;</p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            Neither is counted here. A streak rewards writing something, not writing something true.
          </p>
        </div>
      </div>

      <div className="mt-4 grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* ── Write one ───────────────────────────────────────────────────────────────────── */}
          <ReflectionComposer
            encounterId={encounterId ?? ""}
            categories={REFLECTION_CATEGORIES.map(([key, label]) => ({ key, label }))}
            prompts={REFLECTION_PROMPTS.map(p => ({ field: p.field, label: p.label, hint: p.hint }))}
          />

          {/* ── The journal ─────────────────────────────────────────────────────────────────── */}
          <section className={card}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[13px] font-bold text-gray-900">Your journal</h2>
              <Link href={mine === "1" ? "/practice/reflection" : "/practice/reflection?mine=1"}
                className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                {mine === "1" ? "Include shared" : "Only mine"}
              </Link>
            </div>
            {reflections.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">
                Nothing written yet. A reflection takes a couple of minutes and is yours alone.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-3">
                {reflections.map(r => (
                  <li key={r.id} className="border-b border-gray-100 pb-3 last:border-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                        {r.categoryLabel}
                      </span>
                      <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">
                        {r.visibility === "practice" ? "shared" : "private"}
                      </span>
                      {r.locked && (
                        <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">
                          locked
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-gray-500">
                        {r.authorName} &middot; {String(r.created_at).slice(0, 10)}
                      </span>
                    </div>
                    {[
                      ["What went well", r.went_well],
                      ["What could have gone better", r.could_improve],
                      ["What you learned", r.learned],
                      ["What you will do differently", r.will_do_differently],
                      [null, r.narrative],
                    ].map(([label, text], i) => text ? (
                      <div key={i} className="mt-1">
                        {label && <p className="text-[10px] font-semibold text-gray-500">{label}</p>}
                        <p className="text-[12px] text-gray-800">{text}</p>
                      </div>
                    ) : null)}
                    {r.href && (
                      <Link href={r.href} className="mt-1 inline-block text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                        the consultation →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {/* ── What you reflect on (comp: a donut with percentages) ─────────────────────────── */}
          <section className={card}>
            <h2 className="text-[13px] font-bold text-gray-900">What you reflect on</h2>
            {journal.byCategory.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">Nothing yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {journal.byCategory.map(c => (
                  <li key={c.key} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                    <span className="truncate text-[12px] text-gray-800">{c.label}</span>
                    <span className="ml-auto text-[12px] font-bold text-gray-900">{c.total}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-[10px] text-gray-400">
              Counts, not shares. The design puts a percentage beside each; over eleven reflections a
              percentage is just a count wearing a disguise.
            </p>
          </section>

          {/* ── The four prompts, which need no model ─────────────────────────────────────────── */}
          <section className={card}>
            <h2 className="text-[13px] font-bold text-gray-900">The four questions</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              The design offers to generate these with AI. They are the same four questions every time,
              so they are written down instead.
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {REFLECTION_PROMPTS.map(p => (
                <li key={p.field}>
                  <p className="text-[12px] font-semibold text-gray-700">{p.label}</p>
                  <p className="text-[10px] text-gray-500">{p.hint}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-gray-500">
              For anything that needs reading the record &mdash; summarising a consultation before you
              reflect on it &mdash; the{" "}
              <Link href="/practice/assistant" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                clinical assistant
              </Link>{" "}
              does that, and says what it sends where.
            </p>
          </section>

          {/* THE PANEL THE COMP HAS NO ROOM FOR. */}
          <section className={`${card} border-dashed bg-gray-50/60`}>
            <h2 className="text-[13px] font-bold text-gray-900">Worth knowing before you write</h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {REFLECTION_LIMITS.map(l => (
                <li key={l.key}>
                  <p className="text-[12px] font-semibold text-gray-700">{l.label}</p>
                  <p className="text-[10px] text-gray-500">{l.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

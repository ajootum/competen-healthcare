import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import {
  assistantSettings, assistantUsage, listSessions, sessionMessages,
  ASSISTANT_TASKS, REFUSED, AI_NOTICE,
} from "@/lib/practice/ai-assistant";
import AssistantConsole from "./AssistantConsole";

// /practice/assistant -- CPR-210 AI CLINICAL ASSISTANT.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE ASSISTANT REORGANISES WHAT IS IN THE RECORD. IT DOES NOT ORIGINATE CLINICAL FACTS.
//
// The comp draws a generated SOAP note containing "Paracetamol 1g TDS PRN" and "MRI review if no
// improvement in 4 weeks", cites NICE NG59 and the WHO primary care guidelines, and puts "Confidence:
// High -- 92%" underneath with a green bar. Every one of those is refused, and the reasons are ON THIS
// PAGE rather than in a comment, because a practitioner deciding how far to trust an assistant is better
// served by a list of what it will not do than by a badge saying it is compliant.
//
// What is left is real and useful: summarise the consultation you wrote, draft a referral from it, put
// the plan into plain language, tidy your shorthand, ask about the record in front of you.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// OFF UNTIL SOMEBODY TURNS IT ON. Using it sends record content to a third-party model provider, which
// is a disclosure, so the practice agrees to it explicitly and the agreement is dated and attributed.

export const dynamic = "force-dynamic";

export default async function AssistantPage({ searchParams }: {
  searchParams: Promise<{ encounterId?: string; sessionId?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "encounter.list")) redirect("/practice/home");

  const { encounterId, sessionId } = await searchParams;
  const admin = createAdminClient();

  const [settings, usage, sessions, conversation] = await Promise.all([
    assistantSettings(admin, shell.ctx.workspaceId),
    assistantUsage(admin, shell.ctx),
    listSessions(admin, shell.ctx, 10),
    sessionId ? sessionMessages(admin, shell.ctx, sessionId) : Promise.resolve(null),
  ]);

  const card = "rounded-xl border border-gray-200 bg-white p-4";
  const canManage = hasCapability(shell.ctx, "practice.settings.manage");

  return (
    <div className="max-w-6xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Clinical assistant</h1>
        <p className="mt-0.5 text-[13px] text-gray-500">
          It works from the record you have open. It does not know medicine you have not written down.
        </p>
      </div>

      <div className="mt-4 grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* ── The gate ────────────────────────────────────────────────────────────────────── */}
          {!settings.enabled || !settings.noticeCurrent ? (
            <section className={`${card} border-dashed bg-gray-50/60`}>
              <h2 className="text-[13px] font-bold text-gray-900">
                {settings.enabled && !settings.noticeCurrent
                  ? "What this discloses has changed"
                  : "The assistant is off for this practice"}
              </h2>
              <p className="mt-1 text-[12px] text-gray-600">
                Before it can be used, somebody here has to agree to this:
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {AI_NOTICE.map((n, i) => (
                  <li key={i} className="text-[12px] text-gray-700">&mdash; {n}</li>
                ))}
              </ul>
              {canManage ? (
                <AssistantConsole mode="enable" noticeVersion={settings.noticeVersionCurrent} />
              ) : (
                <p className="mt-3 text-[11px] text-gray-500">
                  Turning it on is a practice setting, and you do not hold that permission.
                </p>
              )}
              {!settings.configured && (
                <p className="mt-3 text-[11px] text-gray-500">
                  Separately: no model provider is configured for this deployment, so even once it is
                  switched on there is nothing behind it yet. Said plainly rather than shown as a status dot.
                </p>
              )}
            </section>
          ) : (
            <AssistantConsole
              mode="ask"
              encounterId={encounterId ?? ""}
              sessionId={sessionId ?? ""}
              tasks={ASSISTANT_TASKS.map(t => ({ key: t.key, label: t.label, blurb: t.blurb, needs: t.needs }))}
            />
          )}

          {/* ── The conversation ────────────────────────────────────────────────────────────── */}
          {conversation && (
            <section className={card}>
              <h2 className="text-[13px] font-bold text-gray-900">{conversation.session.title}</h2>
              <ul className="mt-2 flex flex-col gap-3">
                {conversation.messages.map(m => (
                  <li key={m.id}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      {m.role === "practitioner" ? "You asked" : "The assistant"}
                    </p>
                    {m.status !== "ok" && m.role === "assistant" ? (
                      <p className="mt-0.5 text-[12px] text-gray-500">
                        It could not answer ({m.status}). Nothing was recorded against the patient.
                      </p>
                    ) : (
                      <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-gray-800">{m.body}</p>
                    )}
                    {m.role === "assistant" && m.status === "ok" && (
                      <>
                        {/* THE COMP'S "SOURCES & RATIONALE" PANEL, WITH INTERNAL SOURCES ONLY. Every
                            one is a row in this practice that opens. */}
                        {Array.isArray(m.grounding) && m.grounding.length > 0 && (
                          <div className="mt-1.5">
                            <p className="text-[10px] font-semibold text-gray-500">Built from</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {m.grounding.map((g: { kind: string; id: string; label: string; href?: string }) => (
                                g.href ? (
                                  <Link key={`${g.kind}-${g.id}`} href={g.href}
                                    className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-700 hover:bg-gray-100">
                                    {g.label}
                                  </Link>
                                ) : (
                                  <span key={`${g.kind}-${g.id}`}
                                    className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-700">
                                    {g.label}
                                  </span>
                                )
                              ))}
                            </div>
                          </div>
                        )}
                        <p className="mt-1 text-[10px] text-gray-400">
                          {m.model ?? "model not recorded"}
                          {m.provider ? ` via ${m.provider}` : ""} &middot; nothing here is in the patient&rsquo;s
                          record unless you put it there
                        </p>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── What it will not do (comp: eight tool tiles) ─────────────────────────────────── */}
          <section className={`${card} border-dashed bg-gray-50/60`}>
            <h2 className="text-[13px] font-bold text-gray-900">What this assistant will not do</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              The design offers each of these. Every one is refused, and here is why &mdash; which is more
              use than a badge saying the assistant is compliant.
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {REFUSED.map(r => (
                <li key={r.key}>
                  <p className="text-[12px] font-semibold text-gray-700">{r.label}</p>
                  <p className="text-[10px] text-gray-500">{r.reason}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {/* ── Status (comp: "Model: Competen Clinical LLM v2.1 / Online") ──────────────────── */}
          <section className={card}>
            <h2 className="text-[13px] font-bold text-gray-900">What is actually behind this</h2>
            <ul className="mt-2 flex flex-col">
              {[
                ["Provider", settings.provider ?? "none configured"],
                ["Model", settings.model ?? "none configured"],
                ["Enabled here", settings.enabled ? "yes" : "no"],
                ["Agreed on", settings.enabledAt ? String(settings.enabledAt).slice(0, 10) : "not agreed"],
              ].map(([k, v]) => (
                <li key={String(k)} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                  <span className="text-[12px] text-gray-700">{k}</span>
                  <span className="ml-auto truncate text-[11px] font-semibold text-gray-900">{v}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[10px] text-gray-400">
              The design names a &ldquo;Competen Clinical LLM v2.1&rdquo;. There is no such model, and no
              bespoke clinical model anywhere in this product &mdash; so the real one is named instead.
            </p>
          </section>

          {/* ── Usage ───────────────────────────────────────────────────────────────────────── */}
          <section className={card}>
            <h2 className="text-[13px] font-bold text-gray-900">Use in this practice</h2>
            <ul className="mt-2 flex flex-col">
              {[
                ["Conversations", usage.sessions],
                ["Answers given", usage.answers],
                ["Times it failed", usage.failures],
                ["Marked useful", usage.ratedHelpful],
                ["Marked not useful", usage.ratedUnhelpful],
              ].map(([k, v]) => (
                <li key={String(k)} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                  <span className="text-[12px] text-gray-700">{k}</span>
                  <span className="ml-auto text-[12px] font-bold text-gray-900">{v}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[10px] text-gray-500">{usage.accuracyNote}</p>
          </section>

          {/* ── Recent conversations (comp: "Recent Interactions") ───────────────────────────── */}
          <section className={card}>
            <h2 className="text-[13px] font-bold text-gray-900">Your recent conversations</h2>
            {sessions.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">Nothing yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {sessions.map((s: { id: string; title: string | null; task: string; created_at: string }) => (
                  <li key={s.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                    <Link href={`/practice/assistant?sessionId=${s.id}`}
                      className="min-w-0 truncate text-[12px] text-gray-800 hover:underline">
                      {s.title ?? s.task}
                    </Link>
                    <span className="ml-auto shrink-0 text-[10px] text-gray-500">
                      {String(s.created_at).slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-[10px] text-gray-400">
              Yours only. A conversation carries your questions about patients you were treating, so it is
              not practice-wide reading.
            </p>
          </section>

          <section className={`${card} border-dashed bg-gray-50/60`}>
            <h2 className="text-[13px] font-bold text-gray-900">The limit worth knowing</h2>
            <p className="mt-1 text-[11px] text-gray-600">
              The assistant is instructed not to introduce anything the record does not contain. That
              instruction cannot be proven to hold: a test here can show that nothing reaches the patient
              record and that every answer names its sources, but no test can show a model obeyed. Read
              what it gives you as a draft by a colleague who has only read the notes.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import {
  assistantSettings, assistantUsage, listSessions, sessionMessages,
  ASSISTANT_TASKS, CONTEXT_KINDS, REFUSED, AI_NOTICE,
} from "@/lib/practice/ai-assistant";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { STATE_COPY } from "@/lib/practice/intelligence-constants";
import AssistantConsole from "../assistant/AssistantConsole";
import { CARD, PanelHead, ProvenanceChip } from "./Ui";
import { practiceDayOf } from "@/lib/practice/practice-time";

// CPR-PI-001 s6's ninth area, and s3's consolidation decision.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE ASSISTANT IS AN AREA OF THIS WORKSPACE, NOT A WORKSPACE OF ITS OWN. s3: "Remove the separate
// Practice Assistant item from the global sidebar."
//
// ⚠ AND IT IS THE SAME CONSOLE, NOT A SECOND ONE. Every route into this assistant goes through one
// consent gate, one disclosure log and one grounding contract. A second console rendered here would be
// a second implementation of all three -- and the one somebody forgot to update the day the disclosure
// changed. So this imports the console the /practice/assistant route already uses.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ THE ASSISTANT IS NOT CALLED WHEN THE WORKSPACE LOADS. s12: "Unavailable AI must not block
// dashboards." This area reads its own settings when somebody opens it; the other eight areas are
// arithmetic and never wait on a model provider.

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function AssistantArea({ admin, ctx, sessionId, question }: {
  admin: any; ctx: WorkspaceContext; sessionId?: string; question?: string;
}) {
  // The practice's day for the session dates below. This component takes admin and ctx as props, so
  // the clock is one read away -- there was no reason for it to be showing the server's.
  const timezone = ctx.workspaceTimezone;
  const canUse = hasCapability(ctx, "encounter.list");
  if (!canUse) {
    return (
      <section className={`${CARD} border-dashed bg-slate-50/60`}>
        <PanelHead panel="ai_insight" title="Assistant" />
        <p className="mt-2 text-[12px] font-semibold text-gray-700">{STATE_COPY.not_permitted.title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600">
          The assistant works from consultations, and your role does not include reading them.
          {STATE_COPY.not_permitted.body}
        </p>
      </section>
    );
  }

  const [settings, usage, sessions, conversation] = await Promise.all([
    assistantSettings(admin, ctx.workspaceId),
    assistantUsage(admin, ctx),
    listSessions(admin, ctx, 8),
    sessionId ? sessionMessages(admin, ctx, sessionId) : Promise.resolve(null),
  ]);

  const canManage = hasCapability(ctx, "practice.settings.manage");
  const gated = !settings.enabled || !settings.noticeCurrent;

  return (
    <div className="grid gap-4 lg:grid-cols-3 items-start">
      <div className="lg:col-span-2 flex flex-col gap-4">
        {gated ? (
          <section className={`${CARD} border-dashed bg-gray-50/60`}>
            <PanelHead panel="ai_insight" title={settings.enabled && !settings.noticeCurrent
              ? "What this discloses has changed"
              : "The assistant is off for this practice"} />
            <p className="mt-2 text-[12px] text-gray-600">
              Before it can be used, somebody here has to agree to this:
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {AI_NOTICE.map((n, i) => <li key={i} className="text-[12px] text-gray-700">&mdash; {n}</li>)}
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
                switched on there is nothing behind it yet. {STATE_COPY.ai_unavailable.body}
              </p>
            )}
          </section>
        ) : (
          <AssistantConsole
            mode="ask"
            sessionId={sessionId ?? ""}
            question={question ?? ""}
            returnTo="/practice/intelligence?tab=assistant"
            tasks={ASSISTANT_TASKS.map(t => ({ key: t.key, label: t.label, blurb: t.blurb, needs: t.needs }))}
            contexts={CONTEXT_KINDS.map(c => ({ key: c.key, label: c.label, blurb: c.blurb, param: c.param }))}
          />
        )}

        {conversation && (
          <section className={CARD}>
            <PanelHead panel="ai_insight" title={conversation.session.title ?? conversation.session.task} />
            <ul className="mt-3 flex flex-col gap-3">
              {conversation.messages.map((m: any) => (
                <li key={m.id}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    {m.role === "practitioner" ? "You asked" : "The assistant"}
                  </p>
                  {m.status !== "ok" && m.role === "assistant" ? (
                    <p className="mt-0.5 text-[12px] text-gray-500">
                      It could not answer ({m.status}). Nothing was recorded against the patient, and the
                      rest of this workspace is unaffected.
                    </p>
                  ) : (
                    <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-gray-800">{m.body}</p>
                  )}
                  {m.role === "assistant" && m.status === "ok" && (
                    <>
                      {/* ⚠ THE SOURCES ARE ROWS IN THIS PRACTICE AND EVERY ONE OPENS. The designs cite
                          NICE NG59 and the WHO primary care guidelines; this product holds neither, so
                          such a citation would be a title the model recalled. */}
                      {Array.isArray(m.grounding) && m.grounding.length > 0 && (
                        <div className="mt-1.5">
                          <p className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-500">
                            <ProvenanceChip kind="ai" /> Built from
                          </p>
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
                        {m.model ?? "model not recorded"}{m.provider ? ` via ${m.provider}` : ""} &middot;
                        nothing here is in the patient&rsquo;s record unless you put it there
                      </p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={`${CARD} border-dashed bg-gray-50/60`}>
          <PanelHead panel="refused" title="What this assistant will not do"
            note="The designs offer each of these. Every one is refused, and the reason is more use than a badge saying it is compliant." />
          <ul className="mt-2 grid gap-2 md:grid-cols-2">
            {REFUSED.map(r => (
              <li key={r.key} className="rounded-lg border border-dashed border-slate-300 bg-white p-2.5">
                <p className="text-[11px] font-bold text-gray-700">{r.label}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-gray-600">{r.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="flex flex-col gap-4">
        <section className={CARD}>
          <PanelHead panel="ai_insight" title="What is actually behind this" />
          <ul className="mt-2 flex flex-col">
            {[
              // ⚠ THIS SAID "Provider: openai / Model: gpt-4o" ON A BUILD THAT CANNOT DRIVE OPENAI.
              // The panel exists to say what is actually behind an answer, so a key that is present but
              // unusable has to read as unusable -- otherwise the one place a practitioner goes to check
              // is the place that reassures them.
              ["Provider", !settings.provider ? "none configured"
                : settings.providerUsable ? settings.provider
                : `${settings.provider} (key present, but this build generates only with Anthropic)`],
              ["Model", settings.providerUsable ? (settings.model ?? "none configured") : "none in use"],
              ["Enabled here", settings.enabled ? "yes" : "no"],
              ["Agreed on", settings.enabledAt ? String(settings.enabledAt).slice(0, 10) : "not agreed"],
            ].map(([k, v]) => (
              <li key={String(k)} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                <span className="text-[12px] text-gray-700">{k}</span>
                <span className="ml-auto truncate text-[11px] font-semibold text-gray-900">{v}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] leading-relaxed text-gray-400">
            The designs name a &ldquo;Competen Clinical LLM v2.1&rdquo;. There is no such model, and no
            bespoke clinical model anywhere in this product &mdash; so the real one is named instead.
          </p>
        </section>

        <section className={CARD}>
          <PanelHead panel="ai_insight" title="Use in this practice" />
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
                <span className="ml-auto text-[12px] font-bold tabular-nums text-gray-900">{v}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">{usage.accuracyNote}</p>
        </section>

        <section className={CARD}>
          <PanelHead panel="ai_insight" title="Your recent conversations" />
          {sessions.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">Nothing yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {sessions.map((s: any) => (
                <li key={s.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                  <Link href={`/practice/intelligence?tab=assistant&sessionId=${s.id}`}
                    className="min-w-0 truncate text-[12px] text-gray-800 hover:underline">
                    {s.title ?? s.task}
                  </Link>
                  <span className="ml-auto shrink-0 text-[10px] text-gray-500">
                    {practiceDayOf(timezone, s.created_at) ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[10px] leading-relaxed text-gray-400">
            Yours only. A conversation carries your questions about patients you were treating, so it is
            not practice-wide reading.
          </p>
        </section>

        <section className={`${CARD} border-dashed bg-gray-50/60`}>
          <PanelHead panel="refused" title="The limit worth knowing" />
          <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
            The assistant is instructed not to introduce anything the record does not contain. That
            instruction cannot be proven to hold: a test here can show that nothing reaches the patient
            record, that every answer names its sources, and that it refuses outright without one &mdash;
            but no test can show a model obeyed. Read what it gives you as a draft by a colleague who has
            only read the notes.
          </p>
        </section>
      </div>
    </div>
  );
}

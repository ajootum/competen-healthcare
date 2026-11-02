import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { listMyGrants, type GrantView } from "@/lib/assessment/assessor/grants";
import { listMyInstances } from "@/lib/assessment/assessor/instances";
import { GRANT_STATE_LABEL } from "@/lib/assessment/assessor/common";
import { Chip } from "@/components/assessment/ui";
import { StartButton } from "./_components/StartButton";

// /super-admin/checklist-assessments -- the assessor's queue (Checklist Studio S4). Guarded by hq.assessment.instrument.assess,
// which only the checklist assessor position holds. NOT /super-admin/competency-assessment (verification): a different authority.
//
// ⚠ ONLY WHAT IS MINE. Grants made to me and instances where I am the assessor. A person is assessed only under a grant they
// accepted, and the result is assessor-evaluated work, not formal verification.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assessor workspace" };

const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const h2 = "text-xs font-bold uppercase tracking-[0.14em] text-[var(--cmp-app-text-secondary)]";
const card = "rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4";
const link = "inline-flex min-h-[var(--cmp-touch-min)] items-center rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 text-sm font-semibold text-[var(--cmp-app-text)] hover:bg-[var(--cmp-app-bg)]";

function Who({ g }: { g: GrantView | undefined }) {
  return <span>{g?.instrument_name ?? "Checklist"} <span className="font-normal text-[var(--cmp-app-text-secondary)]">for {g?.subject_name ?? "a person"}</span></span>;
}

export default async function ChecklistAssessmentsPage() {
  const ctx = await requireHqCapability("hq.assessment.instrument.assess");
  const [grants, instances] = await Promise.all([listMyGrants(ctx.admin, ctx.userId), listMyInstances(ctx.admin, ctx.userId)]);

  return (
    <div data-cmp-theme="platform" className="max-w-4xl space-y-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--cmp-theme-ink)]">Competen Holdings</p>
        <h1 className="text-xl font-bold text-[var(--cmp-app-text)]">Assessor workspace</h1>
        <p className="mt-1 text-sm text-[var(--cmp-app-text-secondary)]">Assessments you are authorised to carry out. Each is for one person, with one checklist, under a grant the person accepted.</p>
        <p className="mt-1 text-xs text-[var(--cmp-app-text-secondary)]">Your result is assessor-evaluated. It is not formal verification.</p>
        {ctx.isOwner || ctx.capabilities.includes("hq.assessment.assessor.assign") ? (
          <p className="mt-2 text-sm"><Link href="/super-admin/checklist-assessments/grants" className="font-semibold text-[var(--cmp-theme-ink)] underline underline-offset-2">Assessor grants</Link> <span className="text-[var(--cmp-app-text-secondary)]">(coordinators)</span></p>
        ) : null}
      </header>

      {!grants.ok ? (
        <p role="alert" className={`${card} text-sm text-[var(--cmp-app-text)]`}>{grants.error}</p>
      ) : !instances.ok ? (
        <p role="alert" className={`${card} text-sm text-[var(--cmp-app-text)]`}>{instances.error}</p>
      ) : (() => {
        const byId = new Map(grants.value.map(g => [g.id, g]));
        const awaiting = grants.value.filter(g => g.state === "pending" || g.state === "not_yet");
        const ready = grants.value.filter(g => g.state === "live");
        const finished = grants.value.filter(g => g.state === "ended" || g.state === "expired");
        const inProgress = instances.value.filter(i => i.status === "in_progress");
        const submitted = instances.value.filter(i => i.status === "submitted").slice(0, 50);
        return (
          <>
            <section aria-labelledby="progress-h" className="space-y-3">
              <h2 id="progress-h" className={h2}>In progress</h2>
              {inProgress.length === 0 ? <p className={`${card} border-dashed text-sm text-[var(--cmp-app-text-secondary)]`}>Nothing is in progress.</p> : inProgress.map(i => (
                <article key={i.id} className={`${card} flex flex-wrap items-center justify-between gap-3`}>
                  <div className="min-w-0 text-sm font-semibold text-[var(--cmp-app-text)]"><Who g={i.grant_id ? byId.get(i.grant_id) : undefined} /><p className="text-xs font-normal text-[var(--cmp-app-text-secondary)]">Started {fmt(i.started_at)}</p></div>
                  <Link href={`/super-admin/checklist-assessments/${i.id}`} className={link}>Continue</Link>
                </article>
              ))}
            </section>

            <section aria-labelledby="ready-h" className="space-y-3">
              <h2 id="ready-h" className={h2}>Ready to start</h2>
              {ready.length === 0 ? <p className={`${card} border-dashed text-sm text-[var(--cmp-app-text-secondary)]`}>No accepted grant is waiting for you.</p> : ready.map(g => (
                <article key={g.id} className={`${card} flex flex-wrap items-center justify-between gap-3`}>
                  <div className="min-w-0 text-sm font-semibold text-[var(--cmp-app-text)]"><Who g={g} />
                    <p className="text-xs font-normal text-[var(--cmp-app-text-secondary)]">{g.valid_until ? `Until ${fmt(g.valid_until)}` : "No end date"}</p></div>
                  <StartButton grantId={g.id} label={inProgress.some(i => i.grant_id === g.id) ? "Resume" : "Start assessment"} />
                </article>
              ))}
            </section>

            <section aria-labelledby="await-h" className="space-y-3">
              <h2 id="await-h" className={h2}>Waiting for the person to accept</h2>
              {awaiting.length === 0 ? <p className={`${card} border-dashed text-sm text-[var(--cmp-app-text-secondary)]`}>No grant is waiting for acceptance.</p> : awaiting.map(g => (
                <article key={g.id} className={`${card} flex flex-wrap items-center justify-between gap-3`}>
                  <div className="min-w-0 text-sm font-semibold text-[var(--cmp-app-text)]"><Who g={g} /><p className="text-xs font-normal text-[var(--cmp-app-text-secondary)]">Granted {fmt(g.created_at)}. You cannot start until the person accepts.</p></div>
                  <Chip tone="warning">{GRANT_STATE_LABEL[g.state]}</Chip>
                </article>
              ))}
            </section>

            <section aria-labelledby="done-h" className="space-y-3">
              <h2 id="done-h" className={h2}>Submitted</h2>
              {submitted.length === 0 ? <p className={`${card} border-dashed text-sm text-[var(--cmp-app-text-secondary)]`}>Nothing submitted yet.</p> : submitted.map(i => (
                <article key={i.id} className={`${card} flex flex-wrap items-center justify-between gap-3`}>
                  <div className="min-w-0 text-sm font-semibold text-[var(--cmp-app-text)]"><Who g={i.grant_id ? byId.get(i.grant_id) : undefined} /><p className="text-xs font-normal text-[var(--cmp-app-text-secondary)]">Submitted {fmt(i.submitted_at)}</p></div>
                  <Link href={`/super-admin/checklist-assessments/${i.id}/report`} className={link}>Report</Link>
                </article>
              ))}
            </section>

            {finished.length ? (
              <details className={card}>
                <summary className="cursor-pointer text-sm font-semibold text-[var(--cmp-app-text)]">Ended or expired grants ({finished.length})</summary>
                <ul className="mt-2 space-y-1 text-sm text-[var(--cmp-app-text)]">{finished.map(g => <li key={g.id}><Who g={g} /> <span className="text-[var(--cmp-app-text-secondary)]">({GRANT_STATE_LABEL[g.state]}{g.end_reason ? `: ${g.end_reason}` : ""})</span></li>)}</ul>
              </details>
            ) : null}
          </>
        );
      })()}
    </div>
  );
}

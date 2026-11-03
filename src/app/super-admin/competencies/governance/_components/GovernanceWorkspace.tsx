"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CriteriaList } from "../../_studio/CriteriaList";
import { ReviewButton } from "../../authoring/_components/ReviewDialog";
import { ApproveFramework, type ApproveItem } from "../../../clinical-review/_components/ApproveFramework";
import { Decide, SubmitForPublication } from "../../publication/_components/PublicationControls";
import { QUEUE_FILTERS, inQueue, queueCounts, reviewOrder, type GovCompetency, type GovModel, type QueueFilter, type Stage } from "@/lib/competency/governance-rules";

// FRAMEWORK-GOVERNANCE-WORKSPACE-01 -- the one page: pathway tracker, next action, queues, the selected competency with the
// actions this person may take on it, focused review mode, publication readiness, who can act, and history. Every write
// posts to the existing gated route; the page only arranges what the server already decided this person may do.

const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const link = "text-[13px] font-semibold text-teal-800 hover:underline";
const STATE_TONE: Record<string, string> = { eligible: "bg-teal-50 text-teal-900", in_review: "bg-blue-50 text-blue-900", approved: "bg-violet-50 text-violet-900", changes_requested: "bg-amber-50 text-amber-900", framework_locked: "bg-gray-100 text-gray-800", unreadable: "bg-red-50 text-red-900" };
const STATE_SHORT: Record<string, string> = { eligible: "Ready for review", in_review: "In review", approved: "Approved", changes_requested: "Needs changes", framework_locked: "Locked", unreadable: "Unreadable" };
const STAGE_TONE: Record<Stage["status"], string> = { done: "border-teal-600 bg-teal-50 text-teal-900", current: "border-blue-500 bg-blue-50 text-blue-900", waiting: "border-amber-400 bg-amber-50 text-amber-950", blocked: "border-red-400 bg-red-50 text-red-900", not_started: "border-gray-200 bg-white text-gray-500" };
const STAGE_WORD: Record<Stage["status"], string> = { done: "Done", current: "Current", waiting: "Submitted early", blocked: "Blocked", not_started: "Not started" };
const PUB_STATUS: Record<string, string> = { draft: "Draft", in_review: "Publication request submitted", approved: "Approved, not yet published", published: "Published", archived: "Archived" };
const day = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

async function decide(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/api/hq/clinical-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true } : { ok: false, error: j?.error ?? "That could not be recorded. Nothing has changed." };
  } catch { return { ok: false, error: "That could not be recorded. Check your connection." }; }
}

export default function GovernanceWorkspace({ model, initialId, initialFilter, initialMode }: { model: GovModel; initialId: string | null; initialFilter: string | null; initialMode: boolean }) {
  const router = useRouter();
  const { framework: fw, domains, counts, me, stages, next, actors, history, components } = model;
  const all = useMemo(() => domains.flatMap(d => d.competencies), [domains]);
  const qc = useMemo(() => queueCounts(domains, me, fw), [domains, me, fw]);
  const [filter, setFilter] = useState<QueueFilter>((QUEUE_FILTERS.some(f => f.key === initialFilter) ? initialFilter : qc.mine ? "mine" : "all") as QueueFilter);
  const [active, setActive] = useState<string | null>(initialId ?? all[0]?.id ?? null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(domains.filter(d => d.competencies.some(c => c.id === (initialId ?? all[0]?.id))).map(d => d.id)));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reviewMode, setReviewMode] = useState(initialMode && me.canReview);
  const [decided, setDecided] = useState<Set<string>>(new Set());   // versions decided in this visit (the next render drops them from the queue)
  const [panel, setPanel] = useState<"who" | "history" | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const queue = useMemo(() => reviewOrder(domains).filter(c => !decided.has(c.mine!.versionId)), [domains, decided]);
  const visible = (c: GovCompetency) => inQueue(c, filter, me, fw);
  const cur = all.find(c => c.id === active) ?? null;
  const curIdx = cur ? queue.findIndex(c => c.id === cur.id) : -1;
  const approvedByVersion = (c: GovCompetency) => !!c.mine && decided.has(c.mine.versionId);
  const viewerPublisher = actors.publishers.actors.find(a => a.personId === model.viewerId) ?? null;
  const allApproved = counts.total > 0 && counts.approved === counts.total;
  const publishBlocker = !allApproved ? `${counts.total - counts.approved} of ${counts.total} competencies still need an independent clinical review at their current content.`
    : viewerPublisher?.conflict ? viewerPublisher.conflict : null;

  function select(id: string) {
    setActive(id); setMsg(null); setComment("");
    const d = domains.find(x => x.competencies.some(c => c.id === id));
    if (d) setOpen(s => new Set(s).add(d.id));
  }
  async function record(c: GovCompetency, decision: "approved" | "rejected", andNext: boolean) {
    if (!c.mine) return;
    setBusy(true); setMsg(null);
    const r = await decide({ versionId: c.mine.versionId, appointmentId: c.mine.appointmentId, decision, comment: comment.trim() || undefined });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "Not recorded." }); return; }
    setDecided(s => new Set(s).add(c.mine!.versionId));
    setMsg({ ok: true, text: decision === "approved" ? "Approved for this exact content. The framework's approval count updates on refresh." : "Changes requested; the author sees your note." });
    setComment("");
    router.refresh();
    if (andNext) { const i = queue.findIndex(x => x.id === c.id); const nxt = queue[i + 1] ?? queue[i - 1] ?? null; if (nxt) select(nxt.id); }
  }
  const approveItems: ApproveItem[] = all.filter(c => c.mine && picked.has(c.id) && !decided.has(c.mine.versionId)).map(c => ({ versionId: c.mine!.versionId, competencyId: c.id, title: c.name, domain: c.domain, version: c.mine!.versionId.slice(0, 8), criteria: c.criteria.length, checks: c.mine!.checks }));
  const forwardIds = [...picked].filter(id => { const c = all.find(x => x.id === id); return c && (c.state === "eligible" || c.state === "changes_requested"); });

  const nextButton = (() => {
    const a = next.action; if (!a) return null;
    switch (a.kind) {
      case "review_mode": return <button type="button" className={primary} onClick={() => { setReviewMode(true); if (queue[0]) select(queue[0].id); }}>{a.label}</button>;
      case "open_queue": return <Link href="/super-admin/clinical-review" className={primary}>{a.label}</Link>;
      case "put_forward": return <ReviewButton frameworkId={fw.id} scope={{ kind: "framework" }} label={a.label} className={primary} />;
      case "edit": return <Link href={`/super-admin/competencies/authoring/${fw.id}`} className={primary}>{a.label}</Link>;
      case "assign_reviewer": return <Link href="/super-admin/users/appointments" className={primary}>{a.label}</Link>;
      case "submit_publication": return <a href="#publication" className={primary}>{a.label}</a>;
      case "publish": return <a href="#publication" className={primary}>{a.label}</a>;
      default: return null;
    }
  })();

  return (
    <div className="max-w-7xl space-y-4">
      <nav aria-label="Breadcrumb" className="text-[13px] text-gray-600"><Link href="/super-admin/competencies/governance" className="font-semibold text-teal-800 hover:underline">Framework governance</Link> <span aria-hidden>/</span> {fw.code ?? fw.name}</nav>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Governance workspace</p>
          <h1 className="text-[24px] font-bold text-gray-900">{fw.name}</h1>
          <p className="mt-1 text-[13px] text-gray-600">{fw.code ?? "no code"} Â· version {fw.version} Â· {PUB_STATUS[fw.pubStatus] ?? fw.pubStatus} Â· {counts.approved} of {counts.total} clinically approved</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={ghost} onClick={() => setPanel(panel === "who" ? null : "who")} aria-expanded={panel === "who"}>Who can act?</button>
          <button type="button" className={ghost} onClick={() => setPanel(panel === "history" ? null : "history")} aria-expanded={panel === "history"}>History ({history.length})</button>
          <Link href={`/super-admin/competencies/authoring/${fw.id}?view=pack`} className={ghost}>Review pack</Link>
          {me.canReview && queue.length > 0 && !reviewMode && <button type="button" className={primary} onClick={() => { setReviewMode(true); if (curIdx < 0 && queue[0]) select(queue[0].id); }}>Focused review ({queue.length})</button>}
          {reviewMode && <button type="button" className={ghost} onClick={() => setReviewMode(false)}>Leave review mode</button>}
        </div>
      </header>

      {/* 1. the pathway */}
      <ol className="grid gap-2 md:grid-cols-5" aria-label="Governance pathway">
        {stages.map((s, i) => (
          <li key={s.key} className={`rounded-xl border-l-4 border border-gray-200 p-3 ${STAGE_TONE[s.status]}`}>
            <p className="text-[11px] font-bold uppercase tracking-wide">{i + 1}. {s.label}</p>
            <p className="text-[12.5px] font-semibold">{STAGE_WORD[s.status]}{s.role ? ` Â· ${s.role}` : ""}</p>
            {s.done.map(t => <p key={t} className="mt-1 text-[12px]">âœ“ {t}</p>)}
            {s.outstanding.map(t => <p key={t} className="mt-1 text-[12px]">â—‹ {t}</p>)}
            {s.next && <p className="mt-1 text-[12px] font-semibold">Next: {s.next}</p>}
          </li>
        ))}
      </ol>

      {/* 2. the next action */}
      <section aria-labelledby="na-h" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal-200 bg-teal-50/60 p-4">
        <div>
          <h2 id="na-h" className="text-[15px] font-bold text-gray-900">{next.headline}</h2>
          <p className="text-[13px] text-gray-700">{next.detail}{next.responsible ? ` Responsible: ${next.responsible}.` : ""}</p>
        </div>
        {nextButton}
      </section>
      {model.reviewerNote && <p role="status" className="text-[13px] font-semibold text-amber-900">{model.reviewerNote}</p>}
      {!model.clinicalReadable && <p role="alert" className="text-[13px] font-semibold text-amber-900">Clinical review states could not be read just now.</p>}

      {/* who can act / history drawers */}
      {panel === "who" && (
        <section aria-label="Who can act" className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 md:grid-cols-3">
          {[actors.authors, actors.reviewers, actors.publishers].map(g => (
            <div key={g.capability}>
              <h3 className="text-[13.5px] font-bold text-gray-900">{g.role}</h3>
              <p className="text-[12px] text-gray-500">Role permission: {g.positions.length ? g.positions.join(", ") : "no position"} Â· {g.eligible} eligible of {g.actors.length} appointed</p>
              {g.note && <p className="mt-1 text-[12.5px] text-amber-900">{g.note}</p>}
              <ul className="mt-2 space-y-1.5">
                {g.actors.map(a => (
                  <li key={a.personId + a.position} className="text-[12.5px]">
                    <span className="font-semibold text-gray-900">{a.name}</span> <span className="text-gray-500">({a.position})</span>
                    {a.inScope === false && <span className="ml-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">out of scope</span>}
                    {a.conflict ? <span className="block text-[12px] text-red-800">Not eligible: {a.conflict}</span> : <span className="block text-[12px] text-teal-800">Eligible{a.inScope ? ", in scope" : ""}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-[12px] text-gray-600 md:col-span-3">Eligibility is content-specific: a reviewer may not approve a version they authored, edited or put forward; a publisher may not be the submitter or a contributor. The database refuses either regardless of what is drawn here.</p>
        </section>
      )}
      {panel === "history" && (
        <section aria-label="Governance history" className="rounded-2xl border border-gray-200 bg-white p-4">
          <h3 className="text-[13.5px] font-bold text-gray-900">History</h3>
          {history.length === 0 ? <p className="mt-1 text-[12.5px] text-gray-600">Nothing recorded yet.</p> : (
            <ol className="mt-2 max-h-72 space-y-1 overflow-y-auto text-[12.5px]">
              {history.map((h, i) => <li key={i} className="flex flex-wrap gap-x-2 border-b border-gray-100 py-1"><span className="w-36 shrink-0 text-gray-500">{day(h.at)}</span><span className="text-gray-900">{h.text}</span>{h.who && <span className="text-gray-500">Â· {h.who}</span>}</li>)}
            </ol>
          )}
          <p className="mt-2 text-[12px] text-gray-500">The full audit trail stays on record; this is the governance subset.</p>
        </section>
      )}

      {/* 3. queues + explorer + detail */}
      {!reviewMode && (
        <div role="group" aria-label="Queues" className="flex flex-wrap gap-1.5">
          {QUEUE_FILTERS.map(f => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${filter === f.key ? "border-teal-700 bg-teal-700 text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"}`}>
              {f.label} <span className={filter === f.key ? "text-teal-100" : "text-gray-500"}>{qc[f.key]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <aside aria-label={reviewMode ? "Review queue" : "Competency explorer"} className="rounded-2xl border border-gray-200 bg-white">
          {reviewMode ? (
            <>
              <p className="border-b border-gray-100 px-3 py-2 text-[12.5px] font-semibold text-gray-700">{queue.length} waiting for your decision</p>
              <ol className="max-h-[60vh] overflow-y-auto">
                {queue.map((c, i) => (
                  <li key={c.id}><button type="button" onClick={() => select(c.id)} aria-current={c.id === active ? "true" : undefined}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left text-[13px] ${c.id === active ? "border-l-4 border-teal-700 bg-teal-50/70" : "hover:bg-gray-50"}`}>
                    <span className="w-6 shrink-0 text-gray-500">{i + 1}.</span><span><span className="text-gray-900">{c.name}</span><span className="block text-[11.5px] text-gray-500">{c.code ?? ""} Â· {c.domain}</span></span>
                  </button></li>
                ))}
                {queue.length === 0 && <li className="px-3 py-3 text-[13px] text-gray-600">Nothing left in your queue.</li>}
              </ol>
            </>
          ) : (
            <>
              {(me.canAuthor || me.canReview) && picked.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-teal-50/60 px-3 py-2 text-[12.5px]">
                  <span className="font-semibold">{picked.size} selected</span>
                  {me.canAuthor && fw.editable && forwardIds.length > 0 && <ReviewButton frameworkId={fw.id} scope={{ kind: "competencies", ids: forwardIds }} label={`Put ${forwardIds.length} forward`} className={link} />}
                  {me.canReview && approveItems.length > 0 && <ApproveFramework framework={fw.name} items={approveItems} />}
                  <button type="button" className={link} onClick={() => setPicked(new Set())}>Clear</button>
                </div>
              )}
              <div className="max-h-[60vh] overflow-y-auto">
                {domains.map(d => {
                  const comps = d.competencies.filter(visible);
                  if (!comps.length) return null;
                  const isOpen = open.has(d.id) || filter !== "all";
                  return (
                    <div key={d.id}>
                      <button type="button" aria-expanded={isOpen} onClick={() => setOpen(s => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] font-semibold text-gray-900 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)]">
                        <span><span aria-hidden className="mr-1 inline-block w-3 text-gray-500">{isOpen ? "â–¾" : "â–¸"}</span>{d.name}</span><span className="text-[12px] font-normal text-gray-500">{comps.length}</span>
                      </button>
                      {isOpen && comps.map(c => (
                        <div key={c.id} className={`flex items-start gap-2 px-3 py-1.5 ${c.id === active ? "border-l-4 border-teal-700 bg-teal-50/70" : "hover:bg-gray-50"}`}>
                          {(me.canAuthor || me.canReview) && <input type="checkbox" className="mt-1" aria-label={`Select ${c.name}`} checked={picked.has(c.id)} onChange={() => setPicked(s => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />}
                          <button type="button" onClick={() => select(c.id)} aria-current={c.id === active ? "true" : undefined} className="min-w-0 flex-1 text-left">
                            <span className="block text-[13px] text-gray-900">{c.name}</span>
                            <span className="block text-[11.5px] text-gray-500">{c.code ?? ""} Â· {c.criteria.length} criteria{c.mine && !approvedByVersion(c) ? " Â· in your queue" : ""}</span>
                          </button>
                          <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STATE_TONE[c.state]}`}>{approvedByVersion(c) ? "Decided" : STATE_SHORT[c.state]}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
                {all.every(c => !visible(c)) && <p className="px-3 py-3 text-[13px] text-gray-600">Nothing in this queue.</p>}
              </div>
            </>
          )}
        </aside>

        <section aria-label="Selected competency" className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4">
          {!cur ? <p className="text-[13.5px] text-gray-600">Select a competency to see its content and the actions available to you.</p> : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[12px] font-bold uppercase tracking-wide text-teal-800">{cur.domain} / {cur.code ?? "no code"}</p>
                  <h2 className="text-[18px] font-bold text-gray-900">{cur.name}</h2>
                  <p className="text-[12.5px] text-gray-600">{cur.stateLabel}. {cur.stateNote}{cur.mine ? ` Version ${cur.mine.versionId.slice(0, 8)}, put forward ${day(cur.mine.submittedAt)}.` : ""}</p>
                </div>
                <span className={`rounded-md px-2 py-0.5 text-[12px] font-semibold ${STATE_TONE[cur.state]}`}>{approvedByVersion(cur) ? "Decided" : STATE_SHORT[cur.state]}</span>
              </div>
              {cur.mine && cur.mine.checks.length > 0 && <p className="mt-2 text-[12.5px] text-amber-900">Worth checking: {cur.mine.checks.join(" ")}</p>}
              <dl className="mt-3 space-y-2 text-[13.5px]">
                <div><dt className="text-[12px] font-semibold text-gray-500">Description</dt><dd className="text-gray-800">{cur.description ?? "None recorded"}</dd></div>
                <div><dt className="text-[12px] font-semibold text-gray-500">Learning outcomes</dt><dd className="text-gray-800">{cur.outcomes.length ? <ul className="list-disc pl-5">{cur.outcomes.map((o, n) => <li key={n}>{o}</li>)}</ul> : "None recorded"}</dd></div>
                <div><dt className="text-[12px] font-semibold text-gray-500">Assessment criteria ({cur.criteria.length})</dt><dd><CriteriaList criteria={cur.criteria} components={components} open /></dd></div>
              </dl>

              {/* contextual actions */}
              <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
                {me.canReview && cur.mine && !approvedByVersion(cur) && (
                  <div className="space-y-2">
                    <label htmlFor="gw-comment" className="block text-[12.5px] font-semibold text-gray-700">Your clinical review comment (required to request changes)</label>
                    <textarea id="gw-comment" rows={2} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[14px]" />
                  </div>
                )}
                {me.canReview && cur.state === "in_review" && !cur.mine && <p className="text-[12.5px] text-gray-600">In review, but not in your queue: {cur.version && (cur.version.authoredBy.includes(model.viewerId) || cur.version.submittedBy === model.viewerId) ? "you authored, edited or put forward this version." : "it is outside your reviewer scope, or you already decided it."}</p>}
                {me.canAuthor && fw.editable && (cur.state === "eligible" || cur.state === "changes_requested") && <p className="text-[12.5px] text-gray-600">{cur.state === "changes_requested" ? "A reviewer asked for changes. Edit, then put it forward again." : "Not yet put forward: nobody reviews it until it is."}</p>}
                {cur.state === "approved" && <p className="text-[12.5px] text-teal-800">Approved at its current content. Editing it would need renewed review.</p>}
                <div className="flex flex-wrap items-center gap-2">
                  {me.canReview && cur.mine && !approvedByVersion(cur) && (<>
                    <button type="button" className={primary} disabled={busy} onClick={() => void record(cur, "approved", reviewMode)}>{reviewMode ? "Approve & next" : "Approve this content"}</button>
                    <button type="button" className={ghost} disabled={busy || !comment.trim()} onClick={() => void record(cur, "rejected", reviewMode)}>Request changes</button>
                  </>)}
                  {me.canAuthor && fw.editable && (cur.state === "eligible" || cur.state === "changes_requested") && <ReviewButton frameworkId={fw.id} scope={{ kind: "competencies", ids: [cur.id] }} label="Put forward for clinical review" className={primary} />}
                  {me.canAuthor && fw.editable && <Link href={`/super-admin/competencies/authoring/${fw.id}?tab=competencies&c=${cur.id}`} className={ghost}>Edit in Competency Authoring</Link>}
                  {reviewMode && (<>
                    <button type="button" className={ghost} disabled={curIdx <= 0} onClick={() => select(queue[curIdx - 1].id)}>â† Previous</button>
                    <button type="button" className={ghost} disabled={curIdx < 0 || curIdx >= queue.length - 1} onClick={() => select(queue[curIdx + 1].id)}>Next â†’</button>
                    <span className="text-[12.5px] text-gray-500">{curIdx >= 0 ? `${curIdx + 1} of ${queue.length}` : "decided"}</span>
                  </>)}
                </div>
                {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>{msg.text}</p>}
              </div>
            </>
          )}
        </section>
      </div>

      {/* 6. publication, separate from approval */}
      <section id="publication" aria-labelledby="pb-h" className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pb-h" className="text-[15px] font-bold text-gray-900">Publication readiness</h2>
          <Link href="/super-admin/competencies/publication" className={link}>Framework Publication page â†’</Link>
        </div>
        <div className="mt-2 h-2 rounded-full bg-gray-100" aria-hidden><div className="h-2 rounded-full bg-teal-700" style={{ width: `${counts.total ? (100 * counts.approved) / counts.total : 0}%` }} /></div>
        <p className="mt-2 text-[13px] text-gray-800">
          {counts.approved} of {counts.total} clinically approved at their current content.
          {fw.pending ? ` A publication request was submitted${fw.pending.submittedByName ? ` by ${fw.pending.submittedByName}` : ""} on ${day(fw.pending.submittedAt)}: it waits until every competency is approved, then needs an independent publisher.` : " No publication request yet."}
        </p>
        {me.canPublish && fw.pending && <Decide frameworkId={fw.id} firstPublication={(fw.publication?.publishedCount ?? 0) === 0} version={fw.version} blocker={publishBlocker} />}
        {me.canAuthor && fw.editable && !!fw.layer && !fw.pending && allApproved && <SubmitForPublication frameworkId={fw.id} revision={fw.pubStatus === "published"} />}
        {!me.canPublish && fw.pending && <p className="mt-1 text-[12.5px] text-gray-600">Eligible publishers: {actors.publishers.actors.filter(a => !a.conflict).map(a => a.name).join(", ") || "none (see Who can act)"}.</p>}
      </section>
    </div>
  );
}

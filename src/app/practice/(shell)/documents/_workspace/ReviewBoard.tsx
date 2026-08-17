"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DOC_BULK_LIMIT, DOC_ORIGIN, DOC_REVIEW_STATUS_NOTE, DOC_STATUS, DOC_TYPE_LABEL,
  DOC_VIEW_TONE, DOC_VIEW_TONE_QUIET, DOC_VIEW_TONE_UNREADABLE,
} from "@/lib/practice/documents-workspace-constants";
import { INCOMING_DOC_TYPES } from "@/lib/practice/communication-constants";

// CPR-DOC-002 s20 PHASE 3, THE BOARD: saved views, the queues, bulk classify, assign a review, and who
// may do what.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS COMPONENT IMPORTS FROM TWO CONSTANTS MODULES AND NOTHING ELSE -- documents-workspace-constants
// and communication-constants, neither of which imports anything server-side. Every type below is
// declared here STRUCTURALLY rather than imported from the engine, because the engine imports the audit
// writer, which imports the Supabase server client, and a server-only import reaching a client component
// compiles, lints, passes every harness, and then the page is dead in a production build. It killed the
// Follow-ups board this week. The harness asserts this file's import list statically.
//
// ⚠ EVERY QUEUE HAS THREE RENDERINGS, AND THE MIDDLE ONE IS THE POINT. A list that is `ok` and empty
// says "nothing here", in grey. A list that is `unreadable` prints the database's own words in amber and
// says the queue could not be read. Drawing the second as the first is how a practitioner concludes
// their inbox is clear because a query timed out.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

type Reading<T> =
  | { state: "ok"; value: T }
  | { state: "unreadable"; detail: string }
  | { state: "forbidden"; detail: string };

type Row = {
  id: string; origin: keyof typeof DOC_ORIGIN; title: string; docType: string;
  patientId: string | null; patientName: string | null;
  status: keyof typeof DOC_STATUS; stored: string; at: string; source: string;
  version: number | null; priority: string | null; summary: string | null; href: string | null;
};

type TaskRow = {
  id: string; title: string; detail: string | null; documentId: string;
  documentTitle: string | null; documentStored: string | null;
  assignedTo: string; assigneeName: string | null; assigneeActive: boolean;
  status: string; priority: string; dueOn: string | null; overdue: boolean;
  createdAt: string; href: string;
};

type ViewCount = {
  key: string; label: string; blurb: string; href: string;
  tone: keyof typeof DOC_VIEW_TONE; count: Reading<number>;
};

type PermissionRow = { capability: string; label: string; blurb: string; holders: string[]; nobody: boolean };

type Review = {
  views: ViewCount[];
  assignedToMe: Reading<TaskRow[]>;
  assignedToOthers: Reading<TaskRow[]>;
  arrivals: Reading<Row[]>;
  unlinked: Reading<Row[]>;
  unsigned: Reading<Row[]>;
  members: Reading<{ userId: string; name: string }[]>;
  permissions: Reading<PermissionRow[]>;
  truncated: string[];
  today: string;
  timezone: string;
};

// CPR-MOB-001 s4's 44px floor and s16's native controls, added below md only. The reviewer picker and
// the "by when" field are already a native <select> and <input type="date">, so a phone gets its own
// wheel and calendar for free — they only had to be big enough to hit. 16px text below md is also what
// keeps iOS Safari from zooming the page when a field takes focus.
const input =
  "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10 "
  + "max-md:min-h-[var(--cp-touch)] max-md:w-full max-md:text-[16px]";

function Unreadable({ what, detail }: { what: string; detail: string }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
      <p className="text-[12px] font-bold text-amber-900">{what} could not be read.</p>
      <p className="mt-0.5 text-[11px] text-amber-800">{detail}</p>
      <p className="mt-1 text-[11px] text-amber-800">
        This is not an empty queue. There may be work here and this screen cannot see it.
      </p>
    </div>
  );
}

function Section({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[13px] font-bold text-gray-900">{title}</h2>
      <p className="mt-0.5 max-w-3xl text-[11.5px] leading-relaxed text-gray-500">{blurb}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function ReviewBoard({ review, canAssign, canClassify }: {
  review: Review;
  canAssign: boolean;
  canClassify: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <SavedViews views={review.views} />

      {review.truncated.length > 0 && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
          {review.truncated.join(" and ")} returned the maximum this workspace reads at once, so the
          figures above count what was read rather than everything that exists. Narrow by date or patient
          to see the rest.
        </p>
      )}

      {/* ⚠ THE SPLIT IS THE ENGINE'S, NOT THIS COMPONENT'S. Deciding "mine" in the browser would mean the
          caller's own id travelling to the client and being compared there, and two places that both
          know who you are is one place too many. */}
      <MyQueue mine={review.assignedToMe} others={review.assignedToOthers} />

      <Arrivals arrivals={review.arrivals} />

      <UnlinkedBulk unlinked={review.unlinked} canClassify={canClassify} />

      <Unsigned
        unsigned={review.unsigned}
        members={review.members}
        canAssign={canAssign}
      />

      <Permissions permissions={review.permissions} />
    </div>
  );
}

/* ── s10's SAVED VIEWS ───────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN, and the href opens exactly the rows the figure
 * counted -- the engine ran the same filter to produce both. ⚠ A ZERO GOES GREY. A coloured badge
 * reading 0 trains a reader to stop seeing the colour, and the rose one is the only failure state here.
 */
function SavedViews({ views }: { views: ViewCount[] }) {
  return (
    <section>
      <h2 className="text-[13px] font-bold text-gray-900">Saved views</h2>
      <p className="mt-0.5 text-[11.5px] text-gray-500">
        The standard queues this practice can answer. Each figure is the length of the list it opens.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {views.map(v => {
          const unreadable = v.count.state !== "ok";
          const zero = v.count.state === "ok" && v.count.value === 0;
          const tone = unreadable ? DOC_VIEW_TONE_UNREADABLE : zero ? DOC_VIEW_TONE_QUIET : DOC_VIEW_TONE[v.tone];
          return (
            <Link
              key={v.key} href={v.href} title={v.blurb}
              className={`flex flex-col rounded-xl border px-3 py-2.5 transition hover:shadow-sm ${tone.box}`}
            >
              <span className={`text-2xl font-bold leading-none ${tone.figure}`}>
                {v.count.state === "ok" ? v.count.value : "—"}
              </span>
              <span className={`mt-1 text-[11.5px] font-semibold leading-tight ${tone.label}`}>{v.label}</span>
              {v.count.state !== "ok" && (
                <span className="mt-1 text-[10px] leading-tight text-slate-500">{v.count.detail}</span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ── s10's "AWAITING MY REVIEW" ──────────────────────────────────────────────────────────────────── */

function TaskList({ rows, emptyLine }: { rows: TaskRow[]; emptyLine: string }) {
  if (rows.length === 0) return <p className="text-[12px] text-gray-400">{emptyLine}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map(t => (
        <li key={t.id} className="rounded-lg border border-gray-200 px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link href={t.href} className="text-[12.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              {t.title}
            </Link>
            <span className="text-[10.5px] text-gray-400">
              {t.assigneeName ?? "(name could not be read)"}
              {t.dueOn ? ` · due ${t.dueOn}` : ""}
            </span>
          </div>
          {t.detail && <p className="mt-0.5 text-[11.5px] text-gray-600">{t.detail}</p>}
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-gray-400">
            <span className="rounded bg-gray-100 px-1.5 py-0.5 font-bold text-gray-600">{t.status}</span>
            {t.overdue && (
              <span className="rounded bg-rose-100 px-1.5 py-0.5 font-bold text-rose-700">Overdue</span>
            )}
            {/* ⚠ WORK SITTING WITH SOMEBODY WHO CAN NO LONGER OPEN THE APP IS WORK NOBODY IS DOING. */}
            {!t.assigneeActive && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800">
                Assignee is no longer a member
              </span>
            )}
            {/* A task whose document could not be read keeps its place and says so. */}
            <span>{t.documentTitle ?? "(the document behind this task could not be read)"}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

function MyQueue({ mine, others }: {
  mine: Reading<TaskRow[]>; others: Reading<TaskRow[]>;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section
        title="Assigned to you"
        blurb="Open tasks about a document with your name on them. This is the only queue in this workspace that anybody owns."
      >
        {mine.state === "ok"
          ? <TaskList rows={mine.value} emptyLine="Nothing about a document is assigned to you." />
          : <Unreadable what="Your document tasks" detail={mine.detail} />}
      </Section>

      <Section
        title="Assigned to somebody else"
        blurb="The same work with another name on it. Shown rather than hidden: a queue you cannot see is a queue you assume is being worked."
      >
        {others.state === "ok"
          ? <TaskList rows={others.value} emptyLine="Nothing about a document is assigned to anybody else." />
          : <Unreadable what="The practice's document tasks" detail={others.detail} />}
      </Section>
    </div>
  );
}

/* ── s14's "INCOMING PATIENT DOCUMENT AWAITING REVIEW" ───────────────────────────────────────────────
 *
 * ⚠ NO ASSIGN CONTROL, AND THE SENTENCE SAYING WHY IS IN THE INTERFACE. practice_task has no
 * incoming_document_id, so an arrival cannot be the subject of a task. A disabled Assign button with an
 * apology under it is the thing s18 objects to; a live one that silently did nothing would be worse. The
 * queue says what it is -- the practice's -- and the row links to the register where it is worked.
 */
function RowList({ rows, emptyLine, showStatus = true }: {
  rows: Row[]; emptyLine: string; showStatus?: boolean;
}) {
  if (rows.length === 0) return <p className="text-[12px] text-gray-400">{emptyLine}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.slice(0, 25).map(r => (
        <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-gray-200 px-3 py-1.5">
          <span className="flex flex-wrap items-baseline gap-2">
            {r.href
              ? <Link href={r.href} className="text-[12.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">{r.title}</Link>
              : <span className="text-[12.5px] font-semibold text-gray-800">{r.title}</span>}
            <span className="text-[10.5px] text-gray-400">
              {DOC_TYPE_LABEL[r.docType] ?? r.docType} &middot; {r.patientName ?? "no patient"}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            {showStatus && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${DOC_STATUS[r.status].chip}`}>
                {DOC_STATUS[r.status].label}
              </span>
            )}
            <span className="text-[10.5px] text-gray-400">{r.at}</span>
          </span>
        </li>
      ))}
      {rows.length > 25 && (
        <li className="text-[11px] text-gray-400">
          and {rows.length - 25} more. The figure above counts all of them.
        </li>
      )}
    </ul>
  );
}

function Arrivals({ arrivals }: { arrivals: Reading<Row[]> }) {
  return (
    <Section
      title="Arrived, and nobody has looked"
      blurb={
        "Incoming documents still at RECEIVED. This queue belongs to the practice and not to any one person: "
        + "a task in this product can point at a document this practice wrote, and cannot yet point at one that "
        + "arrived, so there is nobody to put a name on these. Open the register to review one."
      }
    >
      {arrivals.state === "ok"
        ? <RowList rows={arrivals.value} emptyLine="Nothing has arrived unreviewed." />
        : <Unreadable what="The arrivals queue" detail={arrivals.detail} />}
    </Section>
  );
}

/* ── s10's BULK CLASSIFY ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ THE OUTCOMES ARE RENDERED PER ROW. A batch of forty that files thirty-eight and refuses two shows
 * which two and why. "Partially failed" would send the operator round again on all forty.
 */
function UnlinkedBulk({ unlinked, canClassify }: { unlinked: Reading<Row[]>; canClassify: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [docType, setDocType] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; displayName: string }[] | null>(null);
  const [searchIncomplete, setSearchIncomplete] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<{ id: string; ok: boolean; message: string | null }[] | null>(null);

  const rows = unlinked.state === "ok" ? unlinked.value : [];
  const toggle = (id: string) =>
    setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  async function search() {
    setBusy(true); setError(null); setSearchIncomplete(null);
    try {
      const res = await fetch(`/api/v1/practice/patients?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error?.message ?? data?.error ?? "The search did not run."); return; }
      // ⚠ NOT AN ANSWER when a probe was refused. Said, never shown as an empty register -- an empty
      // answer read as truth is how somebody files forty results against a brand-new duplicate record.
      if (data.complete === false)
        setSearchIncomplete(data.incompleteDetail ?? "part of the search was refused, so this list is not complete");
      setResults(((data.results ?? []) as any[]).map(r => ({
        id: r.id as string, displayName: (r.displayName ?? r.display_name ?? "Unnamed") as string,
      })));
    } catch (e) {
      setError(String(e));
    } finally { setBusy(false); }
  }

  async function run() {
    setBusy(true); setError(null); setOutcomes(null);
    try {
      const res = await fetch("/api/v1/practice/documents/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "classify", ids: selected,
          patientId: chosen?.id, docType: docType || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error?.message ?? data?.error ?? "That did not work."); return; }
      setOutcomes(data.bulk?.outcomes ?? []);
      // ⚠ NO RELOAD WHILE THERE IS SOMETHING TO READ. Every other panel in this workspace reloads on
      // success; this one must not, because the per-row refusals are the whole result and a reload would
      // throw them away before anybody saw them.
      if ((data.bulk?.refused ?? 0) === 0) window.location.reload();
    } catch (e) {
      setError(String(e));
    } finally { setBusy(false); }
  }

  return (
    <Section
      title="No patient link"
      blurb={
        "Arrived without a patient, so invisible in the record of the person it is about. Select several and "
        + `file them together — at most ${DOC_BULK_LIMIT} at a time, because filing a long list against one `
        + "patient is the most damaging single action this screen can perform."
      }
    >
      {unlinked.state !== "ok" ? (
        <Unreadable what="The unlinked queue" detail={unlinked.detail} />
      ) : rows.length === 0 ? (
        <p className="text-[12px] text-gray-400">Everything that arrived is linked to a patient.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {rows.slice(0, DOC_BULK_LIMIT).map(r => (
              /* ⚠ THE TICK IS 14px AND THIS IS THE SELECTION THAT FEEDS THE MOST DAMAGING ACTION ON
                 THE SCREEN — filing a batch against one patient. A mis-tap here is not a cosmetic
                 problem, so it takes s4's floor below md, and the metadata drops to its own line
                 rather than being crushed against the title. */
              <li key={r.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 max-md:flex-wrap max-md:py-2">
                {canClassify && (
                  <input
                    type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)}
                    aria-label={`Select ${r.title}`}
                    className="h-3.5 w-3.5 accent-[var(--cp-primary)] max-md:h-5 max-md:w-5"
                  />
                )}
                <span className="flex-1 text-[12.5px] font-semibold text-gray-800 max-md:text-[13.5px]">{r.title}</span>
                <span className="text-[10.5px] text-gray-400 max-md:w-full">
                  {r.source} &middot; {DOC_TYPE_LABEL[r.docType] ?? r.docType} &middot; {r.at}
                </span>
              </li>
            ))}
          </ul>
          {rows.length > DOC_BULK_LIMIT && (
            <p className="mt-1 text-[11px] text-gray-400">
              {rows.length} are unlinked. The first {DOC_BULK_LIMIT} are shown, which is the most this
              action will run on at once.
            </p>
          )}

          {canClassify && selected.length > 0 && (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-[12px] font-bold text-gray-900">
                File {selected.length} document{selected.length === 1 ? "" : "s"}
              </p>
              {/* Below md this stops being a wrapped row and becomes the vertical order the task is
                  actually done in: find the patient, choose the type, then file. "File them" is the one
                  dominant action in the viewport (s4) and sits last, under the thumb. */}
              <div className="mt-2 flex flex-wrap items-end gap-2 max-md:flex-col max-md:items-stretch">
                <label className="flex flex-col gap-1 max-md:w-full">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">Patient</span>
                  <span className="flex gap-1">
                    <input className={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name" />
                    <button type="button" onClick={search} disabled={busy}
                      className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-gray-700 disabled:opacity-50 max-md:min-h-[var(--cp-touch)] max-md:shrink-0 max-md:px-4 max-md:text-[14px]">
                      Search
                    </button>
                  </span>
                </label>
                <label className="flex flex-col gap-1 max-md:w-full">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">Document type</span>
                  <select className={input} value={docType} onChange={e => setDocType(e.target.value)}>
                    <option value="">Leave as it is</option>
                    {INCOMING_DOC_TYPES.map(([code, label]) => (
                      <option key={code} value={code}>{label}</option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={run} disabled={busy || (!chosen && !docType)}
                  className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40 max-md:flex max-md:min-h-[var(--cp-touch-primary)] max-md:w-full max-md:items-center max-md:justify-center max-md:text-[15px]">
                  {busy ? "Filing…" : "File them"}
                </button>
              </div>

              {chosen && (
                <p className="mt-1.5 text-[11.5px] text-gray-700 max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-2 max-md:text-[13px]">
                  <span>They will be linked to <span className="font-bold">{chosen.name}</span>.</span>{" "}
                  {/* "change" was an underlined word about 15px tall; it is the only way back from the
                      wrong patient, so below md it is a control rather than a hyperlink in a sentence. */}
                  <button type="button" onClick={() => setChosen(null)}
                    className="underline max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:rounded-lg max-md:border max-md:border-gray-300 max-md:bg-white max-md:px-3 max-md:font-semibold max-md:no-underline">
                    change
                  </button>
                </p>
              )}
              {searchIncomplete && (
                <p className="mt-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                  This patient list is not complete: {searchIncomplete}
                </p>
              )}
              {results && !chosen && (
                /* ⚠ THESE CHIPS DECIDE WHICH PATIENT A BATCH OF DOCUMENTS IS FILED AGAINST, and they
                   were 11.5px text in a 2px-padded box, packed side by side. That is precision tapping
                   on the highest-consequence choice this panel makes (s16: "searchable clinical
                   selectors must remain usable without precision tapping"). Below md each candidate is
                   a full-width 44px row, one per line, so the neighbouring name is never a thumb's
                   width away. */
                <ul className="mt-1.5 flex flex-wrap gap-1 max-md:flex-col max-md:gap-1.5">
                  {results.length === 0 && <li className="text-[11.5px] text-gray-400">No patient matched.</li>}
                  {results.map(p => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setChosen({ id: p.id, name: p.displayName })}
                        className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[11.5px] font-semibold text-gray-700 hover:border-[var(--cp-primary)] max-md:flex max-md:min-h-[var(--cp-touch)] max-md:w-full max-md:items-center max-md:px-3 max-md:text-[14px]">
                        {p.displayName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[10.5px] text-gray-500">
                Where each of these came from is not changed by filing it. There is no field for it on
                this form and none on the request the form sends.
              </p>
              {error && <p className="mt-1.5 text-[11.5px] font-semibold text-rose-700">{error}</p>}
              {outcomes && (
                <ul className="mt-2 flex flex-col gap-1">
                  {outcomes.map(o => (
                    <li key={o.id} className={`text-[11.5px] ${o.ok ? "text-emerald-700" : "text-rose-700"}`}>
                      {o.ok ? "Filed" : `Refused — ${o.message}`}
                      <span className="ml-1 text-gray-400">{o.id.slice(0, 8)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

/* ── s14's "DRAFT AWAITING SIGNATURE", AND s15's DocumentReview AS A TASK ────────────────────────── */

function Unsigned({ unsigned, members, canAssign }: {
  unsigned: Reading<Row[]>; members: Reading<{ userId: string; name: string }[]>; canAssign: boolean;
}) {
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [note, setNote] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign(documentId: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/v1/practice/documents/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, assignTo, note: note || null, dueOn: dueOn || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error?.message ?? data?.error ?? "That did not work."); return; }
      window.location.reload();
    } catch (e) {
      setError(String(e));
    } finally { setBusy(false); }
  }

  return (
    <Section
      title="Written, not signed"
      blurb="Drafts and documents marked ready. Nothing here has been issued to anybody."
    >
      {unsigned.state !== "ok" ? (
        <Unreadable what="The unsigned queue" detail={unsigned.detail} />
      ) : unsigned.value.length === 0 ? (
        <p className="text-[12px] text-gray-400">Nothing is waiting to be signed.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {unsigned.value.slice(0, 25).map(r => (
            <li key={r.id} className="rounded-lg border border-gray-200 px-3 py-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="flex flex-wrap items-baseline gap-2">
                  {r.href
                    ? <Link href={r.href} className="text-[12.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">{r.title}</Link>
                    : <span className="text-[12.5px] font-semibold text-gray-800">{r.title}</span>}
                  <span className="text-[10.5px] text-gray-400">{r.patientName ?? "no patient"}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${DOC_STATUS[r.status].chip}`}>
                    {DOC_STATUS[r.status].label}
                  </span>
                  {canAssign && members.state === "ok" && (
                    /* s12 row 5's control on this queue. It says what it does in words and keeps
                       saying it — "Ask for a review" / "Close" — so its state is never carried by
                       appearance alone (s4). Below md it takes the 44px floor. */
                    <button type="button" onClick={() => { setOpenFor(openFor === r.id ? null : r.id); setError(null); }}
                      className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:rounded-lg max-md:px-3 max-md:text-[13px]">
                      {openFor === r.id ? "Close" : "Ask for a review"}
                    </button>
                  )}
                </span>
              </div>

              {openFor === r.id && members.state === "ok" && (
                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                  {/* Every field here already has a VISIBLE label, which is what s16 asks for and what
                      most of the rest of this workspace does not do. Below md they stack in task order
                      and Assign lands last, full width, as the one dominant action in the viewport. */}
                  <div className="flex flex-wrap items-end gap-2 max-md:flex-col max-md:items-stretch">
                    <label className="flex flex-col gap-1 max-md:w-full">
                      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">Reviewer</span>
                      <select className={input} value={assignTo} onChange={e => setAssignTo(e.target.value)}>
                        <option value="">Choose somebody</option>
                        {members.value.map(m => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 max-md:w-full">
                      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">By when</span>
                      <input type="date" className={input} value={dueOn} onChange={e => setDueOn(e.target.value)} />
                    </label>
                    <label className="flex flex-1 flex-col gap-1 max-md:w-full">
                      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">What to look at</span>
                      <input className={input} value={note} onChange={e => setNote(e.target.value)}
                        placeholder="Optional. What you want them to check." />
                    </label>
                    <button type="button" onClick={() => assign(r.id)} disabled={busy || !assignTo}
                      className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40 max-md:flex max-md:min-h-[var(--cp-touch-primary)] max-md:w-full max-md:items-center max-md:justify-center max-md:text-[15px]">
                      {busy ? "Assigning…" : "Assign"}
                    </button>
                  </div>
                  {/* ⚠ THE SENTENCE THAT STOPS SOMEBODY EXPECTING A CHIP TO MOVE. */}
                  <p className="mt-2 text-[10.5px] leading-relaxed text-gray-500">{DOC_REVIEW_STATUS_NOTE}</p>
                  {error && <p className="mt-1 text-[11.5px] font-semibold text-rose-700">{error}</p>}
                </div>
              )}
            </li>
          ))}
          {unsigned.value.length > 25 && (
            <li className="text-[11px] text-gray-400">
              and {unsigned.value.length - 25} more. The figure above counts all of them.
            </li>
          )}
        </ul>
      )}

      {/* An assign control drawn over a members list that could not be read would offer an empty select. */}
      {canAssign && members.state !== "ok" && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
          Who works in this practice could not be read, so a review cannot be assigned from this screen
          right now. {members.detail}
        </p>
      )}
    </Section>
  );
}

/* ── s13: WHO MAY DO WHAT, READ LIVE ────────────────────────────────────────────────────────────── */

function Permissions({ permissions }: { permissions: Reading<PermissionRow[]> }) {
  return (
    <Section
      title="Who may do what with documents here"
      blurb="Read from the grants that are live right now, not from what a role starts with. Delegation moves these, and this reflects the move."
    >
      {permissions.state !== "ok" ? (
        <Unreadable what="The capability grants" detail={permissions.detail} />
      ) : (
        <ul className="flex flex-col gap-1">
          {permissions.value.map(p => (
            <li key={p.capability} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 py-1.5 last:border-0">
              <span>
                <span className="text-[12.5px] font-semibold text-gray-800">{p.label}</span>
                <span className="ml-2 text-[11px] text-gray-500">{p.blurb}</span>
              </span>
              <span className={`text-[11.5px] ${p.nobody ? "font-semibold text-amber-800" : "text-gray-700"}`}>
                {/* ⚠ "NOBODY HOLDS THIS" IS SAID, NOT LEFT AS AN EMPTY CELL. A practice where nobody can
                    sign is a practice whose letters cannot leave, and that is worth reading as a sentence. */}
                {p.nobody ? "Nobody in this practice holds this" : p.holders.join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

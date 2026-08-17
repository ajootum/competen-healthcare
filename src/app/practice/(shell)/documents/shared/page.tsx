import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { sharedAndIssued } from "@/lib/practice/documents-workspace-issue";
import {
  DOC_STATUS, DOC_TYPE_LABEL, SHARE_DELIVERY_NOTE, SHARE_COUNT_LABEL,
  SHARE_COUNT_SWATCH, SHARE_COUNT_SWATCH_QUIET,
} from "@/lib/practice/documents-workspace-constants";
import { RELEASE_CHANNELS } from "@/lib/practice/document-constants";
import WorkspaceHeader from "../_workspace/WorkspaceHeader";

// /practice/documents/shared -- CPR-DOC-002 s3, SHARED & ISSUED. s20 PHASE 2.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// "Documents leaving the practice -- issued, printed, downloaded, emailed or link-shared documents with
// delivery status."
//
// ⚠ THE ONE THING ON THIS PAGE THAT COULD NOT BE FOUND ANY OTHER WAY IS THE FIRST SECTION: copies that
// were issued of a version that has since been amended. Everything else here is reconstructible by
// opening documents one at a time. That is not: it is the join between the release register and the
// supersession chain, and it names the only genuinely dangerous state this product can reach -- somebody
// outside the practice holding text the practice has replaced. Migration 195's header is explicit that
// this is WHY a signed version can never be edited. Until now nothing could answer it.
//
// ⚠ THERE IS NO DELIVERY STATUS COLUMN AND THE PAGE SAYS SO, ONCE, IN ONE LINE. s3 asks for it, s4 wants
// a failed-shares queue and s18 a Failed chip. Nothing in this product sends anything, so no row can
// carry a delivery outcome -- a Failed chip would be decoration and a Delivered one would be a claim
// nobody checked. SHARE_DELIVERY_NOTE states what a release IS. That is a description of the control in
// front of the reader, not an implementation note about a feature (s18).
//
// ⚠ NO ACTION LIVES HERE. Issuing a copy is done on the document, where the text being issued is on the
// screen beside the button. A one-click "issue" from a list is how somebody releases the wrong letter.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const CHANNEL_LABEL = Object.fromEntries(RELEASE_CHANNELS) as Record<string, string>;

const cell = "px-3 py-2 align-top text-[12.5px]";

// ══ CPR-MOB-001 s12 row 2 / s19's card-fallback rule — THE THREE HONESTY CELLS, EXTRACTED ═════════════
//
// ⚠ THESE EXIST BECAUSE THE TABLE NOW HAS TWO FACES AND THE SENTENCES MUST NOT DRIFT. Below md the seven
// columns become cards; from md up the table is exactly what it was. Each of the three cells below says
// something specific about a GAP in the record of where a clinical document went, and the whole point of
// extracting them is that "not recorded" cannot become an empty card field on a phone while it stays
// italic on a desktop. One definition, both faces — 4b's IdentityChips move, for the same reason.
//
// ⚠ AND NOT ONE OF THEM RENDERS A BLANK OR A ZERO. An empty cell reads as "nothing to say"; every one of
// these is "this was never written down", which is a different fact and looks like one.

/** The patient a copy was about. An em dash, because a release need not have a patient. */
function PatientCell({ name }: { name: string | null }) {
  return <>{name ?? "—"}</>;
}

/** Who is holding the copy. */
function RecipientCell({ recipient, note }: { recipient: string | null; note: string | null }) {
  return (
    <>
      {recipient
        ? <span className="text-gray-700">{recipient}</span>
        : <span className="italic text-gray-400">not recorded</span>}
      {note && <span className="block text-[11px] text-gray-500">{note}</span>}
    </>
  );
}

/** Who recorded the release. */
function ReleasedByCell({ name }: { name: string | null }) {
  return name
    ? <span className="text-gray-600">{name}</span>
    : <span className="italic text-gray-400">name not on record</span>;
}

/** The document's status NOW, plus the one alarming derived fact. Words, never colour alone (s4). */
function DocumentNowCell({ status, outdated }: { status: keyof typeof DOC_STATUS; outdated: boolean }) {
  const chip = DOC_STATUS[status];
  return (
    <>
      <span className={`inline-block rounded px-1.5 py-0.5 text-[10.5px] font-bold ${chip.chip}`} title={chip.blurb}>
        {chip.label}
      </span>
      {outdated && (
        <span className="mt-0.5 block text-[10.5px] font-semibold text-rose-700">
          this copy is out of date
        </span>
      )}
    </>
  );
}

export default async function SharedAndIssuedPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "document.view")) redirect("/practice/home");

  const admin = createAdminClient();
  const register = await sharedAndIssued(admin, shell.ctx.workspaceId);

  const issued = register.issued.state === "ok" ? register.issued.value : [];
  const awaiting = register.awaiting.state === "ok" ? register.awaiting.value : [];
  const outdated = issued.filter(r => r.outdatedForHolder);

  return (
    <div className="flex max-w-7xl flex-col gap-5">
      <WorkspaceHeader active="shared" capabilities={shell.ctx.capabilities} />

      <p className="rounded-xl bg-[var(--cmp-surface-information)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--cmp-text-information)]">
        {SHARE_DELIVERY_NOTE}
      </p>

      {/* ⚠ A FAILED READ IS NEVER A ZERO. The database's own words, and no counts printed beside them. */}
      {register.issued.state !== "ok" && (
        <p className="rounded-xl bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--cmp-text-warning)]">
          <span className="font-semibold">The issued-copies register could not be read.</span>{" "}
          This page is not showing that no copies have left the practice. It is showing that it could not
          find out.
          <span className="mt-0.5 block font-mono text-[11px] opacity-80">{register.issued.detail}</span>
        </p>
      )}
      {register.truncated.length > 0 && (
        <p className="rounded-xl bg-[var(--cmp-surface-information)] px-3 py-2 text-[12.5px] text-[var(--cmp-text-information)]">
          The most recent 500 of {register.truncated.join(" and ")}. Older rows are not on this page.
        </p>
      )}

      {/* ── THE THREE FIGURES, each the length of a list that is on this page ─────────────────────── */}
      {register.issued.state === "ok" && (
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            ["issued", issued.length],
            ["awaiting", awaiting.length],
            ["outdated", outdated.length],
          ] as const).map(([key, count]) => {
            const label = SHARE_COUNT_LABEL[key];
            // ⚠ THE ONE ALARMING CARD GOES QUIET AT ZERO. A rose card reading 0 every day is a card
            // nobody looks at on the day it reads 1.
            const swatch = key === "outdated" && count === 0
              ? SHARE_COUNT_SWATCH_QUIET : SHARE_COUNT_SWATCH[key];
            return (
              <div key={key} className={`rounded-2xl border p-3 ${swatch.box}`} title={label.blurb}>
                <p className={`text-2xl font-bold ${swatch.figure}`}>{count}</p>
                <p className="mt-0.5 text-[12.5px] font-semibold text-gray-800">{label.label}</p>
                <p className="text-[11px] text-gray-500">{label.caption}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* ── SUPERSEDED IN SOMEBODY ELSE'S HANDS ──────────────────────────────────────────────────── */}
      {outdated.length > 0 && (
        <section className="rounded-2xl border border-rose-300 bg-rose-50/60 p-4">
          <h2 className="text-[13px] font-bold text-rose-800">
            {outdated.length} issued cop{outdated.length === 1 ? "y is" : "ies are"} of a version since amended
          </h2>
          <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-gray-700">
            {SHARE_COUNT_LABEL.outdated.blurb} Nothing in this product can recall a copy. What it can do is
            tell you who to contact.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {outdated.map(r => (
              <li key={r.id} className="rounded-lg bg-white px-3 py-2 text-[12.5px] ring-1 ring-rose-200">
                <Link href={r.href} className="font-semibold text-[var(--cp-primary-deep)] hover:underline">{r.title}</Link>
                <span className="text-gray-600">
                  {r.patientName ? ` · ${r.patientName}` : ""}
                  {" · "}{CHANNEL_LABEL[r.channel] ?? r.channel}
                  {r.recipient ? ` to ${r.recipient}` : " — no recipient recorded"}
                  {" · "}{r.releasedAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── EVERY COPY THAT LEFT ─────────────────────────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 px-4 py-3">
          <h2 className="text-[13px] font-bold text-gray-900">{SHARE_COUNT_LABEL.issued.label}</h2>
          <p className="text-[11.5px] text-gray-500">One row per copy, not per document.</p>
        </div>
        {register.issued.state !== "ok" ? (
          <p className="px-4 py-6 text-[12.5px] text-gray-500">
            This list could not be read. See the message above for what the database said.
          </p>
        ) : issued.length === 0 ? (
          <div className="px-4 py-6">
            <p className="text-[13px] font-semibold text-gray-700">No copy has been recorded as issued.</p>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-gray-500">
              A copy is recorded from the document itself, once it is signed &mdash; the text being issued
              is on the screen beside the control, which is the point. If copies have been handed over
              without being recorded here, this practice has no record of who is holding what.
            </p>
          </div>
        ) : (
          <>
          {/* ══ CPR-MOB-001 s12 row 2 — THE CARDS, BELOW md ═══════════════════════════════════════════
              "Document list → Cards showing title/type/date/status and primary action", and s5's
              "Wide data table → Card/list rows". This is the ONE genuinely wide table in the workspace:
              seven columns behind a min-w-[860px], which on a 390px phone is s4's forbidden horizontal
              scroll for a core workflow.

              ⚠ CardList THE PRIMITIVE WAS REJECTED, AND THE REASON IS A RUNTIME ONE, NOT A TASTE ONE.
              It is a "use client" component whose whole contract is function props — getKey, title,
              fields, action. This page is a server component (force-dynamic, createAdminClient), and a
              function passed from a server component to a client one is not serialisable: Next throws
              "Functions cannot be passed directly to Client Components" at render. Both existing
              adopters, PatientsScreen and MobileReportsLanding, are themselves "use client". Adopting it
              here would mean making this page a client component and shipping the whole issued register
              to the browser to gain a card layout — so the cards are server-rendered here instead, and
              the four honesty cells are shared with the table above rather than the markup.

              ⚠ THE PRIMARY ACTION IS THE TITLE, AND THERE IS ONLY ONE. This page's own rule — "NO ACTION
              LIVES HERE", four paragraphs up — is untouched: the card opens the document, exactly as the
              table's title cell does. Issuing still happens on the document, beside the text being
              issued, because a one-tap Issue in a list is how somebody releases the wrong letter. */}
          <ul className="md:hidden flex flex-col gap-2.5 p-3">
            {issued.map(r => (
              <li
                key={r.id}
                className={`rounded-xl border bg-white p-3.5 ${
                  r.outdatedForHolder ? "border-rose-300" : "border-gray-200"}`}
              >
                <Link
                  href={r.href}
                  className="flex min-h-[var(--cp-touch)] items-center text-[14px] font-semibold leading-snug text-gray-900"
                >
                  {r.title}
                </Link>
                <p className="text-[11.5px] text-gray-400">{DOC_TYPE_LABEL[r.docType] ?? r.docType}</p>
                <div className="mt-1.5">
                  <DocumentNowCell status={r.documentStatus} outdated={r.outdatedForHolder} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {/* Visible labels on every field (s16) — a card has no column header to inherit one. */}
                  <div className="min-w-0">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Patient</dt>
                    <dd className="text-[12.5px] text-gray-700"><PatientCell name={r.patientName} /></dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">How</dt>
                    <dd className="text-[12.5px] text-gray-700">{CHANNEL_LABEL[r.channel] ?? r.channel}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">When</dt>
                    <dd className="text-[12.5px] text-gray-600">{r.releasedAt.slice(0, 10)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Recorded by</dt>
                    <dd className="text-[12.5px]"><ReleasedByCell name={r.releasedByName} /></dd>
                  </div>
                  {/* ⚠ FULL WIDTH, AND NOT TRUNCATED. "To whom" is the answer to the only question this
                      page exists to answer, and it carries the optional note under it. */}
                  <div className="col-span-2 min-w-0">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">To whom</dt>
                    <dd className="text-[12.5px]"><RecipientCell recipient={r.recipient} note={r.note} /></dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>

          <div className="max-md:hidden overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-left text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
                  <th className={cell}>Document</th>
                  <th className={cell}>Patient</th>
                  <th className={cell}>How</th>
                  <th className={cell}>To whom</th>
                  <th className={cell}>When</th>
                  <th className={cell}>Recorded by</th>
                  <th className={cell}>Document now</th>
                </tr>
              </thead>
              <tbody>
                {/* ⚠ EVERY CELL BELOW THAT CAN SAY "this was never recorded" IS NOW THE SAME COMPONENT
                    THE CARDS ABOVE RENDER. The markup is unchanged from what shipped — it was lifted,
                    not rewritten — so this table is pixel-identical at md and up, and the two faces
                    cannot drift apart the next time one of these sentences is edited. */}
                {issued.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                    <td className={cell}>
                      <Link href={r.href} className="font-semibold text-gray-900 hover:text-[var(--cp-primary-deep)] hover:underline">
                        {r.title}
                      </Link>
                      <span className="block text-[11px] text-gray-400">{DOC_TYPE_LABEL[r.docType] ?? r.docType}</span>
                    </td>
                    <td className={`${cell} text-gray-700`}><PatientCell name={r.patientName} /></td>
                    <td className={`${cell} text-gray-700`}>{CHANNEL_LABEL[r.channel] ?? r.channel}</td>
                    <td className={cell}><RecipientCell recipient={r.recipient} note={r.note} /></td>
                    <td className={`${cell} whitespace-nowrap text-gray-600`}>{r.releasedAt.slice(0, 10)}</td>
                    <td className={`${cell} text-gray-600`}><ReleasedByCell name={r.releasedByName} /></td>
                    <td className={cell}>
                      <DocumentNowCell status={r.documentStatus} outdated={r.outdatedForHolder} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      {/* ── SIGNED, AND NOBODY IS RECORDED AS HOLDING ONE ────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 px-4 py-3">
          <h2 className="text-[13px] font-bold text-gray-900">{SHARE_COUNT_LABEL.awaiting.label}</h2>
          <p className="max-w-xl text-[11.5px] text-gray-500">{SHARE_COUNT_LABEL.awaiting.blurb}</p>
        </div>
        {register.awaiting.state !== "ok" ? (
          <p className="px-4 py-6 text-[12.5px] text-gray-500">
            This list could not be read. It is not empty; it is unknown.
          </p>
        ) : awaiting.length === 0 ? (
          <p className="px-4 py-6 text-[12.5px] text-gray-500">
            Every signed document has at least one copy recorded against it.
          </p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {awaiting.map(d => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                <span>
                  <Link href={d.href} className="text-[12.5px] font-semibold text-gray-900 hover:text-[var(--cp-primary-deep)] hover:underline">
                    {d.title}
                  </Link>
                  <span className="text-[12px] text-gray-500">
                    {" · "}{DOC_TYPE_LABEL[d.docType] ?? d.docType}
                    {d.patientName ? ` · ${d.patientName}` : ""}
                    {(d.version ?? 1) > 1 ? ` · version ${d.version}` : ""}
                  </span>
                </span>
                <span className="text-[11.5px] text-gray-400">
                  {d.signedAt ? `signed ${d.signedAt.slice(0, 10)}` : "signed date not recorded"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

import Link from "next/link";
import type { Register } from "@/lib/practice/documents-workspace";
import {
  DOC_STATUS, DOC_STATUSES, DOC_ORIGIN, DOC_ORIGINS, DOC_TYPE_OPTIONS, DOC_TYPE_LABEL,
  patientLinkState, type DocFilter,
} from "@/lib/practice/documents-workspace-constants";
import ClassifyPanel from "./ClassifyPanel";
import FilterDisclosure from "./FilterDisclosure";

// CPR-DOC-002 s3 (Patient Documents, My Documents) and s10 (search, filters, retrieval).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE FILTERS ARE A PLAIN GET FORM, and every one of them is a URL. That is not nostalgia: it makes
// the card on the Overview and the list it opens THE SAME QUERY -- the card's href IS this page's
// querystring, applied by the same applyFilter() in the engine. There is no client-side filter state to
// drift out of step with the figure that sent you here.
//
// ⚠ ROWS FROM THREE TABLES, EACH WEARING ITS OWN ORIGIN. s18: "Use clear source labels: Created in CP,
// Uploaded by patient, Uploaded by staff, Received externally." Three of those four are real; the fourth
// needs a patient upload channel, which is s20 Phase 4, so no row can carry it and the label is not
// offered. See DOC_ORIGIN.
//
// ⚠ SORT: s10 asks for newest / oldest / patient / status / review priority. NEWEST FIRST, and only
// newest first. The other four are one-line additions and each would be a control nobody had asked a
// question with; they are not drawn rather than drawn as a select with one working option.
//
// NOT DRAWN, s20 Phase 3: saved views ("Awaiting my review", "Unsigned drafts", "Patient uploads today",
// "Failed shares"). The URLs that would back them are already the card hrefs, so a saved-view feature is
// a place to keep them, not a new capability -- and a menu that cannot save anything is worse than none.
//
// NOT DRAWN, s10's bulk operations: classify, archive, assign reviewer, export metadata. Archive has no
// state on either object, assign reviewer is Phase 3, and a bulk classify would let one click file
// forty documents against one patient.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

// ⚠ THE max-md:* TAIL IS THE ONLY CHANGE, AND IT IS ADDITIVE. s4's 44px floor and s16's "use native
// date/select controls" — these already ARE native <select> and <input type="date">, so a phone gets its
// own wheel pickers for free; they only needed to be big enough to hit and wide enough to read.
const selectClass =
  "rounded-lg border border-gray-200 px-2 py-1.5 text-[12.5px] outline-none focus:border-[var(--cp-primary)] "
  + "max-md:w-full max-md:min-h-[var(--cp-touch)] max-md:text-[14px]";

export default function RegisterTable({
  register, filter, action, canClassify, emptyTitle, emptyBody,
}: {
  register: Register;
  filter: DocFilter;
  /** The page this form posts back to, so My Documents stays My Documents when a filter is applied. */
  action: string;
  canClassify: boolean;
  emptyTitle: string;
  emptyBody: React.ReactNode;
}) {
  const rows = register.rows;

  return (
    <div className="flex flex-col gap-3">
      {register.unreadable.length > 0 && (
        <p className="rounded-xl bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--cmp-text-warning)]">
          <span className="font-semibold">
            {register.unreadable.map(u => u.source).join(" and ")} could not be read.
          </span>{" "}
          The list below is missing whatever those hold, by an amount nobody can state. It is not a short
          list; it is an incomplete one.
          <span className="mt-0.5 block font-mono text-[11px] opacity-80">
            {register.unreadable.map(u => `${u.source}: ${u.detail}`).join(" · ")}
          </span>
        </p>
      )}
      {register.truncated.length > 0 && (
        <p className="rounded-xl bg-[var(--cmp-surface-information)] px-3 py-2 text-[12.5px] text-[var(--cmp-text-information)]">
          <span className="font-semibold">The most recent 500 of {register.truncated.join(" and ")}.</span>{" "}
          Narrow the dates to reach older rows.
        </p>
      )}

      {/* ── s10's FILTERS ───────────────────────────────────────────────────────────────────────────
          ⚠ CPR-MOB-001 s5 collapses this row behind one control BELOW md and leaves it untouched above.
          Seven controls plus Apply and Clear is a comfortable wrapped row on a desktop and, on a 390px
          phone, a stack tall enough to push every document off the screen — which is how somebody
          concludes a register is empty. FilterDisclosure holds ONE copy of the controls; see its header
          for why FilterSheet was rejected and why the inputs stay in the DOM while hidden.

          The count is computed here, on the server, from the same DocFilter the engine applied — so the
          badge can never disagree with the list underneath it. */}
      {/* ⚠ THE md CLASSES ON THIS FORM ARE THE ORIGINAL ONES, UNTOUCHED: `flex flex-wrap items-end
          gap-2`. Only the max-md column stack is new, and FilterDisclosure's panel is md:contents, so at
          md and up every control below is still a direct flex item of this row exactly as it shipped. */}
      <form method="get" action={action} className="flex flex-wrap items-end gap-2 rounded-2xl border border-gray-200 bg-white p-3 max-md:flex-col max-md:items-stretch">
        <FilterDisclosure
          activeCount={
            [filter.q, filter.type, filter.status?.length ? "y" : null, filter.origin?.length ? "y" : null,
              filter.link, filter.from, filter.to, filter.patientId].filter(Boolean).length
          }
        >
        <label className="flex flex-col gap-0.5 max-md:w-full">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Search</span>
          {/* w-56 is 224px, which fits a desktop row and overflows a 360px phone once padding is
              counted. Full width below md; unchanged above. */}
          <input name="q" defaultValue={filter.q ?? ""} placeholder="Title, patient, sender"
            className="w-56 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10 max-md:w-full max-md:min-h-[var(--cp-touch)] max-md:text-[14px]" />
        </label>
        <label className="flex flex-col gap-0.5 max-md:w-full">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Type</span>
          <select name="type" defaultValue={filter.type ?? ""} className={selectClass}>
            <option value="">All types</option>
            {DOC_TYPE_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 max-md:w-full">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Status</span>
          <select name="status" defaultValue={filter.status?.join(",") ?? ""} className={selectClass}>
            <option value="">All statuses</option>
            {DOC_STATUSES.map(s => <option key={s} value={s}>{DOC_STATUS[s].label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 max-md:w-full">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Source</span>
          <select name="origin" defaultValue={filter.origin?.join(",") ?? ""} className={selectClass}>
            <option value="">Any source</option>
            {DOC_ORIGINS.map(o => <option key={o} value={o}>{DOC_ORIGIN[o].label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 max-md:w-full">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Patient link</span>
          <select name="link" defaultValue={filter.link ?? ""} className={selectClass}>
            <option value="">Either</option>
            <option value="linked">Linked</option>
            <option value="unlinked">Not linked</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5 max-md:w-full">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">From</span>
          <input type="date" name="from" defaultValue={filter.from ?? ""} className={selectClass} />
        </label>
        <label className="flex flex-col gap-0.5 max-md:w-full">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">To</span>
          <input type="date" name="to" defaultValue={filter.to ?? ""} className={selectClass} />
        </label>
        {/* ⚠ THE PATIENT FILTER EXISTED IN THE ENGINE AND HAD NO WAY IN. `parseDocFilter` has always read
            `patientId` and `applyFilter` has always honoured it -- and NOTHING SET IT. No control here,
            no link anywhere in src/ carrying it. So the tab called "Patient Documents" could not be
            narrowed to a patient, which is the one question its name promises to answer.

            ⚠ AND IT IS A HIDDEN INPUT BECAUSE THIS IS A GET FORM. Without it, applying any other filter
            while a patient is selected would silently drop the patient and widen the list back to the
            whole practice -- a filter that quietly returns MORE than it did before is worse than one
            that cannot be set. */}
        {filter.patientId && <input type="hidden" name="patientId" value={filter.patientId} />}
        {/* Below md these two become full-width touch controls stacked under the fields, which is where
            a thumb already is; from md up they sit on the row exactly as before. */}
        <button type="submit"
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 max-md:min-h-[var(--cp-touch-primary)] max-md:w-full max-md:border-[var(--cp-primary)] max-md:bg-[var(--cp-primary)] max-md:text-white">
          Apply
        </button>
        <Link href={action}
          className="rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-gray-500 hover:text-gray-800 max-md:flex max-md:min-h-[var(--cp-touch)] max-md:w-full max-md:items-center max-md:justify-center max-md:border max-md:border-gray-200 max-md:bg-white">
          Clear
        </Link>
        </FilterDisclosure>

        {/* ⚠ THE COUNT STAYS OUT OF THE DISCLOSURE. It is not a filter; it is the length of the list
            below, and it carries "that could be read" when a source failed. Collapsing it with the
            controls would hide the one sentence that distinguishes a short list from an incomplete
            one at exactly the width where the list itself is hardest to survey. */}
        <span className="text-[11.5px] text-gray-400 md:ml-auto">
          {rows.length === 1 ? "1 document" : `${rows.length} documents`}
          {register.unreadable.length > 0 && " that could be read"}
        </span>
      </form>

      {/* ⚠ THE ACTIVE PATIENT IS STATED, NOT LEFT TO BE INFERRED FROM THE ROWS. A narrowed register and
          a practice with one patient's worth of documents look identical, and the difference matters
          before somebody concludes a patient has nothing on file. The name comes off the rows; when the
          filter matches nothing there is no name to show, and it says the id rather than inventing one. */}
      {filter.patientId && (
        <p className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--cp-primary)]/30 bg-[var(--cp-primary)]/[0.06] px-3 py-2 text-[12.5px]">
          <span className="font-semibold text-[var(--cp-primary-deep)]">
            Showing only {rows[0]?.patientName ?? "one patient"}
          </span>
          <span className="text-gray-600">
            {rows.length === 1 ? "1 document" : `${rows.length} documents`} on this patient.
          </span>
          <Link href={action} className="ml-auto font-semibold text-[var(--cp-primary-deep)] hover:underline">
            Show every patient
          </Link>
        </p>
      )}

      {/* ── THE ROWS ──────────────────────────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--cp-primary)]/10 text-[22px] text-[var(--cp-primary-deep)]">▦</span>
            <p className="text-[14px] font-semibold text-gray-800">
              {register.unreadable.length > 0 ? "Nothing could be read" : emptyTitle}
            </p>
            <div className="max-w-xl text-[12.5px] leading-relaxed text-gray-500">
              {register.unreadable.length > 0
                ? "The reads did not return. This is not the same as there being nothing here."
                : emptyBody}
            </div>
          </div>
        ) : (
          <ul className="flex flex-col px-4 py-1">
            {rows.map(r => {
              const link = patientLinkState(r);
              const status = DOC_STATUS[r.status];
              const origin = DOC_ORIGIN[r.origin];
              return (
                <li key={`${r.origin}:${r.id}`} className="border-b border-gray-100 py-2.5 last:border-0">
                  {/* ══ CPR-MOB-001 s12 row 2 ═══════════════════════════════════════════════════════════
                      "Cards showing title/type/date/status and primary action." This row already carried
                      all five — it is a <li>, not a table row — so nothing is added and nothing is
                      dropped. What changes below md is that the TITLE TAKES ITS OWN LINE and the chips
                      wrap under it, instead of seven items competing on one wrapped line where the
                      document's name ends up as a two-word fragment between a version badge and a date.
                      The title is also the primary action: it opens the document. */}
                  <div className="flex flex-wrap items-center gap-2">
                    {r.href
                      ? <Link href={r.href} className="text-[13px] font-semibold text-gray-900 hover:underline max-md:flex max-md:w-full max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:text-[14px]">{r.title}</Link>
                      : <span className="text-[13px] font-semibold text-gray-900 max-md:block max-md:w-full max-md:text-[14px]">{r.title}</span>}
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                      {DOC_TYPE_LABEL[r.docType] ?? r.docType}
                    </span>
                    {r.version !== null && r.version > 1 && (
                      <span className="rounded bg-[var(--cmp-surface-information)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-information)]">
                        v{r.version}
                      </span>
                    )}
                    {r.priority === "urgent" && (
                      <span className="rounded bg-[var(--cmp-surface-critical)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-critical)]">
                        urgent
                      </span>
                    )}
                    {/* ⚠ THE STATUS CHIP CARRIES ITS STORED VALUE IN THE TOOLTIP. The word is derived from
                        s7's vocabulary; the column value is what a support question is really about. */}
                    {/* ⚠ md:ml-auto, NOT ml-auto. On a wrapped phone line `ml-auto` shoves the status
                        chip to the far right of whatever line it lands on, stranding it away from the
                        origin and date it belongs with. Above md the row does not wrap and the chip sits
                        exactly where it always has. */}
                    <span className={`md:ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold ${status.chip}`}
                      title={`${status.blurb} Stored as ${r.stored}.`}>
                      {status.label}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${origin.chip}`}
                      title={origin.blurb}>
                      {origin.short}
                    </span>
                    <span className="text-[11px] text-gray-400">{r.at}</span>
                  </div>

                  <p className="mt-0.5 text-[11.5px] text-gray-500">
                    {link.ok
                      ? (
                        <>
                          <Link href={`/practice/patients/${r.patientId}`} className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                            {r.patientName}
                          </Link>
                          {/* ⚠ THE WAY INTO THE PATIENT FILTER, AND WITHOUT IT THE FILTER IS STILL
                              UNREACHABLE. A hidden input preserves a patient somebody already chose; this
                              is what lets them choose one. It is a separate control from the name beside
                              it on purpose -- that link LEAVES for the patient's record, this one narrows
                              the list in place, and one link doing both would have to guess which was
                              meant. */}
                          {filter.patientId !== r.patientId && (
                            <>
                              {" "}
                              <Link href={`${action}?patientId=${r.patientId}`}
                                aria-label={`Show only ${r.patientName}'s documents`}
                                className="text-[11px] font-semibold text-gray-500 hover:text-[var(--cp-primary-deep)] hover:underline">
                                (only this patient)
                              </Link>
                            </>
                          )}
                        </>
                      )
                      : <span className="font-semibold text-rose-600">{link.reason}</span>}
                    <> &middot; {r.source}</>
                    {r.whereHeld && <> &middot; held: {r.whereHeld}</>}
                  </p>
                  {r.summary && <p className="mt-0.5 text-[11.5px] text-gray-600">{r.summary}</p>}

                  {/* Only an ARRIVAL can be classified. An authored document's patient is chosen when it
                      is created and is NOT NULL in the database; a filed attachment belongs to the
                      encounter it was attached to. Drawing the control on those would be a control that
                      cannot do anything. */}
                  {r.origin === "received_externally" && (
                    <ClassifyPanel canClassify={canClassify} row={{
                      id: r.id, title: r.title, source: r.source, docType: r.docType,
                      patientId: r.patientId, patientName: r.patientName, at: r.at,
                    }} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

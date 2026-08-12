import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import {
  patientList, defaultWindow, attendance, patientListCounts,
  type PatientListResult, type Attendance,
} from "@/lib/practice/patient-lists";
import { workspaceClock } from "@/lib/practice/practice-time";
import { groupByDay } from "@/components/practice/PatientTable";
import GroupedTable from "./GroupedTable";
import ExportMenu from "./ExportMenu";

// /practice/patients/lists -- WHO IS BOOKED, AND WHO WAS SEEN, as a list you can carry out.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// The owner, 2026-08-12: "review all patients booked, see who is booked when and where; export the
// list; filter per location (booked in TMR for the next month or two). Same concept for patients
// already seen."
//
// ⚠ THE FILTERS ARE A PLAIN <form method="get">, WITH NO CLIENT STATE. Every filtered view is therefore
// a URL: bookmarkable, shareable, and the same list when it is opened again. The one piece of client
// code on the page is the print button, because window.print() has no server equivalent.
//
// ⚠ PDF IS THE BROWSER'S PRINT DIALOGUE, AND THE PAGE SAYS SO RATHER THAN IMPLYING A GENERATOR. There
// is no PDF library in this product; a "Download PDF" button that opened a print dialogue would be
// claiming a feature that does not exist, and one that silently produced a different layout from the
// screen would be worse. The print rules below reduce the page to the list, its heading and its
// caveats -- so what prints is what was read.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "").trim();

/**
 * s4: DD-MM-YYYY for inputs, and WRITTEN MONTH for descriptive labels -- "04 Sep 2026", not "04-09-2026".
 * The reason the spec prefers it is that 04-09 and 09-04 are the same four digits reordered, so a
 * misread costs a month rather than looking wrong.
 *
 * ⚠ PARSED EXPLICITLY, never handed to `new Date("04-09-2026")`, which browsers resolve by locale --
 * the exact ambiguity s13 tells us not to inherit. The input is always the ISO day the engine returned.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function writtenDay(isoDay: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  if (!m) return isoDay;                       // not a day string: say what we were given, invent nothing
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${m[3]} ${month} ${m[1]}` : isoDay;
}
/** s4: the same day as DD-MM-YYYY, for the filter controls. */
const dashedDay = (isoDay: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : isoDay;
};

export default async function PatientListsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  // Names, so patient.view. patientList() re-checks rather than trusting this page.
  if (!hasCapability(shell.ctx, "patient.view")) redirect("/practice/patients");

  const sp = await searchParams;
  const view = one(sp.view) === "seen" ? "seen" : "booked";
  const admin = createAdminClient();
  const { today, timezone } = await workspaceClock(admin, shell.ctx.workspaceId);
  const def = defaultWindow(view, today);

  const result = await patientList(admin, shell.ctx, {
    view,
    fromDate: one(sp.from) || undefined,
    toDate: one(sp.to) || undefined,
    locationId: one(sp.location) || null,
    search: one(sp.q) || null,
  });

  // Over the SAME window and location the user is looking at, so the figure can never describe a period
  // other than the one on screen.
  const att = await attendance(admin, shell.ctx, {
    fromDate: result.fromDate, toDate: result.toDate, locationId: result.locationId, timezone,
  });
  // s3: BOTH tab counts, over the same filters, so the tab you are not on can state its own size.
  const counts = await patientListCounts(admin, shell.ctx, {
    fromDate: result.fromDate, toDate: result.toDate, locationId: result.locationId, timezone,
  });

  const qs = (over: Record<string, string>) => {
    const q = new URLSearchParams({
      view, from: result.fromDate, to: result.toDate,
      ...(result.locationId ? { location: result.locationId } : {}),
      ...over,
    });
    return q.toString();
  };
  // (The row formatter moved into ListBody: s8 splits the date onto the group header and leaves only the
  // time on the row, so the full weekday-date-time string this built is no longer rendered anywhere.)

  // s3: "changing tabs must preserve the current date range, location and search". Only `view` changes.
  // ⚠ A NULL COUNT IS NOT NOUGHT. When the count query failed the badge shows an em dash -- a tab reading
  // "Seen 0" would tell a practitioner they saw nobody, which is a different claim from "we could not
  // count". Same three-state rule the lists themselves follow.
  const tab = (key: "booked" | "seen", label: string, count: number | null) => (
    <Link href={`/practice/patients/lists?${qs({ view: key })}`}
      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold ${view === key
        ? "bg-[var(--cp-primary)] text-white"
        : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}>
      {label}
      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${view === key
        ? "bg-white/25 text-white" : "bg-gray-100 text-gray-600"}`}
        title={count === null ? "this count could not be read" : undefined}>
        {count ?? "—"}
      </span>
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl">
      {/* ⚠ THE CLASSIC VISIBILITY RESET, not display:none on a guessed selector. It hides everything and
          re-shows one subtree, so it works whatever the shell renders around this page -- and it cannot
          silently start printing the sidebar when the shell changes. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #printable, #printable * { visibility: visible !important; }
          #printable { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          #printable table { font-size: 11px; }
          #printable thead { display: table-header-group; }
          #printable tr { break-inside: avoid; }
          /* Browsers strip background colours when printing by default, which would flatten the status
             badges to plain text. The words still carry the meaning (s17), so this is fidelity rather
             than a dependency. */
          #printable * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          /* ⚠ A COLLAPSED DAY IS A SCREEN STATE AND MUST NOT REACH THE PAPER. Without this, somebody
             collapses August to read September, prints, and files a register with a whole day missing --
             and nothing on the page says so. GroupedTable keeps those rows in the DOM precisely so this
             rule can bring them back. */
          #printable .cp-day-closed { display: table-row !important; }
          #printable .print-only { display: inline-block !important; }
          /* The sticky header and the scroll box are screen affordances; on paper the list runs on and
             thead repeats per page via display: table-header-group above. */
          #printable .cp-scroll { max-height: none !important; overflow: visible !important; }
          #printable thead th { position: static !important; }
          @page { margin: 14mm; }
        }
        /* Shown only on paper. Screen uses the button that carries the same caption. */
        .print-only { display: none; }
      `}</style>

      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Booked and seen</h1>
          {/* s3's supporting text, verbatim. */}
          <p className="mt-1 text-[13px] text-gray-500">
            See who was booked and who was actually seen &mdash; over any period, at any location.
          </p>
        </div>
        <Link href="/practice/patients" className="text-[12.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          &larr; Back to Patients
        </Link>
      </div>

      {/* ── The summary tiles the reference design puts at the top right. ────────────────────────── */}
      <div className="no-print mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryTile icon="&#128197;" tint="bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
          label="Booked" value={counts.booked} unit="appointments" />
        <SummaryTile icon="&#128100;" tint="bg-emerald-100 text-emerald-700"
          label="Seen" value={counts.seen} unit="encounters" />
        {/* ⚠ THE THIRD TILE IS ATTENDANCE, NOT THE COMP'S "SEEN RATE 76% OF BOOKED".
            That figure divides encounters by appointments, and s3 refuses it in the spec's own words:
            "do not treat the Booked count and Seen count as a conversion funnel". The two tabs also
            default to DIFFERENT windows, so the comp's 76% divided last month's encounters by next
            month's bookings. The owner chose the honest replacement on 2026-08-12 -- attendance over a
            window that has already happened -- and the band below carries its counts and caveats. */}
        <AttendanceTile a={att} />
      </div>

      <div className="no-print mt-3 flex flex-wrap items-center gap-2">
        {tab("booked", "Booked", counts.booked)}
        {tab("seen", "Seen", counts.seen)}
      </div>

      {/* ── The filters. A GET form, so every view is a URL. ─────────────────────────────────────── */}
      <form method="get" className="no-print mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3">
        <input type="hidden" name="view" value={view} />
        {/* ⚠ s4 ASKS FOR DD-MM-YYYY AND A NATIVE DATE INPUT WILL NOT GIVE IT. <input type="date"> renders
            in the BROWSER's locale and no attribute overrides that -- a US-configured machine shows
            09/04/2026 for the fourth of September whatever we write here. Replacing it with a text box we
            control would cost the calendar picker, the keyboard handling and the platform validation, and
            would hand us the locale-dependent PARSING s13 explicitly forbids.
            So the control stays native and the unambiguous rendering is stated beneath it, which is the
            part a person reads back to check. */}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gray-500">From</span>
          <input type="date" name="from" defaultValue={result.fromDate}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px]" />
          <span className="text-[10.5px] tabular-nums text-gray-400">{dashedDay(result.fromDate)}</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gray-500">To</span>
          <input type="date" name="to" defaultValue={result.toDate}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px]" />
          <span className="text-[10.5px] tabular-nums text-gray-400">{dashedDay(result.toDate)}</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gray-500">Location</span>
          <select name="location" defaultValue={result.locationId ?? ""}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px]">
            <option value="">All locations</option>
            {result.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <button type="submit"
          className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
          Apply
        </button>
        <Link href={`/practice/patients/lists?view=${view}&from=${def.from}&to=${def.to}`}
          className="rounded-lg border border-gray-200 px-3 py-2 text-[13px] font-semibold text-gray-600 hover:bg-gray-50">
          Reset
        </Link>

        {/* s5: search by patient name and patient number. A plain GET field, so a searched view is a URL
            like every other filter state -- and so it survives a tab change, which s3 requires. */}
        <label className="ml-auto flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gray-500">Search</span>
          <input type="search" name="q" defaultValue={result.search ?? ""}
            placeholder={view === "booked" ? "Search booked patients..." : "Search seen patients..."}
            className="w-[220px] rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px]" />
        </label>
        {/* s5: "Export is a single menu rather than two permanent buttons." */}
        <ExportMenu csvHref={`/api/v1/practice/patient-lists?${qs({ format: "csv" })}`} />
      </form>

      <p className="no-print mt-2 text-[11.5px] leading-relaxed text-gray-500">
        <strong>PDF:</strong> use <em>Print</em> and choose &ldquo;Save as PDF&rdquo; as the destination.
        This product has no PDF generator, so the page you are reading is what prints &mdash; rather than
        a separate document that could differ from it.
      </p>

      {/* ── The list itself. Everything inside #printable is what a PDF will contain. ─────────────── */}
      {/* ⚠ ATTENDANCE LIVES INSIDE #printable ON PURPOSE. The print rules hide everything outside this
          subtree, so a band placed above it would read on screen and be absent from every PDF -- and a
          list handed to somebody else would have lost the figure that qualifies it. */}
      <div id="printable" className="mt-4">
        <AttendanceBand a={att}
          locationName={result.locationId ? (result.locations.find(l => l.id === result.locationId)?.name ?? null) : null} />
        <div className="mt-3">
          <ListBody result={result} view={view} />
        </div>
      </div>
    </div>
  );
}

function ListBody({ result, view }: {
  result: PatientListResult; view: "booked" | "seen";
}) {
  // (No card heading: the reference design runs the tabs straight into the context line, and a
  // "Booked patients" title between them would repeat the tab that is already highlighted.)
  // s10: a Booked row is an appointment; a Seen row is a consultation. The noun follows the dataset
  // rather than a shared "record", because the two are not the same thing counted twice.
  const countNoun = view === "booked" ? "appointment" : "consultation";
  // s8: one location selected means the column would repeat the same value on every row.
  const showLocation = !result.locationId;

  // ⚠ THREE STATES, AND THE MIDDLE ONE IS THE POINT. A failed read must never print as an empty list --
  // this page exists to be exported, and an empty PDF is filed and planned against.
  if (!result.permitted)
    return <p className="rounded-xl border border-gray-200 bg-white p-4 text-[13px] text-gray-600">
      Your role does not carry patient.view, so this list is not shown. That is a permission, not an empty list.
    </p>;
  if (result.unavailable)
    return <p className="rounded-xl border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] p-4 text-[13px] text-[var(--cmp-text-critical)]">
      {result.detail ?? "This list could not be read."} Nothing is being claimed about who is {view === "booked" ? "booked" : "seen"} &mdash;
      do <strong>not</strong> read this as nobody.
    </p>;

  // ⚠ EVERY VISIBLE STRING IS BUILT HERE, ON THE SERVER, because GroupedTable is a client component and
  // a function on its payload would type-check, lint, pass the harnesses and kill the page at runtime.
  // The ISO instant travels too, but only as the grouping key.
  const timeOf = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: result.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(iso));
    } catch { return iso.slice(11, 16); }
  };
  const groups = groupByDay(
    result.rows.map(r => ({
      id: r.id, patientId: r.patientId, patientName: r.patientName, patientNumber: r.patientNumber,
      at: r.at, time: timeOf(r.at), kind: r.kind, status: r.status,
      locationId: r.locationId, locationName: r.locationName, locationSlot: r.locationSlot,
      sex: r.sex,
    })),
    result.timezone,
  );

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        {/* s5's context line, as the reference design lays it out: place, then period, then count. */}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-gray-600">
          <span aria-hidden="true">&#127973;</span>
          <strong className="font-bold text-gray-900">{result.locationName ?? "All locations"}</strong>
          <span className="text-gray-300">&middot;</span>
          <span aria-hidden="true">&#128197;</span>
          <span>{writtenDay(result.fromDate)} &ndash; {writtenDay(result.toDate)}</span>
          <span className="text-gray-300">&middot;</span>
          <span><strong className="font-bold text-gray-900">{result.rows.length}</strong> {result.rows.length === 1 ? countNoun : `${countNoun}s`}</span>
          <span className="text-gray-300">&middot;</span>
          <span><strong className="font-bold text-gray-900">{result.patientCount}</strong> {result.patientCount === 1 ? "patient" : "patients"}</span>
          {result.search && (
            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-800">
              filtered by &ldquo;{result.search}&rdquo;
            </span>
          )}
        </p>
        {result.truncated && (
          <p className="mt-1 text-[12px] font-semibold text-[var(--cmp-text-warning)]">
            Only the first {result.limit} rows are shown. Narrow the period or the location &mdash; this list
            is not complete.
          </p>
        )}
        {result.detail && <p className="mt-1 text-[11.5px] text-[var(--cmp-text-warning)]">{result.detail}</p>}

        {/* ⚠ THE COUNTING RULE MOVES UP HERE, WHERE THE REFERENCE DESIGN PUTS IT, AND STILL PRINTS.
            It was a grey line under the table -- below the fold on any list longer than a screen, so the
            one sentence that says what the number does and does not include was the least likely thing
            on the page to be read. It is a caveat on the count; it belongs beside the count. */}
        <p className="mt-2.5 flex items-start gap-2 rounded-lg bg-[var(--cp-primary)]/[0.06] px-3 py-2 text-[11.5px] leading-relaxed text-gray-600">
          <span aria-hidden="true" className="mt-px text-[12px] text-[var(--cp-primary)]">&#9432;</span>
          <span>
            Times are shown in <strong className="font-semibold">{result.timezone}</strong>, this
            practice&rsquo;s own clock.
            {view === "booked"
              ? " Requested, confirmed and arrived appointments only — cancelled, completed and no-show bookings are not counted."
              : " One row per recorded consultation; somebody seen twice appears twice."}
            {" "}This list identifies patients and is not anonymised.
          </span>
        </p>
      </div>

      {result.rows.length === 0 ? (
        // s15's wording, plus the sentence that matters more than the wording: this period WAS read.
        <p className="px-4 py-6 text-[13px] text-gray-500">
          {view === "booked"
            ? "No booked patients found for this period and location."
            : "No patients were seen for this period and location."}
          {" "}This period was read successfully &mdash; use <em>Reset</em> to restore the default filters.
        </p>
      ) : (
        <GroupedTable groups={groups} view={view} showLocation={showLocation} countNoun={countNoun} />
      )}

    </section>
  );
}

// ── ATTENDANCE ──────────────────────────────────────────────────────────────────────────────────────
//
// The one percentage on this page, and the shape it has to keep to earn it. See attendance() in
// src/lib/practice/patient-lists.ts for why the comp's "seen rate 76% of booked" is not this figure.
//
//   THE COUNTS ARE THE HEADLINE, the percentage is the tail of the sentence. 78% reads identically at
//   31-of-40 and 3-of-4, so the scale must be impossible to miss rather than available on request.
//   NO OUTCOME RECORDED IS SHOWN, never folded into "did not attend" -- and while it is above nought the
//   percentage is labelled AT LEAST, because some of those people were seen and nobody wrote it down.
//   IT PRINTS. It is part of the page, not chrome around it, so the paper says the same as the screen.

function AttendanceBand({ a, locationName }: { a: Attendance; locationName: string | null }) {
  // ⚠ THREE STATES, NOT TWO. A failed read is not an attendance of nought.
  if (!a.readable) {
    return (
      <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-900">
        Attendance could not be worked out for this period{a.detail ? ` (${a.detail})` : ""}. The list
        below is unaffected.
      </p>
    );
  }
  // Nothing has happened yet. Saying "0% attended" over a week of future bookings would be a lie about
  // the practice rather than a fact about the window.
  if (a.elapsed === 0) return null;

  const bucket = (n: number, label: string, dot: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <strong className="font-semibold text-gray-900">{n}</strong>
      <span className="text-gray-600">{label}</span>
    </span>
  );

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[13px] font-bold text-gray-900">
          Attendance{locationName ? ` — ${locationName}` : ""}
        </h2>
        <p className="text-[11.5px] text-gray-500">
          {a.partialWindow
            ? "Counts the part of this period that has already happened; bookings still ahead are not included."
            : "Every appointment in this period."}
        </p>
      </div>

      <p className="mt-1.5 text-[13.5px] text-gray-800">
        Of <strong className="font-semibold text-gray-900">{a.elapsed}</strong>{" "}
        {a.elapsed === 1 ? "appointment" : "appointments"} that have taken place:
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px]">
        {bucket(a.attended, "attended", "bg-emerald-500")}
        {bucket(a.didNotAttend, "did not attend", "bg-rose-400")}
        {bucket(a.cancelled, "cancelled", "bg-gray-400")}
        {a.noOutcomeRecorded > 0 && bucket(a.noOutcomeRecorded, "no outcome recorded", "bg-amber-400")}
      </div>

      {a.attendedPercent === null ? (
        // ⚠ NOT "0% attended". Below the measurability line the percentage would be reporting how much
        // has been written down, in a form that reads as a judgement on the patients.
        <div className="mt-2 border-t border-gray-100 pt-2">
          <p className="text-[13px] font-semibold text-gray-800">Attendance is not known for this period.</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">
            {a.resolved === 0
              ? `None of these appointments has been closed off, so there is nothing to work an attendance figure from.`
              : `More of these appointments have no outcome recorded (${a.noOutcomeRecorded}) than have one (${a.resolved}), so any percentage would describe the record-keeping rather than who turned up.`}
            {" "}Marking each one attended, or as a missed appointment, is what makes the figure appear.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-2 border-t border-gray-100 pt-2 text-[13px] text-gray-800">
            <strong className="text-[15px] font-bold text-gray-900">
              {a.noOutcomeRecorded > 0 ? "At least " : ""}{a.attendedPercent}% attended
            </strong>
            <span className="text-gray-500"> &mdash; {a.attended} of {a.elapsed}</span>
          </p>
          {a.noOutcomeRecorded > 0 && (
            <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
              {a.noOutcomeRecorded} {a.noOutcomeRecorded === 1 ? "appointment has" : "appointments have"} no
              consultation recorded and {a.noOutcomeRecorded === 1 ? "was" : "were"} not marked as missed,
              so {a.noOutcomeRecorded === 1 ? "it is" : "they are"} counted in the total but not as
              attended. Real attendance is this figure or higher.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── The reference design's summary tiles ────────────────────────────────────────────────────────────

/**
 * ⚠ A NULL VALUE IS NOT A NOUGHT, and this is the tile where that matters most. "Seen 0 encounters" is a
 * statement about the practice; "we could not count" is a statement about the query. They must not look
 * the same, so a failed count renders an em dash and says why on hover.
 */
function SummaryTile({ icon, tint, label, value, unit }: {
  icon: string; tint: string; label: string; value: number | null; unit: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[17px] ${tint}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-gray-500">{label}</div>
        <div className="text-[20px] font-bold leading-tight text-gray-900"
          title={value === null ? "this count could not be read" : undefined}>
          {value ?? "—"}
        </div>
        <div className="text-[11.5px] text-gray-500">{value === null ? "could not be counted" : unit}</div>
      </div>
    </div>
  );
}

/**
 * The third tile. The comp draws "Seen rate 76% of booked"; this draws attendance, for the reasons set
 * out at the call site and in attendance() itself. Where the percentage is withheld the tile says so in
 * words rather than showing a nought, because the tile is the part people read at a glance.
 */
function AttendanceTile({ a }: { a: Attendance }) {
  const unreadable = !a.readable;
  const nothing = a.readable && a.elapsed === 0;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <span aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-[17px] text-sky-700">
        &#127919;
      </span>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-gray-500">Attended</div>
        <div className="text-[20px] font-bold leading-tight text-gray-900">
          {unreadable || nothing || a.attendedPercent === null
            ? "—"
            : `${a.noOutcomeRecorded > 0 ? "≥" : ""}${a.attendedPercent}%`}
        </div>
        <div className="text-[11.5px] text-gray-500">
          {unreadable ? "could not be read"
            : nothing ? "nothing has elapsed yet"
              : a.attendedPercent === null ? "outcomes not recorded"
                : `${a.attended} of ${a.elapsed} elapsed`}
        </div>
      </div>
    </div>
  );
}

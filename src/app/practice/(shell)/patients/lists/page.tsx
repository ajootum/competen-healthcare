import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { patientList, defaultWindow, type PatientListResult } from "@/lib/practice/patient-lists";
import { workspaceClock } from "@/lib/practice/practice-time";
import PrintButton from "./PrintButton";

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
  });

  const qs = (over: Record<string, string>) => {
    const q = new URLSearchParams({
      view, from: result.fromDate, to: result.toDate,
      ...(result.locationId ? { location: result.locationId } : {}),
      ...over,
    });
    return q.toString();
  };
  const fmt = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone, weekday: "short", day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(iso));
    } catch { return iso; }
  };

  const tab = (key: "booked" | "seen", label: string) => (
    <Link href={`/practice/patients/lists?${qs({ view: key, from: defaultWindow(key, today).from, to: defaultWindow(key, today).to })}`}
      className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${view === key
        ? "bg-[var(--cp-primary)] text-white"
        : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}>
      {label}
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
          @page { margin: 14mm; }
        }
      `}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Booked and seen</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Who is booked, and who was seen &mdash; over any period, at any location.
          </p>
        </div>
        <Link href="/practice/patients" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          &larr; Patients
        </Link>
      </div>

      <div className="no-print mt-3 flex flex-wrap items-center gap-2">
        {tab("booked", "Booked")}
        {tab("seen", "Seen")}
      </div>

      {/* ── The filters. A GET form, so every view is a URL. ─────────────────────────────────────── */}
      <form method="get" className="no-print mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3">
        <input type="hidden" name="view" value={view} />
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gray-500">From</span>
          <input type="date" name="from" defaultValue={result.fromDate}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px]" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-gray-500">To</span>
          <input type="date" name="to" defaultValue={result.toDate}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px]" />
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

        <span className="ml-auto flex items-center gap-2">
          <PrintButton />
          <a href={`/api/v1/practice/patient-lists?${qs({ format: "csv" })}`}
            className="rounded-lg border border-gray-200 px-3 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50">
            Download CSV
          </a>
        </span>
      </form>

      <p className="no-print mt-2 text-[11.5px] leading-relaxed text-gray-500">
        <strong>PDF:</strong> use <em>Print</em> and choose &ldquo;Save as PDF&rdquo; as the destination.
        This product has no PDF generator, so the page you are reading is what prints &mdash; rather than
        a separate document that could differ from it.
      </p>

      {/* ── The list itself. Everything inside #printable is what a PDF will contain. ─────────────── */}
      <div id="printable" className="mt-4">
        <ListBody result={result} fmt={fmt} view={view} />
      </div>
    </div>
  );
}

function ListBody({ result, fmt, view }: {
  result: PatientListResult; fmt: (iso: string) => string; view: "booked" | "seen";
}) {
  const title = view === "booked" ? "Booked patients" : "Patients seen";

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

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-[15px] font-bold text-gray-900">{title}</h2>
        <p className="mt-0.5 text-[12px] text-gray-600">
          {result.fromDate} to {result.toDate} ({result.timezone})
          {" · "}{result.locationName ?? "All locations"}
          {" · "}<strong>{result.rows.length}</strong> {result.rows.length === 1 ? "appointment" : view === "booked" ? "appointments" : "consultations"}
          {" · "}<strong>{result.patientCount}</strong> {result.patientCount === 1 ? "patient" : "patients"}
        </p>
        {result.truncated && (
          <p className="mt-1 text-[12px] font-semibold text-[var(--cmp-text-warning)]">
            Only the first {result.limit} rows are shown. Narrow the period or the location &mdash; this list
            is not complete.
          </p>
        )}
        {result.detail && <p className="mt-1 text-[11.5px] text-[var(--cmp-text-warning)]">{result.detail}</p>}
      </div>

      {result.rows.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-gray-500">
          Nobody was {view === "booked" ? "booked" : "seen"} between {result.fromDate} and {result.toDate}
          {result.locationName ? ` at ${result.locationName}` : ""}. This period was read successfully.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-gray-50/80">
              <tr>
                {["Patient number", "Patient", view === "booked" ? "Booked for" : "Seen on", "Kind", "Status", "Location"].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[0.06em] text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map(r => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono text-[12px] text-gray-700">{r.patientNumber ?? "—"}</td>
                  <td className="px-3 py-2 text-[13px] font-semibold text-gray-900">
                    {r.patientId
                      ? <Link href={`/practice/patients/${r.patientId}`} className="hover:underline">{r.patientName}</Link>
                      : <span title="Booked by name before a record existed">{r.patientName}</span>}
                  </td>
                  <td className="px-3 py-2 text-[13px] text-gray-800">{fmt(r.at)}</td>
                  <td className="px-3 py-2 text-[12.5px] text-gray-600">{r.kind}</td>
                  <td className="px-3 py-2 text-[12px] text-gray-600">{r.status.toLowerCase()}</td>
                  <td className="px-3 py-2 text-[12.5px] text-gray-600">{r.locationName ?? "not named"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ⚠ THE SENTENCE TRAVELS WITH THE PAGE, because the page is meant to leave the product. */}
      <p className="border-t border-gray-100 px-4 py-2 text-[11px] leading-relaxed text-gray-500">
        This list identifies patients and is not anonymised. Times are shown in {result.timezone}, this
        practice&rsquo;s own clock.
        {view === "booked"
          ? " Requested, confirmed and arrived appointments only — cancelled, completed and no-show bookings are not counted."
          : " One row per recorded consultation; somebody seen twice appears twice."}
      </p>
    </section>
  );
}

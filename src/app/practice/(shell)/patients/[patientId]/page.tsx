import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getPatient, registerNeighbours } from "@/lib/practice/patients";
import { patientFinancial } from "@/lib/practice/billing";
import { formatMinor } from "@/lib/practice/billing-constants";
import { practiceToday } from "@/lib/practice/practice-time";
import { patientTimeline } from "@/lib/practice/encounters";
import { listFollowUps } from "@/lib/practice/follow-ups";
import { patientFollowUps } from "@/lib/practice/follow-up-plans";
import { patientCorrespondence } from "@/lib/practice/document-library";
import FollowUpPanel from "./FollowUpPanel";
import { listContacts } from "@/lib/practice/communication";
import { logAccess, patientAccessHistory } from "@/lib/practice/privacy";
import PatientActions from "./PatientActions";
import StartEncounterAction from "../../encounters/StartEncounterAction";
import { loadTaxonomy } from "@/lib/practice/taxonomy";
import ContactLog from "./ContactLog";
import { monitoringPlan } from "@/lib/practice/parameters";
import MonitoringPlanPanel from "./MonitoringPlanPanel";
import { patientMedications } from "@/lib/practice/medication";
import MedicationPanel from "./MedicationPanel";

// /practice/patients/{id} -- the Phase-2 slice of CPR-V2-002's patient workspace: identity, identifiers,
// contacts and the diary history, plus book-for-patient. The clinical timeline, problems and documents
// arrive with their phases and are named as such. Object-level access: a patient outside the caller's
// workspace is notFound(), indistinguishable from a patient that never existed (SHELL-001 s6.2).
//
// A MERGED patient renders as a signpost to the survivor, not as an editable record and not as a 404 --
// the row exists precisely so history is followable (DM-001 s6.1).

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export default async function PatientPage({ params, searchParams }: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{ followUp?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "patient.view")) redirect("/practice/home");

  const { patientId } = await params;
  const { followUp: followUpTab } = await searchParams;
  const admin = createAdminClient();
  const detail = await getPatient(admin, shell.ctx.workspaceId, patientId);
  // The booking card's two dropdowns. Read HERE rather than in the client, so the card receives plain
  // data -- ids and labels only -- and cannot make a request of its own. A function on that payload
  // would type-check, lint, pass every harness and kill the page at runtime.
  const taxonomy = await loadTaxonomy(admin, { workspaceId: shell.ctx.workspaceId });
  if (!detail) notFound();

  const { patient, identifiers, contacts, appointments } = detail;
  const practiceId = (identifiers as any[]).find(i => i.identifier_type === "practice_id")?.value ?? null;
  // THREE STATES, NOT TWO. Not permitted to see encounters, could not read them, and there are none --
  // and only the last of those means the patient has no history here. `unavailable: false` on the
  // capability branch is correct and deliberate: nothing failed, the caller simply may not look.
  const timeline = hasCapability(shell.ctx, "encounter.list")
    ? await patientTimeline(admin, shell.ctx.workspaceId, patientId, 20)
    : {
      encounters: [] as any[], diagnosesByEncounter: {} as Record<string, any[]>,
      unavailable: false, diagnosesUnavailable: false, detail: null as string | null,
    };
  // CPR-140. Read-only here: the actions live where the clinical context is, in the consultation and on
  // the board. What this record owes is a fact about the patient and belongs on their page.
  //
  // THE FULL PATIENT-CENTRIC VIEW arrived with migration 206 -- plans, adherence and the comp's tabs.
  // listFollowUps is still called because the contact log takes the open ones to file a call against.
  const canSeeFollowUps = hasCapability(shell.ctx, "followup.view");
  const followUps = canSeeFollowUps
    ? (await listFollowUps(admin, shell.ctx.workspaceId, { patientId, status: ["OPEN", "SCHEDULED"] })).items
    : [];
  const followUpView = canSeeFollowUps
    ? await patientFollowUps(admin, shell.ctx.workspaceId, patientId)
    : null;
  // CPR-320. The register of contact WITH this person -- calls made, messages left. Recorded, never
  // sent. Named contactLog, not contacts: `contacts` on this page is already the patient's phone
  // numbers from migration 193 -- the same collision that renamed the table itself.
  const contactLog = await listContacts(admin, shell.ctx.workspaceId, { patientId, limit: 15 });
  // CPR-320. Composed from documents issued, copies released, documents received and calls recorded --
  // no table of its own, because those four already hold every fact it shows.
  const correspondence = hasCapability(shell.ctx, "document.view")
    ? await patientCorrespondence(admin, shell.ctx.workspaceId, patientId)
    : null;

  // CPR-370. THE READ THAT MATTERS MOST, logged after notFound() so a probe for another practice's id
  // leaves no trail suggesting it was seen. The history is fetched for the panel below; it deliberately
  // includes this very visit once the page is next opened, because a log that hides the reader looking
  // at the log is not a log.
  await logAccess(admin, {
    workspaceId: shell.ctx.workspaceId, actorId: shell.ctx.userId, subjectKind: "patient",
    subjectId: patientId, patientId, route: "/practice/patients/[id]",
  });
  const accessHistory = hasCapability(shell.ctx, "access.review")
    ? await patientAccessHistory(admin, shell.ctx.workspaceId, patientId, 12)
    : null;

  // CPR-LCP-001 s10.2's Monitoring Plan panel.
  //
  // ⚠ ALWAYS FETCHED, NEVER GATED HERE. monitoringPlan itself returns permitted:false when the caller
  // lacks parameter.view, and the panel renders that as a permissions sentence rather than as an empty
  // plan. Gating the CALL would collapse "you may not see this" into "there is nothing here", which is
  // the exact failure the three states exist to prevent -- and this page has been bitten by it before
  // (see the clinical-timeline note below).
  const monitoring = await monitoringPlan(admin, shell.ctx, patientId);
  // s12/s18: read only when the caller holds billing.view -- clinical access does not imply money.
  const financial = hasCapability(shell.ctx, "billing.view")
    ? await patientFinancial(admin, shell.ctx, patientId) : null;

  // CPR-MED-001. The medication record, as MED s8's first named integration and as the design comp draws
  // it.
  //
  // ⚠ ALWAYS FETCHED, NEVER GATED HERE, for the same reason the monitoring plan above is not:
  // patientMedications reports permitted:false itself, and reports storeState "absent" when the migration
  // has not been applied. Gating the CALL would collapse "you may not see this" and "this deployment has
  // no medication store" into "there is nothing here" -- and on a medication list that reads as a patient
  // who takes nothing.
  const medications = await patientMedications(admin, shell.ctx, patientId);

  // The register-walk links in the header. After the merged-record check would be too late: a merged
  // record renders its signpost and returns before the header exists.
  const neighbours = await registerNeighbours(admin, shell.ctx.workspaceId, patientId);

  // ── THE BOOKED BANNER (the owner, 2026-08-12: "how can we show that this patient is already
  // booked?") ─────────────────────────────────────────────────────────────────────────────────────
  // The appointments were ALWAYS fetched -- and rendered at the very bottom of the page, below the
  // access log, in raw UTC slices. A booking that exists but cannot be seen where the decision is made
  // is the REACHABLE-but-not-DISCOVERABLE failure this product keeps re-finding. What is upcoming now
  // renders directly under the name, in the practice's own clock.
  const timezone = shell.ctx.workspaceTimezone;
  const today = practiceToday(timezone);
  // #15: the booking card offers WHERE. Active places only -- a closed location is not somewhere
  // a new appointment happens.
  const { data: locationRows } = await admin.from("practice_location")
    .select("id, name").eq("workspace_id", shell.ctx.workspaceId).eq("active", true).order("name");
  const fmtWhen = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone, weekday: "short", day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(iso));
    } catch { return String(iso).slice(0, 16).replace("T", " ") + " (zone unreadable, shown as UTC)"; }
  };
  // A server component runs once per request, so "now" is the request's own moment.
  // eslint-disable-next-line react-hooks/purity -- request-scoped clock read in a server component
  const nowMs = Date.now();
  const upcoming = (appointments as any[])
    .filter(a => ["REQUESTED", "CONFIRMED", "ARRIVED"].includes(a.status) && Date.parse(a.scheduled_at) >= nowMs)
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
  const locIds = [...new Set(upcoming.map(a => a.location_id).filter(Boolean))] as string[];
  const { data: locRows } = locIds.length
    ? await admin.from("practice_location").select("id, name").eq("workspace_id", shell.ctx.workspaceId).in("id", locIds)
    : { data: [] };
  const locName = new Map(((locRows ?? []) as any[]).map(l => [l.id, l.name as string]));

  if (patient.status === "merged") {
    return (
      <div className="max-w-3xl">
        <h1 className="text-xl font-bold text-gray-900">{patient.display_name}</h1>
        <div className="mt-4 rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
          <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">This record was merged.</p>
          <p className="mt-1 text-[12px] text-gray-700">
            Its identifiers, contacts and appointments now live on the surviving record.
          </p>
          {patient.merged_into_patient_id && (
            <Link href={`/practice/patients/${patient.merged_into_patient_id}`}
              className="mt-2 inline-block text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Open the surviving record →
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{patient.display_name}</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            {/* CPR-PID-001: the CP Patient Number is the headline identity; the retired P-XXXXXX shows
                only on a record that predates the numbering. */}
            {(patient.patient_number ?? practiceId) && <span className="font-mono">{patient.patient_number ?? practiceId}</span>}
            {" · "}{patient.sex}
            {patient.birth_date ? ` · b. ${patient.birth_date}` : patient.age_estimate_years != null ? ` · ~${patient.age_estimate_years}y` : ""}
            {" · "}{patient.status}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* ⚠ WALKING THE REGISTER WITHOUT THE ROUND-TRIP (the owner, 2026-08-11). The order is the
              register's own default -- most recently registered first -- so "next" here is the row
              below this patient on an unsorted registry. When the neighbours could not be trusted
              (read failed, register over the bound) NOTHING renders: a "next" that silently skipped
              somebody would be worse than the round-trip this replaces. */}
          {neighbours.known && (neighbours.prev || neighbours.next) && (
            <span className="flex items-center gap-2 text-[12px] font-semibold">
              {neighbours.prev ? (
                <Link href={`/practice/patients/${neighbours.prev.id}`} title={neighbours.prev.name}
                  className="text-[var(--cp-primary-deep)] hover:underline">← {neighbours.prev.name}</Link>
              ) : (
                <span className="text-gray-300">first on the register</span>
              )}
              <span aria-hidden className="text-gray-300">|</span>
              {neighbours.next ? (
                <Link href={`/practice/patients/${neighbours.next.id}`} title={neighbours.next.name}
                  className="text-[var(--cp-primary-deep)] hover:underline">{neighbours.next.name} →</Link>
              ) : (
                <span className="text-gray-300">last on the register</span>
              )}
            </span>
          )}
          <Link href="/practice/patients" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline max-md:inline-flex max-md:min-h-[var(--cp-touch)] max-md:items-center">← Registry</Link>
        </div>
      </div>

      {/* ⚠ WHETHER THIS PATIENT IS ALREADY BOOKED, WHERE THE BOOKING DECISION IS MADE. Without this,
          the desk books a second appointment because the first one was only visible at the bottom of
          the page. Times are the practice's own clock, never a UTC slice. */}
      {upcoming.length > 0 && (
        <div className="mt-3 rounded-xl border border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.06] px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--cp-primary-deep)]">
            Booked — {upcoming.length === 1 ? "1 upcoming appointment" : `${upcoming.length} upcoming appointments`}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {upcoming.map((a: any) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-gray-800">
                <span className="font-semibold">{fmtWhen(a.scheduled_at)}</span>
                <span className="text-gray-600">{String(a.appointment_type).replace(/_/g, " ")}</span>
                {a.location_id && locName.get(a.location_id) && (
                  <span className="text-gray-600">· {locName.get(a.location_id)}</span>
                )}
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${a.status === "CONFIRMED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                  {a.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ══ CPR-MOB-001 s9 rows 3 + 5 -- two md:hidden blocks; neither renders at md+. ══════════════════
          THE PRIMARY PATIENT ACTION, POSITIONED CONSISTENTLY: Start consultation, directly under the
          patient's identity on every record. It is the SAME shared control the desktop card mounts --
          StartEncounterAction over startEncounterFor(), resume-before-create and all -- behind the SAME
          capability gate; the desktop card's own copy is max-md:hidden so no viewport carries two
          dominant primary actions (s4). A pinned bar was rejected: StickyPrimaryAction cannot host this
          control without re-implementing its guarded fetch, and a fixed bar stacked on the bottom nav
          is the s17 obscuring the primitive itself warns about. */}
      {hasCapability(shell.ctx, "encounter.create") && (
        <div className="mt-3 md:hidden [&_button]:min-h-[var(--cp-touch-primary)] [&_button]:w-full [&_button]:text-[14px]">
          <StartEncounterAction
            patientId={patient.id}
            label="Start consultation"
            note="Opens the consultation record now. If one is already open for this patient it is resumed, never duplicated."
          />
        </div>
      )}

      {/* s9 row 3: INTERNAL SECTION NAVIGATION for the single-column record. Anchors, not tabs -- the
          page is server-rendered and every section is already on it, so a jump is honest where a tab
          bar would imply panels that swap. Only sections that actually render get a chip. The strip
          scrolls in its own box (s4 forbids horizontal scroll for the WORKFLOW, not inside a tab
          strip -- SectionTabs' own reading, adopted; the primitive itself is not, because it drives
          client tab STATE and these are same-page anchors with none). */}
      <nav aria-label="Sections of this record" className="mt-3 md:hidden">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[
            { id: "record-identifiers", label: "Identifiers" },
            { id: "record-actions", label: "Actions & booking" },
            ...(financial && financial.permitted ? [{ id: "record-money", label: "Money" }] : []),
            { id: "record-monitoring", label: "Monitoring" },
            { id: "record-medications", label: "Medications" },
            ...(followUpView && followUpView.all.length > 0 ? [{ id: "record-followups", label: "Follow-up" }] : []),
            ...(correspondence && correspondence.entries.length > 0 ? [{ id: "record-correspondence", label: "Correspondence" }] : []),
            { id: "record-contactlog", label: "Contact log" },
            ...(accessHistory && accessHistory.entries.length > 0 ? [{ id: "record-access", label: "Access" }] : []),
            { id: "record-appointments", label: "Appointments" },
            ...(hasCapability(shell.ctx, "encounter.list") ? [{ id: "record-timeline", label: "Clinical timeline" }] : []),
          ].map(s => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="inline-flex min-h-[var(--cp-touch)] shrink-0 items-center whitespace-nowrap rounded-full border border-gray-200 bg-white px-3.5 text-[12px] font-semibold text-gray-700"
            >
              {s.label}
            </a>
          ))}
        </div>
      </nav>

      <div className="mt-4 grid lg:grid-cols-2 gap-4">
        <section id="record-identifiers" className="scroll-mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Identifiers</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {(identifiers as any[]).map(i => (
              <li key={i.id} className="flex items-center gap-2 text-[12px]">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{i.identifier_type.replace(/_/g, " ")}</span>
                <span className="font-mono text-gray-800">{i.value}</span>
                {i.issuer && <span className="text-gray-400">({i.issuer})</span>}
                {i.valid_to && <span className="text-[10px] text-gray-400">historical</span>}
              </li>
            ))}
          </ul>

          <h2 className="mt-4 text-[13px] font-bold text-gray-900">Contacts</h2>
          {(contacts as any[]).length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-400">None recorded.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {(contacts as any[]).map(c => (
                <li key={c.id} className="flex items-center gap-2 text-[12px]">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{c.contact_type}</span>
                  <span className="text-gray-800">{c.value}</span>
                  {c.preferred && <span className="text-[10px] font-semibold text-[var(--cmp-text-success)]">preferred</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <PatientActions
          patientId={patient.id}
          displayName={patient.display_name}
          sex={patient.sex}
          birthDate={patient.birth_date}
          ageEstimateYears={patient.age_estimate_years}
          recordVersion={patient.record_version}
          // NO hasPriorEncounter. The visit type used to be decided from this page-load read and handed
          // down; startEncounterFor() reads it when the button is pressed instead, so a tab left open
          // through a consultation cannot file the next one as a first visit.
          canEdit={hasCapability(shell.ctx, "patient.edit")}
          canMerge={hasCapability(shell.ctx, "patient.merge")}
          canBook={hasCapability(shell.ctx, "appointment.manage")}
          canStartEncounter={hasCapability(shell.ctx, "encounter.create")}
          taxonomy={{
            visitTypes: taxonomy.visitTypes.map(v => ({ id: v.id, label: v.label })),
            modes: taxonomy.modes.map(m => ({ id: m.id, label: m.label })),
            defaultVisitTypeId: taxonomy.defaultVisitTypeId,
            defaultModeId: taxonomy.defaultModeId,
            readable: taxonomy.readable,
          }}
          locations={((locationRows ?? []) as { id: string; name: string }[]).map(l => ({ id: l.id, name: l.name }))}
          todayDate={today}
        />
      </div>

      {/* CPR-LCP-001 s10.2. Rendered unconditionally: a panel that disappears when it cannot be read is
          the failed-read-as-zero bug wearing a layout. */}
      {/* ── CPR-PAY-001 s12: the COMPACT financial panel -- balance and a door, never a billing
          workspace inside the clinical record. Rendered only for holders of billing.view, because
          s18 keeps financial data outside clinical permission grants. */}
      {financial && financial.permitted && (
        <section id="record-money" className="scroll-mt-4 mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-[13px] font-bold text-gray-900">Money</h2>
            <a href={`/practice/payments?tab=transactions&patientId=${patientId}`}
              className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Full financial history &rarr;
            </a>
          </div>
          {financial.unavailable ? (
            <p className="mt-1 text-[12px] text-rose-800">
              The money figures could not be read. This is not a statement that nothing is owed.
            </p>
          ) : (financial.balances ?? []).length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-600">Nothing outstanding on any issued invoice.</p>
          ) : (
            <p className="mt-1 text-[13px] text-gray-800">
              Outstanding:{" "}
              {(financial.balances ?? []).map((b: any) => formatMinor(b.balanceMinor, b.currency)).join(" · ")}
            </p>
          )}
        </section>
      )}

      <MonitoringPlanPanel plan={monitoring} patientId={patientId} />

      {/* CPR-MED-001 s2, s6, s7 and reconciliation. Rendered unconditionally, like the panel above: a
          medication list that disappears when it cannot be read is the failed-read-as-zero bug wearing a
          layout, and on this particular list it reads as a patient taking nothing. */}
      <MedicationPanel
        record={medications}
        canRecord={hasCapability(shell.ctx, "medication.record")}
        canVerify={hasCapability(shell.ctx, "medication.override")}
      />

      {followUpView && followUpView.all.length > 0 && (
        <FollowUpPanel view={followUpView} patientId={patientId} tab={followUpTab ?? "upcoming"} />
      )}

      {correspondence && correspondence.entries.length > 0 && (
        <section id="record-correspondence" className="scroll-mt-4 mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-[13px] font-bold text-gray-900">Correspondence</h2>
            <span className="text-[11px] text-gray-500">
              {correspondence.issued} issued · {correspondence.received} received ·{" "}
              {correspondence.copiesReleased} {correspondence.copiesReleased === 1 ? "copy" : "copies"} released ·{" "}
              {correspondence.contacts} recorded
            </span>
          </div>
          {/* CPR-320. ONE TIMELINE, composed from what already exists -- documents issued, copies
              released, documents received, calls recorded. A correspondence table would be a fourth
              copy of facts three tables already hold, and it would drift the first time somebody wrote
              to one and not the other. */}
          <ul className="mt-2 flex flex-col">
            {correspondence.entries.slice(0, 12).map((e: any) => (
              <li key={`-`} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <span className="min-w-0">
                  <Link href={e.href} className="block truncate text-[12px] font-semibold text-gray-800 hover:underline">
                    {e.title}
                  </Link>
                  <span className="block text-[10px] text-gray-500">{e.detail}</span>
                </span>
                <span className="ml-auto shrink-0 text-right">
                  <span className="block text-[10px] text-gray-500">{String(e.at).slice(0, 10)}</span>
                  <span className="block text-[10px] text-gray-400">{e.status}</span>
                </span>
              </li>
            ))}
          </ul>
          {/* The sentence this panel must not lose. */}
          <p className="mt-2 text-[10px] text-gray-500">
            Nothing here was sent by this product &mdash; there is no email, SMS or patient-messaging
            channel. A released copy is somebody recording that they printed or handed something over.
          </p>
        </section>
      )}

      <ContactLog
        patientId={patientId}
        contacts={contactLog}
        followUps={followUps as never[]}
        canRecord={hasCapability(shell.ctx, "comm.record")}
      />

      {/* CPR-370. Who has opened this record. The question a patient is most entitled to ask, and the
          one this product could not answer before the access log existed. */}
      {accessHistory && accessHistory.entries.length > 0 && (
        <section id="record-access" className="scroll-mt-4 mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[13px] font-bold text-gray-900">Who has opened this record</h2>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
              {accessHistory.distinctActors} {accessHistory.distinctActors === 1 ? "person" : "people"}
            </span>
            <Link href={`/practice/privacy?patientId=${patientId}`} className="ml-auto text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Full access log →
            </Link>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {accessHistory.entries.map((e: any) => (
              <li key={e.id} className="flex items-baseline gap-2 text-[11px] max-md:flex-wrap">
                <span className="font-mono text-gray-400">{String(e.occurred_at).slice(0, 16).replace("T", " ")}</span>
                <span className="font-semibold text-gray-700">{e.actor_name ?? "Unnamed member"}</span>
                <span className="text-gray-500">{e.action === "export" ? "exported" : "opened"} the {e.subject_kind.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-gray-400">
            Every read through this application, including your own just now. The log is append-only &mdash;
            the database refuses to change or remove an entry.
          </p>
        </section>
      )}

      <section id="record-appointments" className="scroll-mt-4 mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Appointment history</h2>
        {(appointments as any[]).length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">
            No linked appointments yet. Diary entries made before this patient was registered carry a name
            only and stay on the calendar.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {/* ⚠ THE PRACTICE CLOCK, NOT A UTC SLICE. The old `.slice(0, 16)` printed a correctly
                stored Kampala 09:00 as 06:00 -- the same display bug CalendarConsole carried. */}
            {/* max-md:flex-wrap: a mono timestamp, a type and a status do not share 320px on one
                line, and a row that cannot wrap is the horizontal scroll s4 forbids. */}
            {(appointments as any[]).map(a => (
              <li key={a.id} className="flex items-center gap-2 text-[12px] max-md:flex-wrap">
                <span className="font-mono text-gray-500">{fmtWhen(a.scheduled_at)}</span>
                <span className="text-gray-700">{String(a.appointment_type).replace(/_/g, " ")}</span>
                <span className="ml-auto text-gray-500">{a.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {hasCapability(shell.ctx, "encounter.list") && (
        <section id="record-timeline" className="scroll-mt-4 mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Clinical timeline</h2>
          {/* ⚠ "NO ENCOUNTERS RECORDED" IS A CLINICAL CLAIM, and until this it was also what a failed
              read looked like. A clinician reading an empty timeline concludes the patient has no
              history here; there is nothing on the screen to suggest otherwise, and the decisions that
              follow are different ones. The two are now different sentences. */}
          {timeline.unavailable ? (
            <p className="mt-2 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">
              This patient&rsquo;s clinical history could not be read. This is <strong>not</strong> the same
              as having none &mdash; do not treat this patient as new.
            </p>
          ) : (timeline.encounters as any[]).length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">No encounters recorded for this patient yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {(timeline.encounters as any[]).map(e => (
                <li key={e.id} className="border-l-2 border-gray-100 pl-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/practice/encounters/${e.id}`} className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                      {String(e.started_at).slice(0, 16).replace("T", " ")}
                    </Link>
                    <span className="text-[11px] text-gray-400">
                      {String(e.entry_pathway).replace(/_/g, " ")} · {String(e.encounter_mode).replace(/_/g, " ")}
                    </span>
                    <span className="ml-auto text-[10px] font-bold text-gray-500">{e.status}</span>
                  </div>
                  {e.reason_for_visit && <p className="text-[11px] text-gray-600">{e.reason_for_visit}</p>}
                  {(timeline.diagnosesByEncounter[e.id] ?? []).map((d: any, i: number) => (
                    <p key={i} className="text-[11px] text-gray-500">
                      {d.is_primary ? "▪ " : "· "}{d.label} <span className="text-gray-400">({d.certainty})</span>
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[10px] text-gray-400">
            The 20 most recent encounters. Documents and attachments arrive with Phase 4.
          </p>
        </section>
      )}
    </div>
  );
}

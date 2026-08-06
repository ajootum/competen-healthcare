import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { registrationWorkspace } from "@/lib/practice/registration-workspace";
import {
  patientsWorkspace, worklists, myPatients, patientSummary, familyRelationships, universalSearch,
} from "@/lib/practice/patient-workspace";
import { WORKLIST_KEYS, DEFAULT_PAGE_SIZE } from "@/lib/practice/patient-workspace-constants";
import PatientsScreen from "./PatientsScreen";
import RegistryConsole from "./RegistryConsole";
import ContextPanel from "./ContextPanel";
import type {
  CohortView, FamilyView, ScreenCapabilities, SearchView, SummaryView, WorklistsView,
} from "./types";

// /practice/patients -- CPR-PAT-002, the Patients workspace dashboard (CPR-V5-006's engine, unchanged).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// "Redesign the Patients workspace around LONGITUDINAL CARE rather than patient registration." s3's
// order is the page's order: universal search with New Patient and Quick Walk-in at the top, then the
// five Today's Care cards, then the four Continuing Care cards, then the longitudinal register --
// with registration in a drawer behind one click, because s9 asks it to occupy minimal space.
//
// THE NINE CARDS ARE NOT THE ENGINE'S SIX WORKLISTS. Six map onto one exactly; three -- In Consultation,
// Follow-ups Today, Urgent Reviews -- have no query behind them, keep their place in the row and print
// the read the engine would have to make. Nothing on this screen counts anything itself.
//
// EVERY FIGURE ON IT COMES FROM patient-workspace.ts, WHICH IS READ-ONLY. Nothing on this page writes.
// The three writes it offers -- register, start a consultation, queue a walk-in -- go to APIs that
// already existed, because a second implementation of any of them would give the product two answers to
// the same question.
//
// THE ENGINE'S TYPES ARE CHECKED AGAINST THE SCREEN'S HERE, ON PURPOSE. types.ts mirrors the payload
// shapes so that "use client" files never import patient-workspace.ts (it reaches next/headers through
// access.ts, which breaks the build in a way tsc and eslint do not report). The mirror is not trusted:
// the assignments below are where the engine's own return types meet it, so a change in the engine
// stops this file compiling rather than silently rendering a field that no longer exists.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v ?? "").trim();

export default async function PatientsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "patient.list")) redirect("/practice/home");

  const sp = await searchParams;

  // ── THE URL CONTRACT ──────────────────────────────────────────────────────────────────────────────
  // The sidebar already ships /practice/patients?list=waiting and ?list=new. `worklist` is accepted as
  // an alias because WORKLIST_META's own hrefs use it. Anything else falls back to the whole register
  // and is reported to the reader rather than silently ignored.
  const rawList = one(sp.list) || one(sp.worklist);
  const isKey = (WORKLIST_KEYS as readonly string[]).includes(rawList);
  const selectedList = isKey ? rawList : null;
  const unknownList = rawList && !isKey && rawList !== "new" ? rawList : null;
  const registerOpen = rawList === "new" || one(sp.register) === "1";
  // Which act the drawer was opened for. It changes the drawer's own words, never the form's behaviour
  // -- see RegistrationDrawer. Anything other than "walkin" is treated as no intent at all.
  const registerIntent = one(sp.intent) === "walkin" ? "walkin" : null;

  const query = one(sp.q);
  const selectedPatientId = one(sp.patient) || null;
  const parsedPage = Number.parseInt(one(sp.page), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 0;
  const scope: "practice" | "mine" = one(sp.scope) === "mine" ? "mine" : "practice";
  const sort: "registered" | "name" = one(sp.sort) === "name" ? "name" : "registered";

  const admin = createAdminClient();
  const ctx = shell.ctx;
  const canCreate = hasCapability(ctx, "patient.create");

  const capabilities: ScreenCapabilities = {
    mayList: true,
    mayView: hasCapability(ctx, "patient.view"),
    mayCreate: canCreate,
    maySearch: hasCapability(ctx, "patient.list") && hasCapability(ctx, "patient.view"),
    // encounter.create, verified against migration 191's seeded capability list. There is no
    // "patient.register" capability -- registration is patient.create.
    mayStartEncounter: hasCapability(ctx, "encounter.create"),
  };

  const [base, regWorkspace, summaryResult, familyResult, searchResult] = await Promise.all([
    (async () => {
      // The unfiltered landing surface is one call, which parallelises the worklists and the cohort.
      if (!selectedList) {
        const w = await patientsWorkspace(admin, ctx, { page, pageSize: DEFAULT_PAGE_SIZE, scope, sort });
        return { lists: w.worklists, cohort: w.cohort as CohortView | null };
      }
      // A FILTERED VIEW HAS TO KNOW WHO IS ON THE LIST BEFORE IT CAN ASK FOR THEM, so these are ordered
      // rather than parallel. A worklist that could not be read yields NO cohort at all -- filtering by
      // an empty id set would render the whole practice as "nobody is waiting".
      const lists = await worklists(admin, ctx);
      const wl = lists.worklists.find(w => w.key === selectedList);
      if (!wl || wl.unavailable) return { lists, cohort: null as CohortView | null };
      const cohort = await myPatients(admin, ctx, {
        page, pageSize: DEFAULT_PAGE_SIZE, scope, sort, patientIds: wl.patientIds,
        // A FILTERED LIST MUST NOT BE SHORTER THAN THE TILE THAT OPENED IT. myPatients defaults to
        // active records; somebody archived who is nonetheless sitting in the waiting room would drop
        // out silently and make the count above disagree with the table below. Archived people are
        // people -- they are shown here, with their record status on the row.
        includeInactive: true,
      });
      return { lists, cohort: cohort as CohortView | null };
    })(),
    canCreate ? registrationWorkspace(admin, ctx) : Promise.resolve(null),
    selectedPatientId ? patientSummary(admin, ctx, selectedPatientId) : Promise.resolve(null),
    selectedPatientId ? familyRelationships(admin, ctx, selectedPatientId) : Promise.resolve(null),
    // A LINKED ?q= IS ANSWERED ON THE SERVER, so a search sent to a colleague opens with its results on
    // it. Typing is answered by /api/v1/practice/patients/search; both call the same engine.
    query ? universalSearch(admin, ctx, query, { limit: 20 }) : Promise.resolve(null),
  ]);

  // ── The mirror check (see the header) ─────────────────────────────────────────────────────────────
  const lists: WorklistsView = base.lists;
  const cohort: CohortView | null = base.cohort;
  const summary: SummaryView | null = summaryResult?.ok ? summaryResult.data : null;
  const summaryError = summaryResult && !summaryResult.ok
    ? { status: summaryResult.status, code: summaryResult.code, message: summaryResult.message }
    : null;
  const family: FamilyView | null = familyResult?.ok ? familyResult.data : null;
  const initialSearch: SearchView | null = searchResult ?? null;

  return (
    // THE CANVAS IS WHAT MAKES A WHITE CARD READ AS A CARD. Against a white page the borders do all the
    // work alone. The negative margin cancels the shell's own padding so the tint reaches the edges.
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto w-full max-w-[1500px]">
        <PatientsScreen
          capabilities={capabilities}
          lists={lists}
          cohort={cohort}
          selectedList={selectedList}
          unknownList={unknownList}
          query={query}
          initialSearch={initialSearch}
          patientId={selectedPatientId}
          summary={summary}
          summaryError={summaryError}
          family={family}
          registerOpen={registerOpen}
          registerIntent={registerIntent}
          page={page}
          scope={scope}
          sort={sort}
          registration={regWorkspace ? (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <RegistryConsole
                canCreate={canCreate}
                canStartEncounter={capabilities.mayStartEncounter}
                workspace={regWorkspace}
              />
              {/* The operational context the registration desk works against -- today's clinic, who is
                  waiting, who was registered, and what this screen refuses. It stays with the form
                  rather than with the workspace, because that is the job it belongs to. */}
              <ContextPanel w={regWorkspace} />
            </div>
          ) : null}
        />
      </div>
    </div>
  );
}

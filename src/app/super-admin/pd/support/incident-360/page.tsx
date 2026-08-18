import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdSupport, loadIncidentCommand } from "@/lib/hq/pd-support";
import { SEVERITY_LABEL, STATUS_LABEL } from "@/lib/hq/mos-incident";
import {
  SupportHeader, Panel, SeverityBadge, StatusChip, AbsentList, Explain, Cite,
} from "../_components/support-ui";

// CPR-PD-009 §7 — INCIDENT 360 / COMMAND. The specification calls this the critical build.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ s7 NAMES EIGHT PANELS AND THREE OF THEM CAN BE FILLED. Command Header, Impact and Timeline have
// producers; Current Situation, Actions Underway, Communications and Decisions have no record type at
// all, and "next update due" needs a cadence with nowhere to be configured. Each dark panel is named
// SEPARATELY rather than as one sentence, because a commander opening this surface needs to know WHICH
// part of it is dark - a single "some panels are unavailable" leaves them guessing which.
//
// ⚠ AND THE IMPACT FIGURE IS COUNTED WHEN THE PAGE IS OPENED, NOT WHEN THE INCIDENT WAS RAISED. The
// incident carries a correlation id; the count comes from the event store now. A number frozen at
// declaration is wrong within the hour of an incident that is still moving, which is exactly the hour a
// commander is reading it.

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireHqCapability("hq.practice.support.view");
  const { id } = await searchParams;
  const admin = await createAdminClient();

  if (!id) {
    const s = await loadPdSupport(admin);
    return (
      <div className="flex flex-col gap-4">
        <SupportHeader
          title="Incident 360"
          spec="CPR-PD-009 §7"
          purpose="A single command surface for an active major incident."
          readAt={s.readAt}
        />
        <Panel title="Choose an incident" note="§7 is a surface for ONE incident. Open one from the list to command it.">
          {s.incidents.length === 0 ? (
            <p className="text-[12px] leading-relaxed text-gray-600">
              No incident is open, so there is nothing to command. ⚠ Not the same as &ldquo;nothing is
              wrong&rdquo; — five of §1&apos;s six record types do not exist, so much of what would be
              worth commanding has nowhere to be recorded.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-gray-100">
              {s.incidents.map(i => (
                <li key={i.incidentId} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <Link href={`/super-admin/pd/support/incident-360?id=${i.incidentId}`}
                    className="text-[12.5px] font-semibold text-gray-900 hover:text-teal-700">
                    {i.title}
                  </Link>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <SeverityBadge label={SEVERITY_LABEL[i.severity]} />
                    <StatusChip label={STATUS_LABEL[i.status]} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    );
  }

  const c = await loadIncidentCommand(admin, id);
  if (!c) {
    return (
      <div className="flex flex-col gap-4">
        <SupportHeader
          title="Incident 360"
          spec="CPR-PD-009 §7"
          purpose="A single command surface for an active major incident."
          readAt={new Date().toISOString()}
        />
        <Panel title="That incident is not open">
          <p className="text-[12px] leading-relaxed text-gray-600">
            No open incident has that identifier. It may have been resolved, or it may never have
            existed — ⚠ and this page cannot tell you which, because it reads only the open estate.
          </p>
          <Link href="/super-admin/pd/support/incidents" className="mt-2 inline-block text-[11.5px] font-semibold text-teal-700 hover:underline">
            Incident Management →
          </Link>
        </Panel>
      </div>
    );
  }

  const i = c.incident;

  return (
    <div className="flex flex-col gap-4">
      <SupportHeader
        title={i.title}
        spec="CPR-PD-009 §7"
        purpose="Command surface: what is known, what it affects, and what has happened so far."
        readAt={new Date().toISOString()}
      />

      {/* ── §7 Command Header ──────────────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge label={c.severityLabel} />
          <StatusChip label={c.statusLabel} />
          <span className="text-[11.5px] text-gray-600">running {c.durationHours}h</span>
          {i.detection === "health_rule" && (
            <span className="text-[11.5px] text-gray-500">· raised by a health rule</span>
          )}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Commander</p>
            <p className={`mt-0.5 text-[12.5px] ${i.ownerName ? "font-semibold text-gray-900" : "font-semibold text-[var(--cmp-text-warning)]"}`}>
              {i.ownerName ?? "none — §7 requires one"}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Subject</p>
            <p className="mt-0.5 text-[12.5px] text-gray-800">{i.subjectLabel ?? i.subjectType}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Journey</p>
            <p className="mt-0.5 text-[12.5px] text-gray-800">{i.journeyName ?? "none named"}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Next update due</p>
            <p className="mt-0.5 text-[12.5px] font-semibold text-gray-400">no cadence configured</p>
          </div>
        </div>
        <Explain summary="Why §7's technical owner and product owner are not shown">
          §7 asks for three roles on the header: incident commander, technical owner and product owner.
          The model carries ONE owner. Showing the same name in three slots would suggest three people
          had been assigned, and leaving two blank without saying why would read as an oversight rather
          than a schema limit.
          <Cite>mos_incident.owner_name and .owner_id — one owner, not three roles</Cite>
        </Explain>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        {/* ── §7 Impact ─────────────────────────────────────────────────────────────────────── */}
        <Panel title="Impact (§7)" note="Counted from the event thread this incident names, when the page is opened.">
          {c.impact === null ? (
            <p className="text-[12px] leading-relaxed text-gray-600">
              This incident carries no correlation id, so its impact is <span className="font-semibold">unknown</span> —
              ⚠ not zero. Nothing threads it to the telemetry that would say how many attempts or
              practices it touched.
            </p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                {[["Events on the thread", c.impact.events], ["Failed", c.impact.failures], ["Practices touched", c.impact.practices]].map(([l, v]) => (
                  <div key={String(l)} className="rounded-lg border border-gray-200 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{l}</p>
                    <p className="mt-0.5 text-[20px] font-bold leading-none tabular-nums text-gray-900">{v}</p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-gray-600">
                {i.affectedScope ?? "No affected scope was stated on the incident."}
              </p>
              <Explain summary="Why this is counted now rather than stored">
                §8 of the substrate specification asks for quantified impact where possible. A number
                frozen when the incident was declared is wrong within the hour of an incident that is
                still moving — which is exactly the hour a commander is reading it. The incident stores
                the thread; the count is taken when you open the page.
              </Explain>
            </>
          )}
        </Panel>

        {/* ── §7 Timeline ───────────────────────────────────────────────────────────────────── */}
        <Panel title="Timeline (§7)" note="The append-only lifecycle trail. It cannot be edited or deleted while the incident exists.">
          {c.history.length === 0 ? (
            <p className="text-[12px] leading-relaxed text-gray-600">
              Nothing has been recorded on this incident since it was raised. The trail exists and holds
              no entries — a measured empty timeline rather than an unreadable one.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {c.history.map((h, n) => (
                <li key={n} className="border-l-2 border-gray-200 pl-2.5">
                  <p className="font-mono text-[10.5px] text-gray-500">
                    {new Date(h.at).toISOString().replace("T", " ").slice(0, 16)} GMT
                  </p>
                  <p className="text-[12px] text-gray-800">
                    {h.fromStatus && h.toStatus ? `${h.fromStatus} → ${h.toStatus}` : (h.toStatus ?? "recorded")}
                    {h.actorName ? ` · ${h.actorName}` : ""}
                  </p>
                  {h.note && <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">{h.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      {/* ── the dark panels, named one by one ──────────────────────────────────────────────────── */}
      <Panel
        title="The panels §7 asks for that have no record type"
        note="Named individually, because a commander needs to know which part of the surface is dark rather than that some part is."
      >
        <AbsentList items={c.darkPanels.map(d => ({ label: d.panel, why: d.why }))} />
      </Panel>

      <Panel title="Technical evidence (§7)">
        <p className="text-[12px] leading-relaxed text-gray-700">
          The health signals and the failed journey stage behind this incident are read{" "}
          <Link href="/super-admin/pd/health/workflows" className="font-semibold text-teal-700 hover:underline">
            in Workflow Health
          </Link>
          , which is where detection lives. §0 keeps detection and response apart on purpose, and a
          second surface recomputing the same verdict is how the two come to disagree.
          {i.changeRef && (
            <> The incident names <span className="font-mono text-[11px]">{i.changeRef}</span> as the change it is suspected to follow.</>
          )}
        </p>
      </Panel>
    </div>
  );
}

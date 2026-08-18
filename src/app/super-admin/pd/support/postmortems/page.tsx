import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPostmortems, tally, POSTMORTEM_STATUS_LABEL, POSTMORTEM_ORDER } from "@/lib/hq/mos-support";
import { absenceSentence } from "@/lib/hq/pd-metric-registry";
import {
  SupportHeader, Panel, StatusChip, Distribution, Field,
  NoIntakeBanner, EmptyOrUnreadable, Truncated, Explain, Cite, AbsentValue,
} from "../_components/support-ui";

// CPR-PD-009 §13 — ROOT CAUSE & POSTMORTEMS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ THREE CLAIMS, THREE COLUMNS, THREE ROWS ON SCREEN. §13: "Distinguish confirmed root cause from
// contributing factor and unresolved hypothesis." They are stored separately because collapsing them is
// how a hypothesis becomes a finding by retelling, and they are RENDERED separately for the same
// reason — a postmortem is read months later by someone who was not there, and the typography is all
// they have to tell a certainty from a guess.
//
// ⚠ AND THIS PAGE COUNTS POSTMORTEMS WRITTEN, NEVER POSTMORTEMS OWED. §5 says closure must not silently
// bypass a required postmortem, and "required" is undefined — no rule anywhere says which incidents
// qualify. Counting SEV-1 and SEV-2 without one would invent that rule on a screen and then enforce it.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.support.view");
  const admin = await createAdminClient();
  const read = await loadPostmortems(admin);
  const rows = read?.rows ?? [];

  return (
    <div className="flex flex-col gap-4">
      <SupportHeader
        title="Root Cause & Postmortems"
        spec="CPR-PD-009 §13"
        purpose="What was learned from incidents that have been resolved, and how confident each conclusion is."
        readAt={new Date().toISOString()}
      />

      <NoIntakeBanner what="Postmortems" metric="sup.postmortems" />

      <EmptyOrUnreadable rows={read === null ? null : rows} what="postmortem" />

      {read !== null && (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Postmortems written</p>
              <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">{rows.length}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">With a confirmed root cause</p>
              <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">
                {rows.filter(p => p.hasConfirmedCause).length}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                The rest name contributing factors or open hypotheses, which are weaker claims.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Postmortems outstanding</p>
              <AbsentValue why={absenceSentence("sup.postmortems_outstanding")} />
            </div>
          </div>

          <Panel title="By state (§13)" note="Approval and publication are auditable — an approved postmortem must name who and when.">
            <Distribution items={tally(rows, p => p.status, POSTMORTEM_ORDER, POSTMORTEM_STATUS_LABEL)} total={rows.length} />
          </Panel>

          {rows.length > 0 && (
            <Panel title="The postmortems" note="Newest first. Root cause, contributing factors and open hypotheses are never merged.">
              <ul className="flex flex-col divide-y divide-gray-100">
                {rows.map(p => (
                  <li key={p.postmortemId} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link href={`/super-admin/pd/support/incident-360?id=${p.incidentId}`}
                        className="min-w-0 text-[12.5px] font-semibold text-gray-900 hover:text-teal-700">
                        {p.executiveSummary ?? "Postmortem with no executive summary"}
                      </Link>
                      <StatusChip label={POSTMORTEM_STATUS_LABEL[p.status] ?? p.status} />
                    </div>

                    <div className="mt-2 flex flex-col gap-1.5">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Confirmed root cause</p>
                        <p className={`text-[12px] leading-relaxed ${
                          p.rootCause ? "font-semibold text-gray-900" : "text-gray-400"}`}>
                          {p.rootCause ?? "none confirmed"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Contributing factors</p>
                        <p className="text-[12px] leading-relaxed text-gray-700">
                          {p.contributingFactors ?? "none recorded"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Open hypotheses</p>
                        <p className="text-[12px] italic leading-relaxed text-gray-600">
                          {p.openHypotheses ?? "none left open"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <Field label="Approved by" value={p.approvedBy} />
                      <Field label="Approved at" value={
                        p.approvedAt ? `${new Date(p.approvedAt).toISOString().slice(0, 16).replace("T", " ")} GMT` : null
                      } />
                      <Field label="Written" value={new Date(p.createdAt).toISOString().slice(0, 10)} />
                    </div>

                    {p.learning && (
                      <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-600">
                        <span className="font-semibold text-gray-700">Learning:</span> {p.learning}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <Truncated truncated={read.truncated} what="postmortems" />
            </Panel>
          )}

          <Panel title="Why &ldquo;postmortems outstanding&rdquo; is blank rather than calculated">
            <p className="text-[12px] leading-relaxed text-gray-700">
              The record exists and the rule does not. A postmortem can be written and approved — but
              nothing anywhere states which incidents <em>require</em> one.
              §5 says closure must not silently bypass a required postmortem, and &ldquo;required&rdquo;
              is the undefined word in that sentence.
            </p>
            <Explain summary="Why SEV-1 and SEV-2 is not a safe default">
              It would be an easy count and it would be an invented policy. Once the screen shows
              &ldquo;3 outstanding&rdquo;, that threshold is the rule — nobody decided it, nobody can
              point at where it is written, and the first argument about it will be with a dashboard.
              The threshold is a governance decision, and this module&apos;s job is to enforce one, not
              to author it.
              <Cite>mos_postmortem exists — no qualification rule does</Cite>
            </Explain>
          </Panel>
        </>
      )}
    </div>
  );
}

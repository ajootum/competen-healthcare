import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadReleaseHistory, subSpec, structureScore, refusalFor } from "@/lib/hq/pd-releases";
import {
  ReleaseHeader, Fact, Panel, AbsentList, Warn, Explain, Cite, Verdict, StateModel,
  Structure, Questions, PlaneRefusal, ReadFailures, ReadStamp, NotThisModule,
} from "../_components/release-ui";

// CPR-PD-012L — RELEASE HISTORY.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THREE STREAMS MERGED, AND THE FOURTH — THE ONE THAT ANSWERS §6's CENTRAL QUESTION — IS REFUSED.
//
// 012L §6 asks for historical reconstruction of material availability decisions: who had access to what
// capability at a material point in time. That data EXISTS. Every capability activation and
// deactivation is written to the practice's own event log with the state before, the state after, the
// source, the actor, a correlation id and a reason. It is the richest release-history stream in this
// product and it sits on the Practice plane, which this one may not read.
//
// So this page merges what it can reach — platform releases, estate configuration change-set events,
// and estate flag assignments — and says plainly that the reconstruction question is answerable and
// answered somewhere else. Rendering the timeline without that sentence would let a thin history read
// as a quiet period.
//
// ⚠ AND ONE OF THE THREE STREAMS IS NOT VERSIONED. Estate flag assignments are CREATED and never
// updated, so a row says what was set and can never say what it changed from. A timeline that showed
// them as changes would be inventing the previous value.

export const dynamic = "force-dynamic";

const SPEC = subSpec("history");

const STREAM_LABEL: Record<string, string> = {
  release: "Release",
  "config-release": "Configuration change set",
  "flag-assignment": "Estate flag",
};

const STREAM_STYLE: Record<string, string> = {
  release: "bg-teal-50 text-teal-800 border-teal-200",
  "config-release": "bg-gray-100 text-gray-700 border-gray-200",
  "flag-assignment": "bg-gray-100 text-gray-700 border-gray-200",
};

export default async function Page() {
  await requireHqCapability("hq.practice.releases.view");
  const h = await loadReleaseHistory(createAdminClient());

  const score = structureScore(SPEC);
  const readStreams = h.streams.filter(s => s.read).length;
  const oldest = h.events.length > 0 ? h.events[h.events.length - 1].at : null;

  return (
    <div data-wide className="space-y-4">
      <ReleaseHeader
        title="Release History"
        purpose="What was released, changed or reversed and when — merged from the streams this plane can reach, and the one that answers who had access when, which it cannot."
        spec="CPR-PD-012L · CPR-PD-012 §18"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Events on this timeline"
          value={readStreams === 0 ? "Could not be read" : String(h.events.length)}
          note={readStreams === h.streams.length
            ? "merged from three streams, newest first"
            : `⚠ only ${readStreams} of ${h.streams.length} streams answered — this is a partial timeline, not a quiet period`} />
        <Fact label="Streams answering" value={`${readStreams} of ${h.streams.length}`}
          note="a stream that failed must never read as a period when nothing happened" />
        <Fact label="Oldest event shown"
          value={oldest ? String(oldest).slice(0, 10) : readStreams === 0 ? "Could not be read" : "None"}
          note="each stream is read to its most recent 100 events, so anything older is outside this page rather than absent" />
        <Fact label="Prescribed elements on this page" value={`${score.yes + score.partial} of ${score.total}`}
          note={`${score.yes} in full, ${score.partial} in part — scored against 012L §3 below`} />
      </div>

      <ReadFailures problems={h.problems} />

      <Warn title="The question §18 exists to answer is answerable, and not from here">
        <p>
          <em>&quot;Who had access to what capability at a material point in time?&quot;</em> Every
          capability switched on or off in every practice is recorded with the state before, the state
          after, why it changed, who changed it and when.{" "}
          <span className="font-semibold">
            That trail belongs to the practices and this plane may not read it.
          </span>{" "}
          The timeline below is genuine and it is about releases and estate configuration — not about
          who could do what.
        </p>
        <Cite>
          practice_capability_activation_event (migration 278:165-207): action, state_before,
          state_after, source, mode_code, actor_id, correlation_id, reason, occurred_at. Not on
          PRACTICE_ALLOWLIST in src/lib/access/plane-boundary.ts.
        </Cite>
      </Warn>

      {/* ── THE STREAMS ──────────────────────────────────────────────────────────────────────────── */}
      <Panel title="Where this timeline comes from"
        note="Named individually because they behave differently, and one of them is not versioned. A merged timeline that hid that would let an assignment read as a change.">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[620px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-500">
                <th scope="col" className="py-1.5 pr-3 font-semibold">Stream</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Answered</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Events read</th>
                <th scope="col" className="py-1.5 font-semibold">What it records</th>
              </tr>
            </thead>
            <tbody>
              {h.streams.map(s => (
                <tr key={s.name} className="border-b border-gray-100 align-top">
                  <th scope="row" className="py-1.5 pr-3 text-left font-mono text-[11px] font-normal text-gray-800">{s.name}</th>
                  <td className="py-1.5 pr-3"><Verdict ok={s.read} yes="Yes" no="No" /></td>
                  <td className="py-1.5 pr-3 tabular-nums text-gray-700">{s.read ? s.rows : "—"}</td>
                  <td className="py-1.5 leading-relaxed text-gray-700">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── THE TIMELINE ─────────────────────────────────────────────────────────────────────────── */}
      <Panel title="The timeline"
        note="Newest first. Every event carries the stream it came from, because a release, a configuration change set and an estate flag are three different kinds of fact and only one of them is about Competen Practice.">
        {readStreams === 0 ? (
          <p className="text-[12px] text-[var(--cmp-text-warning)]">
            No stream answered, so there is no timeline. That is a failed read and not an empty history.
          </p>
        ) : h.events.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-gray-500">
            {readStreams} stream{readStreams === 1 ? "" : "s"} answered and returned no events — a
            measured empty history over what this plane can reach. Nobody has recorded a release, run a
            configuration change set or targeted an estate flag.
          </p>
        ) : (
          <ol className="flex flex-col">
            {h.events.slice(0, 60).map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-gray-100 py-1.5 first:pt-0 last:border-0 last:pb-0">
                <span className="whitespace-nowrap font-mono text-[11px] text-gray-500">
                  {String(e.at).slice(0, 16).replace("T", " ")}
                </span>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${STREAM_STYLE[e.stream]}`}>
                  {STREAM_LABEL[e.stream]}
                </span>
                <span className="text-[12px] font-semibold text-gray-900">{e.title}</span>
                <span className="w-full text-[12px] leading-relaxed text-gray-600">{e.detail}</span>
              </li>
            ))}
          </ol>
        )}
        {h.events.length > 60 && (
          <p className="mt-2 text-[12px] text-gray-500">
            Showing the 60 most recent of {h.events.length} events read. Each stream is read to its own
            most recent 100, so this page is a window on the history rather than all of it.
          </p>
        )}
        <Explain summary="Why there are no filters on this timeline">
          012L §3 asks for filters by capability, release, market, plan and environment.{" "}
          <span className="font-semibold">Not one of those five is recorded on any of these events.</span>{" "}
          A release does not name the capabilities it carried; no event names a market, a plan or an
          environment. A filter control that returned everything for every value would suggest the
          dimension exists and is currently uniform, which is a more misleading thing than its absence.
        </Explain>
      </Panel>

      <PlaneRefusal
        tables={["practice_capability_activation_event", "practice_audit_event"]}
        why={
          "The two streams that would answer who had access to what and when. Every capability change "
          + "records its before and after state, its source and its actor; every launch-flag flip is "
          + "written to the practice trail. Both belong to the practices, and the audit trail's payloads "
          + "carry clinical detail, so it is refused to this plane entirely rather than shown with its "
          + "detail hidden."
        }
      />

      <Panel title="The history states 012L prescribes"
        note="Two states, and how each behaves here.">
        <StateModel rows={SPEC.states} holdLabel="Can an event hold this state?" />
      </Panel>

      <Panel title="What 012L §3 asks this screen to show"
        note={`Eight prescribed elements, ${score.yes} in full and ${score.partial} in part.`}>
        <Structure rows={SPEC.structure} />
      </Panel>

      <Questions id={SPEC.id} questions={SPEC.questions} answers={[
        "Releases, estate configuration change sets and estate flag targeting, in time order, above.",
        "Where an actor was recorded, the event carries it. No approval was ever recorded, because no approval record exists.",
        "Not from here. That trail is the practices' own and this plane may not read it — which is the finding at the top of this page rather than a gap in the timeline.",
        "Nothing. There is no incident or health store to correlate against, so no overlay is drawn.",
      ]} />

      <Panel title="Not shown, and why">
        <AbsentList items={[
          "rel.capability_activation_history", "rel.release_content",
          "rel.release_approvals", "rel.rollout_stage", "rel.market_availability",
        ].map(refusalFor)} />
      </Panel>

      <Warn title="Nothing here is deleted, and one stream cannot be compared">
        <p>
          §18: do not silently delete superseded flags or releases. Nothing on this page is deleted or
          rewritten — release rows and change-set events are kept.{" "}
          <span className="font-semibold">
            But estate flag assignments are created and never versioned
          </span>
          , so an assignment records what was set and never what it changed from. That is why no change
          comparison is offered: the previous value is genuinely not recorded, and inferring it from the
          row before would be a guess dressed as an audit.
        </p>
      </Warn>

      <NotThisModule>
        §18 asks for incident and health overlays for learning. Both belong to Support &amp; Incidents
        and Product Health, which are authoritative for them; this page would reference them rather than
        copy them, and neither has a store to reference yet.
      </NotThisModule>

      <ReadStamp at={h.generatedAt} />
    </div>
  );
}

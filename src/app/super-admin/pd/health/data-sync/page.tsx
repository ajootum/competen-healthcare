import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdHealth, PLANE_REFUSED } from "@/lib/hq/pd-health";
import {
  HealthHeader, Panel, Stat, Duration, PlaneRefusal, ReadFailures, Explain, SampleNote,
} from "../_components/health-ui";

// CPR-PD-008E — DATA & SYNC HEALTH.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ THIS PAGE'S SUBJECT IS A REFUSED READ, NOT A MISSING ONE, AND THAT IS UNUSUAL ENOUGH TO LEAD WITH.
// The offline outbox is one of the few genuinely instrumented paths in Competen Practice: every device
// sync writes a transaction row with a version and a timestamp. The table is not on the practice plane's
// allowlist, so this plane may not count it. "No sync data" would be the comfortable sentence and would
// leave the reader with the exact opposite of the truth.

export const dynamic = "force-dynamic";

const SYNC = PLANE_REFUSED.find(r => r.spec === "PD-008E")!;

export default async function Page() {
  await requireHqCapability("hq.practice.health.view");
  const admin = await createAdminClient();
  const h = await loadPdHealth(admin);

  return (
    <div className="flex flex-col gap-4">
      <HealthHeader
        title="Data & Sync Health"
        spec="CPR-PD-008E"
        purpose="Persistence, synchronisation, queues, delayed writes and data-pipeline health."
        readAt={h.readAt}
        windowDays={h.windowDays}
      />

      <PlaneRefusal what={SYNC.what} tables={SYNC.tables} why={SYNC.why} />

      <ReadFailures problems={h.problems} />

      <Panel
        title="The pipeline half this plane can see"
        note="Data movement that runs as a background job is visible here; the device-to-server sync is not."
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Job runs" f={h.jobs.runs} />
          <Stat label="Job failures" f={h.jobs.failures} />
          <Stat label="Still running" f={h.jobs.running} />
          <Stat label="Jobs tracked" f={h.jobs.tracked} />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Duration label="Job duration (P95)" f={h.jobs.durationP95} />
        </div>
        <div className="mt-3"><SampleNote sample={h.jobs.sample} what="Duration" /></div>
        <p className="mt-3 text-[12px] leading-relaxed text-gray-700">
          ⚠ These are all the background jobs, not only the data ones. The job log records a job key and
          nothing that says which jobs move data, so filtering to a &ldquo;pipeline&rdquo; subset would
          mean this screen guessing at a classification the schema does not hold.
        </p>
      </Panel>

      <Panel title="What a sync health view would show once the read is permitted">
        <ul className="flex flex-col gap-1.5 text-[12px] leading-relaxed text-gray-700">
          <li>• Outstanding transactions and the age of the oldest, which is the figure that says whether a device is silently behind.</li>
          <li>• Failed applications and the reason each was rejected.</li>
          <li>• Version conflicts, which are the interesting failure in an outbox rather than the common one.</li>
        </ul>
        <Explain summary="Why the age matters more than the count">
          A queue of a hundred transactions that clears in a minute is healthy; one transaction stuck for
          three days is a practitioner whose work is not where they think it is. A count alone ranks those
          the wrong way round, which is why the age of the oldest is the figure this page would lead with.
        </Explain>
      </Panel>
    </div>
  );
}

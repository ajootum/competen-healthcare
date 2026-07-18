import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { StatTiles, Card, PctChip } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";
import RunDecisions from "./RunDecisions";

// Passport Approvals — the final sign-off before the Competency Passport
// updates: per-cycle validation coverage, then the formal decision run
// (audited, learner-notified). Certificates/digital signatures aren't built
// and are stated as such — the audited decision record IS the sign-off.

export const dynamic = "force-dynamic";

export default async function PassportApprovalsPage() {
  const { admin, hospitalId } = await requireEducatorAccess();

  const { data: cyclesRaw } = hospitalId
    ? await admin.from("competency_cycles")
        .select("id, cycle_type, status, start_date, profiles!nurse_id(full_name, hospital_id)")
        .eq("hospital_id", hospitalId).in("status", ["active", "complete"])
        .order("start_date", { ascending: false }).limit(40)
    : { data: [] };
  const cycles = (cyclesRaw ?? []) as unknown as {
    id: string; cycle_type: string; status: string; start_date: string;
    profiles: { full_name: string } | null;
  }[];
  const cycleIds = cycles.map(c => c.id);

  const [{ data: scores }, { data: decisions }] = await Promise.all([
    cycleIds.length
      ? admin.from("competency_scores").select("cycle_id, educator_validated").in("cycle_id", cycleIds)
      : Promise.resolve({ data: [] }),
    cycleIds.length
      ? admin.from("competency_decisions").select("cycle_id, validation_outcome").in("cycle_id", cycleIds)
      : Promise.resolve({ data: [] }),
  ]);

  const rows = cycles.map(c => {
    const s = (scores ?? []).filter(x => x.cycle_id === c.id);
    const d = (decisions ?? []).filter(x => x.cycle_id === c.id);
    return {
      id: c.id,
      nurse: c.profiles?.full_name ?? "—",
      type: c.cycle_type, status: c.status, started: c.start_date,
      scored: s.length,
      validated: s.filter(x => x.educator_validated).length,
      decisions: d.length,
    };
  }).filter(r => r.scored > 0);

  const ready = rows.filter(r => r.validated === r.scored && r.scored > 0);
  const awaiting = rows.filter(r => r.validated < r.scored);
  const issued = rows.filter(r => r.decisions > 0);

  return (
    <div className="max-w-4xl">
      <EduHeader icon="🛂" title="Passport Approvals" sub="Final competency sign-off — validate scores, then run the decision process that updates the Competency Passport." />
      <StatTiles tiles={[
        { label: "Cycles With Scores", value: String(rows.length) },
        { label: "Fully Validated", value: String(ready.length), sub: "ready for decision run" },
        { label: "Awaiting Validation", value: String(awaiting.length), alert: awaiting.length > 0 },
        { label: "Decisions Issued", value: String(issued.length), sub: "passports updated" },
      ]} />

      <Card title="Cycle Sign-Off Queue" sub="a decision run replaces the cycle's prior decisions with the latest validated state">
        {rows.length ? (
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.id} className="border border-gray-100 rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-gray-800">{r.nurse}</span>
                  <span className="text-[10px] text-gray-400 capitalize">{r.type} cycle · started {r.started}</span>
                  <span className="flex-1" />
                  <span className="text-[10px] text-gray-500">{r.validated}/{r.scored} validated</span>
                  <PctChip v={r.scored ? Math.round(r.validated / r.scored * 100) : null} />
                  {r.decisions > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-indigo-100 text-indigo-700">{r.decisions} issued</span>}
                  <RunDecisions cycleId={r.id} disabled={r.validated === 0} />
                </div>
                {r.validated < r.scored && (
                  <p className="text-[10px] text-amber-600 mt-1">
                    {r.scored - r.validated} score{r.scored - r.validated === 1 ? "" : "s"} unvalidated — finish in{" "}
                    <Link href="/educator/validations" className="underline">Pending Validation</Link> first for full coverage.
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">No cycles with scored competencies yet.</p>}
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        On approval: decisions are issued with expiry dates, the learner&apos;s pathway refreshes, the learner is notified, and passports on both
        workspaces read the same decision records — no separate sync. Honest scope: certificate PDFs and drawn digital signatures aren&apos;t built;
        the audited decision record (who, when, what) is the governance sign-off.
      </p>
    </div>
  );
}

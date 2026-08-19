import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { loadPracticeOps, evaluateGate, FLAG_CONSEQUENCE, FLAG_ORDER } from "@/lib/practice/operations";
import PracticeOpsConsole from "./PracticeOpsConsole";
import { requireHqCapability } from "@/lib/hq/context";
import { loadServiceHealth } from "@/lib/hq/pd-service-health";

// Practice Operations (CPR-IAM-001 s14 cutover, s14.1 launch ladder; CPR-PROV-001 s4 pilot pathway).
//
// WHY THIS PAGE EXISTS: the provisioning API shipped with migration 191 and had no caller. Everything
// needed to open a pilot workspace was deployed, and the only way to use it was to hand-craft a request
// with an Idempotency-Key header. IAM-001 s14 asks for "at least one TESTED individual Practice
// provisioning pathway" and s14.1 defines four launch states; neither is satisfied by a SQL editor.
//
// The gate ledger below is the honest half. Auto items are evaluated against the live database and can
// go red. Manual items -- a person signing in, a pilot walkthrough -- are never auto-greened, because
// the whole purpose of automating the rest is to shrink the human set, not to disguise it.
//
// No clinical content reaches this page: see the note in src/lib/practice/operations.ts.

export const dynamic = "force-dynamic";

export default async function PracticeOperations() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  /**
   * ⚠ full_name ONLY. This selected `role, roles` as well and used NEITHER — the authorization on this
   * page is requireHqCapability below, exactly as it should be. CPR-PD-014 §9: "Do not read
   * profiles.role as a substitute for the capability model", and COMP-ARCH-PSA-001 makes profiles.role
   * nullable precisely so it stops being the thing anybody reaches for.
   *
   * An unused select is not harmless here. It is how the next reader concludes the column still governs
   * something, and how a future edit starts branching on a value the product has retired.
   */
  const { data: profile } = await admin.from("profiles").select("full_name").eq("id", user.id).single();
  await requireHqCapability("hq.practice.operations.view");

  const ops = await loadPracticeOps(admin);
  const gate = await evaluateGate(admin, ops);
  const serviceHealth = await loadServiceHealth(admin);

  const passed = gate.filter(g => g.state === "pass").length;
  const failed = gate.filter(g => g.state === "fail").length;

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link>
          <span>/</span><span className="text-gray-600">Competen Practice</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Practice Operations</h1>
        <p className="text-sm text-gray-500">
          Pilot provisioning, the launch ladder and the IAM-001 §14 cutover gate for Competen Practice.
        </p>
        {/* PIS-000: the shape of the practitioner number lives on its own page, because it is a
            settlement rather than a setting -- see the note at the top of that file. */}
        <Link href="/super-admin/platform-ops/practice/identifiers"
          className="mt-2 inline-block text-xs font-semibold text-teal-700 hover:underline">
          Practitioner number format →
        </Link>
      </div>

      {/* ── CPR-PD-014 §7.2 A — environment & service health ────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Environment &amp; service health</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          Operational status for services that can actually be measured. UNKNOWN is used wherever only
          configuration is visible, because a key being present says a deployment intends to send
          something, not that the next attempt would succeed.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {serviceHealth.map(s => (
            <li key={s.name} className="rounded-lg border border-gray-100 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  s.status === "OPERATIONAL" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
                    : s.status === "DEGRADED" ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"
                      : s.status === "DOWN" ? "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"
                        : "bg-gray-100 text-gray-500"}`}>
                  {s.status}
                </span>
                <span className="text-[12px] font-medium text-gray-800">{s.name}</span>
              </div>
              {/* §7.2: every status shows last verified time and check source. */}
              <p className="mt-1 text-[11px] leading-snug text-gray-500">{s.source}</p>
              <p className="mt-0.5 font-mono text-[10px] text-gray-400">
                checked {s.checkedAt.slice(11, 16)} UTC
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* STANDING STATEMENT OF WHAT IS PUBLICLY LIVE. Not a toast: whoever opens this page sees it,
          including someone who did not flip the flag and does not know it moved. */}
      {FLAG_ORDER.filter(f => ops.flags[f] && f !== "practice_pilot_provisioning").length > 0 && (
        <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
          <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">Live on the public site right now</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {FLAG_ORDER.filter(f => ops.flags[f] && f !== "practice_pilot_provisioning").map(f => (
              <li key={f} className="text-[12px] text-gray-800">
                <span className="font-mono font-semibold">{f}</span> — {FLAG_CONSEQUENCE[f]}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-gray-600">
            Turning the toggle below off reverses this immediately. No account is lost.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400">Current launch state (IAM-001 §14.1)</p>
            <p className="text-xl font-bold text-gray-900">{ops.launch.state}</p>
            <p className="text-[12px] text-gray-500">{ops.launch.detail}</p>
          </div>
          <div className="flex gap-3 text-right">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Gate</p>
              <p className="text-xl font-bold tabular-nums text-gray-900">{passed}/{gate.length}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Failing</p>
              <p className={`text-xl font-bold tabular-nums ${failed ? "text-[var(--cmp-text-critical)]" : "text-gray-300"}`}>{failed}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Workspaces</p>
              <p className="text-xl font-bold tabular-nums text-gray-900">{ops.workspaces.length}</p>
            </div>
          </div>
        </div>
      </div>

      <PracticeOpsConsole
        callerId={user.id}
        callerName={profile?.full_name ?? "me"}
        initial={JSON.parse(JSON.stringify({ ...ops, gate }))}
      />
    </div>
  );
}

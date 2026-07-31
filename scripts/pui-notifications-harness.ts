// Harness for the Notification, Messaging & Alert Framework (PUI-006, migration 161).
//
// The framework's whole value is that ONE decision (priority) drives every downstream behaviour. These
// checks pin the rules that would otherwise be re-litigated at each call site:
//
//   - a safety alert cannot be filed as low priority by a careless caller
//   - a CRITICAL alert is never silenced: not by quiet hours, not by a muted category, not by a
//     min-priority filter, not by a disabled channel
//   - reading is not acknowledging
//   - terminal states are terminal, so a resolved alert cannot resurface as new
//   - the 242 legacy notify() call sites keep working and get a sane category
//
// Live-row half runs against the real table and deletes everything it writes.
//   npx --yes tsx scripts/pui-notifications-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
loadEnvConfig(process.cwd());

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};
const at = (h: number, m = 0) => { const d = new Date(2026, 0, 1, h, m); return d; };

async function main() {
  const f = await import("../src/lib/notifications/framework");
  const { DEFAULT_PREFS, BEHAVIOUR, CATEGORY_KEYS, PRIORITY_ORDER } = f;

  // ── 1. The spec's tables are complete ──
  check(CATEGORY_KEYS.length === 6, "six notification types (PUI-006 s1)", CATEGORY_KEYS.join(", "));
  check(PRIORITY_ORDER.join() === "critical,high,medium,low", "four priority levels, most severe first");
  check(f.STATES.join() === "unread,read,acknowledged,escalated,resolved", "five alert states (PUI-006 s7)");

  // ── 2. Behaviour is derived from priority, and matches the design tokens ──
  const { priority: tokens } = await import("../src/lib/design/tokens");
  for (const p of PRIORITY_ORDER) {
    check(BEHAVIOUR[p].requiresAck === tokens[p].requiresAck,
      `${p}: ack requirement matches the token table (badge and behaviour share one source)`);
  }
  check(BEHAVIOUR.critical.persistent && BEHAVIOUR.high.persistent, "critical and high are persistent");
  check(!BEHAVIOUR.medium.persistent && !BEHAVIOUR.low.persistent, "medium and low are not");
  check(BEHAVIOUR.critical.escalateAfterMin === 5 && BEHAVIOUR.high.escalateAfterMin === 30,
    "critical escalates in 5 min, high in 30");
  check(BEHAVIOUR.medium.escalateAfterMin === null && BEHAVIOUR.low.escalateAfterMin === null,
    "medium and low never escalate");
  check(BEHAVIOUR.critical.channels.length >= BEHAVIOUR.low.channels.length,
    "more severe reaches more channels", `critical ${BEHAVIOUR.critical.channels.length} vs low ${BEHAVIOUR.low.channels.length}`);

  // ── 3. A careless caller cannot under-file a clinical risk ──
  check(f.clampPriority("safety_alert", "low") === "high", "a safety alert filed as LOW is clamped up to high");
  check(f.clampPriority("clinical_alert", "medium") === "high", "a clinical alert cannot be filed below high");
  check(f.clampPriority("escalation", "low") === "high", "an escalation cannot be filed below high");
  check(f.clampPriority("safety_alert", "critical") === "critical", "but it CAN be raised above the floor");
  check(f.clampPriority("information", "low") === "low", "an informational notice may legitimately be low");
  check(f.clampPriority("reminder", null) === "medium", "an undeclared priority defaults to medium, not low");

  // ── 4. Legacy type -> category, for the 242 existing call sites ──
  for (const [type, want] of [
    ["patient_escalation", "escalation"], ["safety_alert_raised", "safety_alert"],
    ["pews_high", "clinical_alert"], ["medication_due", "clinical_alert"],
    ["announcement", "announcement"], ["credential_expiring", "reminder"],
    ["logbook_verified", "information"], ["some_new_thing", "information"],
  ] as const) {
    check(f.categoryOfType(type) === want, `type "${type}" categorises as ${want}`, f.categoryOfType(type));
  }
  check(f.categoryOfType("") === "information", "an unknown type is conservatively informational, never a safety alert");

  // ── 5. CRITICAL IS NEVER SILENCED ──
  const quiet = { ...DEFAULT_PREFS, quiet_from: "22:00", quiet_to: "07:00" };
  const night = at(23, 30), day = at(10, 0);
  check(f.inQuietHours(quiet, night), "quiet hours match inside a window that wraps midnight");
  check(f.inQuietHours({ ...quiet }, at(2, 0)), "and after midnight, still inside the same window");
  check(!f.inQuietHours(quiet, day), "and not during the day");
  check(!f.inQuietHours(DEFAULT_PREFS, night), "no quiet window configured means never quiet");

  const critNight = f.resolveChannels("clinical_alert", "critical", quiet, night);
  check(critNight.channels.length === BEHAVIOUR.critical.channels.length,
    "a CRITICAL alert reaches every channel during quiet hours", critNight.channels.join(", "));
  const critMuted = f.resolveChannels("safety_alert", "critical", { ...quiet, muted_categories: ["safety_alert"] }, night);
  check(critMuted.channels.length > 0, "a CRITICAL alert is not silenced by a muted category");
  const critMin = f.resolveChannels("clinical_alert", "critical", { ...DEFAULT_PREFS, min_priority: "critical" }, day);
  check(critMin.channels.length > 0, "a CRITICAL alert survives a min-priority filter");
  const critOff = f.resolveChannels("clinical_alert", "critical", { ...DEFAULT_PREFS, sms: false, email: false, push: false }, day);
  check(critOff.channels.length === BEHAVIOUR.critical.channels.length && /overrides channel preferences/.test(critOff.reason ?? ""),
    "a CRITICAL alert overrides disabled channels AND says so", critOff.reason ?? "");
  const highNight = f.resolveChannels("clinical_alert", "high", quiet, night);
  check(highNight.channels.length > 1, "HIGH is also not silenced by quiet hours");

  // ── 6. ...but a low-priority notice respects the user ──
  const lowNight = f.resolveChannels("information", "low", quiet, night);
  check(lowNight.channels.join() === "in_app" && lowNight.reason === "quiet hours",
    "a LOW notice during quiet hours lands in-app only, and says why", lowNight.reason ?? "");
  const lowMuted = f.resolveChannels("information", "low", { ...DEFAULT_PREFS, muted_categories: ["information"] }, day);
  check(lowMuted.channels.length === 0 && /muted/.test(lowMuted.reason ?? ""), "a muted category suppresses a low notice");
  const belowMin = f.resolveChannels("information", "low", { ...DEFAULT_PREFS, min_priority: "high" }, day);
  check(belowMin.channels.length === 0 && /minimum priority/.test(belowMin.reason ?? ""),
    "a notice below the user's minimum priority is suppressed");
  check(lowMuted.channels.length === 0 && lowNight.channels.length > 0,
    "muting REMOVES delivery; quiet hours only defer it to in-app");

  // ── 7. State machine ──
  check(f.canTransition("unread", "read") && f.canTransition("read", "acknowledged"), "the normal path is allowed");
  check(f.canTransition("escalated", "acknowledged"), "an escalated alert can still be acknowledged");
  check(!f.canTransition("resolved", "unread") && !f.canTransition("resolved", "read"),
    "a RESOLVED alert cannot reopen — it can never resurface as new");
  check(!f.canTransition("acknowledged", "unread"), "an acknowledged alert cannot become unread again");

  // READING IS NOT ACKNOWLEDGING — the check this framework exists for.
  check(f.isOutstanding({ requires_ack: true, state: "read" }),
    "a critical alert that has been READ is still outstanding");
  check(!f.isOutstanding({ requires_ack: true, state: "acknowledged" }), "acknowledging clears it");
  check(!f.isOutstanding({ requires_ack: false, state: "read" }), "a normal notice is done once read");
  check(f.isOutstanding({ requires_ack: true, state: "escalated" }), "an escalated alert is still outstanding");

  // ── 8. Escalation timing ──
  const now = Date.now();
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  check(f.escalationDue({ requires_ack: true, state: "unread", created_at: ago(6), escalate_after_min: 5 }, now),
    "an unacknowledged critical alert is due to escalate after its window");
  check(!f.escalationDue({ requires_ack: true, state: "unread", created_at: ago(3), escalate_after_min: 5 }, now),
    "and not before it");
  check(!f.escalationDue({ requires_ack: true, state: "acknowledged", created_at: ago(60), escalate_after_min: 5 }, now),
    "an acknowledged alert never escalates");
  check(!f.escalationDue({ requires_ack: true, state: "escalated", created_at: ago(60), escalate_after_min: 5 }, now),
    "an already-escalated alert does not escalate twice");
  check(!f.escalationDue({ requires_ack: false, state: "unread", created_at: ago(999), escalate_after_min: null }, now),
    "a notice that needs no acknowledgement never escalates");

  // ── 9. buildNotification ties it together ──
  const built = f.buildNotification("00000000-0000-0000-0000-000000000001", { type: "pews_high", title: "PEWS 7" });
  check(built.category === "clinical_alert", "an inferred category reaches the row", built.category);
  check(built.priority === "high", "and the category floor sets the priority", built.priority);
  check(built.requires_ack === true && built.escalate_after_min === 30,
    "ack requirement and escalation window come from the priority, not the caller");
  check(built.state === "unread" && built.read === false, "a new row starts unread, with `read` consistent");
  const legacy = f.buildNotification("00000000-0000-0000-0000-000000000001", { type: "logbook_verified", title: "Verified" });
  check(legacy.priority === "medium" && legacy.requires_ack === false,
    "a legacy informational type lands medium and needs no acknowledgement");

  // ── 10. Live table: the migration is applied and the columns behave ──
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log("SKIP  live checks — no Supabase env"); }
  else {
    const admin = createClient(url, key, { auth: { persistSession: false } });
    const probe = await admin.from("notifications").select("priority, category, state, requires_ack").limit(1);
    if (probe.error) {
      check(false, "migration 161 is applied", probe.error.message);
    } else {
      check(true, "migration 161 is applied — priority/category/state/requires_ack exist");
      const { data: who } = await admin.from("profiles").select("id").limit(1).maybeSingle();
      if (!who) console.log("SKIP  live write — no profiles");
      else {
        const row = f.buildNotification(who.id, { type: "safety_alert_raised", title: "PUI-006 harness", priority: "low" });
        const { data: ins, error: insErr } = await admin.from("notifications").insert(row).select("id, priority, category, requires_ack, state").single();
        check(!insErr, "a framework-built row inserts against the real table", insErr?.message ?? "");
        if (ins) {
          check(ins.priority === "high", "the clamp survives the round-trip — a safety alert cannot be stored as low", ins.priority);
          check(ins.requires_ack === true, "requires_ack persisted");
          check(ins.state === "unread", "state persisted");
          const bad = await admin.from("notifications").update({ priority: "nonsense" }).eq("id", ins.id);
          check(!!bad.error, "the database rejects an invalid priority", bad.error ? "constraint held" : "NO CONSTRAINT");
          const badState = await admin.from("notifications").update({ state: "made_up" }).eq("id", ins.id);
          check(!!badState.error, "the database rejects an invalid state");
          await admin.from("notifications").delete().eq("id", ins.id);
          const { data: gone } = await admin.from("notifications").select("id").eq("id", ins.id);
          check((gone ?? []).length === 0, "harness row cleaned up");
        }
      }
      const prefs = await admin.from("notification_preferences").select("user_id, min_priority, muted_categories").limit(1);
      check(!prefs.error, "notification_preferences exists", prefs.error?.message ?? "");
    }
  }

  console.log(`\n${pass}/${pass + fail} checks passed.`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

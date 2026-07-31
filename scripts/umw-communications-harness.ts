/**
 * UMW-TLS-004 harness — Notifications, Communications & Collaboration.
 *
 * Writes real rows, asserts against the real loader, deletes them. No mocks: the whole point of this module
 * is that priority and acknowledgement come from the notification framework rather than from a second opinion
 * formed in a unit dashboard, and only a live round-trip proves that.
 *
 * The assertions that matter most:
 *   - a read alert that still REQUIRES acknowledgement stays outstanding (reading is not acknowledging)
 *   - "unanswered critical" is a query over requires_ack, not a guess from the type string
 *   - the manager's own messages are never counted as unread to them
 *   - a broadcast with no target_count reports NO rate rather than 0%
 *   - a channel with no delivery attempts does not appear at 100% success
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { loadUnitCommunications } from "../src/lib/operations/unit-communications";
loadEnvConfig(process.cwd());

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};
const eq = (name: string, got: any, want: any) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const MIN = 60000;

async function main() {
  console.log("\nUMW-TLS-004 Notifications, Communications & Collaboration\n");

  // ── Fixtures: a real hospital that actually has staff, and two real people in it.
  // Not "the first hospital" — most tenants here have a single profile, and a colleague is required to
  // test the isolation rules that matter (a manager must not see another person's inbox).
  const { data: staff } = await admin.from("profiles").select("id, full_name, hospital_id").not("hospital_id", "is", null).limit(3000);
  const byHospital = new Map<string, { id: string; full_name: string }[]>();
  for (const p of staff ?? []) {
    const k = String(p.hospital_id);
    if (!byHospital.has(k)) byHospital.set(k, []);
    byHospital.get(k)!.push(p);
  }
  const populated = [...byHospital.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!populated || populated[1].length < 2) { console.log("  need two profiles in one hospital — cannot run"); process.exit(1); }
  const { data: hosp } = await admin.from("hospitals").select("id, name").eq("id", populated[0]).single();
  if (!hosp) { console.log("  no hospital row for the populated tenant — cannot run"); process.exit(1); }
  const people = populated[1];
  const me = people[0].id, other = people[1].id;
  console.log(`  hospital ${hosp.name} · manager ${people[0].full_name} · colleague ${people[1].full_name}\n`);

  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const made: { table: string; ids: string[] }[] = [];
  const track = (table: string, rows: any[]) => made.push({ table, ids: rows.map(r => r.id) });

  const cleanup = async () => {
    for (const m of [...made].reverse()) if (m.ids.length) await admin.from(m.table).delete().in("id", m.ids);
  };

  // A two-hour window, and every count asserted as a DELTA against a baseline taken before anything is
  // written. This database has real seeded rows in it; a harness that asserted absolute totals would be
  // measuring the seed as much as the feature, and would start failing the day someone seeds more.
  const W = { now, windowDays: 2 / 24 };

  try {
    const base: any = await loadUnitCommunications(admin, hosp.id, false, me, W);
    const baseCh = (c: string) => base.delivery.byChannel.find((x: any) => x.channel === c) ?? { attempts: 0, sent: 0, failed: 0 };

    // ── Notifications: the four cases that separate "read" from "acknowledged" ──
    // `category` must be one of migration 161's six — the same six the framework exports. The DB check
    // constraint enforces it, which is how this harness's first draft was caught inventing categories.
    const notifRows = [
      // 1. critical, requires ack, PAST its escalation window → unanswered AND overdue
      { user_id: me, type: "safety_alert", title: "HX-OVERDUE deteriorating patient", body: "Bed 4", category: "safety_alert",
        priority: "critical", state: "unread", read: false, requires_ack: true, escalate_after_min: 15, created_at: iso(45 * MIN) },
      // 2. high, requires ack, READ but not acknowledged → still outstanding. Reading is not acknowledging.
      { user_id: me, type: "escalation", title: "HX-READ escalation raised", body: "Level 2", category: "escalation",
        priority: "high", state: "read", read: true, requires_ack: true, escalate_after_min: 120, created_at: iso(5 * MIN) },
      // 3. critical, requires ack, ALREADY ACKNOWLEDGED → must NOT appear as unanswered
      { user_id: me, type: "safety_alert", title: "HX-ACKED alert", body: "handled", category: "safety_alert",
        priority: "critical", state: "acknowledged", read: true, requires_ack: true, escalate_after_min: 15,
        acknowledged_at: iso(30 * MIN), created_at: iso(55 * MIN) },
      // 4. low, unread, no ack required → counts as unread, never as unanswered
      { user_id: me, type: "roster", title: "HX-LOW roster published", category: "reminder",
        priority: "low", state: "unread", read: false, requires_ack: false, created_at: iso(10 * MIN) },
      // 5. SOMEONE ELSE'S critical alert → must never reach this manager
      { user_id: other, type: "safety_alert", title: "HX-OTHER private alert", category: "safety_alert",
        priority: "critical", state: "unread", read: false, requires_ack: true, escalate_after_min: 15, created_at: iso(20 * MIN) },
    ];
    const { data: notifs, error: nErr } = await admin.from("notifications").insert(notifRows).select("id, title");
    if (nErr) throw new Error(`notifications insert: ${nErr.message}`);
    track("notifications", notifs!);

    // ── Messages: mine, theirs-read, theirs-unread ──
    const msgRows = [
      { hospital_id: hosp.id, channel: "HX-unit", context_type: "general", body: "HX mine", author_id: me, author_name: "Me", created_at: iso(9 * MIN) },
      { hospital_id: hosp.id, channel: "HX-unit", context_type: "general", body: "HX theirs read", author_id: other, author_name: "Them", created_at: iso(8 * MIN) },
      { hospital_id: hosp.id, channel: "HX-unit", context_type: "general", body: "HX theirs unread", author_id: other, author_name: "Them", created_at: iso(7 * MIN) },
      { hospital_id: hosp.id, channel: "HX-quiet", context_type: "team", body: "HX quiet unread", author_id: other, author_name: "Them", created_at: iso(6 * MIN) },
    ];
    const { data: msgs, error: mErr } = await admin.from("op_messages").insert(msgRows).select("id, body");
    if (mErr) throw new Error(`op_messages insert: ${mErr.message}`);
    track("op_messages", msgs!);
    const readMsg = msgs!.find(m => m.body === "HX theirs read")!;
    const { data: reads, error: rErr } = await admin.from("op_message_reads")
      .insert([{ message_id: readMsg.id, user_id: me }]).select("id");
    if (rErr) throw new Error(`op_message_reads insert (migration 163 applied?): ${rErr.message}`);
    track("op_message_reads", reads!);

    // ── Broadcasts: one with a denominator, one without ──
    // TWO SEPARATE INSERTS ON PURPOSE. PostgREST unifies the column list across a batch, so omitting
    // target_count on the second row of one batch sends an explicit NULL rather than letting the column
    // default to 0 — the untargeted case cannot be created at all in a single insert.
    const { data: castA, error: bErr } = await admin.from("op_broadcasts").insert([
      { hospital_id: hosp.id, title: "HX-TARGETED policy update", body: "read it", priority: "high",
        audience: "all nurses", target_count: 4, emergency: false, created_at: iso(50 * MIN) },
    ]).select("id, title");
    if (bErr) throw new Error(`op_broadcasts insert: ${bErr.message}`);
    const { data: castB, error: bErr2 } = await admin.from("op_broadcasts").insert([
      { hospital_id: hosp.id, title: "HX-UNTARGETED note", body: "fyi", priority: "low",
        emergency: false, created_at: iso(48 * MIN) },
    ]).select("id, title");
    if (bErr2) throw new Error(`op_broadcasts insert (untargeted): ${bErr2.message}`);
    const casts = [...castA!, ...castB!];
    track("op_broadcasts", casts);
    const targeted = casts.find(c => c.title.startsWith("HX-TARGETED"))!;
    const untargeted = casts.find(c => c.title.startsWith("HX-UNTARGETED"))!;
    const { data: acks, error: aErr } = await admin.from("op_broadcast_acks").insert([
      { broadcast_id: targeted.id, user_id: me, user_name: "Me" },
      { broadcast_id: untargeted.id, user_id: me, user_name: "Me" },
    ]).select("id");
    if (aErr) throw new Error(`op_broadcast_acks insert: ${aErr.message}`);
    track("op_broadcast_acks", acks!);

    // ── Deliveries: email healthy, sms failing. NO push rows at all. ──
    const delivFor = notifs![0].id;
    const delivRows = [
      ...Array.from({ length: 4 }, () => ({ notification_id: delivFor, user_id: me, channel: "email", status: "sent", created_at: iso(40 * MIN) })),
      { notification_id: delivFor, user_id: me, channel: "sms", status: "failed", created_at: iso(40 * MIN) },
      { notification_id: delivFor, user_id: me, channel: "sms", status: "failed", created_at: iso(39 * MIN) },
      { notification_id: delivFor, user_id: me, channel: "sms", status: "sent", created_at: iso(38 * MIN) },
    ];
    const { data: delivs, error: dErr } = await admin.from("notif_deliveries").insert(delivRows).select("id");
    if (dErr) throw new Error(`notif_deliveries insert: ${dErr.message}`);
    track("notif_deliveries", delivs!);

    // ── Load ──
    const d: any = await loadUnitCommunications(admin, hosp.id, false, me, W);

    console.log("Alerts awaiting acknowledgement");
    const un = d.notifications.unanswered;
    const titles = un.map((n: any) => n.title);
    ok("overdue critical is unanswered", titles.some((t: string) => t.startsWith("HX-OVERDUE")));
    ok("READ-but-unacknowledged alert is still unanswered", titles.some((t: string) => t.startsWith("HX-READ")),
      "reading an alert must not clear an acknowledgement requirement");
    ok("acknowledged alert is NOT unanswered", !titles.some((t: string) => t.startsWith("HX-ACKED")));
    ok("no-ack-required notification is NOT unanswered", !titles.some((t: string) => t.startsWith("HX-LOW")));
    ok("another user's alert never appears", !titles.some((t: string) => t.startsWith("HX-OTHER")),
      "notifications are per-user; a manager must not see a colleague's inbox");
    const overdueRow = un.find((n: any) => n.title.startsWith("HX-OVERDUE"));
    const readRow = un.find((n: any) => n.title.startsWith("HX-READ"));
    eq("45min alert with 15min window is overdue", overdueRow?.overdue, true);
    eq("5min alert with 120min window is not overdue", readRow?.overdue, false);
    ok("overdue sorts above not-overdue", titles.indexOf("HX-OVERDUE deteriorating patient") < titles.indexOf("HX-READ escalation raised"));
    ok("age is reported in minutes", overdueRow?.ageMin >= 44 && overdueRow?.ageMin <= 46, `got ${overdueRow?.ageMin}`);

    console.log("\nKPIs and framework wiring");
    eq("unanswered count (delta)", d.kpis.unanswered - base.kpis.unanswered, 2);
    eq("overdue-unanswered count (delta)", d.kpis.unansweredOverdue - base.kpis.unansweredOverdue, 1);
    eq("unread count (delta)", d.kpis.unread - base.kpis.unread, 2);
    eq("framework columns detected", d.frameworkReady, true);
    eq("read receipts detected", d.readsReady, true);
    const crit = d.notifications.byPriority.find((p: any) => p.priority === "critical");
    const baseCrit = base.notifications.byPriority.find((p: any) => p.priority === "critical");
    eq("critical bucket counts only mine (delta)", crit.n - baseCrit.n, 2);
    ok("category breakdown uses framework labels", d.notifications.byCategory.some((c: any) => c.category === "safety_alert" && c.label));

    console.log("\nMessaging");
    const unit = d.messaging.channels.find((c: any) => c.channel === "HX-unit");
    const quiet = d.messaging.channels.find((c: any) => c.channel === "HX-quiet");
    eq("channel totals", unit?.total, 3);
    eq("own message is not unread to me", unit?.unread, 1);
    eq("unopened channel is fully unread", quiet?.unread, 1);
    eq("participants counted distinctly", unit?.participants, 2);
    // HX-quiet carries the newest message (6 min) and HX-unit the next (7 min), so recency puts quiet first.
    const iUnit = d.messaging.channels.findIndex((c: any) => c.channel === "HX-unit");
    const iQuiet = d.messaging.channels.findIndex((c: any) => c.channel === "HX-quiet");
    ok("channels ordered by recency", iQuiet < iUnit, `quiet at ${iQuiet}, unit at ${iUnit}`);
    ok("aggregate unread is a number, not null", typeof d.kpis.unreadMessages === "number");

    console.log("\nBroadcasts");
    const t = d.broadcasts.items.find((b: any) => b.title.startsWith("HX-TARGETED"));
    const u = d.broadcasts.items.find((b: any) => b.title.startsWith("HX-UNTARGETED"));
    eq("rate computed against target_count", t?.ackRate, 25);
    eq("no target_count yields NO rate", u?.ackRate, null);
    eq("acknowledgement still counted without a target", u?.acked, 1);
    eq("ackedByMe reflects this manager", t?.ackedByMe, true);
    eq("unexpired broadcast is not expired", t?.expired, false);

    console.log("\nDelivery health");
    const email = d.delivery.byChannel.find((c: any) => c.channel === "email");
    const sms = d.delivery.byChannel.find((c: any) => c.channel === "sms");
    eq("healthy channel attempts (delta)", email?.attempts - baseCh("email").attempts, 4);
    eq("healthy channel successes (delta)", email?.sent - baseCh("email").sent, 4);
    eq("failing channel attempts (delta)", sms?.attempts - baseCh("sms").attempts, 3);
    eq("failures counted (delta)", sms?.failed - baseCh("sms").failed, 2);
    ok("failing channel rates below healthy channel", sms?.rate < email?.rate, `sms ${sms?.rate}% vs email ${email?.rate}%`);
    ok("a channel with no attempts is absent, not 100%", !d.delivery.byChannel.some((c: any) => c.channel === "in_app" && baseCh("in_app").attempts === 0),
      "silence must not read as success");
    ok("channels ordered by volume", d.delivery.byChannel[0].attempts >= d.delivery.byChannel[1].attempts);
    // Delivery is keyed to a PERSON, not a tenant — so a unit page must resolve it through the staff list.
    const foreign: any = await loadUnitCommunications(admin, "00000000-0000-0000-0000-000000000000", false, me, W);
    eq("delivery does not leak across tenants", foreign.delivery.recorded, 0);

    console.log("\nSignals");
    const text = d.signals.map((s: any) => s.text).join(" | ");
    ok("overdue acknowledgement raises a HIGH signal",
      d.signals.some((s: any) => s.severity === "high" && /escalation window/.test(s.text)), text);
    ok("failing channel raises a signal", /sms/.test(text), text);
    ok("low broadcast acknowledgement raises a signal", /HX-TARGETED/.test(text), text);

    console.log("\nTimeline");
    const kinds = new Set(d.timeline.map((x: any) => x.kind));
    ok("merges notifications", kinds.has("notification"));
    ok("merges messages", kinds.has("message"));
    ok("merges broadcasts", kinds.has("broadcast"));
    const ts = d.timeline.map((x: any) => String(x.at));
    ok("strictly newest-first", ts.every((v: string, i: number) => i === 0 || ts[i - 1] >= v));
    ok("timeline excludes other users' notifications", !d.timeline.some((x: any) => String(x.title).startsWith("HX-OTHER")));

    console.log("\nHonest empties and isolation");
    const empty: any = await loadUnitCommunications(admin, hosp.id, false, me, { now, windowDays: 0 });
    eq("zero-day window records nothing", empty.notifications.recorded, 0);
    eq("empty store yields no unanswered alerts", empty.kpis.unanswered, 0);
    ok("empty delivery reports no channels rather than perfect health", empty.delivery.byChannel.length === 0);
    ok("recorded counts are always present", typeof empty.messaging.recorded === "number" && typeof empty.broadcasts.recorded === "number");

    const NONE = "00000000-0000-0000-0000-000000000000";
    const otherTenant: any = await loadUnitCommunications(admin, NONE, false, me, W);
    eq("other tenant sees no messages", otherTenant.messaging.recorded, 0);
    eq("other tenant sees no broadcasts", otherTenant.broadcasts.recorded, 0);
    ok("notifications follow the USER, not the tenant filter", otherTenant.notifications.recorded > 0,
      "a manager's own inbox is theirs wherever it is read from");

    const colleague: any = await loadUnitCommunications(admin, hosp.id, false, other, W);
    ok("colleague sees only their own alert", colleague.notifications.unanswered.every((n: any) => !n.title.startsWith("HX-OVERDUE")));
    // The colleague wrote two of the three HX-unit messages, so exactly one — the manager's — is unread to
    // them. Three would mean the loader counts a person's own words as something they have not read.
    eq("colleague sees only what they did not write as unread", colleague.messaging.channels.find((c: any) => c.channel === "HX-unit")?.unread, 1);
  } finally {
    await cleanup();
    const { data: leftN } = await admin.from("notifications").select("id").like("title", "HX-%").limit(1);
    const { data: leftM } = await admin.from("op_messages").select("id").like("body", "HX %").limit(1);
    ok("harness rows removed", !leftN?.length && !leftM?.length);
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"}  ${pass}/${pass + fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });

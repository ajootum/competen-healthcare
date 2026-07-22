// Multi-channel notification dispatch (PFS-000 §12 / POS-001H). Fans a
// notification out across channels and records every attempt to notif_deliveries
// so delivery is tracked. In-app is always real; email and webhook are real
// adapters gated on provider env (RESEND_API_KEY+NOTIFY_FROM_EMAIL /
// NOTIFY_WEBHOOK_URL); channels with no provider record an honest 'skipped'.
// Everything is fail-soft — a delivery failure never breaks the triggering action.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Channel = "in_app" | "email" | "sms" | "webhook" | "teams" | "slack";
export const CHANNELS: Channel[] = ["in_app", "email", "sms", "webhook", "teams", "slack"];

export type NotifPayload = { type: string; title: string; body?: string | null; href?: string | null };

// Which channels can actually deliver, given configured provider env vars.
export function channelProviders(): Record<Channel, { ready: boolean; provider: string | null }> {
  const email = !!(process.env.RESEND_API_KEY && process.env.NOTIFY_FROM_EMAIL);
  const webhook = !!process.env.NOTIFY_WEBHOOK_URL;
  const sms = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
  return {
    in_app: { ready: true, provider: "internal" },
    email: { ready: email, provider: email ? "resend" : null },
    sms: { ready: sms, provider: sms ? "twilio" : null },
    webhook: { ready: webhook, provider: webhook ? "webhook" : null },
    teams: { ready: false, provider: null },
    slack: { ready: false, provider: null },
  };
}

async function sendEmail(to: string, subject: string, text: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.NOTIFY_FROM_EMAIL, to, subject, text }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
}
async function sendWebhook(payload: any) {
  const r = await fetch(process.env.NOTIFY_WEBHOOK_URL!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`Webhook ${r.status}`);
}

type DeliveryRow = { notification_id?: string | null; user_id?: string | null; channel: Channel; address?: string | null; status: "sent" | "failed" | "skipped"; provider?: string | null; error?: string | null };

export async function recordDeliveries(admin: any, rows: DeliveryRow[]) {
  if (!rows.length) return;
  try { await admin.from("notif_deliveries").insert(rows); } catch { /* pre-migration / non-fatal */ }
}

// Dispatch to the given users across the requested channels. Always best-effort.
export async function dispatch(admin: any, userIds: string[], n: NotifPayload, channels: Channel[] = ["in_app", "email"]) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return { deliveries: [] as DeliveryRow[] };
  const prov = channelProviders();
  const deliveries: DeliveryRow[] = [];

  // Recipient addresses for per-user channels.
  const addr = new Map<string, { email: string | null; phone: string | null }>();
  if (channels.some(c => c === "email" || c === "sms")) {
    try { const { data } = await admin.from("profiles").select("id, email, phone").in("id", ids); for (const p of data ?? []) addr.set(p.id, { email: p.email ?? null, phone: p.phone ?? null }); } catch { /* ignore */ }
  }

  // In-app: write the message store rows, one delivery each.
  if (channels.includes("in_app")) {
    try {
      const { data } = await admin.from("notifications").insert(ids.map(uid => ({ user_id: uid, type: n.type, title: n.title, body: n.body ?? null, href: n.href ?? null }))).select("id, user_id");
      for (const row of data ?? []) deliveries.push({ notification_id: row.id, user_id: row.user_id, channel: "in_app", status: "sent", provider: "internal" });
    } catch { /* in-app store unavailable */ }
  }

  // Per-user provider channels (email, sms).
  for (const ch of channels.filter(c => c === "email" || c === "sms") as Channel[]) {
    for (const uid of ids) {
      const to = ch === "email" ? addr.get(uid)?.email : addr.get(uid)?.phone;
      const provider = prov[ch].provider;
      if (!prov[ch].ready) { deliveries.push({ user_id: uid, channel: ch, status: "skipped", provider, error: "provider not configured" }); continue; }
      if (!to) { deliveries.push({ user_id: uid, channel: ch, status: "skipped", provider, error: "no recipient address" }); continue; }
      try {
        if (ch === "email") await sendEmail(to, n.title, n.body ?? n.title);
        else { deliveries.push({ user_id: uid, channel: ch, address: to, status: "skipped", provider, error: "sms adapter pending" }); continue; }
        deliveries.push({ user_id: uid, channel: ch, address: to, status: "sent", provider });
      } catch (e: any) { deliveries.push({ user_id: uid, channel: ch, address: to, status: "failed", provider, error: String(e?.message ?? e).slice(0, 300) }); }
    }
  }

  // Single-endpoint channels (webhook, teams, slack) — one delivery per notification.
  for (const ch of channels.filter(c => c === "webhook" || c === "teams" || c === "slack") as Channel[]) {
    const provider = prov[ch].provider;
    if (!prov[ch].ready) { deliveries.push({ channel: ch, status: "skipped", provider, error: "provider not configured" }); continue; }
    try { if (ch === "webhook") await sendWebhook({ ...n, recipients: ids.length }); deliveries.push({ channel: ch, address: ch === "webhook" ? process.env.NOTIFY_WEBHOOK_URL : null, status: "sent", provider }); }
    catch (e: any) { deliveries.push({ channel: ch, status: "failed", provider, error: String(e?.message ?? e).slice(0, 300) }); }
  }

  await recordDeliveries(admin, deliveries);
  return { deliveries };
}

const DAY = 86400000;

// Delivery analytics for the notifications console.
export async function loadNotificationsOps(admin: any) {
  const [delRes, readRes, totRes] = await Promise.all([
    admin.from("notif_deliveries").select("channel, status, provider, address, error, created_at").order("created_at", { ascending: false }).limit(5000),
    admin.from("notifications").select("*", { count: "exact", head: true }).eq("read", true),
    admin.from("notifications").select("*", { count: "exact", head: true }),
  ]);
  const ready = !delRes.error;
  const rows = (ready ? delRes.data ?? [] : []) as any[];
  const since = Date.now() - DAY;
  const d = rows.filter(r => new Date(r.created_at).getTime() >= since);
  const prov = channelProviders();

  const byChannel = CHANNELS.map(ch => {
    const a = d.filter(r => r.channel === ch);
    return { channel: ch, provider: prov[ch].provider, ready: prov[ch].ready, n: a.length, sent: a.filter(r => r.status === "sent").length, failed: a.filter(r => r.status === "failed").length, skipped: a.filter(r => r.status === "skipped").length };
  });
  const totalNotifs = totRes.count ?? 0, readNotifs = readRes.count ?? 0;

  return {
    summary: {
      ready,
      deliveries24h: d.length,
      sent24h: d.filter(r => r.status === "sent").length,
      failed24h: d.filter(r => r.status === "failed").length,
      skipped24h: d.filter(r => r.status === "skipped").length,
      channelsReady: CHANNELS.filter(ch => prov[ch].ready).length,
      readRate: totalNotifs ? Math.round((readNotifs / totalNotifs) * 100) : null,
      totalNotifs,
    },
    byChannel,
    recent: rows.slice(0, 15).map(r => ({ channel: r.channel, status: r.status, provider: r.provider, address: r.address, error: r.error, at: r.created_at })),
  };
}

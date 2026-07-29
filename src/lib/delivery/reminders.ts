/* eslint-disable @typescript-eslint/no-explicit-any */
// CDP-011 — scheduled reminder engine. The in-app notification layer already fires REACTIVE nudges; this adds
// the SCHEDULED side: a daily scan that finds expiring credentials + competencies and proactively reminds the
// learner exactly once per due milestone (deduped via cdp_reminders 145). Reminders are real in-app
// notifications (notify() → notifications 029 + notif_deliveries 056). Real over professional_credentials (016)
// + competency_decisions (011) + profiles. No fabricated recipients.

import { notify } from "@/lib/notify";
import { resolveDeliveryConfig } from "@/lib/delivery/config";

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";

export async function scanReminders(admin: Admin) {
  const horizonDays = (await resolveDeliveryConfig(admin)).reminder_horizon_days; // CDP-014 governs the lead time
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const horizonStr = new Date(today.getTime() + horizonDays * 864e5).toISOString().slice(0, 10);

  type Cand = { kind: string; subject_id: string; nurse_id: string; due_date: string; label: string; title: string; body: string; href: string };
  const candidates: Cand[] = [];

  const { data: creds } = await admin.from("professional_credentials").select("id, nurse_id, credential_type, expiry_date").eq("status", "active").not("expiry_date", "is", null).lte("expiry_date", horizonStr).limit(20000);
  for (const c of (creds ?? []) as any[]) {
    if (!c.nurse_id) continue;
    const expired = c.expiry_date < todayStr;
    candidates.push({ kind: "credential_expiry", subject_id: c.id, nurse_id: c.nurse_id, due_date: c.expiry_date, label: String(c.credential_type ?? "credential"),
      title: expired ? "Credential expired" : "Credential expiring soon",
      body: `Your ${String(c.credential_type ?? "credential").replace(/_/g, " ")} ${expired ? "expired" : "expires"} on ${c.expiry_date}. Renew to stay compliant.`, href: "/dashboard/certificates" });
  }

  const { data: decs } = await admin.from("competency_decisions").select("id, nurse_id, competency_id, expiry_date").not("expiry_date", "is", null).lte("expiry_date", horizonStr).limit(20000);
  const compIds = [...new Set(((decs ?? []) as any[]).map(d => d.competency_id).filter(Boolean))] as string[];
  const compName = new Map<string, string>();
  if (compIds.length) { const { data } = await admin.from("framework_competencies").select("id, name").in("id", compIds.slice(0, 2000)); ((data ?? []) as any[]).forEach(c => compName.set(c.id, c.name)); }
  for (const d of (decs ?? []) as any[]) {
    if (!d.nurse_id) continue;
    const name = compName.get(d.competency_id) ?? "A competency";
    const expired = d.expiry_date < todayStr;
    candidates.push({ kind: "competency_expiry", subject_id: d.id, nurse_id: d.nurse_id, due_date: d.expiry_date, label: name,
      title: expired ? "Competency expired" : "Competency expiring soon",
      body: `${name} ${expired ? "expired" : "expires"} on ${d.expiry_date}. Reassessment may be due.`, href: "/dashboard/passport" });
  }

  if (!candidates.length) return { ok: true as const, sent: 0, byKind: {} as Record<string, number> };

  const { data: existing } = await admin.from("cdp_reminders").select("kind, subject_id, due_date").limit(50000);
  const have = new Set(((existing ?? []) as any[]).map(r => `${r.kind}|${r.subject_id}|${r.due_date}`));
  const fresh = candidates.filter(c => !have.has(`${c.kind}|${c.subject_id}|${c.due_date}`)).slice(0, 1000);
  if (!fresh.length) return { ok: true as const, sent: 0, byKind: {} as Record<string, number> };

  const nurseIds = [...new Set(fresh.map(c => c.nurse_id))];
  const { data: profs } = await admin.from("profiles").select("id, hospital_id").in("id", nurseIds.slice(0, 2000));
  const nurseHosp = new Map(((profs ?? []) as any[]).map(p => [p.id, p.hospital_id]));

  const byKind: Record<string, number> = {};
  let sent = 0;
  for (const c of fresh) {
    // Insert the dedup row first; the unique index makes this the once-only gate (a dup means already reminded).
    const { error } = await admin.from("cdp_reminders").insert({ hospital_id: nurseHosp.get(c.nurse_id) ?? null, kind: c.kind, subject_id: c.subject_id, recipient_id: c.nurse_id, subject_label: c.label, due_date: c.due_date });
    if (error) continue;
    await notify([c.nurse_id], { type: "reminder", title: c.title, body: c.body, href: c.href });
    byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    sent++;
  }
  return { ok: true as const, sent, byKind };
}

export async function loadReminderStatus(admin: Admin, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const totalRes = await scope(admin.from("cdp_reminders").select("id", { count: "exact", head: true }));
  if (totalRes.error) return { provisioned: false as const };
  const horizonDays = (await resolveDeliveryConfig(admin)).reminder_horizon_days;
  const horizon = new Date(Date.now() + horizonDays * 864e5).toISOString().slice(0, 10);
  const [credRes, compRes, recentRes, upCred, upComp] = await Promise.all([
    scope(admin.from("cdp_reminders").select("id", { count: "exact", head: true }).eq("kind", "credential_expiry")),
    scope(admin.from("cdp_reminders").select("id", { count: "exact", head: true }).eq("kind", "competency_expiry")),
    scope(admin.from("cdp_reminders").select("kind, subject_label, due_date, sent_at").order("sent_at", { ascending: false }).limit(15)),
    admin.from("professional_credentials").select("id", { count: "exact", head: true }).eq("status", "active").not("expiry_date", "is", null).lte("expiry_date", horizon),
    admin.from("competency_decisions").select("id", { count: "exact", head: true }).not("expiry_date", "is", null).lte("expiry_date", horizon),
  ]);
  return {
    provisioned: true as const,
    kpis: { sent: totalRes.count ?? 0, credential: credRes.count ?? 0, competency: compRes.count ?? 0, upcoming: (upCred.count ?? 0) + (upComp.count ?? 0) },
    recent: (recentRes.data ?? []) as any[],
  };
}

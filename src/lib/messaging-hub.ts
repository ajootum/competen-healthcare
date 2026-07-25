// PW-005 Messaging & Communications Hub — user-scoped view over the REAL op_messages store (channel-based, with
// context_type team/patient/task/direct/general). Groups messages into channels/conversations, resolves the
// selected thread, and computes the KPI ribbon + a context-type communication summary. Read-only aggregation;
// sending goes through /api/messages/channel (own-hospital). Honest gaps: op_messages has no read-state,
// reactions, threads, stars, pins or scheduling — those KPIs are proxied (recent = last 24h) or next-phase (0).
/* eslint-disable @typescript-eslint/no-explicit-any */
const dayMs = 86400000;
const q = async (p: Promise<any>) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };

export const CONTEXT_META: Record<string, { label: string; color: string; icon: string }> = {
  direct: { label: "Direct Messages", color: "#3b82f6", icon: "👤" },
  team: { label: "Team Channels", color: "#10b981", icon: "👥" },
  general: { label: "Broadcasts", color: "#f59e0b", icon: "📢" },
  patient: { label: "Patient Care", color: "#f43f5e", icon: "🏥" },
  task: { label: "Task Threads", color: "#8b5cf6", icon: "☑️" },
};

export async function loadMessagingHub(admin: any, userId: string, profile: any, selectedChannel: string | null) {
  const now = Date.now();
  const hid = profile?.hospital_id ?? null;
  const firstName = (profile?.full_name ?? "").split(" ")[0]?.toLowerCase() ?? "";
  const fullName = (profile?.full_name ?? "").toLowerCase();

  const empty = { channels: [] as any[], thread: [] as any[], selected: null as string | null, kpis: { unread: 0, direct: 0, groups: 0, broadcasts: 0, mentions: 0, starred: 0 }, summary: [] as any[], myChannels: [] as string[], total: 0 };
  if (!hid) return empty;

  const msgs = await q(admin.from("op_messages").select("id, channel, context_type, body, author_id, author_name, created_at").eq("hospital_id", hid).order("created_at", { ascending: false }).limit(400));
  if (!msgs.length) return empty;

  // Group into channels.
  const byChannel = new Map<string, any>();
  for (const m of msgs) {
    const c = byChannel.get(m.channel);
    if (!c) byChannel.set(m.channel, { name: m.channel, context_type: m.context_type, count: 1, last: m, recent: new Date(m.created_at).getTime() > now - dayMs ? 1 : 0 });
    else { c.count++; if (new Date(m.created_at).getTime() > now - dayMs) c.recent++; }
  }
  const channels = [...byChannel.values()].sort((a, b) => new Date(b.last.created_at).getTime() - new Date(a.last.created_at).getTime());

  // Selected thread (chronological).
  const selected = (selectedChannel && byChannel.has(selectedChannel)) ? selectedChannel : channels[0]?.name ?? null;
  const thread = selected
    ? msgs.filter((m: any) => m.channel === selected).sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((m: any) => ({ ...m, mine: m.author_id === userId }))
    : [];

  // KPIs.
  const distinctCtx = (ctx: string) => channels.filter(c => c.context_type === ctx).length;
  const mentions = msgs.filter((m: any) => m.author_id !== userId && ((firstName && String(m.body ?? "").toLowerCase().includes(firstName)) || (fullName && String(m.body ?? "").toLowerCase().includes(fullName)))).length;
  const recent = msgs.filter((m: any) => new Date(m.created_at).getTime() > now - dayMs && m.author_id !== userId).length;
  const kpis = { unread: recent, direct: distinctCtx("direct"), groups: distinctCtx("team") + distinctCtx("general"), broadcasts: distinctCtx("general"), mentions, starred: 0 };

  // Communication summary by context type.
  const ctxCount = new Map<string, number>();
  msgs.forEach((m: any) => ctxCount.set(m.context_type, (ctxCount.get(m.context_type) ?? 0) + 1));
  const summary = [...ctxCount.entries()].map(([ctx, n]) => ({ ctx, ...(CONTEXT_META[ctx] ?? { label: ctx, color: "#94a3b8", icon: "💬" }), n })).sort((a, b) => b.n - a.n);

  return { channels, thread, selected, kpis, summary, myChannels: channels.slice(0, 8).map(c => c.name), total: msgs.length };
}

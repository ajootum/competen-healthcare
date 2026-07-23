import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCollaboration } from "@/lib/platform/collaboration";
import { NoteComposer, DeleteComment } from "./CommentControls";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

// Collaboration console (PCS-000 Collaboration) — the platform activity + moderation
// view over plat_comments: post platform notes, see the cross-entity comment feed,
// distribution by entity, top contributors, and soft-delete for moderation. The
// threaded comment primitive (loadThread) embeds on entity pages in a follow-up.

const card = "bg-white rounded-xl border border-gray-200";
const ENTITY_COLOR = ["#14b8a6", "#8b5cf6", "#3b82f6", "#f59e0b", "#ef4444", "#0ea5e9", "#6b7280"];
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };

function Kpi({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon?: string }) {
  return <div className={`${card} p-3.5`}><div className="flex items-start justify-between"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>{icon && <span className="text-sm opacity-50">{icon}</span>}</div><p className="text-2xl font-bold tabular-nums mt-0.5 text-gray-900">{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

export default async function CollaborationConsole() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadCollaboration(admin, profile?.hospital_id ?? null, true) as any;

  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2"><span className="text-xl">💬</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Collaboration</h1><p className="text-sm text-gray-500">Threaded comments and @-mentions across every platform entity.</p></div></div>
      <Link href="/super-admin/platform-ops" className="text-xs text-teal-700 hover:underline shrink-0">← Platform Operations</Link>
    </div>
  );

  if (!d.provisioned) return (
    <div className="space-y-4">{header}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
        <p className="font-semibold text-amber-900">⚙️ Collaboration store not provisioned</p>
        <p className="text-sm text-amber-800 mt-1">Run migration <code>078-plat-comments.sql</code> to enable the collaboration primitive. The service, API and this console are ready — they light up once the store exists.</p>
      </div>
    </div>
  );

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Comments" value={k.total.toLocaleString()} sub="Not deleted" icon="💬" />
        <Kpi label="Threads" value={k.threads} sub="Entities discussed" icon="🧵" />
        <Kpi label="Replies" value={k.replies} sub="Nested" icon="↩️" />
        <Kpi label="Mentions" value={k.mentions} sub="@-mentions" icon="📣" />
        <Kpi label="This Week" value={k.thisWeek} sub="Last 7 days" icon="🆕" />
        <Kpi label="Contributors" value={k.contributors} sub="Distinct authors" icon="👥" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Feed */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Activity Feed</h3>
          <div className="mb-4"><NoteComposer /></div>
          {d.recent.length === 0 ? (
            <div className="text-center py-8"><p className="text-3xl mb-2">💬</p><p className="text-sm font-semibold text-gray-700">No comments yet</p><p className="text-xs text-gray-400 mt-1">Post the first platform note above, or comments arrive as workspaces attach discussions to their records.</p></div>
          ) : (
            <div className="space-y-2.5">
              {d.recent.map((c: any) => (
                <div key={c.id} className="flex gap-2.5 group">
                  <div className="w-7 h-7 rounded-full bg-teal-50 border border-teal-100 flex items-center justify-center text-[10px] font-bold text-teal-700 shrink-0">{(c.author || "?").slice(0, 2).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-gray-800">{c.author}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{c.entityLabel}</span>
                      {c.isReply && <span className="text-[9px] text-gray-400">reply</span>}
                      {c.edited && <span className="text-[9px] text-gray-400">edited</span>}
                      <span className="text-[10px] text-gray-400">{relTime(c.at)}</span>
                      <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"><DeleteComment id={c.id} /></span>
                    </div>
                    <p className="text-xs text-gray-700 mt-0.5 break-words">{c.body}</p>
                    {c.mentions.length > 0 && <p className="text-[10px] text-violet-500 mt-0.5">📣 {c.mentions.length} mention{c.mentions.length === 1 ? "" : "s"}</p>}
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-gray-400 pt-1">Showing {d.recent.length} most recent across all entities.</p>
            </div>
          )}
        </div>

        {/* Distribution + contributors */}
        <div className="space-y-4 xl:col-span-1">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">By Entity</h3>
            {d.byEntity.length === 0 ? <p className="text-sm text-gray-400">No activity.</p> : (
              <div className="space-y-2">{d.byEntity.slice(0, 7).map((x: any, i: number) => (<div key={x.label} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: ENTITY_COLOR[i % ENTITY_COLOR.length] }} />{x.label}</span><span className="text-gray-400">{x.n} ({x.pct}%)</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${x.pct}%`, background: ENTITY_COLOR[i % ENTITY_COLOR.length] }} /></div></div>))}</div>
            )}
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Top Contributors</h3>
            {d.contributors.length === 0 ? <p className="text-sm text-gray-400">No contributors yet.</p> : (
              <div className="space-y-1.5">{d.contributors.map((u: any) => (<div key={u.label} className="flex items-center gap-2 text-xs"><div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-600">{(u.label || "?").slice(0, 2).toUpperCase()}</div><span className="text-gray-700 flex-1 truncate">{u.label}</span><b className="text-gray-900">{u.n}</b></div>))}</div>
            )}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Collaboration Service (PCS-000 Collaboration) is the reusable comment primitive over <code>plat_comments</code> — threaded comments with @-mentions that any workspace attaches to any record via (entity_type, entity_id). Edits and deletes are soft (the trail is kept); every action is audit-logged through the role-gated /api/platform/comments route. This console is the platform activity + moderation view; embedding the threaded view on entity pages (CAPA, escalation, tenant…) and resolving @-mentions to notifications are the honest next-phase wiring.</p>
    </div>
  );
}

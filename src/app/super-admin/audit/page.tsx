import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

type AuditEntry = {
  id: string;
  created_at: string;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_name: string | null;
  old_value: Record<string, string> | null;
  new_value: Record<string, string> | null;
  notes: string | null;
};

const ACTION_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  submit_review:   { label: "Submitted for Review", icon: "📤", color: "text-amber-600 bg-amber-50"  },
  approve_content: { label: "Approved",             icon: "✅", color: "text-green-700 bg-green-50"  },
  reject_content:  { label: "Rejected",             icon: "❌", color: "text-red-600  bg-red-50"     },
  publish:         { label: "Published",            icon: "🌐", color: "text-blue-700 bg-blue-50"    },
  archive:         { label: "Archived",             icon: "📦", color: "text-gray-600 bg-gray-100"   },
  revert:          { label: "Reverted to Draft",    icon: "↩️", color: "text-gray-500 bg-gray-50"    },
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default async function AuditLogPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  const { data: entries } = await admin
    .from("audit_log")
    .select("id, created_at, actor_name, action, entity_type, entity_name, old_value, new_value, notes")
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<AuditEntry[]>();

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Audit Log</h1>
        <p className="text-gray-400 text-sm mt-0.5">All platform governance actions — who changed what and when.</p>
      </div>

      {!(entries ?? []).length ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">🗒️</p>
          <p className="text-gray-500 text-sm">No audit entries yet.</p>
          <p className="text-gray-400 text-xs mt-1">Actions on frameworks and content will appear here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-0">
          {(entries ?? []).map((e, i) => {
            const meta = ACTION_LABELS[e.action];
            return (
              <div key={e.id} className="relative flex gap-4">
                {/* Timeline line */}
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 z-10 ${meta?.color ?? "text-gray-500 bg-gray-100"}`}>
                    {meta?.icon ?? "📋"}
                  </div>
                  {i < (entries ?? []).length - 1 && (
                    <div className="w-px flex-1 bg-gray-100 my-1" />
                  )}
                </div>

                <div className="pb-5 flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <span className="text-sm font-semibold text-gray-900">{meta?.label ?? e.action}</span>
                      {e.entity_name && (
                        <span className="text-sm text-gray-500"> · <span className="font-medium text-gray-700">{e.entity_name}</span></span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0">{fmt(e.created_at)}</span>
                  </div>

                  <p className="text-xs text-gray-400 mt-0.5">
                    {e.actor_name ?? "Unknown"} · {e.entity_type}
                  </p>

                  {(e.old_value || e.new_value) && (
                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-gray-500">
                      {e.old_value && (
                        <span className="bg-red-50 text-red-500 px-1.5 py-0.5 rounded font-mono">
                          {Object.entries(e.old_value).map(([k, v]) => `${k}: ${v}`).join(", ")}
                        </span>
                      )}
                      {e.old_value && e.new_value && <span className="text-gray-300">→</span>}
                      {e.new_value && (
                        <span className="bg-green-50 text-green-600 px-1.5 py-0.5 rounded font-mono">
                          {Object.entries(e.new_value).map(([k, v]) => `${k}: ${v}`).join(", ")}
                        </span>
                      )}
                    </div>
                  )}

                  {e.notes && (
                    <p className="mt-1.5 text-xs text-gray-500 italic bg-gray-50 rounded px-2 py-1">
                      &ldquo;{e.notes}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

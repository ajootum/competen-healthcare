import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import NotificationsCentre, { type Notif, type ActivityItem } from "@/components/educator/NotificationsCentre";

// Educator Notifications Centre (Notifications Developer Specification v2.0).
// Server side gathers the live inputs: the user's notifications, today's
// signed-off validations (competency_scores.validated_at), the validation
// queue depth, and the educator's recent validation activity.

export default async function EducatorNotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!roles.includes("educator") && !["hospital_admin", "super_admin"].includes(profile?.role ?? "")) redirect("/dashboard");

  const { data: hospitalNurses } = await admin
    .from("profiles").select("id")
    .eq("hospital_id", profile?.hospital_id ?? "").eq("role", "nurse");
  const nurseIds = (hospitalNurses ?? []).map(n => n.id);

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const noCount = Promise.resolve({ count: 0 });

  const [{ data: rows }, { count: validatedToday }, { count: pendingCount }, { data: recentValidations }] = await Promise.all([
    admin.from("notifications").select("id, type, title, body, href, read, created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
    admin.from("competency_scores").select("id", { count: "exact", head: true })
      .eq("educator_id", user.id).eq("educator_validated", true)
      .gte("validated_at", dayStart.toISOString()),
    nurseIds.length
      ? admin.from("competency_scores").select("id", { count: "exact", head: true })
          .eq("educator_validated", false).in("nurse_id", nurseIds)
      : noCount,
    admin.from("competency_scores")
      .select("id, validated_at, profiles!nurse_id(full_name), framework_competencies!competency_id(name)")
      .eq("educator_id", user.id).eq("educator_validated", true)
      .not("validated_at", "is", null)
      .order("validated_at", { ascending: false }).limit(4),
  ]);

  const activity: ActivityItem[] = (recentValidations ?? []).map(v => ({
    id: v.id,
    label: `Validated “${(v.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency"}”`,
    sub: (v.profiles as unknown as { full_name: string } | null)?.full_name ?? "—",
    when: v.validated_at as string,
  }));

  return (
    <div className="max-w-[1400px]">
      <NotificationsCentre
        items={(rows ?? []) as Notif[]}
        validatedToday={validatedToday ?? 0}
        pendingValidations={pendingCount ?? 0}
        activity={activity}
      />
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import NotificationsCentre from "@/components/NotificationsCentre";

// Assessor-shell notifications — same centre, rendered inside the assessor
// layout so opening the bell doesn't switch workspaces.
export default async function AssessorNotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <NotificationsCentre userId={user.id} />;
}

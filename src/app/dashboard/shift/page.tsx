import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import MyShiftClient from "./MyShiftClient";

export const dynamic = "force-dynamic";

// My Shift — the Healthcare Worker operational workspace (COE §4.4).
// Self-scoped; data is fetched client-side from /api/operations/my-shift.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function MyShiftPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const probe = await admin.from("op_observations").select("id").limit(1);
  const ready = !(probe.error && /does not exist|schema cache/i.test(probe.error.message ?? ""));
  return <MyShiftClient ready={ready} />;
}

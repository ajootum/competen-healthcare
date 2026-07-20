import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CurrentShiftClient from "./CurrentShiftClient";

export const dynamic = "force-dynamic";

// Current Shift (HWW-012) — the Healthcare Worker's personal operational
// dashboard. Self-scoped; data is fetched client-side from /api/operations/my-shift.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function CurrentShiftPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const probe = await admin.from("op_observations").select("id").limit(1);
  const ready = !(probe.error && /does not exist|schema cache/i.test(probe.error.message ?? ""));
  return <CurrentShiftClient ready={ready} />;
}

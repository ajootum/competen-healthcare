import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { callerContext } from "@/lib/config/runtime-context";
import { composeRuntime } from "@/lib/config/runtime";
import RuntimeRenderer from "./RuntimeRenderer";

export const dynamic = "force-dynamic";

// Live metadata-driven surface (NCP-015) — renders a composable configuration object (page / dashboard /
// navigation) as the real screen the CURRENT signed-in user sees, resolved + composed for their own context.
// Any authenticated user; the composed model only exposes what is enabled/visible for them. This is the
// end-to-end proof that authored configuration drives real behaviour, not just an authoring artifact.
/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function ConfigViewPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;

  const ctx = await callerContext(admin, user.id);
  const composed: any = await composeRuntime(admin, decodeURIComponent(key), ctx, { withValues: true });
  if (!composed || !composed.provisioned || !composed.found) notFound();

  return <RuntimeRenderer composed={composed} ctx={ctx} />;
}

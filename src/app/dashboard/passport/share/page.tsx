import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ShareManager from "./ShareManager";

export const dynamic = "force-dynamic";

// COMP-023 Passport Verification & Sharing — the worker's manage surface for consented, time-limited share
// links to their own passport. Worker-owned (nurse_id = caller); the public read is at /verify/[token].
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function PassportSharePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;

  const probe = await admin.from("passport_share_tokens").select("id").limit(1);
  const provisioned = !(probe.error && /does not exist|schema cache/i.test(probe.error.message ?? ""));
  const { data: rows } = provisioned
    ? await admin.from("passport_share_tokens").select("id, token, scope, label, expires_at, revoked, view_count, created_at").eq("nurse_id", user.id).order("created_at", { ascending: false }).limit(100)
    : { data: [] };
  const tokens = (rows ?? []) as any[];

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide mb-0.5">Personal Workspace</p>
          <h1 className="text-xl font-bold text-gray-900">Share &amp; Verify my Passport</h1>
          <p className="text-sm text-gray-500 mt-0.5">Give an employer or regulator a trusted, time-limited link that proves your competence — in your control.</p>
        </div>
        <Link href="/dashboard/passport" className="text-[13px] text-teal-600 hover:underline shrink-0">← Back to passport</Link>
      </div>

      {!provisioned
        ? <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">Passport sharing isn&apos;t provisioned yet — apply migration <code className="font-mono">122</code> to enable time-limited verification links.</div>
        : <ShareManager tokens={tokens} />}

      <p className="text-[11px] text-gray-400">COMP-023 — verification links reveal only your verified, current competencies and credentials over the public <code>/verify/&lt;token&gt;</code> page, until they expire or you revoke them; every link is logged. Cross-organisation recognition (COMP-024) builds on this shared, verifiable record.</p>
    </div>
  );
}

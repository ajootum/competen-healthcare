/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { learningEnabled } from "@/lib/learning/policy";
import { listOfferings } from "@/lib/learning/studio";
import { GrantAccess } from "../_components/LearningControls";
import { Header, Off, when } from "../_components/Bits";

// /super-admin/learning/access -- HQ course access grants (COMPETEN-LEARNING-01 S3, owner D5). Guarded by the existing
// Individual pilot-access authority, hq.individual.pilot.grant. A grant is a course entitlement with source hq_grant:
// it opens one course for one existing member, and grants no Scholar or Professional access. Members still join by
// the existing HQ invitation. You cannot grant access to yourself.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Course access" };

export default async function CourseAccessPage() {
  const ctx = await requireHqCapability("hq.individual.pilot.grant");
  if (!(await learningEnabled(ctx.admin))) return <Off />;
  const [offerings, { data: grants }] = await Promise.all([
    listOfferings(ctx.admin),
    ctx.admin.from("individual_course_entitlement").select("id, user_id, offering_id, status, starts_at, ends_at, source, note").order("created_at", { ascending: false }).limit(100),
  ]);
  const name = new Map((offerings ?? []).map(o => [o.id, `${o.code} ${o.title}`]));
  return (
    <div className="max-w-4xl space-y-8">
      <Header eyebrow="Competen Holdings · Competen Individual" title="Course access" intro="Open one course for one existing Competen Individual member, for pilot or sponsored learning. It gives no Scholar or Professional access, and it is recorded with your reason." />
      <div className="rounded-xl border border-gray-200 bg-white p-3"><GrantAccess offerings={(offerings ?? []).filter(o => o.status === "active" && o.delivery === "hosted").map(o => ({ id: o.id, code: o.code, title: o.title }))} /></div>
      <section className="space-y-2"><h2 className="text-[15px] font-bold text-gray-900">Recent course entitlements</h2>
        {((grants ?? []) as any[]).length === 0 ? <p className="text-[13.5px] text-gray-700">None yet.</p> : <ul className="text-[13px] text-gray-800">{((grants ?? []) as any[]).map(g => <li key={g.id} className="border-t border-gray-100 py-1">{name.get(g.offering_id) ?? "A course"} · member {String(g.user_id).slice(0, 8)} · {g.source === "payment" ? "purchase" : "HQ grant"} · {g.status} · from {when(g.starts_at)}{g.ends_at ? ` to ${when(g.ends_at)}` : ", no end"}{g.note ? ` · ${g.note}` : ""}</li>)}</ul>}
      </section>
    </div>
  );
}

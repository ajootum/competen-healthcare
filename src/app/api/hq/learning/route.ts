/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { publishScope, setOverride } from "@/lib/config/workspace-config-write";
import { LEARNING_OFF, LEARNING_POLICY_PATH, LEARNING_SCOPE, learningEnabled, resolveLearningPolicy } from "@/lib/learning/policy";
import {
  authoriseCertificates, createOffering, createProvider, decidePrice, deleteDraft, newDraft, proposePrice, publishVersion, retireOffering, retirePrice,
  revokeCertificate, saveDraft, submitVersion, withdrawCertificateAuthorisation,
} from "@/lib/learning/studio";
import { grantCourseAccess } from "@/lib/learning/commerce";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/learning -- COMPETEN-LEARNING-01 S1-S3, migrations 460-464.
//
// Body: { action, ...args }. Each action's capability is fixed HERE, server-side (owner D8, five separate authorities):
//   hq.learning.course.author      create_provider, create, new_draft, delete_draft, save, submit, propose_price
//   hq.learning.course.publish     publish (for an external listing: listing approval only), retire, policy_draft, policy_publish
//   hq.learning.price.approve      decide_price, retire_price
//   hq.learning.certificate.issue  authorise_certificates, withdraw_certificates, revoke_certificate
//   hq.individual.pilot.grant      grant_access (the existing Individual pilot-access authority)
// Clinical approval is NOT here: it is /api/hq/clinical-review (hq.quality.clinical.approve) and the 395/461 trigger.
//
// ⚠ NOTHING THE BROWSER SENDS PICKS AN AUTHOR, A STATE, AN APPROVER OR AN ISSUER. The actor is the session's person.
// Independence and authority are checked again by the database (460-464). Every action is audited.

const AUTHOR = ["create_provider", "create", "new_draft", "delete_draft", "save", "submit", "propose_price"] as const;
const PUBLISH = ["publish", "retire", "policy_draft", "policy_publish"] as const;
const PRICE = ["decide_price", "retire_price"] as const;
const CERT = ["authorise_certificates", "withdraw_certificates", "revoke_certificate"] as const;
const GRANT = ["grant_access"] as const;
const CAPABILITY: [readonly string[], string][] = [[AUTHOR, "hq.learning.course.author"], [PUBLISH, "hq.learning.course.publish"], [PRICE, "hq.learning.price.approve"],
  [CERT, "hq.learning.certificate.issue"], [GRANT, "hq.individual.pilot.grant"]];
const refuse = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const capability = CAPABILITY.find(([acts]) => acts.includes(action))?.[1] ?? null;
  if (!capability) return refuse(400, "Unknown action.");
  const ctx = await hqApiGate([capability]);
  if (isHqRefusal(ctx)) return ctx;
  if (!(await learningEnabled(ctx.admin))) return refuse(409, LEARNING_OFF);
  const me = ctx.userId;
  const trace = await currentTraceId();
  const audit = (entityType: string, entityId: string | null, value: Record<string, unknown>) => ctx.admin.from("audit_log").insert({
    trace_id: trace, actor_id: me, actor_name: ctx.fullName ?? null, action: `learning_${action}`, entity_type: entityType, entity_id: entityId, new_value: value,
  }).then((x: unknown) => x, () => {});

  let r: any;
  switch (action) {
    case "create_provider": r = await createProvider(ctx.admin, me, { code: str(body.code, 41).toUpperCase(), name: str(body.name, 160), kind: str(body.kind, 20), websiteUrl: str(body.websiteUrl, 500) || null, description: str(body.description, 2000) || null });
      if (r.ok) await audit("learning_provider", r.providerId, { code: str(body.code, 41).toUpperCase(), kind: str(body.kind, 20) }); break;
    case "create": r = await createOffering(ctx.admin, me, { code: str(body.code, 45).toUpperCase(), title: str(body.title), source: str(body.source, 20), delivery: str(body.delivery, 20), offeringType: str(body.offeringType, 31), responsibilities: body.responsibilities ?? {} });
      if (r.ok) { await audit("learning_offering", r.offeringId, { code: str(body.code, 45).toUpperCase() }); await audit("learning_offering_version", r.versionId, { origin: "educator" }); } break;
    case "new_draft": r = await newDraft(ctx.admin, me, str(body.offeringId, 40)); if (r.ok) await audit("learning_offering_version", r.versionId, { offering: str(body.offeringId, 40), origin: "revision" }); break;
    case "delete_draft": r = await deleteDraft(ctx.admin, str(body.versionId, 40)); if (r.ok) await audit("learning_offering_version", str(body.versionId, 40), {}); break;
    case "save": r = await saveDraft(ctx.admin, me, str(body.versionId, 40), { content: body.content, responsibilities: body.responsibilities, risk: body.risk, checked: body.checked === true });
      if (r.ok) await audit("learning_offering_version", str(body.versionId, 40), { problems: r.problems.length }); break;
    case "submit": r = await submitVersion(ctx.admin, me, str(body.versionId, 40)); if (r.ok) await audit("learning_offering_version", str(body.versionId, 40), { review_version: r.reviewVersionId, required: r.required }); break;
    case "propose_price": r = await proposePrice(ctx.admin, me, { offeringId: str(body.offeringId, 40), currency: body.currency, amountMajor: body.amountMajor, accessDays: body.accessDays ?? null, note: str(body.note, 1000) });
      if (r.ok) await audit("learning_offering_price", r.priceId, { currency: str(body.currency, 3), amountMajor: Number(body.amountMajor), accessDays: body.accessDays ?? null }); break;
    case "publish": r = await publishVersion(ctx.admin, me, str(body.versionId, 40)); if (r.ok) await audit("learning_offering_version", str(body.versionId, 40), {}); break;
    case "retire": r = await retireOffering(ctx.admin, str(body.offeringId, 40)); if (r.ok) await audit("learning_offering", str(body.offeringId, 40), {}); break;
    case "decide_price": r = await decidePrice(ctx.admin, me, str(body.priceId, 40), body.approve === true, str(body.note, 1000) || null);
      if (r.ok) await audit("learning_offering_price", str(body.priceId, 40), { approve: body.approve === true }); break;
    case "retire_price": r = await retirePrice(ctx.admin, str(body.priceId, 40)); if (r.ok) await audit("learning_offering_price", str(body.priceId, 40), {}); break;
    case "authorise_certificates": r = await authoriseCertificates(ctx.admin, me, str(body.versionId, 40), body.outcomes, str(body.note, 1000) || null);
      if (r.ok) await audit("learning_certificate_authorisation", r.authorisationId, { version: str(body.versionId, 40), outcomes: body.outcomes }); break;
    case "withdraw_certificates": r = await withdrawCertificateAuthorisation(ctx.admin, me, str(body.authorisationId, 40)); if (r.ok) await audit("learning_certificate_authorisation", str(body.authorisationId, 40), {}); break;
    case "revoke_certificate": r = await revokeCertificate(ctx.admin, me, str(body.certificateId, 40), str(body.reason, 500)); if (r.ok) await audit("learning_certificate", str(body.certificateId, 40), { reason: str(body.reason, 500) }); break;
    case "grant_access": if (str(body.userId, 40) === me) return refuse(403, "You cannot grant course access to yourself.");
      r = await grantCourseAccess(ctx.admin, me, { userId: str(body.userId, 40), offeringId: str(body.offeringId, 40), days: body.days === null || body.days === "" || body.days === undefined ? null : Number(body.days), note: str(body.note, 500) });
      if (r.ok) await audit("individual_course_entitlement", r.entitlementId, { person: str(body.userId, 40), offering: str(body.offeringId, 40) }); break;
    case "policy_draft": {
      const w = await setOverride(ctx.admin, { userId: me, name: ctx.fullName ?? null }, LEARNING_SCOPE, LEARNING_POLICY_PATH, resolveLearningPolicy(body.policy));
      r = w.ok ? { ok: true } : { ok: false, error: "The Learning policy draft could not be saved." }; break;
    }
    case "policy_publish": {
      const w = await publishScope(ctx.admin, { userId: me, name: ctx.fullName ?? null }, LEARNING_SCOPE, { label: "Learning policy", note: str(body.note, 300) || null });
      r = w.ok ? { ok: true } : { ok: false, error: "The Learning policy could not be published." }; break;
    }
  }
  if (!r?.ok) return refuse(409, r?.error ?? "That could not be done.", r?.problems ? { problems: r.problems } : {});
  return NextResponse.json(r);
}

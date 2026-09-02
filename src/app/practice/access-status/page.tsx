import Link from "next/link";
import { redirect } from "next/navigation";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveLifecycleActor, PERSON_SCOPED_EXPORT_PATH } from "@/lib/practice/lifecycle";
import { CAP_RESTORE } from "@/lib/practice/lifecycle-constants";
import { SETTINGS_CAPABILITY } from "@/lib/practice/capabilities";
import { accessEndedReading, endedBecause, type AccessEndedReading } from "@/lib/practice/access-ended";
import RestorePracticePanel from "./RestorePracticePanel";
import IdleReSignIn from "./IdleReSignIn";

// /practice/access-status (IAM-001 s7.1, SHELL-001 s13): a member of a restricted workspace sees WHAT
// KIND of restriction stands and what they may do -- a status page, not a broken dashboard. Reason
// CATEGORIES only, never internal detail (IAM-001 s16), and only for workspaces the caller is genuinely
// a member of; everyone else was already routed elsewhere by the guards.

export const dynamic = "force-dynamic";

const REASONS: Record<string, { title: string; body: string; href?: string; hrefLabel?: string }> = {
  WORKSPACE_INACTIVE: {
    title: "This Practice is not currently available",
    body: "The workspace is suspended or being closed. Clinical data access is paused while that stands. If you believe this is wrong, contact support with your workspace name.",
  },
  // ⚠ THE FALLBACK ONLY. CPR-PD-PROV-001 s10 replaces this with a dated, role-aware panel below, built
  // from the practice's actual entitlement row. This wording stands for the one case that panel refuses
  // to speak for: an entitlement record that could not be read. It says less than it used to on purpose
  // -- it no longer promises "your data is retained", because when nothing was read, nothing is known.
  NOT_ENTITLED: {
    title: "This Practice is not open",
    body: "Access to this workspace is closed, and the record that would say why could not be read just now. Nothing has been changed and nothing has been deleted. Try again shortly; if it keeps happening, contact hello@competenhealthcare.com with your practice name.",
  },
  // CPR-370 (migration 213). Both say plainly what happened and what it does NOT mean -- a person who
  // has just been locked out needs to know whether they are still signed in to Competen.
  revoked: {
    title: "This device has been locked out of the Practice",
    body: "Somebody in this practice revoked access for this device. You are still signed in to Competen elsewhere — this is a Practice lockout, not a sign-out. Signing in from a device that has not been revoked will work as usual.",
  },
  // ⚠ THIS SENTENCE BECAME LOAD-BEARING WHEN THE DEVICE REGISTER STARTED WORKING.
  //
  // It always said "Sign in again to carry on", and until now that was harmless advice about a control
  // that could never fire. With a stable device cookie the idle rule is real, and the lock-out it applies
  // is on a browser that will present the same identifier for ever -- so if signing in again did not
  // clear it, this screen would be a permanent wall with no route past it. touchSession now lifts an
  // idle lock-out (and ONLY an idle one) when the person has authenticated since it was applied, so the
  // instruction is true. The button below exists because there is nothing else on this page that gets
  // somebody to a sign-in form, and an instruction with no control behind it is the thing this product
  // has already been caught doing once, on the MFA screen above.
  idle: {
    title: "This device was idle for too long",
    body: "This practice sets a limit on how long a device may sit unused before it has to sign in again. Nothing is wrong with your account, nothing has been deleted, and no other device is affected. Sign out and sign in again on this device to carry on — that clears it.",
  },
  // ⚠ THIS USED TO SAY "add an authenticator to your account and then come back". There is no page in
  // this product that adds one -- `auth.mfa.` appears in exactly one file, the shell's check -- so the
  // instruction sent a locked-out person to do something they could not do, and the sentence read as a
  // route back in when there was none. What it says now is what is actually true, including who can undo
  // it, because that is the only thing this person can act on.
  //
  // AND IT SPLITS ON `enrolled`, because the two cases need different sentences and one wrong sentence
  // here is the whole problem. Somebody who HOLDS a factor is in a quite different position from somebody
  // who does not, and telling the first that their account has no second factor would be simply false.
  // ⚠ REWRITTEN 2026-08-16, THE DAY THE SCREEN SHIPPED. These two sentences used to state -- truthfully
  // -- that no page in this product could set up or complete a second factor, which left a locked-out
  // person with nothing to act on but "contact somebody". /practice/two-factor exists now (COMP-AUTH-001
  // survey s7 item 9, built in the strict order: the screen BEFORE any fail-closed behaviour), and it is
  // deliberately outside the (shell) guard so exactly this person can reach it.
  MFA_REQUIRED: {
    title: "This Practice requires a second factor",
    body: "Somebody in this practice has made two-factor authentication a requirement, and your Competen account does not have one yet. Two-factor lives on the Competen account rather than in Practice. Set one up at Practice > Two-factor authentication — it takes an authenticator app and about a minute — and this practice opens for you. If you cannot, somebody in the practice who can still get in can turn the requirement off.",
    href: "/practice/two-factor", hrefLabel: "Set up two-factor",
  },
  MFA_REQUIRED_ENROLLED: {
    title: "This Practice requires a second factor",
    body: "Somebody in this practice has made two-factor authentication a requirement. Your Competen account does have an authenticator, but this session was not verified with it. Verify with your authenticator code and this practice opens — no sign-out needed.",
    href: "/practice/two-factor", hrefLabel: "Verify your second factor",
  },
  // The third state: not permitted, not refused — unanswered. It carries a retry rather than an
  // instruction, because there is nothing for the person to do differently.
  SECURITY_CHECK_UNAVAILABLE: {
    title: "A security check could not be completed",
    body: "This Practice was not opened because one of its security checks gave no answer just now. Nothing is wrong with your account, nothing has been locked out, and nothing was changed. This is usually momentary — try again. If it keeps happening, contact support with your workspace name.",
  },
};

export default async function Page() {
  const shell = await resolvePracticeShell();
  if (shell.state === "AUTH_REQUIRED") redirect("/practice/sign-in?return_to=/practice/access-status");
  if (shell.state === "READY") redirect("/practice/home");
  if (shell.state === "ONBOARDING_REQUIRED") redirect("/practice/onboarding");
  if (shell.state === "CHOOSER_REQUIRED") redirect("/practice/select-workspace");
  if (shell.state === "WORKSPACE_REQUIRED") redirect("/practice/no-account");

  // MFA_REQUIRED and SECURITY_CHECK_UNAVAILABLE carry no `reason` field -- the state is the reason. The
  // first splits further on whether the person actually holds a factor, which the state carries.
  const key = shell.state === "MFA_REQUIRED" ? (shell.enrolled ? "MFA_REQUIRED_ENROLLED" : "MFA_REQUIRED")
    : shell.state === "SECURITY_CHECK_UNAVAILABLE" ? "SECURITY_CHECK_UNAVAILABLE"
      : shell.reason;
  const reason = REASONS[key] ?? REASONS.WORKSPACE_INACTIVE;

  // ── CPR-LIFE-001 s3: "Administrators may restore Archived or Suspended practices." ────────────────
  //
  // ⚠ THIS IS THE ONLY PLACE A RESTORE CAN BE OFFERED FROM, AND THAT IS NOT AN OVERSIGHT IN THE DESIGN.
  //
  // Archiving a practice takes its status out of the set resolveWorkspaceContext admits, so every
  // Practice page -- including the lifecycle page that offers Restore -- redirects here. Without this,
  // s2's "fully recoverable" would be true of the data and false of the product: the person who archived
  // their own practice would need a developer to get it back.
  //
  // NOTHING IS GRANTED HERE. The same practice.restore capability decides it, resolved from the same
  // active membership and the same time-bounded grants, and the engine refuses a caller who does not
  // hold it. The panel is not rendered at all for anyone else, and the API would refuse them anyway.
  let restorable: { workspaceId: string; workspaceName: string; status: string } | null = null;
  if (shell.state === "ACCESS_RESTRICTED" && shell.reason === "WORKSPACE_INACTIVE") {
    const admin = createAdminClient();
    const actor = await resolveLifecycleActor(admin, shell.userId, shell.workspaceId);
    if (actor && actor.capabilities.includes(CAP_RESTORE)) {
      const { data: ws } = await admin.from("practice_workspace")
        .select("name, status").eq("id", shell.workspaceId).maybeSingle();
      const status = (ws?.status as string | undefined) ?? null;
      // ⚠ ONLY THE TWO REVERSIBLE STATES. A practice that is CLOSED or CLOSING is not offered a restore
      // here, because this build has no verb that puts one there and no engine that takes one out.
      if (status === "ARCHIVED" || status === "SUSPENDED") {
        restorable = {
          workspaceId: shell.workspaceId,
          workspaceName: (ws?.name as string | undefined) ?? actor.workspaceName,
          status,
        };
      }
    }
  }

  // ── CPR-PD-PROV-001 s10 / AC-13: the expired practice, told what happened and when ────────────────
  //
  // ⚠ THE AUDIENCE SPLIT IS BY CAPABILITY, NEVER BY A ROLE STRING. s13: "Never authorize these actions
  // using a nullable role string where the CP capability model is authoritative", and CLAUDE.md says the
  // same about `profiles.role`. Somebody who holds practice.settings.manage is the person who runs this
  // practice; everybody else is staff, and staff are shown the state without the commercial detail.
  //
  // ⚠ AND THERE IS NO PRODUCT DIRECTOR BRANCH HERE, WHICH IS A DECISION AND NOT AN OVERSIGHT. s10's
  // table asks for PD actions on this screen. Those actions are landlord commercial writes, and this is a
  // tenant-plane page reached by a practice member; putting an Extend control on it would mean a Practice
  // URL that mutates commercial state, which is the boundary plane-boundary.ts exists to hold. The PD
  // already has the control, on the surface built for it, at /super-admin/pd/practices/[id] -- the s7
  // card with the same presets and the same audit trail. A PD who lands HERE landed as a member of this
  // practice, and is served by the branch their membership earns.
  let ended: { reading: AccessEndedReading; isOwner: boolean; timezone: string } | null = null;
  if (shell.state === "ACCESS_RESTRICTED" && shell.reason === "NOT_ENTITLED") {
    const admin = createAdminClient();
    const [reading, actor] = await Promise.all([
      accessEndedReading(admin, shell.workspaceId),
      resolveLifecycleActor(admin, shell.userId, shell.workspaceId),
    ]);
    ended = {
      reading,
      isOwner: !!actor?.capabilities.includes(SETTINGS_CAPABILITY),
      timezone: actor?.workspaceTimezone ?? "UTC",
    };
  }

  // ⚠ THE PRACTICE'S OWN TIMEZONE, NOT THE SERVER'S (s5, s15). An entitlement that lapses at 21:00 UTC
  // ended on the FOLLOWING day in Kampala, and a screen that names the wrong day to somebody who was
  // working when it happened is telling them their memory is wrong.
  const onDate = (iso: string, timeZone: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone });
    } catch { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }
  };

  // s10's heading and copy, one branch per audience and one per state. `panel` is null whenever the
  // entitlement could not be read, which is what hands the screen back to the cautious fallback above.
  let panel: { title: string; body: string; retention: boolean } | null = null;
  if (ended && ended.reading.state === "known") {
    const r = ended.reading;
    const tz = ended.timezone;
    if (r.resumesAt && !r.startedAt) {
      // s15: a future-start entitlement shows Scheduled, and must not let anybody in early.
      panel = {
        title: "This Practice has not opened yet",
        body: `Access is scheduled to begin on ${onDate(r.resumesAt, tz)}, and cannot be opened before then. `
          + (ended.isOwner
            ? "If that date is wrong, email hello@competenhealthcare.com with your practice name."
            : "Whoever runs this practice arranged the start date."),
        retention: false,
      };
    } else if (r.resumesAt) {
      panel = {
        title: "Practice access resumes shortly",
        body: `Access ended${r.endedAt ? ` on ${onDate(r.endedAt, tz)}` : ""}, and a new period is already `
          + `recorded to begin on ${onDate(r.resumesAt, tz)}. Everything in the practice is waiting for it.`,
        retention: true,
      };
    } else if (ended.isOwner) {
      panel = {
        title: "Practice access has ended",
        body: (r.endedAt
          ? `Your practice access ended on ${onDate(r.endedAt, tz)}, because ${endedBecause(r)}. `
          : `Your practice access is closed, because ${endedBecause(r)}. `)
          // ⚠ NOTHING ON THIS SCREEN REOPENS IT, AND SAYING SO IS THE POINT. This product has no
          // self-serve route back in from behind the lock: the billing page lives inside the practice
          // shell, and the shell sends a locked-out person here -- so an instruction to "renew your plan"
          // would be a door that opens onto this same screen. An instruction with no control behind it is
          // a mistake this page has already been caught making once, on the two-factor state above.
          + "Reopening it is done by Competen rather than from this screen, so email "
          + "hello@competenhealthcare.com with your practice name and the date above.",
        retention: true,
      };
    } else {
      // Non-owner staff: the state, and the person to ask. No plan, no dates beyond the end, no controls.
      panel = {
        title: "Practice access has ended",
        body: (r.endedAt ? `This practice's access ended on ${onDate(r.endedAt, tz)}. ` : "This practice's access is closed. ")
          + "Nothing is wrong with your own account, and nothing you did caused it. Whoever runs this "
          + "practice can arrange for it to be reopened — there is nothing to do from here.",
        retention: true,
      };
    }
  } else if (ended && ended.reading.state === "none") {
    // s4: "Provisioning must not leave a usable Practice without a valid entitlement." This is that fault
    // seen from the inside, and it is worth distinguishing from an expiry -- the person did nothing.
    panel = {
      title: "This Practice has no access period",
      body: "No plan or trial has ever been recorded against this practice, so it cannot be opened. That is "
        + "a fault in how it was set up rather than something that ran out. Email hello@competenhealthcare.com "
        + "with your practice name.",
      retention: true,
    };
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <h1 className="text-lg font-bold text-gray-900">{panel?.title ?? reason.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">{panel?.body ?? reason.body}</p>
        {/* s10's retention reassurance, and it is deliberately a statement about what still EXISTS rather
            than a promise about how long. This build has no retention clock and no deletion job, so a
            period in days would be a number nothing enforces. */}
        {panel?.retention && (
          <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[12.5px] leading-relaxed text-gray-700">
            <span className="font-semibold">Nothing has been deleted.</span> Patient records, appointments,
            documents and settings are all retained under the applicable retention policy, and reopening
            access brings the practice back as it was.
          </p>
        )}
        {/* The control behind the sentence, where one exists -- the MFA states route to the two-factor
            screen (2026-08-16), which is what turned their old "no screen exists" wording into a door. */}
        {reason.href && (
          <p className="mt-5">
            <Link href={reason.href}
              className="inline-block rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[13px] font-semibold text-white">
              {reason.hrefLabel ?? "Continue"}
            </Link>
          </p>
        )}
        {restorable && (
          <RestorePracticePanel workspaceId={restorable.workspaceId}
            workspaceName={restorable.workspaceName} status={restorable.status} />
        )}
        {/* The escape from an idle lock-out, on the screen that describes it. Signing out and back in is
            what clears it, and this is the only page the person can reach. */}
        {key === "idle" && <IdleReSignIn />}
        {/* The retry belongs to the one state a retry can fix. The guards run again on arrival, so this
            is a real second attempt at the check rather than a button that reloads a verdict. */}
        {key === "SECURITY_CHECK_UNAVAILABLE" && (
          <p className="mt-5">
            <Link href="/practice/home"
              className="inline-block rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[13px] font-semibold text-white">
              Try again
            </Link>
          </p>
        )}
        {/* ⚠ THE ONE ROUTE TO A PROFESSIONAL RECORD FROM BEHIND A LOCKED DOOR (CPR-IDENT-SURVEY-001 D1).
            Every other portfolio path resolves a workspace context, and this page exists precisely
            because no context can be resolved. The record itself is person-scoped from migration 270,
            so this link works whatever has happened to the practice. */}
        <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50/60 p-4 text-left">
          <p className="text-[13px] font-semibold text-gray-900">Your professional record is not part of this</p>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
            Your qualifications, registration details, publications, certificates and awards belong to you
            rather than to this practice, and nothing above affects them. You can take a copy now, from
            here, without opening a practice at all. It does not include your consultation, procedure or
            CPD counts &mdash; those are recorded inside a practice and stay there.
          </p>
          <p className="mt-2">
            <Link href={PERSON_SCOPED_EXPORT_PATH}
              className="inline-block rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Export my professional record
            </Link>
          </p>
        </div>
        <p className="mt-4 text-[13px] text-gray-500">
          <Link href="/practice" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">Back to Competen Practice</Link>
        </p>
      </div>
    </main>
  );
}

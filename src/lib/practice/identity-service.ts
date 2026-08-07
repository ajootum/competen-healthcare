import QRCode from "qrcode";
import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";
import {
  getFormat, formatPractitionerNumber, parsePractitionerNumber, lockFormat,
} from "@/lib/practice/identifier-format";

// PIS-000 v1.0 (Frozen) -- PRACTITIONER IDENTITY SERVICE.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// AN IDENTITY IS NOT SCOPED TO A PRACTICE. s1 "independent of employers", s15 "remains valid when
// changing workplaces". Every function here is keyed on the USER, and the workspace a booking lands in
// is a nullable pointer that can be moved or cleared without touching the number, the handle or the URL.
//
// PRIVACY BY DEFAULT (s1). Discovery starts 'hidden'; s7's public mode is something a practitioner
// chooses, once, knowingly. This publishes a real person's name, qualifications and place of work.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// WHAT IS NOT BUILT, AND WHY -- see NOT_BUILT below rather than a comment nobody reads.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

/** s7. Public is the only mode that reaches search; the rest differ in how a link behaves. */
export const DISCOVERY_MODES = [
  { key: "hidden", label: "Hidden", detail: "Nobody can reach your page, by search or by link. This is where every identity starts." },
  { key: "link_only", label: "Anyone with the link", detail: "Your page works for anybody who has the URL or scans your code, and never appears in search." },
  { key: "existing_patients", label: "Existing patients only", detail: "The page resolves, and says so, but booking is for people already registered with your practice." },
  { key: "referral_only", label: "By referral", detail: "The page resolves and states that new bookings come by referral." },
  { key: "public", label: "Listed publicly", detail: "Your name, qualifications and locations appear in public search results. This publishes you." },
] as const;

/** s10. Ordered, because the lifecycle is a progression and the UI derives its next step from this. */
export const IDENTITY_STATES = [
  "created", "email_verified", "licence_verified", "active",
  "temporarily_hidden", "suspended", "archived", "deleted",
] as const;

/** Which states may reach the public, whatever the discovery mode says. */
const RESOLVABLE_STATES = new Set(["active", "licence_verified"]);

export const NOT_BUILT = [
  {
    key: "otp_booking",
    spec: "PIS-000 s11",
    label: "OTP verification before booking confirmation",
    detail: "Sending a one-time code to a patient needs an SMS or email channel. This product has none, by a decision taken in CPR-320 and CPR-340 and enforced by their harnesses -- there is no channel column and no sent_at anywhere. A code that cannot reach the patient is not a verification, so it is absent rather than stubbed. Everything else in s11 -- resolving a handle, a number, a QR code or a URL to a practitioner -- is built.",
  },
  {
    key: "licence_verification",
    spec: "PIS-000 s10, s14",
    label: "Automated licence verification",
    detail: "s14 lists integration with professional councils as future work. The licence_verified state exists and is recorded with who checked and when, which is a provenance record rather than a verification. Nothing here contacts a council.",
  },
  {
    key: "qr_pdf",
    spec: "PIS-000 s12",
    label: "QR codes as PDF",
    detail: "SVG and PNG are generated here, in process, with no external service. PDF would need a second library; the printable card page prints to PDF from the browser instead.",
  },
  {
    key: "short_url",
    spec: "PIS-000 s12",
    label: "A separate short URL",
    detail: "A short URL needs a domain and a redirect service that this deployment does not have. The canonical URL is already short -- a handle plus a host -- so a second one would be an alias to maintain rather than a feature.",
  },
  {
    key: "telemedicine",
    spec: "PIS-000 s5",
    label: "Telemedicine",
    detail: "Named in s5 as a future capability. Nothing is built and nothing pretends to be.",
  },
] as const;

// ── URLS ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The canonical host.
 *
 * s8 names https://practice.competenhealthcare.com. NOT HARDCODED: a booking URL printed onto a poster
 * has to resolve, and hardcoding a host this deployment may not serve would put a dead address on a
 * physical card. Read from the environment, with the spec's value as the default.
 */
export function identityHost(): string {
  return (process.env.NEXT_PUBLIC_PRACTICE_IDENTITY_HOST ?? "https://practice.competenhealthcare.com")
    .replace(/\/+$/, "");
}

export const bookingUrl = (handle: string) => `${identityHost()}/@${handle}`;

// ── HANDLES ──────────────────────────────────────────────────────────────────────────────────────────

const HANDLE_RE = /^[a-z][a-z0-9]{2,29}$/;

/** s3: lowercase letters and digits only, no spaces or punctuation. */
export function normaliseHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * s3's algorithm, exactly: first initial + surname, then first name + surname, then numeric suffixes.
 *
 * RETURNS THE WHOLE LADDER, not the first free rung. The caller checks availability in order, which
 * keeps the generation rule (this function, pure and testable) apart from the uniqueness rule (the
 * database, which is the only thing that can settle a race).
 */
export function handleCandidates(displayName: string, limit = 12): string[] {
  // Titles are not names. "Dr Elisha Okaisu" must not yield @dokaisu.
  const words = displayName.trim().split(/\s+/)
    .map(w => w.replace(/[^A-Za-z'-]/g, ""))
    .filter(w => w.length > 0 && !/^(dr|prof|professor|mr|mrs|ms|miss|sr|sister|nurse|mx)\.?$/i.test(w));
  if (words.length === 0) return [];

  const first = words[0].toLowerCase().replace(/[^a-z]/g, "");
  const surname = words[words.length - 1].toLowerCase().replace(/[^a-z]/g, "");
  if (!surname) return [];

  const out: string[] = [];
  const push = (h: string) => {
    if (HANDLE_RE.test(h) && !out.includes(h)) out.push(h);
  };

  // s3 order: first initial + surname, then first name + surname.
  if (first) push(first[0] + surname);
  if (first && first !== surname) push(first + surname);
  push(surname);

  // Then numeric suffixes on the preferred stem until unique.
  const stem = (first ? first[0] + surname : surname).slice(0, 26);
  for (let n = 1; out.length < limit; n++) {
    push(`${stem}${n}`);
    if (n > 200) break;
  }
  return out.slice(0, limit);
}

/**
 * Is this handle available?
 *
 * THREE WAYS TO BE UNAVAILABLE, and they are deliberately not distinguished to the caller beyond a
 * reason code: taken by a live identity, reserved (s4), or RETIRED BY SOMEBODY ELSE. The third is the
 * one that is easy to miss -- a released handle stays claimed, because posters and QR codes printed
 * with it are still in circulation and reassigning it would send a stranger's patients to somebody new.
 *
 * ⚠ A FAILED READ IS `unreadable`, NOT `available`. The first version of this function destructured only
 * `data` from all three queries, so a database that could not answer produced a confident "yes, that one
 * is free" -- and the caller would then write it. Reserved and retired have no database constraint
 * behind them (nothing links practice_reserved_handle or practice_handle_history to the identity's
 * handle column), so THIS read is the only thing enforcing them and it must never fail open.
 *
 * ⚠ THIS IS NOT THE COLLISION CONTROL. Two people claiming the same free handle in the same instant
 * both read "available" here. What settles that is the unique constraint on the column, and the writers
 * below attempt the write and handle the violation rather than trusting this answer.
 */
export async function handleAvailable(admin: any, handle: string, forIdentityId?: string): Promise<{
  available: boolean; reason?: "invalid" | "reserved" | "taken" | "retired" | "unreadable";
  because?: string;
}> {
  const h = normaliseHandle(handle);
  if (!HANDLE_RE.test(h)) return { available: false, reason: "invalid" };

  const { data: reserved, error: reservedError } = await admin.from("practice_reserved_handle")
    .select("handle").eq("handle", h).maybeSingle();
  if (reservedError) return { available: false, reason: "unreadable", because: reservedError.message };
  if (reserved) return { available: false, reason: "reserved" };

  const { data: taken, error: takenError } = await admin.from("practice_practitioner_identity")
    .select("id").eq("handle", h).maybeSingle();
  if (takenError) return { available: false, reason: "unreadable", because: takenError.message };
  if (taken && taken.id !== forIdentityId) return { available: false, reason: "taken" };

  const { data: retired, error: retiredError } = await admin.from("practice_handle_history")
    .select("identity_id").eq("handle", h).maybeSingle();
  if (retiredError) return { available: false, reason: "unreadable", because: retiredError.message };
  if (retired && retired.identity_id !== forIdentityId) return { available: false, reason: "retired" };

  return { available: true };
}

/**
 * ⚠ THE ONE BIT A "IS THIS FREE?" QUESTION MAY ANSWER.
 *
 * An availability endpoint is an enumeration oracle -- anybody who can call it can sweep the namespace
 * and learn which handles exist. That is tolerable here (three to thirty lowercase alphanumerics is a
 * small space, and the URLs are public by design; migration 254 says the same in as many words), but
 * only if the answer carries NOTHING BEYOND TAKEN-OR-FREE. `taken`, `reserved` and `retired` are
 * collapsed into one `unavailable` on purpose: which of the three it is would tell a sweeper whether a
 * real practitioner holds a name, which is a fact about a person rather than about a string.
 *
 * `invalid` is disclosed because it is a property of the characters typed, computable without asking
 * anybody. `unreadable` is disclosed because the alternative is reporting a database failure as "free".
 */
export type HandleCheck = {
  handle: string;
  /** The address the caller would get. Null when the handle could never be one. */
  url: string | null;
  state: "invalid" | "available" | "unavailable" | "unreadable";
};

export async function checkHandle(admin: any, raw: string, forIdentityId?: string): Promise<HandleCheck> {
  const h = normaliseHandle(raw);
  const result = await handleAvailable(admin, h, forIdentityId);
  const state: HandleCheck["state"] =
    result.available ? "available"
      : result.reason === "invalid" ? "invalid"
        : result.reason === "unreadable" ? "unreadable"
          : "unavailable";
  return { handle: h, url: state === "invalid" ? null : bookingUrl(h), state };
}

/** The first candidate that is actually free. */
export async function suggestHandle(admin: any, displayName: string): Promise<string | null> {
  for (const candidate of handleCandidates(displayName, 24)) {
    const { available } = await handleAvailable(admin, candidate);
    if (available) return candidate;
  }
  return null;
}

// ── THE IDENTITY ─────────────────────────────────────────────────────────────────────────────────────

export async function getIdentity(admin: any, userId: string) {
  const { data } = await admin.from("practice_practitioner_identity")
    .select("*").eq("user_id", userId).maybeSingle();
  return data ?? null;
}

/**
 * ⚠ WHAT A PRACTITIONER SHOULD KNOW BEFORE THEY CHOOSE ONE. Exported so the screen and the harness read
 * the same sentence -- a warning that lives only in JSX is a warning that can be dropped in a redesign
 * with nothing failing.
 */
export const HANDLE_PERMANENCE_NOTICE =
  "Choose carefully. If you change your handle later the old one is not released: it stays attached to "
  + "you for ever so that cards, posters and QR codes already carrying it keep reaching you rather than "
  + "a stranger. That also means nobody else can ever have it, including you under a different name.";

/**
 * Issue an identity. Idempotent per person.
 *
 * s15: "Every practitioner receives a permanent Practitioner Number, public handle, booking URL and QR
 * code automatically." Automatic, but NOT public: the number is issued, and discovery stays hidden until
 * the practitioner opts in.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ NO HANDLE IS ASSIGNED HERE, AND THAT IS A DEPARTURE FROM s15 TAKEN DELIBERATELY.
 *
 * This function used to call suggestHandle() and write the first free candidate onto the row. It is the
 * obvious reading of "automatically", and it is wrong for two reasons that only show up later:
 *
 *   1. A HANDLE IS A PUBLIC NAME. It is the address in https://practice.competenhealthcare.com/@handle,
 *      printed on cards and given to patients. Deriving it from a real person's name at signup publishes
 *      that name as a side effect of registering -- and nobody was asked.
 *   2. A HANDLE IS CLOSE TO PERMANENT. changeHandle() retires the old one into practice_handle_history,
 *      where it stays claimed for ever so printed codes keep working. So an auto-assigned @eokaisu that
 *      its owner then replaces has burned a name they never chose out of a shared namespace, for good.
 *
 * So provisioning creates the ROW -- the permanent number, the lifecycle, the private profile -- and the
 * practitioner CLAIMS the address themselves in Practice Setup, having seen the URL first. The schema
 * already permits exactly this: migration 218 declares `handle text unique check (handle is null or ...)`
 * and migration 254's booking-page foreign key is on a NULLABLE column, so an identity with no handle is
 * a legal, first-class state rather than a half-written row.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export async function issueIdentity(admin: any, args: {
  userId: string; displayName: string; workspaceId?: string | null; correlationId: string;
}): Promise<EngineResult<{ id: string; practitionerNumber: string; handle: string | null; created: boolean }>> {
  const existing = await getIdentity(admin, args.userId);
  if (existing) {
    return {
      ok: true,
      data: {
        id: existing.id, practitionerNumber: existing.practitioner_number,
        handle: existing.handle, created: false,
      },
    };
  }
  if (args.displayName.trim().length < 2)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a display name is required" };

  // A SEQUENCE, AND NOTHING ELSE. s2 says permanent and never reused, and max()+1 is wrong about the
  // second half: delete CPR-000005 and the next practitioner issued is handed 000005 again, so a number
  // that meant one clinician on a printed card now means another.
  //
  // A MISSING ALLOCATOR FAILS LOUDLY. Falling back to a count here would silently downgrade a guarantee
  // the whole identity rests on, and nothing downstream could tell the difference until two people
  // shared a number.
  // THE SHAPE COMES FROM THE FORMAT TABLE, NEVER FROM A LITERAL HERE. One place knows it, so agreeing a
  // new format reaches every future issuance, every validator and every parser at once.
  const format = await getFormat(admin);

  for (let attempt = 0; attempt < 10; attempt++) {
    const { data: allocated, error: allocError } = await admin.rpc("practice_next_practitioner_sequence");
    if (allocError || allocated == null)
      return {
        ok: false, status: 503, code: "ALLOCATOR_UNAVAILABLE",
        message: `the practitioner number allocator is not available -- migration 220 may not have been applied: ${allocError?.message ?? "no value returned"}`,
      };

    let practitionerNumber: string;
    try {
      practitionerNumber = formatPractitionerNumber(allocated as number, format);
    } catch (e) {
      // The sequence has outgrown the format. Refused here, loudly, rather than by writing a number that
      // does not match the shape everything else validates against.
      return {
        ok: false, status: 409, code: "FORMAT_TOO_NARROW",
        message: e instanceof Error ? e.message : String(e),
      };
    }

    const { data, error } = await admin.from("practice_practitioner_identity").insert({
      user_id: args.userId, practitioner_number: practitionerNumber,
      // ⚠ NULL, AND NOT BY OMISSION. Written out so that a future reader sees a decision rather than a
      // column somebody forgot. See the header.
      handle: null, display_name: args.displayName.trim(),
      primary_workspace_id: args.workspaceId ?? null,
      status: "created", discovery: "hidden",
      // WHICH SHAPE THIS ONE FOLLOWS, recorded rather than inferred from its appearance later.
      number_format_version: format.version,
    }).select("id, practitioner_number, handle").single();

    if (!error) {
      // A NUMBER HAS NOW BEEN ISSUED, so the format is locked: changing it from here on needs an
      // acknowledgement that existing numbers will not change.
      await lockFormat(admin);
      await audit(admin, {
        workspaceId: args.workspaceId ?? null, actorId: args.userId, eventType: "practice.identity_issued",
        payload: { identityId: data.id, practitionerNumber: data.practitioner_number, handle: data.handle },
        correlationId: args.correlationId,
      });
      return {
        ok: true,
        data: { id: data.id, practitionerNumber: data.practitioner_number, handle: data.handle, created: true },
      };
    }
    // A collision on the NUMBER is a race the sequence should have prevented, so take the next one. A
    // collision on user_id means somebody else issued this person's identity while we were working --
    // return theirs rather than a second.
    if (/user_id/.test(error.message)) {
      const theirs = await getIdentity(admin, args.userId);
      if (theirs) return {
        ok: true,
        data: { id: theirs.id, practitionerNumber: theirs.practitioner_number, handle: theirs.handle, created: false },
      };
    }
    if (!/duplicate|unique/i.test(error.message))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }
  return { ok: false, status: 409, code: "NUMBER_UNAVAILABLE", message: "could not allocate a practitioner number" };
}

/**
 * Change a handle.
 *
 * s3: availability checks, and automatic legacy redirects. THE OLD HANDLE IS RETIRED, NOT FREED -- it
 * goes to practice_handle_history so that the printed cards and posters carrying it keep working, and so
 * nobody else can claim it.
 */
/**
 * Why a handle was refused, in the practitioner's words.
 *
 * ⚠ `reserved` DOES NOT SAY WHY THAT PARTICULAR NAME IS RESERVED. practice_reserved_handle holds a
 * `reason` column -- platform, brand, profession, routing -- and repeating it back would tell somebody
 * probing the namespace which names the operator cares about and why. "It is not available" is the whole
 * of what a caller is owed.
 */
const REFUSAL: Record<string, { code: string; status: number; message: string }> = {
  invalid: {
    code: "HANDLE_INVALID", status: 400,
    message: "a handle is 3 to 30 characters, starts with a letter, and uses only lowercase letters and numbers",
  },
  reserved: { code: "HANDLE_RESERVED", status: 409, message: "that handle is not available" },
  taken: { code: "HANDLE_TAKEN", status: 409, message: "that handle is in use" },
  retired: {
    code: "HANDLE_RETIRED", status: 409,
    message: "that handle used to belong to somebody else, and stays with them so their printed codes keep working",
  },
  unreadable: {
    code: "HANDLE_UNREADABLE", status: 503,
    message: "whether that handle is free could not be checked just now, so nothing was changed",
  },
};

/**
 * ⚠ A UNIQUE VIOLATION ON THE HANDLE COLUMN IS "SOMEBODY ELSE GOT IT FIRST", NOT AN INTERNAL ERROR.
 *
 * handleAvailable() cannot settle a race -- two claims of the same free name both read "available" and
 * both proceed. The unique constraint from migration 218 is the only thing that can, so the write is
 * attempted and ITS refusal is the answer. Returning the raw Postgres message instead would both leak
 * the constraint's name and tell the loser nothing they could act on.
 */
type Refused = { ok: false; status: number; code: string; message: string };

const writeRefusal = (error: { code?: string; message: string }): Refused => {
  if (error.code === "23505" || /duplicate|unique/i.test(error.message))
    return { ok: false, ...REFUSAL.taken };
  return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
};

export async function changeHandle(admin: any, args: {
  userId: string; handle: string; correlationId: string;
}): Promise<EngineResult<{ handle: string; previous: string | null }>> {
  const identity = await getIdentity(admin, args.userId);
  if (!identity) return { ok: false, status: 404, code: "NO_IDENTITY", message: "no identity has been issued" };

  const h = normaliseHandle(args.handle);
  const check = await handleAvailable(admin, h, identity.id);
  if (!check.available) return { ok: false, ...REFUSAL[check.reason ?? "invalid"] };
  if (identity.handle === h) return { ok: true, data: { handle: h, previous: null } };

  const previous: string | null = identity.handle ?? null;
  if (previous) {
    const { error: historyError } = await admin.from("practice_handle_history")
      .insert({ handle: previous, identity_id: identity.id });
    // THE HISTORY WRITE COMES FIRST AND ITS FAILURE STOPS THE CHANGE. Freeing the old handle without
    // recording it would break every poster carrying it and leave it claimable by somebody else.
    if (historyError && !/duplicate|unique/i.test(historyError.message))
      return { ok: false, status: 500, code: "HISTORY_FAILED", message: `the old handle could not be retired, so nothing was changed: ${historyError.message}` };
  }

  const { data: updated, error } = await admin.from("practice_practitioner_identity")
    .update({ handle: h, updated_at: nowIso() }).eq("id", identity.id).select("id");
  if (error) return writeRefusal(error);
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: identity.primary_workspace_id, actorId: args.userId, eventType: "practice.handle_changed",
    payload: { identityId: identity.id, from: previous, to: h }, correlationId: args.correlationId,
  });
  return { ok: true, data: { handle: h, previous } };
}

/**
 * CLAIM the first handle -- the deliberate act that gives a practitioner a public address.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ SEPARATE FROM changeHandle BECAUSE IT IS A DIFFERENT ACT WITH A DIFFERENT COST.
 *
 * A CHANGE retires the outgoing handle into practice_handle_history, where it stays claimed for ever. A
 * CLAIM retires nothing: there is no previous name, so the namespace is not consumed twice. Refusing to
 * let this function overwrite an existing handle keeps that true -- a screen that "claimed" over the top
 * would silently retire a name and the practitioner would find out from a dead poster.
 *
 * ⚠ THE WRITE IS THE COLLISION CHECK, NOT THE READ ABOVE IT. `.is("handle", null)` in the update is what
 * makes this idempotent-safe against this identity being claimed twice concurrently, and the unique
 * constraint is what settles two DIFFERENT identities racing for the same name. Neither is a check
 * followed by a write. This codebase has been bitten three times by that pattern -- most recently a
 * one-time code accepted ten times under concurrency -- so the read below exists only for the two rules
 * the database cannot enforce (reserved, and retired by somebody else), and its failure is a refusal.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export async function claimHandle(admin: any, args: {
  userId: string; handle: string; correlationId: string;
}): Promise<EngineResult<{ handle: string; bookingUrl: string }>> {
  const identity = await getIdentity(admin, args.userId);
  if (!identity)
    return { ok: false, status: 404, code: "NO_IDENTITY", message: "no identity has been issued for you yet" };
  if (identity.handle)
    return {
      ok: false, status: 409, code: "HANDLE_ALREADY_CLAIMED",
      message: `you already have @${identity.handle}. Changing it retires the old one permanently, which is a different decision from claiming your first.`,
    };

  const h = normaliseHandle(args.handle);
  const check = await handleAvailable(admin, h, identity.id);
  if (!check.available) return { ok: false, ...REFUSAL[check.reason ?? "invalid"] };

  const { data: updated, error } = await admin.from("practice_practitioner_identity")
    .update({ handle: h, updated_at: nowIso() })
    .eq("id", identity.id).is("handle", null).select("id, handle");
  if (error) return writeRefusal(error);
  // Zero rows and no error means the `is null` guard held: this identity acquired a handle between the
  // read and the write. Reported as already claimed rather than as a mysterious not-found.
  if (!updated || updated.length === 0)
    return {
      ok: false, status: 409, code: "HANDLE_ALREADY_CLAIMED",
      message: "a handle was claimed for you a moment ago, so this one was not written",
    };

  await audit(admin, {
    workspaceId: identity.primary_workspace_id, actorId: args.userId,
    eventType: "practice.handle_claimed",
    payload: { identityId: identity.id, handle: h, bookingUrl: bookingUrl(h) },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { handle: h, bookingUrl: bookingUrl(h) } };
}

/**
 * The name an identity is issued under, when nobody has typed one for this call.
 *
 * ⚠ THIS IS NOT A PUBLIC NAME AND ISSUING IT PUBLISHES NOTHING. display_name is NOT NULL on the identity
 * (migration 218), the row is created `hidden`, and resolveHandle refuses a hidden identity -- so the
 * name sits privately against the row until its owner both claims a handle and changes their discovery
 * mode. That is two deliberate acts away from a stranger being able to read it.
 *
 * The platform profile first, because that is the name the person themselves entered. The workspace name
 * second, and ONLY for an individual practice, where provisioning set it from the practitioner's own
 * stated display name. A managed practice is called something that is not a person, and issuing an
 * identity under a clinic's name would put a business where a clinician belongs -- so it returns null and
 * the caller has to ask.
 */
export async function resolveDisplayName(
  admin: any, userId: string, workspaceId: string | null,
): Promise<string | null> {
  const { data: profile } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  const fromProfile = (profile?.full_name ?? "").trim();
  if (fromProfile.length >= 2) return fromProfile;

  if (!workspaceId) return null;
  const { data: ws } = await admin.from("practice_workspace")
    .select("name, type").eq("id", workspaceId).maybeSingle();
  if (ws?.type !== "individual_practice") return null;
  const fromWorkspace = (ws?.name ?? "").trim();
  return fromWorkspace.length >= 2 ? fromWorkspace : null;
}

// ── WHAT PRACTICE SETUP SHOWS ────────────────────────────────────────────────────────────────────────

/**
 * ⚠ EVERY FIELD IS A STRING, A BOOLEAN, A NUMBER, NULL, OR AN ARRAY OF THOSE. NOTHING IS A FUNCTION.
 *
 * This payload is handed from a server component to a client one. A method on it type-checks, passes
 * eslint, passes every harness and kills the page at runtime -- which is exactly how the Follow-ups
 * board died this week. The harness walks this object and asserts the same thing, because a rule that is
 * only a comment is a rule that lasts until the next field is added.
 */
export type IdentitySetupView = {
  /**
   * The three states, kept apart. `none` is "no identity row exists", which is a real and recoverable
   * situation for a practice provisioned before issuance was wired in -- NOT an error, and NOT the same
   * as `unclaimed`.
   */
  state: "none" | "unclaimed" | "claimed" | "unreadable";
  /** Populated only for `unreadable`. A failed read says so instead of rendering as "you have nothing". */
  reason: string | null;

  practitionerNumber: string | null;
  displayName: string | null;
  handle: string | null;
  bookingUrl: string | null;
  discovery: string | null;
  identityStatus: string | null;

  /** The host a claimed handle would hang off, so the screen can show the shape before anything is typed. */
  host: string;
  /** What a claim costs, in the words the harness also checks. */
  permanenceNotice: string;

  /**
   * Candidates s3's algorithm produced THAT ARE ACTUALLY FREE. Offered, never applied -- and the
   * distinction is the whole point of this build.
   */
  suggestions: string[];
  /** True when at least one candidate could not be checked, so the list may be short rather than complete. */
  suggestionsIncomplete: boolean;

  /**
   * The booking page, which is a different thing from the address. Reported honestly: this build has no
   * surface that creates or publishes one, and migration 254's `practice_booking_access_publishable`
   * constraint -- not this code -- is what refuses a published page with no handle.
   */
  bookingPage: {
    state: "absent" | "present" | "unreadable";
    reason: string | null;
    publishState: string | null;
    handle: string | null;
  };
};

/** How many name candidates are worth offering. Enough to choose from, few enough to read. */
const SUGGESTION_LIMIT = 5;

export async function identitySetupView(admin: any, args: {
  userId: string; workspaceId: string; fallbackDisplayName?: string | null;
}): Promise<IdentitySetupView> {
  const host = identityHost();
  const base = {
    reason: null as string | null,
    practitionerNumber: null as string | null,
    displayName: null as string | null,
    handle: null as string | null,
    bookingUrl: null as string | null,
    discovery: null as string | null,
    identityStatus: null as string | null,
    host,
    permanenceNotice: HANDLE_PERMANENCE_NOTICE,
    suggestions: [] as string[],
    suggestionsIncomplete: false,
  };

  const bookingPage = await bookingPageState(admin, args.workspaceId);

  const { data: row, error } = await admin.from("practice_practitioner_identity")
    .select("practitioner_number, display_name, handle, discovery, status")
    .eq("user_id", args.userId).maybeSingle();
  // ⚠ A FAILED READ IS NOT "YOU HAVE NO IDENTITY". Reporting it as `none` would offer a practitioner a
  // button that issues a SECOND permanent number the moment the database answered again.
  if (error) return { ...base, state: "unreadable", reason: error.message, bookingPage };

  if (!row) {
    return { ...base, state: "none", displayName: args.fallbackDisplayName ?? null, bookingPage };
  }

  if (row.handle) {
    return {
      ...base, state: "claimed",
      practitionerNumber: row.practitioner_number, displayName: row.display_name,
      handle: row.handle, bookingUrl: bookingUrl(row.handle),
      discovery: row.discovery, identityStatus: row.status,
      bookingPage,
    };
  }

  const free: string[] = [];
  let incomplete = false;
  for (const candidate of handleCandidates(row.display_name ?? "", 24)) {
    if (free.length >= SUGGESTION_LIMIT) break;
    const check = await handleAvailable(admin, candidate);
    if (check.available) free.push(candidate);
    else if (check.reason === "unreadable") { incomplete = true; break; }
  }

  return {
    ...base, state: "unclaimed",
    practitionerNumber: row.practitioner_number, displayName: row.display_name,
    discovery: row.discovery, identityStatus: row.status,
    suggestions: free, suggestionsIncomplete: incomplete,
    bookingPage,
  };
}

/**
 * Is there a booking-page profile for this practice, and what state is it in?
 *
 * ⚠ ABSENT IS NOT UNREADABLE, AND NEITHER IS AN ERROR. Migration 254 created practice_booking_access;
 * nothing in this build writes to it, so `absent` is the honest answer for every practice today. A
 * missing TABLE (PGRST205) is reported as absent too -- a deployment that has not applied 254 has no
 * booking page in exactly the sense that matters here -- while any other failure is `unreadable`.
 */
async function bookingPageState(admin: any, workspaceId: string): Promise<IdentitySetupView["bookingPage"]> {
  const { data, error } = await admin.from("practice_booking_access")
    .select("handle, publish_state").eq("workspace_id", workspaceId).maybeSingle();
  if (error) {
    if (error.code === "PGRST205" || /could not find the table/i.test(error.message ?? ""))
      return { state: "absent", reason: "the booking-page store is not present in this deployment", publishState: null, handle: null };
    return { state: "unreadable", reason: error.message, publishState: null, handle: null };
  }
  if (!data) return { state: "absent", reason: null, publishState: null, handle: null };
  return { state: "present", reason: null, publishState: data.publish_state ?? null, handle: data.handle ?? null };
}

/** The public profile fields (s6) and the discovery mode (s7). All practitioner-controlled. */
export async function updateIdentity(admin: any, args: {
  userId: string; displayName?: string; qualifications?: string; specialties?: string;
  biography?: string; languages?: string; consultationTypes?: string;
  discovery?: string; primaryWorkspaceId?: string | null; correlationId: string;
}): Promise<EngineResult<{ id: string; discovery: string }>> {
  const identity = await getIdentity(admin, args.userId);
  if (!identity) return { ok: false, status: 404, code: "NO_IDENTITY", message: "no identity has been issued" };

  if (args.discovery && !DISCOVERY_MODES.some(m => m.key === args.discovery))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `discovery must be one of: ${DISCOVERY_MODES.map(m => m.key).join(", ")}` };

  // GOING PUBLIC NEEDS A NAME AND A HANDLE. A public listing with neither is a page that cannot be found
  // and cannot be identified, and it would still have published the row.
  if (args.discovery === "public" && !identity.handle)
    return { ok: false, status: 409, code: "NO_HANDLE", message: "choose a handle before listing publicly -- a public page needs an address" };

  const patch: Record<string, unknown> = { updated_at: nowIso() };
  const map: Record<string, string> = {
    displayName: "display_name", qualifications: "qualifications", specialties: "specialties",
    biography: "biography", languages: "languages", consultationTypes: "consultation_types",
    discovery: "discovery",
  };
  for (const [k, column] of Object.entries(map)) {
    const v = (args as any)[k];
    if (v !== undefined) patch[column] = typeof v === "string" ? (v.trim() || null) : v;
  }
  if (args.primaryWorkspaceId !== undefined) patch.primary_workspace_id = args.primaryWorkspaceId;
  if (patch.display_name === null)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a display name is required" };

  const { data: updated, error } = await admin.from("practice_practitioner_identity")
    .update(patch).eq("id", identity.id).select("id, discovery");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (args.discovery && args.discovery !== identity.discovery) {
    await audit(admin, {
      workspaceId: identity.primary_workspace_id, actorId: args.userId,
      eventType: "practice.discovery_changed",
      // BOTH VALUES, so "why did my page become findable" has an answer.
      payload: { identityId: identity.id, from: identity.discovery, to: args.discovery },
      correlationId: args.correlationId,
    });
  }
  return { ok: true, data: { id: identity.id, discovery: updated[0].discovery } };
}

/** s10's lifecycle. Forward-only, except that a temporary hide can be undone. */
const TRANSITIONS: Record<string, string[]> = {
  created: ["email_verified", "suspended", "archived"],
  email_verified: ["licence_verified", "active", "suspended", "archived"],
  licence_verified: ["active", "suspended", "archived"],
  active: ["temporarily_hidden", "suspended", "archived"],
  temporarily_hidden: ["active", "suspended", "archived"],
  suspended: ["active", "archived"],
  archived: ["deleted"],
  deleted: [],
};

export async function transitionIdentity(admin: any, args: {
  userId: string; to: string; actorId: string; licenceReference?: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const identity = await getIdentity(admin, args.userId);
  if (!identity) return { ok: false, status: 404, code: "NO_IDENTITY", message: "no identity has been issued" };

  const allowed = TRANSITIONS[identity.status] ?? [];
  if (!allowed.includes(args.to))
    return {
      ok: false, status: 409, code: "ILLEGAL_TRANSITION",
      message: `an identity that is ${identity.status} cannot become ${args.to}${allowed.length ? ` -- only ${allowed.join(", ")}` : ""}`,
    };

  const patch: Record<string, unknown> = { status: args.to, updated_at: nowIso() };
  if (args.to === "licence_verified") {
    // WHO CHECKED, AND WHEN. Nothing here contacts a council; what makes this state true is a person
    // recording that they looked, and their id stays against it. See NOT_BUILT.
    patch.licence_verified_at = nowIso();
    patch.licence_verified_by = args.actorId;
    patch.licence_reference = args.licenceReference?.trim() || null;
  }

  const { data: updated, error } = await admin.from("practice_practitioner_identity")
    .update(patch).eq("id", identity.id).select("id, status");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: identity.primary_workspace_id, actorId: args.actorId,
    eventType: "practice.identity_transitioned",
    payload: { identityId: identity.id, from: identity.status, to: args.to },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { status: args.to } };
}

// ── RESOLUTION AND SEARCH ────────────────────────────────────────────────────────────────────────────

/** Only the fields s6 lists. Never the internal id, the user id or the workspace -- s13. */
function publicView(row: any) {
  return {
    practitionerNumber: row.practitioner_number,
    handle: row.handle,
    displayName: row.display_name,
    qualifications: row.qualifications,
    specialties: row.specialties,
    biography: row.biography,
    languages: row.languages,
    consultationTypes: row.consultation_types,
    discovery: row.discovery,
    bookingUrl: row.handle ? bookingUrl(row.handle) : null,
    // WHETHER BOOKING IS OPEN, and why not when it is not. s7's modes differ in exactly this.
    bookingOpen: row.discovery === "public" || row.discovery === "link_only",
    bookingNote:
      row.discovery === "existing_patients" ? "Bookings here are for people already registered with this practice."
      : row.discovery === "referral_only" ? "New bookings come by referral."
      : null,
  };
}

/**
 * Resolve a handle for the public page (s8, s11).
 *
 * A HIDDEN IDENTITY IS A 404, NOT A REFUSAL. "This practitioner exists but will not see you" is a
 * disclosure about a named person; nothing distinguishes it from a handle that was never issued.
 * Returns the REDIRECT when the handle is a retired one, which is what s8's automatic redirect is.
 */
export async function resolveHandle(admin: any, rawHandle: string): Promise<
  | { kind: "found"; profile: ReturnType<typeof publicView> }
  | { kind: "redirect"; to: string }
  | { kind: "none" }
> {
  const h = normaliseHandle(rawHandle);
  if (!HANDLE_RE.test(h)) return { kind: "none" };

  const { data: row } = await admin.from("practice_practitioner_identity")
    .select("*").eq("handle", h).maybeSingle();

  if (row) {
    if (row.discovery === "hidden") return { kind: "none" };
    if (!RESOLVABLE_STATES.has(row.status)) return { kind: "none" };
    return { kind: "found", profile: publicView(row) };
  }

  // s8: legacy URLs redirect automatically.
  const { data: retired } = await admin.from("practice_handle_history")
    .select("identity_id").eq("handle", h).maybeSingle();
  if (retired) {
    const { data: current } = await admin.from("practice_practitioner_identity")
      .select("handle, discovery, status").eq("id", retired.identity_id).maybeSingle();
    if (current?.handle && current.discovery !== "hidden" && RESOLVABLE_STATES.has(current.status))
      return { kind: "redirect", to: `/@${current.handle}` };
  }
  return { kind: "none" };
}

/**
 * s9's search resolution, in its exact priority order:
 *   Exact Handle -> Practitioner Number -> Exact Display Name -> Surname -> Specialty -> Fuzzy Match
 *
 * s7: ONLY PUBLIC IDENTITIES ARE SEARCHABLE. That filter is applied in every query below rather than to
 * the merged result -- filtering afterwards is the classic search leak, where a total discloses that a
 * hidden practitioner exists. Same position CPR-350 took.
 */
export async function searchPractitioners(admin: any, rawQuery: string, limit = 20) {
  const q = rawQuery.trim();
  if (q.length < 2) return { tier: null, results: [] as ReturnType<typeof publicView>[] };

  const listed = (builder: any) => builder.eq("discovery", "public").in("status", [...RESOLVABLE_STATES]);
  const base = () => listed(admin.from("practice_practitioner_identity").select("*"));
  const seen = new Set<string>();
  const out: any[] = [];
  const take = (rows: any[] | null) => {
    for (const r of rows ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id); out.push(r);
    }
  };

  const handle = normaliseHandle(q);
  // THE NUMBER IS PARSED, NOT COMPARED AS TYPED. A patient reading one off a card types spaces, lower
  // case or no separators, and none of that changes who they meant -- but a transposed pair does, and
  // the check digit refuses it here rather than letting it resolve to a different real clinician.
  const format = await getFormat(admin);
  const parsedNumber = parsePractitionerNumber(q, format);

  const tiers: { tier: string; run: () => Promise<any> }[] = [
    { tier: "handle", run: () => base().eq("handle", handle).limit(limit) },
    {
      tier: "number",
      run: () => parsedNumber.ok
        ? base().eq("practitioner_number", parsedNumber.normalised).limit(limit)
        : Promise.resolve({ data: [] }),
    },
    { tier: "display_name", run: () => base().ilike("display_name", q).limit(limit) },
    { tier: "surname", run: () => base().ilike("display_name", `% ${q}`).limit(limit) },
    { tier: "specialty", run: () => base().ilike("specialties", `%${q}%`).limit(limit) },
    { tier: "fuzzy", run: () => base().ilike("display_name", `%${q}%`).limit(limit) },
  ];

  let matchedTier: string | null = null;
  for (const t of tiers) {
    const { data } = await t.run();
    if ((data ?? []).length > 0) {
      // THE TIER THAT FIRST MATCHED IS REPORTED, so a caller can tell an exact hit from a fuzzy one --
      // which is the whole point of a priority order.
      if (!matchedTier) matchedTier = t.tier;
      take(data);
      if (matchedTier === "handle" || matchedTier === "number") break;
    }
  }
  return { tier: matchedTier, results: out.slice(0, limit).map(publicView) };
}

// ── THE SHARING TOOLKIT (s12) ────────────────────────────────────────────────────────────────────────

/**
 * QR codes, generated in process.
 *
 * NO EXTERNAL SERVICE. A QR code is a deterministic encoding of a string; fetching one from an image API
 * would send every practitioner's booking URL to a third party and make a printed card depend on
 * somebody else's uptime.
 */
export async function bookingQr(handle: string, format: "svg" | "png" = "svg"): Promise<string> {
  const url = bookingUrl(handle);
  return format === "svg"
    ? QRCode.toString(url, { type: "svg", margin: 1, width: 320, errorCorrectionLevel: "M" })
    : QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M" });
}

/**
 * s12's message templates.
 *
 * TEMPLATES, NOT MESSAGES. This product sends nothing -- CPR-320 and CPR-340 settled that and their
 * harnesses enforce it structurally. What it can honestly do is write the text for a practitioner to
 * paste into WhatsApp themselves, which is what a "sharing toolkit" is when there is no channel.
 */
export function shareTemplates(displayName: string, handle: string) {
  const url = bookingUrl(handle);
  return {
    sentByThisProduct: false,
    templates: [
      { key: "whatsapp", label: "WhatsApp", body: `Hello, this is ${displayName}. You can book an appointment with me here: ${url}` },
      { key: "sms", label: "SMS", body: `${displayName} -- book an appointment: ${url}` },
      { key: "email", label: "Email", subject: `Booking with ${displayName}`, body: `Hello,\n\nYou can book an appointment with me using the link below.\n\n${url}\n\n${displayName}` },
      { key: "card", label: "Printed card", body: `${displayName}\n@${handle}\n${url}` },
    ],
  };
}
